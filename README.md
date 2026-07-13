# AetherX

AetherX 是一个以 AI 为核心、可持续扩展生活与工作能力的个人智能助手。

## 项目结构

```text
AetherX/
├─ frontend/
│  ├─ desktop/       Electron 桌面客户端
│  └─ uniapp/        UniApp 多端客户端
├─ backend/          可独立部署的 Node.js 服务端
└─ docs/             架构、模块与决策文档
```

业务数据和 AI Provider 请求统一由后端管理；前端只负责界面、交互和设备能力。

## 启动后端

```bash
cd backend
npm start
```

默认地址为 `http://127.0.0.1:4318`。

## 启动桌面端

先启动后端，然后打开另一个终端：

```bash
cd frontend/desktop
npm install
npm start
```

桌面端启动后可在登录页填写服务器地址；也可以通过 `AETHERX_SERVER_URL` 预设：

```powershell
$env:AETHERX_SERVER_URL = "https://api.example.com"
npm start
```

## 启动 UniApp H5

```bash
cd frontend/uniapp
npm install
npm run dev:h5
```

UniApp 目前仍保留原有本地 Todo Store，后续将接入同一套 `/api/v1` 接口。
