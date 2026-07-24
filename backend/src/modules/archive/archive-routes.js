const fs = require("node:fs");
const { pipeline } = require("node:stream/promises");

function registerArchiveRoutes(router, service) {
  router.add("POST", "/api/v1/archives/export", async ({ body, userId }) => {
    const result = await service.createDownload(userId, body.password);
    return {
      data: {
        ...result,
        downloadPath: `/api/v1/archives/download/${encodeURIComponent(result.ticket)}`
      }
    };
  }, { allowDuringWriteLock: true });

  router.add(
    "GET",
    "/api/v1/archives/download/:ticket",
    async ({ response, params }) => {
      const entry = service.takeDownload(params.ticket);
      response.setHeader("Content-Type", "application/vnd.aetherx.archive");
      response.setHeader("Content-Disposition", contentDisposition(entry.fileName));
      response.setHeader("Content-Length", fs.statSync(entry.filePath).size);
      response.writeHead(200);
      try {
        await pipeline(fs.createReadStream(entry.filePath), response);
      } finally {
        service.releaseDownload(entry);
      }
      return { handled: true };
    },
    { public: true, parseBody: false }
  );

  router.add(
    "POST",
    "/api/v1/archives/restore",
    async ({ request, userId }) => ({
      data: await service.restoreRequest(
        userId,
        request,
        decodePassword(request.headers["x-aetherx-archive-password"])
      )
    }),
    { parseBody: false, allowDuringWriteLock: true }
  );
}

function decodePassword(value) {
  try {
    const encoded = String(value || "");
    if (!encoded || encoded.length > 512 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return "";
    return Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function contentDisposition(fileName) {
  const encoded = encodeURIComponent(fileName).replace(/[!'()*]/g, (value) =>
    `%${value.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="AetherX.aetherx"; filename*=UTF-8''${encoded}`;
}

module.exports = { registerArchiveRoutes };
