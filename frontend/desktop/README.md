# AetherX Desktop

AetherX 的 Electron 桌面客户端。它既可以连接远程自托管 Hub，也可以在本机没有 Hub 时自动启动随安装包携带的后端。

## 环境要求

- Node.js 22.13+
- npm 10+
- Windows 10/11（当前正式构建目标）

## 开发运行

```powershell
cd frontend\desktop
npm install
npm start
```

默认服务器地址是：

```text
http://127.0.0.1:4318
```

启动时：

1. 如果配置的是远程地址，桌面端直接连接远程 Hub；
2. 如果配置的是回环地址且已有健康 Hub，桌面端复用它；
3. 如果配置的是回环地址但没有 Hub，桌面端启动仓库中的内置后端；
4. 如果端口被其他程序占用且不是健康的 AetherX Hub，启动会失败而不是强行接管端口。

## 连接远程 Hub

可以在登录页输入服务器地址，也可以在启动前设置：

```powershell
$env:AETHERX_SERVER_URL = "https://hub.example.com"
npm start
```

兼容旧变量 `XUANAI_SERVER_URL`。远程生产地址应使用 HTTPS，地址中不要附加 `/api/v1`。

## 内置 Hub 配置

桌面端会向内置 Hub 传递以下变量：

- `AETHERX_DATA_DIR`
- `AETHERX_MASTER_KEY`
- `AETHERX_REGISTRATION_SECRET`
- `AETHERX_SESSION_TTL_DAYS`
- `AETHERX_CORS_ORIGIN`
- `AETHERX_HUB_HOST`

开发模式默认复用 `backend/.data`，方便保留现有本地数据。打包版本默认使用 Electron `userData/hub`，不会静默搬动显式指定的数据目录。

## 会话与安全

- 登录令牌使用 Electron `safeStorage` 加密后写入 `userData/auth.json`；
- 渲染进程启用 `contextIsolation`，禁用 `nodeIntegration`；
- 业务操作通过 preload 暴露的有限 IPC 接口访问主进程；
- AI Provider Key 保存在 Hub，不写入桌面会话文件；
- 切换服务器地址时会清除当前会话，防止令牌误发给另一台服务器。

## 托盘行为

关闭主窗口会隐藏到托盘，内置 Hub 继续运行，手机仍可同步。只有托盘菜单中的“退出”才会真正停止桌面程序及其拥有的内置 Hub。

## 测试

```powershell
npm test
```

## 构建 Windows 安装包

```powershell
npm run dist
```

也可以分别构建：

```powershell
npm run dist:installer
npm run dist:portable
```

产物位于 `frontend/desktop/dist`。构建产物、签名材料和私人配置不得提交到仓库。

当前构建包含 `../../backend/src` 和后端 `package.json`，使用 Electron 自带 Node.js 运行时启动内置 Hub。

## 数据与远程部署

- [快速上手](../../docs/getting-started.md)
- [数据、备份与恢复](../../docs/data-and-backup.md)
- [自托管部署](../../docs/deployment/self-hosted.md)
- [常见问题与排障](../../docs/troubleshooting.md)
