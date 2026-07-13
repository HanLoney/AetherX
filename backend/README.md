# AetherX Backend

这是 AetherX 可独立部署的服务端。客户端只通过 `/api/v1` 接口访问业务数据。

## 运行

需要 Node.js 22.13 或更高版本。

```bash
cd backend
npm start
```

默认监听 `http://127.0.0.1:4318`。为兼容已有安装，数据文件仍保存在 `backend/.data/xuanai.db`。

## 环境变量

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `AETHERX_HOST` | `127.0.0.1` | 监听地址 |
| `AETHERX_PORT` | `4318` | 监听端口 |
| `AETHERX_DATA_DIR` | `backend/.data` | 数据目录 |
| `AETHERX_MASTER_KEY` | 自动生成本地密钥 | 服务端凭证加密主密钥 |
| `AETHERX_REGISTRATION_SECRET` | 空 | 新账号注册口令；生产环境必须设置 |
| `AETHERX_SESSION_TTL_DAYS` | `30` | 登录会话有效天数 |
| `AETHERX_CORS_ORIGIN` | `*` | 允许的前端 Origin |

生产部署必须设置稳定且安全的 `AETHERX_MASTER_KEY`、`AETHERX_REGISTRATION_SECRET`，并通过反向代理启用 HTTPS。旧的 `XUANAI_*` 环境变量仍兼容。

## 账号与旧数据

除健康检查和注册/登录接口外，所有业务接口都要求 Bearer 会话令牌，业务身份只能从服务端会话中取得，不再接受客户端指定用户 ID。

空数据库允许创建首个账号；已有 `local-user` 数据时，首个账号会在同一个数据库事务中认领原来的待办、记忆、手记、相册、对话与配置。若任一表迁移失败，账号创建和数据迁移会一起回滚。设置 `AETHERX_REGISTRATION_SECRET` 后，包括首个账号在内的所有注册都必须提供该口令；已有账号且未设置口令时，注册入口自动关闭。

## 测试

```bash
npm test
```
