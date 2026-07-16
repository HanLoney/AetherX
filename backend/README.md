# AetherX Backend

AetherX Hub 的 Node.js 服务端。它是账号、业务数据、AI Provider 凭证和多端同步状态的唯一权威来源，提供 `/api/v1` REST API 与 SSE 变化通知。

## 环境要求

- Node.js 22.13+
- npm 10+

后端使用 Node.js 内置的 `node:sqlite`，不需要单独安装数据库服务。

## 本地运行

```powershell
cd backend
npm install
npm run dev
```

生产方式启动：

```powershell
npm start
```

默认监听 `http://127.0.0.1:4318`，健康检查：

```powershell
curl.exe http://127.0.0.1:4318/health
```

开发数据库默认位于 `backend/.data/xuanai.db`。

## 配置

复制示例文件并按运行环境加载其中变量：

```powershell
Copy-Item .env.example .env
```

后端不会自动读取 `.env` 文件；开发时需要由 Shell、进程管理器或 IDE 注入，生产环境建议使用 systemd `EnvironmentFile` 或秘密管理服务。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `AETHERX_HOST` | `127.0.0.1` | 监听地址 |
| `AETHERX_PORT` | `4318` | 监听端口 |
| `AETHERX_DATA_DIR` | 当前工作目录下 `.data` | SQLite 与本地加密材料目录 |
| `AETHERX_MASTER_KEY` | 本地模式自动生成 | AI 凭证加密主密钥；生产环境必须固定设置 |
| `AETHERX_REGISTRATION_SECRET` | 空 | 新账号注册口令 |
| `AETHERX_SESSION_TTL_DAYS` | `30` | 登录会话有效天数，最小为 1 |
| `AETHERX_CORS_ORIGIN` | `*` | 允许的浏览器 Origin |

旧版 `XUANAI_HOST`、`XUANAI_PORT`、`XUANAI_DATA_DIR`、`XUANAI_MASTER_KEY` 和 `XUANAI_CORS_ORIGIN` 仍兼容，但新部署应使用 `AETHERX_*`。

> [!WARNING]
> 更换 `AETHERX_MASTER_KEY` 后，数据库中已经保存的 AI API Key 将无法解密。数据库迁移或恢复时必须同时恢复原主密钥。

## 账号与旧数据迁移

- 空数据库允许创建第一个账号；
- 如果设置了注册口令，第一个账号也必须提供口令；
- 已存在账号且未设置注册口令时，注册入口关闭；
- 第一个账号会在同一事务中认领旧版 `local-user` 数据；
- 任一表迁移失败时，账号创建和数据认领一起回滚；
- 账号名长度为 2～32，只允许文字、数字、点、横线和下划线；
- 密码长度为 10～128。

除健康检查、注册、登录和配对流程中的明确公开端点外，API 默认要求：

```http
Authorization: Bearer <token>
```

业务身份只从服务端认证上下文取得，不接受客户端指定用户 ID。

## AI 凭证

AI Provider 和图像 Provider 的 API Key 由 Hub 加密保存。客户端读取配置时不会获得明文 Key。手机端只调用 Hub 的 AI API，不保存 Provider Key。

生产环境应：

- 设置稳定、高熵的 `AETHERX_MASTER_KEY`；
- 限制环境文件和数据目录权限；
- 只通过 HTTPS 反向代理或可信私人网络访问；
- 不把 4318 直接暴露到公网。

## 配对与同步

Hub 支持：

- 短时一次性配对会话；
- 桌面端人工批准；
- 独立、可撤销的设备令牌；
- `sync_changes.seq` 增量游标；
- SSE 在线变化通知；
- 断线后的增量补拉。

同步只记录实体变化，不复制活跃数据库文件，也不会在 SSE 中传输完整私人内容。详见[家庭节点与多端同步架构](../docs/architecture/home-hub-sync.md)。

## API

- [API 使用说明](../docs/api.md)
- [OpenAPI 3.1 契约](openapi.yaml)

主要接口组包括认证、设备、同步、待办、画像、记忆、AI、对话、手记、相册、成长记录和梦境。

## 测试

```powershell
npm test
```

测试会使用临时数据库，不应依赖或修改 `backend/.data` 中的个人数据。

## 生产部署

推荐使用专用系统用户、systemd、固定数据目录和 Caddy HTTPS 反向代理。完整步骤见[自托管部署指南](../docs/deployment/self-hosted.md)。备份与恢复见[数据、备份与恢复](../docs/data-and-backup.md)。
