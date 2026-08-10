import { AetherApi } from "./api";

export interface CompletePairingBundle {
  serverUrls: string[];
  clientCode: string;
  hubCode: string;
}

type PairingProbe = (serverUrl: string, signal: AbortSignal) => Promise<unknown>;

export function parseCompletePairingCode(value: string): CompletePairingBundle | null {
  const raw = String(value || "").trim();
  if (!/^aetherx:\/\/complete-pair\?/i.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (url.searchParams.get("v") === "2") {
      const serverUrls = requiredUrls(url.searchParams.getAll("s"));
      const clientId = required(url.searchParams.get("c"));
      const clientSecret = requiredSecret(url.searchParams.get("cs"));
      const hubSessionId = required(url.searchParams.get("h"));
      const hubSecret = requiredSecret(url.searchParams.get("hs"));
      const expiresAt = Number(url.searchParams.get("e"));
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error("expired");
      return {
        serverUrls,
        clientCode: JSON.stringify({
          serverUrl: serverUrls[0],
          id: clientId,
          secret: clientSecret,
          expiresAt
        }),
        hubCode: JSON.stringify({
          version: 2,
          serverUrls,
          sessionId: hubSessionId,
          secret: hubSecret,
          expiresAt
        })
      };
    }

    const encoded = url.searchParams.get("payload");
    if (!encoded) throw new Error("missing payload");
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encoded))) as {
      version?: number;
      client?: Record<string, unknown>;
      hub?: Record<string, unknown>;
    };
    if (payload.version !== 1 || !payload.client || !payload.hub) {
      throw new Error("invalid payload");
    }
    return {
      serverUrls: [],
      clientCode: JSON.stringify(payload.client),
      hubCode: JSON.stringify(payload.hub)
    };
  } catch {
    throw new Error("一体化配对码无法识别，请回到电脑端重新生成。");
  }
}

export async function detectReachablePairingServer(
  values: string[],
  probe: PairingProbe = defaultProbe
) {
  const serverUrls = requiredUrls(values);
  const controllers = serverUrls.map(() => new AbortController());
  const timers = controllers.map((controller) => globalThis.setTimeout(() => controller.abort(), 6_000));

  return new Promise<string>((resolve, reject) => {
    let failures = 0;
    let settled = false;
    serverUrls.forEach((serverUrl, index) => {
      void probe(serverUrl, controllers[index].signal).then(() => {
        if (settled) return;
        settled = true;
        controllers.forEach((controller, controllerIndex) => {
          globalThis.clearTimeout(timers[controllerIndex]);
          if (controllerIndex !== index) controller.abort();
        });
        resolve(serverUrl);
      }).catch(() => {
        globalThis.clearTimeout(timers[index]);
        failures += 1;
        if (!settled && failures === serverUrls.length) {
          settled = true;
          reject(new Error("无法自动连接电脑 AetherX。已尝试 USB、局域网和 Anywhere，请确认电脑端仍在运行。"));
        }
      });
    });
  });
}

export async function runCompletePairing(
  value: string,
  tasks: {
    pairClient(code: string): Promise<unknown>;
    pairHub(code: string): Promise<unknown>;
    probeServer?: PairingProbe;
    onState?: (state: string) => void;
  }
) {
  const bundle = parseCompletePairingCode(value);
  if (!bundle) return false;

  let clientCode = bundle.clientCode;
  let hubCode = bundle.hubCode;
  if (bundle.serverUrls.length) {
    tasks.onState?.("正在自动检测 USB、局域网与 Anywhere…");
    const selected = await detectReachablePairingServer(bundle.serverUrls, tasks.probeServer);
    const ordered = [selected, ...bundle.serverUrls.filter((serverUrl) => serverUrl !== selected)];
    clientCode = JSON.stringify({ ...JSON.parse(clientCode), serverUrl: selected });
    hubCode = JSON.stringify({ ...JSON.parse(hubCode), serverUrls: ordered });
  }

  const results = await Promise.allSettled([
    tasks.pairClient(clientCode),
    tasks.pairHub(hubCode)
  ]);
  const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failure) throw failure.reason;
  return true;
}

async function defaultProbe(serverUrl: string, signal: AbortSignal) {
  return new AetherApi({ baseUrl: serverUrl }).health(signal);
}

function required(value: unknown) {
  const result = String(value || "").trim();
  if (!result) throw new Error("missing value");
  return result;
}

function requiredSecret(value: unknown) {
  const result = required(value);
  if (result.length < 32) throw new Error("invalid secret");
  return result;
}

function requiredUrls(values: unknown[]) {
  const result: string[] = [];
  values.forEach((value) => {
    const url = new URL(required(value));
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("invalid server");
    if (!result.includes(url.origin)) result.push(url.origin);
  });
  if (!result.length) throw new Error("missing server");
  return result.slice(0, 5);
}

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
