<div align="center">
  <img src="frontend/desktop/app-icon-rounded.png" width="148" alt="AetherX 图标" />

  <h1>AetherX</h1>

  <p><strong>把 AI 从一次性问答，变成住在你自己设备里的长期伙伴。</strong></p>
  <p>开源 · 自托管 · 长期记忆 · 双 Hub 单活动</p>

  <p>
    <a href="https://github.com/HanLoney/AetherX/actions/workflows/ci.yml"><img src="https://github.com/HanLoney/AetherX/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-6f7fcf.svg" alt="MIT License" /></a>
    <a href="backend/package.json"><img src="https://img.shields.io/badge/Node.js-%3E%3D22.13-5FA04E" alt="Node.js 22.13+" /></a>
    <a href="frontend/desktop"><img src="https://img.shields.io/badge/Desktop-Electron-47848F" alt="Electron Desktop" /></a>
    <a href="frontend/mobile"><img src="https://img.shields.io/badge/Android-Capacitor-119EFF" alt="Capacitor Android" /></a>
  </p>

  <p>
    <a href="docs/getting-started.md">快速上手</a> ·
    <a href="docs/README.md">文档中心</a> ·
    <a href="#部署独立-hub">自托管部署</a> ·
    <a href="CONTRIBUTING.md">参与贡献</a>
  </p>
</div>

---

AetherX 是一个以长期陪伴为目标的个人 AI 伙伴。它不只保存聊天记录，还会在你的确认和控制下整理记忆、理解偏好，并把待办、钱包、手记、成长记录、梦境与纪念册连接成连续的个人空间。

所有核心数据都保存在你自己的 **AetherX Hub** 中。默认情况下，电脑上的 Node Hub 负责业务与 Agent；完成备用 Hub 配对后，Android Local Hub 会保存经过校验的完整副本，并能在安全切换后接管活动 Hub 身份。两个 Hub 始终只有一个接受业务写入和运行 Agent，重新连通后再通过签名 Operation 与媒体校验继续复制。

你可以只使用电脑 Hub，也可以把电脑和 Android 组成双 Hub。模型服务仍由你自由选择，支持 OpenAI 兼容接口的 Provider；账号、对话、记忆、配置和原始媒体不依赖 AetherX 官方数据云。

> [!IMPORTANT]
> AetherX 仍处于快速迭代阶段。升级、迁移或尝试开发版本前，请备份数据目录和主密钥。

## 为什么选择 AetherX

| | 能力 | 你得到什么 |
| --- | --- | --- |
| 🧠 | **可控的长期记忆** | 从对话中提取、确认、搜索和召回记忆；不是把所有内容偷偷塞进黑盒。 |
| 🏠 | **数据留在自己的 Hub** | 账号、对话、记忆和 AI 配置由你部署和备份，不依赖官方数据云。 |
| 🔁 | **双 Hub 安全切换** | 电脑 Hub 与 Android Local Hub 保存完整副本，追平并校验后才移交活动身份。 |
| 🌱 | **不止是聊天窗口** | 待办、画像、偏好、手记、成长、梦境和纪念册共同构成长线体验。 |
| 🔌 | **模型服务可替换** | 在前端配置 Provider、模型和 API Key，不绑定单一厂商。 |
| 🛡️ | **明确的安全边界** | 多账号隔离，节点身份与用户会话分离，Provider Key 在每台 Hub 上重新加密。 |

## 它如何工作

```text
Electron 桌面端 ── Hub Router ──┐
                                ├── 当前活动 Hub ── AI Provider
Android 界面 ───── Hub Router ──┘          │
                                           │ 唯一业务写入与 Agent 执行权

电脑 Node Hub        <── 签名 Operation / Blob / 完整性证明 ──>        Android Local Hub
active 或 standby                                                      standby 或 active
```

AetherX 采用**双节点、单活动**模型：

- 当前活动 Hub 是账号数据、业务写入、Agent 和后台任务的唯一权威执行者；
- 备用 Hub 只接收并校验复制操作，不重复运行 Agent，也不产生业务副作用；
- 每次业务写入与对应 Operation 在同一数据库事务提交，重试通过请求 ID 保持幂等；
- 原始媒体按内容摘要分块传输并支持断点续传，不能只凭“记录已同步”就认为图片完整；
- 计划切换会等待写入排空，执行最终同步、结构化数据与媒体校验，再递增 `epoch` 并移交活动身份；
- 客户端不会直接打开 Hub 数据库，也不会通过网盘、共享目录或复制运行中的 SQLite 文件实现同步。

普通手机客户端配对与备用 Hub 配对在底层仍是两种独立权限，但桌面端只提供一体化配对入口。一体化配对会把两份短期申请引用及 USB、局域网、Anywhere 候选入口封装进同一张低密度二维码：手机扫描一次后会并发检测并自动选择当前可用入口，再使用高熵短期凭据从电脑 Hub 拉取公开配对资料。电脑批准一次，即可同时建立用户设备登录和 Android Local Hub 身份；正常流程不需要用户判断或输入 Hub 地址。

