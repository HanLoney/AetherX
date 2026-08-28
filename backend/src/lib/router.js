const { randomUUID } = require("node:crypto");
const { gzipSync } = require("node:zlib");
const { HttpError } = require("./http-error");

function compilePath(path) {
  const keys = [];
  const expression = path
    .split("/")
    .map((part) => {
      if (!part.startsWith(":")) return part;
      keys.push(part.slice(1));
      return "([^/]+)";
    })
    .join("/");
  return { keys, regex: new RegExp(`^${expression}/?$`) };
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16 * 1024 * 1024) {
      throw new HttpError(413, "PAYLOAD_TOO_LARGE", "请求内容过大。");
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "INVALID_JSON", "请求内容不是有效的 JSON。");
  }
}

function createRouter({
  corsOrigin = "*",
  authenticate,
  authenticatePeer,
  isWriteLocked,
  isModuleEnabled
} = {}) {
  const routes = [];

  function add(method, path, handler, options = {}) {
    routes.push({
      method,
      ...compilePath(path),
      handler,
      public: options.public === true,
      peer: options.peer === true,
      queryAuth: options.queryAuth === true,
      parseBody: options.parseBody !== false,
      allowDuringWriteLock: options.allowDuringWriteLock === true,
      allowDuringClusterTransition:
        options.allowDuringClusterTransition === true,
      moduleId: String(options.module || "")
    });
  }

  async function handle(request, response) {
    const requestId = request.headers["x-request-id"] || randomUUID();
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("X-Request-Id", requestId);
    response.setHeader("Access-Control-Allow-Origin", corsOrigin);
    response.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Request-Id, X-AetherX-Archive-Password, " +
        "X-AetherX-Peer-Space, X-AetherX-Peer-Node, X-AetherX-Peer-Key, " +
        "X-AetherX-Peer-Timestamp, X-AetherX-Peer-Nonce, X-AetherX-Peer-Signature"
    );
    response.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    );

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    try {
      const url = new URL(request.url, "http://localhost");
      const route = routes.find(
        (candidate) =>
          candidate.method === request.method && candidate.regex.test(url.pathname)
      );
      if (!route) {
        throw new HttpError(404, "ROUTE_NOT_FOUND", "接口不存在。");
      }
      const match = url.pathname.match(route.regex);
      const params = Object.fromEntries(
        route.keys.map((key, index) => [key, decodeURIComponent(match[index + 1])])
      );
      const queryToken = route.queryAuth ? url.searchParams.get("access_token") : "";
      const authorization = request.headers.authorization ||
        (queryToken ? `Bearer ${queryToken}` : "");
      const parsesBody = route.parseBody &&
        ["POST", "PUT", "PATCH"].includes(request.method);
      let body = route.peer && parsesBody ? await readJson(request) : undefined;
      const auth = route.public
        ? null
        : route.peer
          ? authenticatePeer?.({
              method: request.method,
              path: request.url,
              body: body ?? {},
              headers: request.headers
            })
          : authenticate?.(authorization);
      if (!route.public && !auth) {
        throw new HttpError(
          401,
          route.peer ? "PEER_AUTH_REQUIRED" : "AUTH_REQUIRED",
          route.peer ? "Peer 节点认证失败。" : "请先登录。"
        );
      }
      if (
        !route.public &&
        route.moduleId &&
        typeof isModuleEnabled === "function" &&
        isModuleEnabled(auth.userId, route.moduleId) !== true
      ) {
        throw new HttpError(
          403,
          "MODULE_DISABLED",
          "这个功能模块当前已停用。",
          { moduleId: route.moduleId }
        );
      }
      const writeLock =
        !route.public &&
        ["POST", "PUT", "PATCH", "DELETE"].includes(request.method) &&
        isWriteLocked?.(auth.userId);
      if (writeLock) {
        const normalizedLock = writeLock === true
          ? {
              scope: "archive",
              code: "ARCHIVE_WRITE_LOCKED",
              message: "完整存档任务正在进行，暂时不能修改数据。"
            }
          : writeLock;
        const allowed =
          (normalizedLock.scope === "archive" && route.allowDuringWriteLock) ||
          (normalizedLock.scope === "cluster" &&
            route.allowDuringClusterTransition);
        if (!allowed) {
          throw new HttpError(
            423,
            normalizedLock.code || "WRITE_LOCKED",
            normalizedLock.message || "当前数据空间暂时禁止写入。",
            normalizedLock.details
          );
        }
      }
      const context = {
        request,
        response,
        requestId,
        params,
        query: Object.fromEntries(url.searchParams.entries()),
        auth,
        userId: auth?.userId || "",
        body: parsesBody
          ? body ?? await readJson(request)
          : {}
      };
      const result = await route.handler(context);
      if (result?.handled) return;
      const status = result?.status || 200;
      if (status === 204) {
        response.writeHead(status);
        response.end();
      } else {
        sendJson(request, response, status, {
          data: result?.data ?? result ?? null,
          requestId
        });
      }
    } catch (error) {
      const status = error.status || 500;
      sendJson(request, response, status, {
          error: {
            code: error.code || "INTERNAL_ERROR",
            message:
              status === 500 ? "服务器处理请求时发生错误。" : error.message,
            ...(error.details ? { details: error.details } : {})
          },
          requestId
        });
      if (status === 500) console.error(`[${requestId}]`, error);
    }
  }

  return { add, handle };
}

function sendJson(request, response, status, payload) {
  const bytes = Buffer.from(JSON.stringify(payload));
  const acceptsGzip = /(?:^|,)\s*gzip\s*(?:,|$)/i.test(
    String(request.headers["accept-encoding"] || "")
  );
  if (acceptsGzip && bytes.length >= 1024) {
    const compressed = gzipSync(bytes);
    response.setHeader("Content-Encoding", "gzip");
    response.setHeader("Vary", "Accept-Encoding");
    response.setHeader("Content-Length", compressed.length);
    response.writeHead(status);
    response.end(compressed);
    return;
  }
  response.setHeader("Content-Length", bytes.length);
  response.writeHead(status);
  response.end(bytes);
}

module.exports = { createRouter };
