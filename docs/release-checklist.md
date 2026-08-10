# 发布检查清单

AetherX 使用仓库根目录 `VERSION` 作为统一产品版本。后端、桌面端、启动器、移动端和 Android `versionName` 必须一致；Android `versionCode` 由 `MAJOR * 1000000 + MINOR * 1000 + PATCH` 生成。

## 自动门禁

1. `node scripts/check-docs.js`：Markdown 链接和 OpenAPI 路由完整性。
2. `node scripts/check-release.js`：版本、变更记录、Android 签名入口和正式网络策略。
3. 后端、桌面端、启动器、移动端全量测试与依赖审计。
4. Android Java 单元测试、`release` APK 构建和 APK 签名验证。
5. Windows 桌面端、启动器打包、内置 Hub 健康检查和 Authenticode 验证。
6. Git 标签必须严格等于 `v<VERSION>`，工作区必须干净。

## 发布密钥

Android CI 需要 `ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`。Gradle 本地构建使用对应的 `AETHERX_ANDROID_*` 环境变量；设置 `AETHERX_REQUIRE_SIGNING=true` 后，缺少任一项都会失败。

本机使用 DPAPI 签名配置时执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-signed-android.ps1
```

Windows CI 使用 electron-builder 标准变量 `CSC_LINK` 和 `CSC_KEY_PASSWORD`。公开发布必须使用受信任代码签名证书，并通过 `scripts/verify-windows-signature.ps1`；测试证书不满足发布门禁。

密钥、证书和 Keystore 不得提交到仓库。

Android 正式签名证书的公开 SHA-256 指纹保存在 `ANDROID_SIGNING_CERT_SHA256`。APK 校验必须同时确认签名有效、签名者数量为 1，并与该指纹一致。生产 Keystore 必须另做离线加密备份；遗失后无法继续向已安装用户发布升级。

Windows 桌面端 `appId` 暂时保持 `com.xuanxiaotech.todo`，这是已有安装的升级身份，不应只为名称一致性直接修改。

## Android 网络变体

- `assembleRelease`：公开安全包，只允许 HTTPS 与本机回环 HTTP。
- `assembleLanRelease`：显式局域网包，允许私网和 Tailscale 地址使用 HTTP；应用仍拒绝公网 HTTP。
- `assembleDebug`：开发调试包，网络策略与局域网包一致。

## 必做真机验收

公开发布前必须在真实 Android 设备上运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/smoke-android-device.ps1 `
  -PreviousApk frontend/mobile/android/app/build/outputs/apk/upgrade-smoke/app-1.0-versionCode1-signed.apk `
  -Apk frontend/mobile/android/app/build/outputs/apk/lanRelease/app-lanRelease.apk
```

双 Hub 真机验收必须使用签名后的 `lanRelease` APK；标准 `release` APK/AAB 保持 HTTPS-only，不能拿它验证私网或 Tailscale HTTP Hub。

安装和冷启动通过后，还必须完成以下双 Hub 场景并保存测试记录：

1. 电脑 Hub 活动时，手机补拉、实时 SSE、结构化数据和媒体进度到达“已同步”。
2. 计划切换到手机 Hub 后，两端拓扑、活动节点、epoch 和客户端路由一致。
3. 手机 Hub 活动且电脑离线时，可聊天、执行已启用工具、生成媒体并持久化 Operation。
4. 电脑恢复后可追平并安全切回；同步进度不会停在中间阶段。
5. 强制接管产生分叉后，分别验证保留手机和保留电脑的恢复路径；写入冻结、证据导出、加密快照、媒体校验和签名 ACK 全部闭环。
6. 使用上一公开版本覆盖安装，数据库迁移、Keystore 会话、配对关系和单会话聊天历史均保留。
7. 手机锁屏并进入 Doze 后，停止外部测试保活，确认电脑仍可访问手机 Hub，并完成一次“电脑 → 手机 → 电脑”计划切换。
8. 同一数据目录只能存在一个 Hub 写进程；重复启动必须返回 `AETHERX_DATA_DIR_LOCKED`，不能出现两个进程同时写同一 SQLite。

Windows 启动器载荷的隔离覆盖升级可以先运行：

```powershell
node scripts/smoke-windows-upgrade.js "frontend/desktop/dist/上一版安装包.exe" 1.2.4
```

没有真实证书签名或没有完成真机双 Hub/升级验收时，只能发布内部测试构建，不能标记为公开稳定版。

标签构建完成后，GitHub `production` 环境还会等待人工批准。验收人员完成上述场景后，把环境 Secret `RELEASE_SMOKE_APPROVAL` 设置为当前完整标签（例如 `v1.2.6`）；值与标签不一致时不会创建公开 Release。建议同时为该环境配置 Required reviewers。