> [!NOTE]
> 当前已支持两端在线时的安全计划切换，以及电脑 Hub 失联时由手机显式确认的强制接管。强制接管会保存完整性证据、提升 `epoch`，并在电脑恢复连接后隔离旧代未确认写入，绝不会自动覆盖。桌面端分叉恢复中心允许明确选择保留手机 Hub 或电脑 Hub：系统冻结写入，通过 Space Key AES-256-GCM 分块传输权威分支完整快照，复验媒体和 Operation 哈希链，双方应用签名控制并确认后提升到统一新 `epoch`；被舍弃分支仍保存在 HMAC 签名证据包中。逐实体比较、复制为新实体和逐项合并仍在后续开放。手机 Hub 独立运行且电脑完全离线时，暂时不能直接导出或恢复兼容 `.aetherx` 完整存档。

- [家庭节点与多端同步架构](docs/architecture/home-hub-sync.md)
- [双 Hub 复制与安全切换实现方案](docs/architecture/dual-hub-replication.md)
- [模型上下文与富数据隔离](docs/architecture/model-context-budget.md)
- [工具系统与安全边界](docs/architecture/tool-system.md)
- [服务端 Agent Hub 决策记录](docs/adr/0003-server-owned-agent-hub.md)
- [双 Hub 单活动架构决策](docs/adr/0004-dual-hub-single-active-replication.md)

## 快速开始

### Windows 一键部署

Windows 用户可以使用 **AetherX 启动器** 在统一界面中安装电脑 Hub 与桌面端。桌面端启动后会核验并安全接管启动器 Hub 的同一数据目录，用户只需保持 AetherX 桌面端运行；启动器仍可检测 Hub 接口、响应延迟、桌面端进程、手机节点和复制状态。

需要在局域网之外使用手机端时，启动器还可以通过 **Tailscale Serve** 开启私人 HTTPS 入口。手机扫码即可完成 Tailscale 安装引导或读取远程 Hub 地址；Hub 仍只监听本机，不需要公网 IP 和路由器端口映射。

开发者可在 `frontend/launcher` 中构建启动器安装包，具体方式见 [Windows 启动器说明](frontend/launcher/README.md)。

### 准备环境

- Node.js 22.13 或更高版本；
- npm 10 或更高版本；
- Windows 10/11（当前桌面构建目标）；
- 构建 Android 客户端时需要 Android Studio、JDK 21 和 Android SDK 36。

### 运行桌面端

```powershell
git clone https://github.com/HanLoney/AetherX.git
cd AetherX\frontend\desktop
npm install
npm start
```

桌面端默认连接 `http://127.0.0.1:4318` 并在主进程中托管电脑 Hub。若启动器或受支持的独立 Hub 已在使用同一数据目录，桌面端会通过本机控制通道让它优雅退出，再无损接管；不同数据目录或未知服务不会被强制结束。

首次打开时：

1. 创建第一个账号；
2. 在“接入设置”中填写 AI Provider、模型和 API Key；
3. 开始对话，并按自己的节奏启用记忆、待办和其他生活模块。

API Key 由电脑 Hub 使用本机主密钥加密保存，不写入仓库，也不会通过普通用户 API 返回。只有在配对 Android Local Hub 时，凭证才会以 Space Key 加密信封进入复制协议，并立即由 Android Keystore 重新加密保存。完整流程见[快速上手](docs/getting-started.md)。

### 运行 Android 客户端

```powershell
cd frontend\mobile
npm install
npm run android:sync
npm run android:open
```

Android 客户端同时承担两种角色：

1. **普通手机客户端**：登录当前活动 Hub，承载界面、会话和操作入口。
2. **Android Local Hub**：保存结构化数据、Operation、Provider 凭证信封和原始媒体的本机副本，并可在安全切换后接管。

首次连接时推荐扫描桌面端的“一体化配对码”，一次完成这两个角色的授权，不需要先后扫描两张二维码。

Local Hub 的 Space Key、Peer 凭据和 Provider Key 都由 Android Keystore 保护，不写入 WebView 存储。完成首轮复制和最终确认后，手机会成为可切换的备用 Hub；切换到手机 Hub 后，已迁移模块可以在电脑关闭时继续运行。

真机调试、Keystore 凭证保护与网络限制见[移动端说明](frontend/mobile/README.md)。

### 配置电脑与手机双 Hub

1. 在桌面端打开“连接手机 / 设备管理”，选择“一次配对客户端与手机 Hub”；
2. 在手机登录页或连接设置中扫描二维码，等待应用自动检测 USB、局域网和 Anywhere，再回到电脑批准一次；
3. 手机会并行建立客户端登录与 Local Hub 节点身份，任一部分失败都会明确报错；
4. 等待首轮结构化数据、Operation 和原始媒体复制完成，状态变为“待命”；
5. 需要电脑离线时，在手机设置中选择“切换到手机 Hub”；
6. 系统追平最后一批变更并通过完整性门禁后，手机成为当前活动 Hub；
7. 电脑恢复在线后，可从手机发起“切换到电脑 Hub”，手机继续作为备用副本同步。

