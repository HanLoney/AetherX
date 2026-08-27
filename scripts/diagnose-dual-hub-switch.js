const http = require("node:http");
const https = require("node:https");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { app, safeStorage } = require("electron");
const { AuthStore } = require("../frontend/desktop/auth-store");

const authFile = path.join(
  process.env.APPDATA || "",
  "aetherx-desktop",
  "auth.json"
);
const sourceUserData = path.dirname(authFile);
const temporaryUserData = fs.mkdtempSync(path.join(os.tmpdir(), "aetherx-switch-diagnostic-"));
fs.copyFileSync(
  path.join(sourceUserData, "Local State"),
  path.join(temporaryUserData, "Local State")
);
app.setPath("userData", temporaryUserData);

async function request(baseUrl, token, pathname, options = {}) {
  const url = new URL(pathname, `${baseUrl.replace(/\/+$/, "")}/`);
  const transport = url.protocol === "https:" ? https : http;
  const method = String(options.method || "GET").toUpperCase();
  const body = options.body === undefined ? "" : JSON.stringify(options.body);
  const response = await new Promise((resolve, reject) => {
    const pending = transport.request(url, {
      method,
      agent: false,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body)
        } : {})
      }
    }, (incoming) => {
      const chunks = [];
      incoming.on("data", (chunk) => chunks.push(chunk));
      incoming.on("end", () => resolve({
        status: incoming.statusCode,
        body: Buffer.concat(chunks).toString("utf8")
      }));
    });
    pending.setTimeout(300_000, () => pending.destroy(new Error("request timed out")));
    pending.on("error", reject);
    if (body) pending.write(body);
    pending.end();
  });
  let payload = {};
  try { payload = JSON.parse(response.body); } catch {}
  return { status: response.status, payload };
}

function summarizeCluster(result) {
  const cluster = result?.payload?.data || {};
  return {
    status: result.status,
    activeNodeId: cluster.activeNodeId,
    localNodeId: cluster.localNodeId,
    epoch: cluster.epoch,
    state: cluster.state,
    transitionId: cluster.transitionId || ""
  };
}

async function main() {
  await app.whenReady();
  const stored = new AuthStore(authFile, safeStorage).load();
  const desktop = stored.routing?.nodes?.find((node) => {
    try { return Number(new URL(node.serverUrl).port) === 4318 && node.token; }
    catch { return false; }
  });
  if (!desktop) throw new Error("Desktop Hub session is unavailable.");
  const hubs = await request(
    desktop.serverUrl,
    desktop.token,
    "/api/v1/cluster/mobile-hubs"
  );
  const target = hubs.payload?.data?.hubs?.find(
    (hub) => hub.ready && hub.hubOnline === true
  );
  if (!target) throw new Error("No ready online mobile Hub is available.");

  const output = { targetNodeId: target.id };
  output.before = summarizeCluster(await request(
    desktop.serverUrl,
    desktop.token,
    "/api/v1/cluster/status"
  ));
  output.preflight = await request(
    desktop.serverUrl,
    desktop.token,
    "/api/v1/cluster/switch/preflight",
    { method: "POST", body: { targetNodeId: target.id } }
  );
  if (output.preflight.status >= 400) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  const observedStates = [];
  let sampling = true;
  const sampler = (async () => {
    let previous = "";
    while (sampling) {
      const current = summarizeCluster(await request(
        desktop.serverUrl,
        desktop.token,
        "/api/v1/cluster/status"
      ));
      const key = [
        current.state,
        current.epoch,
        current.activeNodeId,
        current.transitionId
      ].join("|");
      if (key !== previous) {
        observedStates.push({ ...current, observedAt: Date.now() });
        previous = key;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  })();
  output.prepare = await request(
    desktop.serverUrl,
    desktop.token,
    "/api/v1/cluster/switch/prepare",
    { method: "POST", body: { targetNodeId: target.id } }
  );
  sampling = false;
  await sampler;
  output.observedStates = observedStates;
  output.afterPrepare = summarizeCluster(await request(
    desktop.serverUrl,
    desktop.token,
    "/api/v1/cluster/status"
  ));
  const transitionId = output.prepare.payload?.data?.transitionId;
  if (transitionId) {
    output.abort = await request(
      desktop.serverUrl,
      desktop.token,
      "/api/v1/cluster/switch/abort",
      { method: "POST", body: { transitionId } }
    );
  }
  output.final = summarizeCluster(await request(
    desktop.serverUrl,
    desktop.token,
    "/api/v1/cluster/status"
  ));
  console.log(JSON.stringify(output, null, 2));
}

main()
  .catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
  })
  .finally(() => app.quit());
