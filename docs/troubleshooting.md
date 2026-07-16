# 常见问题与排障

## 桌面端提示 `fetch failed`

先从运行桌面端的电脑检查健康接口：

```powershell
curl.exe -4 -v https://hub.example.com/health
```

如果使用本地 Hub：

```powershell
curl.exe http://127.0.0.1:4318/health
```

依次确认：

- 域名是否解析到正确服务器；
- 80/443 是否在云安全组和系统防火墙中放行；
- Caddy 是否运行并成功获得证书；
- AetherX 服务是否监听 `127.0.0.1:4318`；
- 客户端填写的是服务器根地址，不要附加 `/api/v1`；
- 是否存在失效的 AAAA 记录或代理软件拦截。

## HTTPS 握手被重置

查看：

```bash
sudo systemctl status caddy --no-pager
sudo journalctl -u caddy -n 100 --no-pager -l
```

常见原因包括证书尚未签发、80/443 未放行、域名解析错误、同端口存在其他服务或服务器网络策略拦截 TLS。

## `AI_KEY_DECRYPTION_FAILED`

数据库中的 AI Key 是用 `AETHERX_MASTER_KEY` 加密的。迁移或重装后出现该错误，通常表示当前主密钥与保存凭证时不同。

处理方式：

1. 优先恢复原来的主密钥并重启 Hub；
2. 无法恢复时，在前端重新填写 AI API Key；
3. 不要反复随机生成新主密钥，否则所有已保存凭证都会继续失效。

业务数据不会因为 AI Key 无法解密而自动删除。

## 不能创建第二个账号

先检查服务器的注册模式。默认 `open` 会开放创建账号；`invite` 需要注册口令；`closed` 会在首个账号创建后关闭入口。

要开放创建功能，在服务器环境文件中设置并重启：

```ini
AETHERX_REGISTRATION_MODE=open
AETHERX_REGISTRATION_SECRET=
```

保存后重启服务，桌面端和 Android 端都会显示“创建账号”。若使用 `invite`，客户端还必须填写同一个注册口令。

## 首页内容暂时为空

首页会并行加载画像、手记、相册、成长记录等多个资源。先确认登录状态和健康接口，再查看后端日志是否有某个 API 返回错误。远程网络较慢时，内容可能晚于页面外框出现。

如果一直为空：

- 重新进入页面；
- 确认登录的是预期账号；
- 检查该账号下是否确实有对应数据；
- 查看后端 `requestId` 对应的日志；
- 不要直接编辑数据库尝试“补数据”。

## Android 无法连接本地电脑

USB 调试：

```powershell
adb devices
adb reverse tcp:4318 tcp:4318
```

手机端服务器地址填写：

```text
http://127.0.0.1:4318
```

`adb reverse` 在拔线、重启手机或重启 adb 后可能需要重新执行。远程地址必须使用 HTTPS；Android 安全配置不会为任意远程主机放行明文 HTTP。

## 配对一直等待确认

- 确认配对码没有过期；
- 手机和电脑必须连接同一个 Hub 地址；
- 手机提交申请后，需要在桌面端明确批准；
- 配对秘密只能兑换一次；
- 重新生成配对会话时，不要继续使用旧码；
- 远程配对必须通过可信 HTTPS 或私人网络。

## 手机不同步

同步由“增量补拉 + SSE 通知”组成。检查：

- 设备令牌是否已被撤销；
- 手机能否正常读取业务 API；
- `/api/v1/sync/changes` 是否返回递增游标；
- 反向代理是否允许长连接；
- 应用从后台恢复后是否重新连接；
- 服务器日志是否出现 401 或 5xx。

SSE 断开不会直接丢数据，客户端应使用最后保存的游标补拉。如果游标异常，先保留日志和客户端状态，不要删除数据库同步表。

## 端口 4318 被占用

桌面端会先探测占用者是否是健康的 AetherX Hub：是则复用，否则无法安全接管该端口。

Windows 查看监听进程：

```powershell
Get-NetTCPConnection -LocalPort 4318 -State Listen
```

Linux：

```bash
sudo ss -ltnp 'sport = :4318'
```

不要直接终止不认识的进程。先确认它的用途，或为开发后端配置不同的 `AETHERX_PORT`。

## 数据库完整性或迁移失败

1. 停止 Hub；
2. 保存失败日志和当前数据库副本；
3. 对副本执行 `PRAGMA quick_check`；
4. 恢复升级前备份；
5. 使用原代码和原主密钥验证可登录；
6. 将可复现的脱敏错误报告给项目维护者。

不要在唯一数据库上反复重启尝试迁移，也不要修改已经应用的迁移版本号。

## 获取有效日志

Linux：

```bash
sudo journalctl -u aetherx -n 150 --no-pager -l
sudo journalctl -u caddy -n 150 --no-pager -l
```

提交 Issue 前移除：

- Authorization 请求头；
- API Key、注册口令和主密钥；
- 账号密码、设备令牌和配对秘密；
- 私人对话、记忆、图片和真实数据库内容。

保留错误码、请求 ID、版本、操作系统和最小复现步骤即可。
