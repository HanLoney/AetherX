const { randomUUID } = require("node:crypto");
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

function createRouter({ corsOrigin = "*" } = {}) {
  const routes = [];

  function add(method, path, handler) {
    routes.push({ method, ...compilePath(path), handler });
  }

  async function handle(request, response) {
    const requestId = request.headers["x-request-id"] || randomUUID();
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("X-Request-Id", requestId);
    response.setHeader("Access-Control-Allow-Origin", corsOrigin);
    response.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Xuan-User-Id, X-Request-Id"
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
      const context = {
        request,
        requestId,
        params,
        query: Object.fromEntries(url.searchParams.entries()),
        userId: String(request.headers["x-xuan-user-id"] || "local-user"),
        body: ["POST", "PUT", "PATCH"].includes(request.method)
          ? await readJson(request)
          : {}
      };
      const result = await route.handler(context);
      const status = result?.status || 200;
      response.writeHead(status);
      response.end(
        status === 204
          ? undefined
          : JSON.stringify({ data: result?.data ?? result ?? null, requestId })
      );
    } catch (error) {
      const status = error.status || 500;
      response.writeHead(status);
      response.end(
        JSON.stringify({
          error: {
            code: error.code || "INTERNAL_ERROR",
            message:
              status === 500 ? "服务器处理请求时发生错误。" : error.message,
            ...(error.details ? { details: error.details } : {})
          },
          requestId
        })
      );
      if (status === 500) console.error(`[${requestId}]`, error);
    }
  }

  return { add, handle };
}

module.exports = { createRouter };
