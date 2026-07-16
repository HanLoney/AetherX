# 快速上手

本指南帮助你在本地启动 AetherX、创建第一个账号并完成一次 AI 对话。默认模式下，桌面端会自动运行本机 Hub，不需要单独启动后端。

## 1. 准备环境

- Windows 10/11；
- Node.js 22.13 或更高版本；
- npm 10 或更高版本；
- 一个支持 OpenAI 兼容接口的 AI Provider 账号。

确认版本：

```powershell
node -v
npm -v
```

## 2. 获取代码

```powershell
git clone https://github.com/HanLoney/AetherX.git
cd AetherX
```

如果使用下载的源码压缩包，解压后进入包含 `backend` 和 `frontend` 的目录即可。

## 3. 启动桌面端

```powershell
cd frontend\desktop
npm install
npm start
```

桌面端会检查 `http://127.0.0.1:4318/health`：

- 已有健康的 AetherX Hub 时，直接复用；
- 没有 Hub 时，使用仓库中的后端代码启动内置 Hub；
- 配置为远程服务器地址时，不启动本地 Hub。

关闭主窗口只会隐藏到托盘。需要真正停止桌面端和其拥有的内置 Hub，请在托盘菜单选择“退出”。

## 4. 创建第一个账号

首次运行的空数据库允许创建第一个账号。账号名需要 2～32 个字符，可使用文字、数字、点、横线和下划线；密码长度需要 10～128 个字符。

如果数据库中存在旧版 `local-user` 数据，第一个账号会在同一事务内认领原有待办、记忆、手记、相册、对话和设置。迁移失败时，账号创建和迁移会一起回滚，不会留下半迁移状态。

第二个及后续账号需要部署者配置 `AETHERX_REGISTRATION_SECRET`。未配置注册口令且已经存在账号时，注册入口会自动关闭。

## 5. 配置 AI Provider

登录后打开“接入设置”，填写：

- Provider 名称；
- OpenAI 兼容 Base URL；
- 模型名称；
- API Key。

保存后先使用界面中的连接测试，再发起聊天。API Key 会由 Hub 加密保存，客户端只能读取脱敏后的配置。

> [!WARNING]
> 如果迁移数据库到另一台机器，必须同时迁移原来的 `AETHERX_MASTER_KEY`，否则已经保存的 AI Key 无法解密。此时业务数据仍在，但需要重新填写 AI Key。

## 6. 连接 Android 客户端

开发版可使用账号密码直接连接，也可以使用一次性配对：

1. 在桌面端创建手机配对会话；
2. 在 Android 登录页选择“配对电脑”；
3. 粘贴 `aetherx://pair?...` 配对码；
4. 手机提交申请；
5. 回到桌面端确认设备；
6. 手机兑换并保存独立设备令牌。

设备令牌可以单独撤销，不会暴露账号密码。远程连接必须使用 HTTPS；USB 本地调试见[Android 客户端说明](../frontend/mobile/README.md)。

## 7. 下一步

- 准备长期运行：阅读[自托管部署](deployment/self-hosted.md)；
- 保护数据：阅读[数据、备份与恢复](data-and-backup.md)；
- 修改代码：阅读[开发者指南](development.md)；
- 遇到错误：查看[常见问题与排障](troubleshooting.md)。
