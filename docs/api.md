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

## Agent Hub 对话

桌面端和手机端都应调用 Agent Hub，不应直接调用 `/ai/chat` 自行实现工具循环。

发起消息：

```http
POST /api/v1/agent/chat
Authorization: Bearer <token>
Content-Type: application/json

{
  "conversationId": "可选的现有会话 ID",
  "content": "帮我看看今天的待办",
  "runtime": {
    "timeZone": "Asia/Shanghai",
    "locale": "zh-CN"
  }
}
```

普通完成时 `status` 为 `completed`。写工具需要确认时，响应会包含：

```json
{
  "status": "approval_required",
  "runId": "短时运行 ID",
  "pendingApproval": { "activityId": "工具卡片消息 ID" },
  "conversation": {},
  "displayMessages": []
}
```

客户端先渲染 `displayMessages`，再将用户选择提交给：

```http
POST /api/v1/agent/runs/{runId}/approve
Authorization: Bearer <token>
Content-Type: application/json

{ "approved": true }
```

一次运行可能连续请求多个写工具，因此批准后仍可能再次返回
`approval_required`。运行只在 Hub 内存中短时保存；收到
`AGENT_RUN_NOT_FOUND` 时应让用户重新发送原消息。同一会话已有请求或授权等待时，
并发消息会返回 `AGENT_CONVERSATION_BUSY`，客户端不应自动重试写入。

`displayMessages` 是界面展示的权威消息流，包含 Markdown、记忆引用和工具卡片。
模型上下文只保存在 Hub，不会随 Agent 响应下发给客户端；客户端不得自行拼接
工具结果或模型历史。

## OpenAPI 使用

可以把 `backend/openapi.yaml` 导入 Swagger Editor、Bruno、Postman 或其他支持 OpenAPI 3.1 的工具。当前契约用于说明稳定路径和认证边界；新增接口时应同时补充请求与响应 Schema。
