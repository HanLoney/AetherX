<div align="center">
  <img src="frontend/desktop/app-icon-rounded.png" width="148" alt="AetherX 图标" />

  <h1>AetherX</h1>

  <p><strong>把 AI 从一次性问答，变成住在你自己设备里的长期伙伴。</strong></p>
  <p>开源 · 自托管 · 长期记忆 · 桌面与 Android 协作</p>

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
    <a href="docs/deployment/self-hosted.md">自托管部署</a> ·
    <a href="CONTRIBUTING.md">参与贡献</a>
  </p>
</div>

---

AetherX 是一个以长期陪伴为目标的个人 AI 伙伴。它不只保存聊天记录，还会在你的确认和控制下整理记忆、理解偏好，并把待办、手记、成长记录、梦境与纪念册连接成连续的个人空间。

所有核心数据都保存在你自己的 **AetherX Hub** 中。桌面端和 Android 客户端通过统一 API 访问 Hub；你可以把它运行在个人电脑、NAS 或私人服务器上，并自由选择支持 OpenAI 兼容接口的模型服务。

> [!IMPORTANT]
> AetherX 仍处于快速迭代阶段。升级、迁移或尝试开发版本前，请备份数据目录和主密钥。

## 为什么选择 AetherX

| | 能力 | 你得到什么 |
| --- | --- | --- |
| 🧠 | **可控的长期记忆** | 从对话中提取、确认、搜索和召回记忆；不是把所有内容偷偷塞进黑盒。 |
| 🏠 | **数据留在自己的 Hub** | 账号、对话、记忆和 AI 配置由你部署和备份，不依赖官方数据云。 |
| 💻 | **桌面与 Android 协作** | 使用短时配对码连接设备，通过增量游标与 SSE 同步变化。 |
| 🌱 | **不止是聊天窗口** | 待办、画像、偏好、手记、成长、梦境和纪念册共同构成长线体验。 |
| 🔌 | **模型服务可替换** | 在前端配置 Provider、模型和 API Key，不绑定单一厂商。 |
| 🛡️ | **明确的安全边界** | 多账号数据隔离，令牌只保存哈希，AI API Key 由 Hub 加密保存。 |

## 它如何工作

```text
Electron 桌面端 ─┐
                  ├── REST API / SSE ── AetherX Hub ── SQLite
Android 客户端 ──┘                         │
                                          └── AI Provider
```

Hub 是业务数据的唯一写入者，也是账号、记忆、工具调用和多端同步的权威来源。客户端不会直接打开数据库，更不会依赖网盘或共享目录同步正在运行的 SQLite 文件。

- [家庭节点与多端同步架构](docs/architecture/home-hub-sync.md)
- [工具系统与安全边界](docs/architecture/tool-system.md)
- [服务端 Agent Hub 决策记录](docs/adr/0003-server-owned-agent-hub.md)

## 快速开始

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

桌面端默认连接 `http://127.0.0.1:4318`。如果该地址没有正在运行的 Hub，它会自动启动仓库中的内置后端。

首次打开时：

1. 创建第一个账号；
2. 在“接入设置”中填写 AI Provider、模型和 API Key；
3. 开始对话，并按自己的节奏启用记忆、待办和其他生活模块。

API Key 由 Hub 使用主密钥加密保存，不写入仓库，也不会下发到手机端。完整流程见[快速上手](docs/getting-started.md)。

### 运行 Android 客户端

```powershell
cd frontend\mobile
npm install
npm run android:sync
npm run android:open
```

Android 客户端支持账号注册、登录和一次性电脑配对。真机调试、Keystore 凭证保护与网络限制见[移动端说明](frontend/mobile/README.md)。

### 部署独立 Hub

生产环境应使用独立数据目录、固定主密钥和 HTTPS 反向代理。不要把 `4318` 端口直接暴露到公网；私有实例建议使用邀请制或关闭后续注册。

完整部署与运维步骤见[自托管部署指南](docs/deployment/self-hosted.md)。

## 核心模块

| 模块 | 用途 |
| --- | --- |
| 对话与 Agent Hub | 统一处理模型请求、工具调用、写操作确认和对话持久化 |
| 长期记忆 | 提取候选、人工确认、语义召回、维护与合并 |
| 画像与偏好 | 保存明确的用户资料和可独立管理的偏好 |
| 待办与提醒 | 管理时间范围、完成状态和桌面提醒 |
| AI 伙伴成长 | 记录人格变化、共同记忆、情绪与关系叙事 |
| 手记、梦境与纪念册 | 从真实历史中整理可回顾的长期内容 |
| 多端同步 | 通过变更游标和 SSE 在桌面端与 Android 间同步 |

## 仓库结构

```text
AetherX/
├─ backend/             Node.js Hub、SQLite、REST API 与 SSE
├─ frontend/
│  ├─ desktop/          Electron 桌面客户端
│  └─ mobile/           Vue + Capacitor Android 客户端
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
- 部署：[自托管部署](docs/deployment/self-hosted.md) · [数据、备份与恢复](docs/data-and-backup.md)
- 开发：[开发者指南](docs/development.md) · [API 文档](docs/api.md)
- 项目：[安全策略](SECURITY.md) · [隐私说明](PRIVACY.md) · [变更记录](CHANGELOG.md)
- 社区：[贡献指南](CONTRIBUTING.md) · [行为准则](CODE_OF_CONDUCT.md) · [获取帮助](SUPPORT.md)

## 参与贡献

欢迎提交 Issue、文档改进和 Pull Request。涉及较大功能、数据迁移或安全边界的改动，请先阅读[贡献指南](CONTRIBUTING.md)并创建讨论 Issue。

发现安全问题时，请不要公开提交 Issue，应使用 GitHub Security Advisory 私下报告。

## 许可证

AetherX 使用 [MIT License](LICENSE)。第三方依赖仍分别遵循其自身许可证，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
