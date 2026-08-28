const fs = require("node:fs");

function registerMediaRoutes(router, service) {
  router.add(
    "GET",
    "/api/v1/media/:id",
    ({ userId, params, query, request, response }) => {
      const asset = service.open(
        userId,
        params.id,
        query.variant === "preview" ? "preview" : "original"
      );
      const etag = `\"${asset.contentHash}\"`;
      response.setHeader("Content-Type", asset.mimeType);
      response.setHeader("Cache-Control", "private, max-age=86400, immutable");
      response.setHeader("ETag", etag);
      response.setHeader("Referrer-Policy", "no-referrer");
      if (request.headers["if-none-match"] === etag) {
        response.writeHead(304);
        response.end();
        return { handled: true };
      }
      response.setHeader("Content-Length", asset.byteSize);
      response.writeHead(200);
      fs.createReadStream(asset.filePath).pipe(response);
      return { handled: true };
    },
    { queryAuth: true }
  );
}

module.exports = { registerMediaRoutes };
