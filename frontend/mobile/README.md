# AetherX Mobile

AetherX 的 Android 客户端，使用 Vue 3、Vite 和 Capacitor。手机端通过同一个 AetherX Hub 访问账号数据，不维护第二套可写业务数据库，也不保存 AI Provider Key。

## 已实现

- 与桌面端一致的粉蓝渐变、纸页和毛玻璃视觉；
- 开放注册、邀请口令注册、账号密码登录和一次性电脑配对；
- 首页、聊天、日历待办、记忆中心和连接设置；
- SSE 变化通知、增量游标补拉和指数退避重连；
- Android Keystore 长期凭证保护；
- 设备令牌独立撤销；
- USB `adb reverse` 本地调试；
- 只为回环地址放行明文 HTTP。

## 环境要求

- Node.js 22.13+
- npm 10+
- Android Studio
- JDK 21
- Android SDK 36

## 浏览器预览

```powershell
cd frontend\mobile
npm install
Copy-Item .env.example .env.local
npm run dev
```

`.env.local` 可设置：

```ini
VITE_AETHERX_SERVER_URL=http://127.0.0.1:4318
```

`VITE_` 变量会进入前端构建产物，不能放置密码、API Key、会话令牌或配对秘密。

浏览器预览仅使用会话级存储；正式 Android 版本使用系统 Keystore。

## 测试与构建

```powershell
npm test
npm run build
npm run android:sync
npm run android:open
```

`android:sync` 会先执行 TypeScript 检查和 Vite 生产构建，再把 Web 资源同步到 Android 工程。

Android Studio 打开后可连接真机运行，也可以在命令行安装 Debug 包：

```powershell
cd android
.\gradlew.bat installDebug
```

## USB 连接本机 Hub

保持电脑端 AetherX 正在运行，然后：

```powershell
adb devices
adb reverse tcp:4318 tcp:4318
```

手机登录页填写：

```text
http://127.0.0.1:4318
```

拔线、重启设备或重启 adb 后可能需要再次执行 `adb reverse`。

## 配对电脑

登录页选择“配对电脑”，粘贴桌面端生成的 `aetherx://pair?...` 一次性连接码：

1. 手机解析服务器、会话 ID 和短时秘密；
2. 手机提交设备名称和申请；
3. 用户在桌面端确认；
4. 手机兑换只返回一次的设备令牌；
5. 令牌进入 Android Keystore；
6. 设备可以在桌面端单独撤销。

配对码不是长期令牌，但仍应只通过可信渠道传递。远程配对必须使用 HTTPS 或可信私人网络。

## 同步模型

手机启动后：

1. 读取本地保存的最后同步游标；
2. 调用 `/api/v1/sync/changes` 补拉断线期间变化；
3. 连接 `/api/v1/sync/events` SSE；
4. 收到变化通知后刷新对应业务数据；
5. 断线后指数退避并加入随机抖动重连；
6. 401 时验证或清除失效会话。

同步事件不包含完整聊天、记忆或图片正文。当前第一阶段以在线客户端为主，尚未实现完整离线写入队列和冲突合并。

## 安全边界

- 会话令牌不写入普通 Preferences 或 localStorage；
- Android 禁止应用数据系统备份，减少令牌随备份迁移的风险；
- 网络安全配置只为 `127.0.0.1` 和 `localhost` 放行 HTTP；
- 远程 Hub 必须使用有效 HTTPS；
- AI Provider Key 始终留在 Hub；
- 手机聊天不会假装执行仅桌面端可用的本地工具；
- 丢失手机后应立即在桌面端撤销对应设备。

## 设计约束

新增页面应复用 `src/styles/tokens.css` 设计变量和现有外壳组件，保持：

- 粉蓝低饱和渐变；
- 纸张、档案与手记质感；
- 毛玻璃底部导航；
- Lucide SVG 图标，不使用单字文字图标；
- 安全区域、窄屏、长文本和软键盘状态可用。

## 相关文档

- [快速上手](../../docs/getting-started.md)
- [家庭节点与多端同步架构](../../docs/architecture/home-hub-sync.md)
- [API 使用说明](../../docs/api.md)
- [常见问题与排障](../../docs/troubleshooting.md)
