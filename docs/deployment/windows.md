# Windows Hub 部署指南

AetherX Hub 是基于 Node.js 和 SQLite 的跨平台服务，不要求 Linux。本指南适用于 Windows 10/11，包含前台运行、开机常驻、局域网或公网接入、更新与备份。

如果只在当前电脑使用 AetherX，通常不需要单独部署 Hub：桌面端会在 `127.0.0.1:4318` 没有可用服务时自动启动内置 Hub。只有需要让 Hub 独立于桌面端运行、开机常驻或供其他设备连接时，才需要继续阅读。

> [!CAUTION]
> 部署前先备份数据目录和主密钥。不要只复制 `xuanai.db`，也不要在 Hub 正在写入时复制数据库。更换主密钥会导致已经保存的 AI Provider 凭证无法解密。

## 1. 前置条件

- Windows 10/11；
- Node.js 22.13 或更高版本；
- npm 10 或更高版本；
- Git；
- 若要从公网访问，需要域名、HTTPS 反向代理以及开放 TCP 80/443；
- 不要把 Hub 的 `4318` 端口直接暴露到公网。

在 PowerShell 中确认环境：

```powershell
node -v
npm -v
git --version
```

## 2. 获取代码并安装依赖

以下示例把程序放在 `C:\AetherX\source`：

```powershell
New-Item -ItemType Directory -Force C:\AetherX | Out-Null
git clone https://github.com/HanLoney/AetherX.git C:\AetherX\source
Set-Location C:\AetherX\source\backend
npm ci --omit=dev
```

若只是参与开发，请不要使用 `--omit=dev`，改为执行 `npm install`。

## 3. 最简单的本机运行

在 PowerShell 中启动：

```powershell
Set-Location C:\AetherX\source\backend
npm start
```

默认行为：

- 监听 `http://127.0.0.1:4318`；
- 数据写入 `C:\AetherX\source\backend\.data`；
- 首次运行时在数据目录生成 `.master-key`；
- 关闭当前 PowerShell 窗口会停止 Hub。

另开一个 PowerShell 窗口验证：

```powershell
curl.exe http://127.0.0.1:4318/health
```

健康响应应包含：

```json
{"data":{"status":"ok","service":"aetherx-backend"}}
```

本地模式下应把整个 `.data` 目录一起备份，其中包括数据库和自动生成的 `.master-key`。

## 4. 准备长期运行目录和配置

长期运行时建议把数据与代码分开。以管理员身份打开 PowerShell：

```powershell
New-Item -ItemType Directory -Force C:\ProgramData\AetherX\data | Out-Null
```

生成稳定的随机主密钥：

```powershell
$bytes = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$rng.Dispose()
$masterKey = [Convert]::ToBase64String($bytes)
$masterKey
```

把输出保存在密码管理器或离线备份中。然后创建 `C:\ProgramData\AetherX\start-hub.ps1`：

```powershell
$env:AETHERX_HOST = "127.0.0.1"
$env:AETHERX_PORT = "4318"
$env:AETHERX_DATA_DIR = "C:\ProgramData\AetherX\data"
$env:AETHERX_MASTER_KEY = "替换为刚才生成的稳定主密钥"
$env:AETHERX_REGISTRATION_MODE = "closed"
$env:AETHERX_REGISTRATION_SECRET = ""
$env:AETHERX_SESSION_TTL_DAYS = "30"
$env:AETHERX_CORS_ORIGIN = "*"

Set-Location "C:\AetherX\source\backend"
& "C:\Program Files\nodejs\node.exe" "src\server.js" *>> "C:\ProgramData\AetherX\hub.log"
exit $LASTEXITCODE
```

若 Node.js 安装在其他位置，请使用下面的命令查询并替换脚本中的路径：

```powershell
(Get-Command node).Source
```

保护配置和数据目录，只允许 `SYSTEM` 与本机管理员访问：

```powershell
icacls C:\ProgramData\AetherX /inheritance:r
icacls C:\ProgramData\AetherX /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F"
```

这里使用内置账号和管理员组的 SID，避免命令受 Windows 显示语言影响。

注册模式说明：

- `open`：允许继续创建新账号；
- `invite`：需要同时设置 `AETHERX_REGISTRATION_SECRET`；
- `closed`：空数据库仍可创建首个账号，之后关闭注册，适合个人实例。

## 5. 配置开机常驻

下面使用 Windows 自带的任务计划程序，不要求额外的服务包装器。仍在管理员 PowerShell 中执行：

```powershell
$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "C:\ProgramData\AetherX\start-hub.ps1"'

$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal `
  -UserId "SYSTEM" `
  -LogonType ServiceAccount `
  -RunLevel Highest

