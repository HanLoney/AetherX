# AetherX Desktop

AetherX 的 Electron 桌面客户端。电脑 Hub 已集成到桌面主进程中；启动桌面端即可启动、托管和停止本机 Hub，同时仍可连接远程自托管 Hub。

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

1. 桌面端始终准备本机内置 Hub，客户端当前路由到手机 Hub 或远程 Hub 时也不会影响电脑副本运行；
2. 如果回环地址上是受支持的 AetherX Hub，桌面端会核验其数据目录，通过命名管道请求优雅停止，然后接管同一份数据；
3. 如果已有 Hub 的数据目录与桌面端目标目录不同，桌面端拒绝接管并标记为“外部中枢”，不会覆盖或合并数据；
4. 点击标题栏的 Hub 状态，或从账号菜单进入“中枢与连接状态”，可直接查看同级的电脑 Hub / 手机 Hub、复制进度、桌面与手机客户端路由，以及 LAN / Anywhere 入口，不再依赖启动器状态页。
5. 如果端口被其他程序占用，桌面端启动会失败，不会结束未知进程。

## 配对手机客户端与手机 Hub

在“连接手机 / 设备管理”中优先选择“一次配对客户端与手机 Hub”。桌面端只把局域网、Anywhere 候选地址、客户端与 Hub 会话 ID、高熵一次性密钥和过期时间放入 v2 短码；手机扫描后并发探测候选入口，自动选中第一个可用地址，再从电脑 Hub 拉取临时公钥、节点标识与候选入口。两项申请随后并行提交，用户不需要填写地址，在电脑端批准一次即可完成授权。底层凭据仍保持隔离，客户端令牌不能代替 Peer 凭据。

二维码使用纯黑矢量码元、Q 级纠错、四模块静区和 `260px` 展示区域。旧版内嵌完整载荷仍可由新版手机解析，但新版桌面默认不再生成高密度完整载荷二维码。

桌面端只提供一体化配对入口，不再分别生成“仅客户端”或“仅备用 Hub”二维码。二维码过期、任一申请失败或网络地址不可达时，应重新生成一体化配对码，不要长期保存或转发二维码内容；新版手机仍保留旧码解析能力以支持滚动升级。

## 连接远程 Hub

可以在登录页输入服务器地址，也可以在启动前设置：

```powershell
$env:AETHERX_SERVER_URL = "https://hub.example.com"
npm start
```

兼容旧变量 `XUANAI_SERVER_URL`。远程生产地址应使用 HTTPS，地址中不要附加 `/api/v1`。

## Online Desktop

开发时使用 `npm run start:cloud`，可通过 `AETHERX_CLOUD_SERVER_URL` 显式覆盖测试服务地址。正式 Online 构建使用 `npm run dist:cloud`，产品名为 `AetherX Online`，拥有独立应用 ID、安装输出和用户数据目录；打包后固定连接 `https://api.aetherx.tech`，不会读取运行时服务器地址，也不会携带内置 Hub 后端和本地防火墙安装脚本。

Online 版只使用邮箱账号登录，不显示设备列表或设备管理。短期 Access Token 过期后，客户端使用 `safeStorage` 中加密保存的轮换 Refresh Token 自动续期并重试原请求；只有刷新失败才回到登录页，退出会撤销当前账号会话。

Online 仍允许每个账号接入自己的 OpenAI 兼容 Provider，但 Base URL 必须是公开可访问的 HTTPS 地址；本机、局域网和云元数据地址会被服务端 Egress Guard 拒绝。Local 版连接局域网 Provider 的能力不受影响。

## 内置 Hub 配置

桌面端会向内置 Hub 传递以下变量：

- `AETHERX_DATA_DIR`
- `AETHERX_MASTER_KEY`
- `AETHERX_REGISTRATION_SECRET`
- `AETHERX_REGISTRATION_MODE`（`open`、`invite` 或 `closed`，默认 `open`）
- `AETHERX_SESSION_TTL_DAYS`
- `AETHERX_CORS_ORIGIN`
- `AETHERX_HUB_HOST`

开发模式默认复用 `backend/.data`，方便保留现有本地数据。打包版本与启动器统一使用 `%APPDATA%\AetherX\hub`。旧桌面版的 `userData/hub` 仅在公共目录尚无数据库时执行一次原子迁移；两个目录都含数据时会停止迁移，等待人工确认。

受支持的独立 Hub、启动器 Hub 和桌面内置 Hub 使用同一条当前用户命名管道交接所有权。交接前会核验服务身份和规范化后的数据目录，交接后仍由数据目录单写锁防止两个进程同时写入。
旧启动器 Hub 尚未上报数据目录，但其专用控制通道可被识别并完成一次兼容接管；没有控制通道的未知或手工旧进程不会被自动结束。

## 会话与安全

- 登录令牌与 Online Refresh Token 使用 Electron `safeStorage` 加密后写入 `userData/auth.json`；
- 渲染进程启用 `contextIsolation`，禁用 `nodeIntegration`；
- 业务操作通过 preload 暴露的有限 IPC 接口访问主进程；
- AI Provider Key 保存在 Hub，不写入桌面会话文件；
- 切换服务器地址时会清除当前会话，防止令牌误发给另一台服务器。

聊天页是 Agent Hub 的薄客户端：只提交消息、展示服务端消息流，并将工具授权
选择传回 Hub。提示词组合、记忆召回、Provider 请求、工具循环和会话持久化均在
后端执行，不应在渲染进程新增第二套实现。工具定义文件会作为内置 Hub 资源随
安装包发布，但不会再由聊天页面加载执行。

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
