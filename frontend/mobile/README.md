# AetherX Mobile

AetherX 的 Android 客户端，使用 Vue 3、Vite 和 Capacitor。在线业务仍可连接电脑 Hub；Android 安装包同时包含正在迁移中的原生 Local Hub，用于保存受校验的手机副本，并逐步承接离线业务。Provider Key 只会以 Space Key 信封进入 Android Keystore，不写入 WebView 存储。

## 已实现

- 与桌面端一致的粉蓝渐变、纸页和毛玻璃视觉；
- 开放注册、邀请口令注册、账号密码登录和一次性电脑配对；
- 首页、聊天、日历待办、记忆中心和连接设置；
- 与桌面端共用后端 Agent Hub、工具执行与授权状态机；
- Markdown、记忆引用、工具调用和生成图片卡片；
- SSE 变化通知、增量游标补拉和指数退避重连；
- Android Keystore 长期凭证保护；
- Android Local Hub 原生 SQLite、Operation/Watermark、幂等写入与完整性根；
- 一体化配对 v2 短码同时引用客户端登录与独立 Hub 配对，并携带 USB、局域网和 Anywhere 候选入口；手机并发探测后自动选择可用地址，再用一次性密钥解析公开配对资料，Hub 部分继续使用 X25519 密钥协商、Peer HMAC 和完整快照首轮复制；
- 原图分块下载、断点续传、分块/整文件 SHA-256 校验和本地媒体 URI；
- records root、blobs root、Operation heads 完成证明与 `standby_pending → standby` 双端确认；
- Provider Key 由 Android Keystore 重加密保存，SQLite 只保留不可逆摘要；
- LocalHubClient 已承接核心页面读取、待办/资料/记忆写入和基础本地 Provider 对话；
- WorkManager 周期唤醒本机 Hub，通过 Peer HMAC 补拉连续 Operation、原图和 Watermark，并恢复中断的 Bootstrap；
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

使用 `npm start` 或 `npm run dev` 启动本地后端时，会自动为所有已授权且在线的 Android 设备执行端口映射。需要手动排查时可以运行：

```powershell
adb devices
adb reverse tcp:4318 tcp:4318
```

手机登录页填写：

```text
http://127.0.0.1:4318
```

拔线、重启设备或重启 adb 后，重新启动本地后端即可自动恢复映射；后端已经运行时也可以手动再次执行 `adb reverse`。

## 配对电脑

登录页选择“配对电脑”，优先点击“扫描电脑二维码”；推荐扫描桌面端生成的 `aetherx://complete-pair?...` 一体化短码，一次建立手机客户端登录与 Android Local Hub 身份。短码只含候选地址、会话引用、高熵一次性密钥和过期时间；应用会并发检测 USB、局域网与 Anywhere，自动选择当前可用入口，再从电脑 Hub 解析临时公钥并完成两项申请，电脑端只需批准一次。用户不需要输入 Hub 地址；无法使用相机时，也可以粘贴完整短码。

旧的 `aetherx://pair?...` 客户端连接码和 `aetherx://hub-pair?...` Hub 配对码继续兼容，仅用于旧版本滚动升级；新版桌面端不再提供单项生成入口。两套长期凭据仍分别进入安全存储，不会相互替代。

单独使用客户端连接码时：

1. 手机解析服务器、会话 ID 和短时秘密；
2. 手机提交设备名称和申请；
3. 用户在桌面端确认；
4. 手机兑换只返回一次的设备令牌；
5. 令牌进入 Android Keystore；
6. 设备可以在桌面端单独撤销。

配对码不是长期令牌，但仍应只通过可信渠道传递。远程配对必须使用 HTTPS 或可信私人网络。

应用内扫码使用 Capacitor 官方 Barcode Scanner 插件，因此 Android 最低版本为 Android 8.0（API 26）。修改移动端依赖后需再次执行 `npm run android:sync`。

## 同步模型

手机启动后：

1. 读取本地保存的最后同步游标；
2. 调用 `/api/v1/sync/changes` 补拉断线期间变化；
3. 连接 `/api/v1/sync/events` SSE；
4. 收到变化通知后刷新对应业务数据；
5. 断线后指数退避并加入随机抖动重连；
6. 401 时验证或清除失效会话。

同步事件不包含完整聊天、记忆或图片正文。Android Local Hub 会保存完整结构化快照、连续 Operation 与经过校验的原图，并通过最终证明成为正式备用节点。LocalHubClient 已覆盖本地完整 Agent 循环、模块化工具注册、普通写入授权续跑、破坏性操作强制确认、图片生成与媒体登记，以及对话完成后的记忆证据和心情状态派生。手机 Hub 成为活动节点后，电脑关闭也能继续聊天并使用已迁移模块；本地写入会先按电脑 Hub 的复制模型校验，再进入 SQLite 和 Operation 日志。

## 聊天模型

连接电脑 Hub 时，手机通过 `/api/v1/agent/chat` 使用完整 Agent、工具执行与授权状态机。
Android Local Hub 成为活动节点后，LocalHubClient 会读取本机人格、资料、相关长期记忆、偏好、心情和时间感知上下文，直接调用 Keystore 中的 Provider 凭证，并把展示流和模型上下文流分别持久化为 Operation。工具按模块开关动态注册；只读工具直接执行，普通写入按全局授权决定是否暂停，删除等破坏性操作始终要求确认。工具完成后只刷新受影响的数据组，不用等待全量同步。

手机 Hub 可以发起并推进计划切换，切换前会校验双方结构化数据、Operation 边界、Provider 凭证和原图完整性。原图支持 1 MiB 分块、状态查询、断点续传、分块 SHA-256 与整文件 SHA-256 校验；手机生成的图片也能反向传回电脑 Hub。电脑 Hub 失联时可以在明确风险确认后由手机强制接管；重新连通后若检测到双方都有未确认写入，系统会冻结写入并进入分叉恢复，由用户明确选择保留手机或电脑完整分支，通过加密快照、媒体校验、Operation 链复验和签名 ACK 收敛到统一新 epoch。

当前分叉恢复仍是完整分支级选择，不提供逐实体比较、复制为新实体或字段级合并；媒体删除墓碑和孤儿文件自动清理尚未开放。Local Hub 活动且电脑完全离线时，兼容 `.aetherx` 完整存档也暂不提供原生导出/恢复。

## 安全边界

- 会话令牌不写入普通 Preferences 或 localStorage；
- Android 禁止应用数据系统备份，减少令牌随备份迁移的风险；
- 公开 Release 只为 `127.0.0.1` 和 `localhost` 放行 HTTP；显式 `lanRelease` 仅接受私网或 Tailscale HTTP 地址；
- 远程 Hub 必须使用有效 HTTPS；
- AI Provider Key 始终留在 Hub；
- 手机聊天使用 Hub 中与桌面端相同的工具，并由服务端按账号隔离执行；
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