$settings = New-ScheduledTaskSettingsSet `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask `
  -TaskName "AetherX-Hub" `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings

Start-ScheduledTask -TaskName "AetherX-Hub"
Start-Sleep -Seconds 3
curl.exe http://127.0.0.1:4318/health
```

常用管理命令：

```powershell
Get-ScheduledTask -TaskName "AetherX-Hub"
Stop-ScheduledTask -TaskName "AetherX-Hub"
Start-ScheduledTask -TaskName "AetherX-Hub"
Get-Content C:\ProgramData\AetherX\hub.log -Tail 100
```

删除任务不会删除代码、配置或数据：

```powershell
Unregister-ScheduledTask -TaskName "AetherX-Hub" -Confirm:$false
```

## 6. 允许其他设备连接

### 只在本机使用

保持：

```text
AETHERX_HOST=127.0.0.1
```

这是风险最低的配置，只有当前电脑可以访问 Hub。

### 局域网或可信私人网络

若手机需要直接访问此 Windows 主机，可以把监听地址改为：

```text
AETHERX_HOST=0.0.0.0
```

然后只对“专用”网络配置文件放行 4318：

```powershell
New-NetFirewallRule `
  -DisplayName "AetherX Hub (Private LAN)" `
  -Direction Inbound `
  -Action Allow `
  -Protocol TCP `
  -LocalPort 4318 `
  -Profile Private
```

确认 Windows 当前网络确实被标记为“专用”，并避免在公共 Wi-Fi 上使用该规则。更稳妥的方案是通过可信私人网络或 HTTPS 反向代理访问。

### 从公网访问

不要为公网直接开放 4318。使用 Caddy、IIS 或其他反向代理，只开放 80/443，并让代理转发到 `127.0.0.1:4318`。Caddyfile 示例：

```caddyfile
hub.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:4318
}
```

域名必须指向当前公网 IP，路由器或云防火墙需要转发或放行 80/443。Caddy 也必须配置为开机启动。若这台 Windows 电脑会休眠、断网或频繁重启，更推荐使用长期在线的 Linux 服务器或 NAS。

桌面端登录页填写完整 HTTPS 地址：

```text
https://hub.example.com
```

地址末尾不要附加 `/api/v1`。

## 7. 创建账号和配置 AI

空数据库始终允许创建第一个账号。登录后在桌面端“接入设置”中填写 AI Provider、模型和 API Key。

AI Key 由 Hub 使用主密钥加密保存，不会下发到手机端。首次账号创建完成后，使用 `closed` 模式的实例将拒绝继续注册新账号。

## 8. 更新

更新前先备份。以管理员身份执行：

```powershell
Stop-ScheduledTask -TaskName "AetherX-Hub"

Set-Location C:\AetherX\source
git pull --ff-only
Set-Location backend
npm ci --omit=dev

Start-ScheduledTask -TaskName "AetherX-Hub"
Start-Sleep -Seconds 3
curl.exe http://127.0.0.1:4318/health
```

数据库迁移会在启动时自动执行。不要在没有备份时跨越多个未知版本直接升级生产数据。

## 9. 备份、迁移与回滚

至少备份：

- `C:\ProgramData\AetherX\data`；
- `C:\ProgramData\AetherX\start-hub.ps1` 或单独保存的 `AETHERX_MASTER_KEY`；
- 当前使用的代码提交编号。

备份数据库前先停止任务：

```powershell
Stop-ScheduledTask -TaskName "AetherX-Hub"
Copy-Item C:\ProgramData\AetherX\data D:\Backups\AetherX-data -Recurse
Start-ScheduledTask -TaskName "AetherX-Hub"
```

迁移到另一台机器时，必须同时迁移数据库和对应主密钥。详细步骤见[数据、备份与恢复](../data-and-backup.md)。

如果更新后无法启动：

1. 保存 `hub.log`；
2. 停止计划任务；
3. 恢复升级前的代码提交；
4. 若新版本已经迁移数据库，同时恢复升级前的数据库备份；
5. 使用原来的主密钥启动；
6. 健康检查通过后再恢复其他设备连接。

只回滚代码而保留已经升级的数据库并不总是安全。

## 10. 常见检查

```powershell
Get-ScheduledTask -TaskName "AetherX-Hub"
Get-NetTCPConnection -LocalPort 4318
Get-Content C:\ProgramData\AetherX\hub.log -Tail 100
curl.exe http://127.0.0.1:4318/health
```

若端口已被占用：

```powershell
Get-NetTCPConnection -LocalPort 4318 | Select-Object OwningProcess
Get-NetTCPConnection -LocalPort 4318 |
  ForEach-Object { Get-Process -Id $_.OwningProcess }
```

定期备份数据目录和主密钥、检查磁盘空间、控制日志文件大小，并验证备份能够在隔离环境恢复。
