# 开发者指南

## 技术栈

| 目录 | 技术 | 职责 |
| --- | --- | --- |
| `backend` | Node.js 22、内置 `node:sqlite` | 认证、业务 API、SQLite、AI 代理、同步 |
| `frontend/desktop` | Electron、原生 HTML/CSS/JS | 桌面 UI、托盘、内置 Hub、桌面工具 |
| `frontend/mobile` | Vue 3、Vite、Capacitor | Android UI、设备配对、在线同步 |

各子项目独立安装依赖，仓库当前没有根级 workspace。

## 环境要求

- Node.js 22.13+
- npm 10+
- Git
- Android 开发额外需要 JDK 21、Android Studio 和 Android SDK 36

仓库提供 `.nvmrc`：

```bash
nvm use
```

## 后端开发

```powershell
cd backend
npm install
npm run dev
```

默认地址是 `http://127.0.0.1:4318`，健康检查为：

```powershell
curl.exe http://127.0.0.1:4318/health
```

测试：

```powershell
npm test
```

开发数据库默认位于 `backend/.data/xuanai.db`，已被 `.gitignore` 忽略。

## 桌面端开发

可以先独立启动后端，也可以让桌面端自动启动内置 Hub：

```powershell
cd frontend\desktop
npm install
npm start
```

连接其他 Hub：

```powershell
$env:AETHERX_SERVER_URL = "https://hub.example.com"
npm start
```

测试与构建：

```powershell
npm test
npm run dist
```

构建产物位于 `frontend/desktop/dist`，不要提交到仓库。

## 移动端开发

浏览器预览：

```powershell
cd frontend\mobile
npm install
Copy-Item .env.example .env.local
npm run dev
```

构建和测试：

```powershell
npm test
npm run build
npm run android:sync
```

Android Studio：

```powershell
npm run android:open
```

不要把真实服务器地址、账号或密钥写入 `.env.example`。`VITE_` 变量会被打包进客户端，不能用于保存秘密。

## 数据库迁移规则

迁移位于 `backend/src/infrastructure/database.js` 的顺序迁移数组中。

- 只在数组尾部追加新迁移；
- 不修改已经发布的迁移 SQL；
- 迁移必须在事务中完成并可从失败状态安全回滚；
- 新增包含 `user_id` 的业务表时，确认它进入增量同步触发器覆盖；
- 不把会话、配对秘密和内部证据表暴露到同步日志；
- 修改前使用脱敏副本测试旧数据库升级；
- PR 中说明迁移、回滚和备份要求。

## API 规则

- 所有业务 API 使用 `/api/v1` 前缀；
- 除健康检查、注册、登录和配对兑换等明确公开接口外，默认要求 Bearer 认证；
- 客户端不得提交或覆盖 `user_id`；
- 错误使用稳定的 `code` 和面向用户的 `message`；
- 新增或修改接口时同步更新 `backend/openapi.yaml`；
- SSE 只发送变化通知，不传输完整私人内容。

## 安全开发要求

- 不记录密码、API Key、会话令牌、设备令牌和配对秘密；
- 不把本地数据库、数据导出、压缩包和 `.env` 文件提交到仓库；
- 桌面渲染进程不启用 Node 集成；
- Android 长期令牌只能放入 Keystore；
- 外部 URL 和文件路径都在可信边界内校验；
- 删除、覆盖和批量修改必须保留清晰的确认与错误反馈。

## 提交前检查

```powershell
cd backend
npm test

cd ..\frontend\desktop
npm test

cd ..\mobile
npm test
npm run build

cd ..\..\
git diff --check
node scripts\check-docs.js
```

如果改动了 Android 原生代码，还应在 Android Studio 或 Gradle 中至少完成一次 Debug 构建。
