# AetherX

> 一个开源、自托管、以长期记忆和多端协作为核心的个人 AI 伙伴。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.13-5FA04E)](backend/package.json)
[![Desktop](https://img.shields.io/badge/Desktop-Electron-47848F)](frontend/desktop)
[![Android](https://img.shields.io/badge/Android-Capacitor-119EFF)](frontend/mobile)

AetherX 把账号、记忆、待办、手记、纪念册、对话和 AI 配置保存在用户自己的 AetherX Hub 中。桌面端与 Android 客户端只通过 Hub API 访问数据；项目不依赖官方数据云，适合在个人电脑、NAS 或私人服务器上运行。

> [!IMPORTANT]
> 项目仍处于快速迭代阶段。请在升级、迁移或尝试开发版本前备份数据目录和主密钥。

## 能做什么

- 与支持 OpenAI 兼容接口的模型聊天，并在前端配置 Provider、模型和 API Key；
- 从对话中提取、确认、搜索和召回长期记忆；
- 管理个人画像、AI 伙伴人设、待办、手记、成长记录、梦境和纪念册；
- 使用账号隔离同一 Hub 上不同用户的数据；
- 通过短时配对码连接 Android 设备，并使用增量游标与 SSE 同步变化；
- 将桌面客户端与内置 Hub 一起运行，或连接自托管的远程 Hub；
- 所有核心代码以 MIT 许可证开放，不绑定官方云服务。

## 架构概览

```text
Electron 桌面端 ─┐
                  ├── REST API / SSE ── AetherX Hub ── SQLite
Android 客户端 ──┘                         │
                                          └── AI Provider
```

Hub 是业务数据的唯一写入者。不要用网盘、Syncthing 或共享目录直接同步正在运行的 SQLite 数据库。设计说明见[家庭节点与多端同步架构](docs/architecture/home-hub-sync.md)。

## 快速开始

### 环境要求

- Node.js 22.13 或更高版本；
- npm 10 或更高版本；
- Windows 10/11（当前桌面构建目标）；
- 构建 Android 客户端时还需要 Android Studio、JDK 21 和 Android SDK 36。

### 启动桌面端

```powershell
git clone https://github.com/HanLoney/AetherX.git
cd AetherX\frontend\desktop
npm install
npm start
```

桌面端默认连接 `http://127.0.0.1:4318`。如果该地址没有正在运行的 AetherX Hub，桌面端会自动启动仓库中的内置后端。

首次打开时创建第一个账号。第一个账号会在同一数据库事务中认领旧版 `local-user` 数据，不会清空已有内容。Hub 默认开放后续账号注册，也可以切换为邀请制或关闭注册。

登录后在“接入设置”中配置 AI Provider。API Key 由 Hub 使用主密钥加密保存，不写入仓库，也不会下发到手机端。

更完整的首次使用流程见[快速上手](docs/getting-started.md)。

### 启动 Android 客户端

```powershell
cd frontend\mobile
npm install
npm run android:sync
npm run android:open
```

Android 客户端支持创建账号、账号登录和一次性电脑配对。真机调试、Keystore 凭证保护与网络限制见[移动端说明](frontend/mobile/README.md)。

### 自托管 Hub

生产环境应使用独立数据目录、固定主密钥和 HTTPS 反向代理。公开服务可保持开放注册；私有服务建议使用邀请制。不要把 `4318` 端口直接暴露到公网。

完整步骤见[自托管部署指南](docs/deployment/self-hosted.md)。

## 仓库结构

```text
AetherX/
├─ backend/             Node.js Hub、SQLite、REST API 与 SSE
├─ frontend/
│  ├─ desktop/          Electron 桌面客户端
│  ├─ mobile/           Vue + Capacitor Android 客户端
│  └─ uniapp/           旧版跨端原型，仅保留作参考
├─ docs/
│  ├─ architecture/     架构与边界
│  ├─ adr/              已接受的架构决策
│  ├─ deployment/       自托管部署
│  ├─ modules/          模块契约
│  └─ ui/               UI 行为约定
└─ .github/             Issue 与 Pull Request 模板
```

## 开发与测试

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

## 文档

- [文档中心](docs/README.md)
- [快速上手](docs/getting-started.md)
- [开发者指南](docs/development.md)
- [自托管部署](docs/deployment/self-hosted.md)
- [数据、备份与恢复](docs/data-and-backup.md)
- [常见问题与排障](docs/troubleshooting.md)
- [安全策略](SECURITY.md)
- [隐私说明](PRIVACY.md)
- [获取帮助](SUPPORT.md)
- [变更记录](CHANGELOG.md)

## 参与贡献

欢迎提交 Issue、文档改进和 Pull Request。开始前请阅读：

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- [SECURITY.md](SECURITY.md)

发现安全问题时，请不要公开提交 Issue，应使用 GitHub Security Advisory 私下报告。

## 许可证

本项目使用 [MIT License](LICENSE)。第三方依赖仍分别遵循其自身许可证。
