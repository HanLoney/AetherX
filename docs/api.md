# API 使用说明

AetherX Hub 提供版本化 REST API 和 SSE 增量通知。机器可读契约位于 [backend/openapi.yaml](../backend/openapi.yaml)。

## 基础地址

本地默认地址：

```text
http://127.0.0.1:4318/api/v1
```

远程部署示例：

```text
https://hub.example.com/api/v1
```

健康检查不带 `/api/v1`：

```http
GET /health
```

## 认证

登录和设备配对成功后会返回只展示一次的令牌。业务请求使用 Bearer 认证：

```http
Authorization: Bearer <token>
```

服务端从令牌解析用户身份。客户端不应发送 `user_id` 试图选择数据所有者。

### 查询注册状态

```bash
curl https://hub.example.com/api/v1/auth/config
```

返回 `registrationMode`、`registrationAvailable`、`firstUser` 和 `requiresRegistrationSecret`。默认模式为 `open`。

### 登录

```bash
curl -X POST https://hub.example.com/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"demo","password":"replace-with-your-password"}'
```

### 携带令牌读取会话

```bash
curl https://hub.example.com/api/v1/auth/session \
  -H 'Authorization: Bearer replace-with-session-token'
```

示例中的密码和令牌仅为占位符，不要把真实值写入 Shell 历史、Issue 或截图。

## 响应格式

成功响应通常为：

```json
{
  "data": {},
  "requestId": "request-id"
}
```

错误响应通常为：

```json
{
  "error": {
    "code": "STABLE_ERROR_CODE",
    "message": "可展示给用户的错误信息"
  },
  "requestId": "request-id"
}
```

排障时优先记录 `requestId`，不要记录 Authorization 请求头。

## 增量同步

客户端先使用：

```http
GET /api/v1/sync/changes?after=<seq>&limit=<n>
```

补拉遗漏变化，再连接：

```http
GET /api/v1/sync/events?after=<seq>
Accept: text/event-stream
```

SSE 只通知实体类型、实体 ID、操作和游标。客户端收到通知后通过业务 API 重新读取数据。断线重连时必须继续使用最后确认的游标，不能只依赖在线事件。

## OpenAPI 使用

可以把 `backend/openapi.yaml` 导入 Swagger Editor、Bruno、Postman 或其他支持 OpenAPI 3.1 的工具。当前契约用于说明稳定路径和认证边界；新增接口时应同时补充请求与响应 Schema。
