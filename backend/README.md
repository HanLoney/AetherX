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
| `AETHERX_CORS_ORIGIN` | `*` | 允许的前端 Origin |

生产部署必须设置稳定且安全的 `AETHERX_MASTER_KEY`，并通过反向代理启用 HTTPS 和身份认证。旧的 `XUANAI_*` 环境变量仍兼容。

## 测试

```bash
npm test
```