如果强制接管后检测到两边都存在未确认写入，双 Hub 会进入写入冻结状态。此时在桌面端点击 Hub 状态进入分叉恢复中心，先导出签名证据，再选择保留手机 Hub 或电脑 Hub；保持手机端在线，等待快照传输、完整性校验和双端确认全部完成后再继续使用。

切换期间普通写入会短暂锁定；任何预检、最终同步或完整性校验失败都会阻止切换，原活动 Hub 保持权威。不要在两端失联时手工修改数据库或尝试让两个 Hub 同时写入。

### 部署独立 Hub

Hub 只依赖 Node.js 和内置 SQLite，**Windows 与 Linux 都可以运行**。如果只在 Windows 桌面端本机使用，不需要手动部署：桌面端会自动启动内置 Hub。

需要让 Hub 独立运行时，在 Windows PowerShell 中执行：

```powershell
git clone https://github.com/HanLoney/AetherX.git
cd AetherX\backend
npm ci
npm start
```

然后验证服务：

```powershell
curl.exe http://127.0.0.1:4318/health
```

默认数据保存在 `backend\.data`，首次运行会自动生成数据库和本地主密钥。请备份整个 `.data` 目录；关闭 PowerShell 窗口会停止这个独立 Hub。

用于长期运行时，应配置独立数据目录、稳定主密钥、开机常驻和备份。其他设备从公网连接时，还必须使用 HTTPS 反向代理，**不要直接暴露 `4318` 端口**。

- [Windows Hub 部署指南](docs/deployment/windows.md)：前台运行、计划任务常驻、局域网接入、更新与备份；
- [Linux Hub 部署指南](docs/deployment/self-hosted.md)：Ubuntu、systemd、Caddy、HTTPS、更新与回滚。

## 核心模块

| 模块 | 用途 |
| --- | --- |
| 对话与 Agent Hub | 统一处理模型请求、工具调用、写操作确认和对话持久化 |
| 长期记忆 | 提取候选、人工确认、语义召回、维护与合并 |
| 画像与偏好 | 保存明确的用户资料和可独立管理的偏好 |
| 待办与提醒 | 管理时间范围、完成状态和桌面提醒 |
| 钱包 | 使用整数分管理多项存款、收支流水与历史余额链 |
| AI 伙伴成长 | 记录人格变化、共同记忆、情绪与关系叙事 |
| 手记、梦境与纪念册 | 从真实历史中整理可回顾的长期内容 |
| 双 Hub 复制 | 使用签名 Operation、Watermark、完整性摘要与媒体分块维持电脑和手机副本 |
| 安全切换 | 在 Agent 空闲、数据追平和媒体完整后移交活动 Hub 身份，并通知客户端重新路由 |

## 仓库结构

```text
AetherX/
├─ backend/             Node.js Hub、SQLite、REST API 与 SSE
├─ frontend/
│  ├─ desktop/          Electron 桌面客户端
│  ├─ launcher/         Windows 安装、进程与连接状态管理
│  └─ mobile/           Vue + Capacitor Android 客户端与原生 Local Hub
├─ docs/
│  ├─ architecture/     架构与边界
│  ├─ adr/              已接受的架构决策
│  ├─ deployment/       自托管部署
│  ├─ modules/          模块契约
│  └─ ui/               UI 行为约定
└─ .github/             CI、Issue 与 Pull Request 模板
```

## 开发与验证

各子项目独立管理依赖：

```powershell
cd backend
npm install
npm test

cd ..\frontend\desktop
npm install
npm test

cd ..\mobile
npm install
npm test
npm run build
```

开发规范、数据库迁移约束和提交前检查见[开发者指南](docs/development.md)与[贡献指南](CONTRIBUTING.md)。API 契约位于 [backend/openapi.yaml](backend/openapi.yaml)。

## 文档导航

- 使用：[快速上手](docs/getting-started.md) · [常见问题与排障](docs/troubleshooting.md)
- 部署：[Windows Hub](docs/deployment/windows.md) · [Linux Hub](docs/deployment/self-hosted.md) · [数据、备份与恢复](docs/data-and-backup.md)
- 开发：[开发者指南](docs/development.md) · [API 文档](docs/api.md)
- 项目：[安全策略](SECURITY.md) · [隐私说明](PRIVACY.md) · [变更记录](CHANGELOG.md)
- 社区：[贡献指南](CONTRIBUTING.md) · [行为准则](CODE_OF_CONDUCT.md) · [获取帮助](SUPPORT.md)

## 参与贡献

欢迎提交 Issue、文档改进和 Pull Request。涉及较大功能、数据迁移或安全边界的改动，请先阅读[贡献指南](CONTRIBUTING.md)并创建讨论 Issue。

发现安全问题时，请不要公开提交 Issue，应使用 GitHub Security Advisory 私下报告。

## 许可证

AetherX 使用 [MIT License](LICENSE)。第三方依赖仍分别遵循其自身许可证，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
