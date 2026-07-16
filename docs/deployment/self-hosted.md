# 自托管部署指南

本指南以 Ubuntu 24.04、systemd 和 Caddy 为例，将 AetherX Hub 部署到私人服务器。最终只有 Caddy 的 80/443 端口对公网开放，Node 后端继续监听回环地址。

> [!CAUTION]
> 部署前先备份现有数据库和 `AETHERX_MASTER_KEY`。更换主密钥会导致已经保存的 AI Provider 凭证无法解密。

## 1. 前置条件

- 一台 x86_64 或 arm64 Linux 服务器；
- Node.js 22.13 或更高版本；
- Git；
- 指向服务器公网 IP 的域名，例如 `hub.example.com`；
- 防火墙允许 TCP 80 和 443；
- 不向公网开放 4318。

确认环境：

```bash
node -v
npm -v
git --version
```

Node.js 安装方式请优先选择 Node.js 官方发行包或受信任的软件源。安装后记下：

```bash
command -v node
```

后面的 systemd `ExecStart` 必须使用这个绝对路径。

## 2. 创建服务用户和目录

```bash
sudo useradd --system --home-dir /var/lib/aetherx --shell /usr/sbin/nologin aetherx
sudo install -d -o aetherx -g aetherx -m 700 /var/lib/aetherx
sudo install -d -o root -g root -m 755 /opt/aetherx
```

获取代码：

```bash
sudo git clone https://github.com/HanLoney/AetherX.git /opt/aetherx/source
cd /opt/aetherx/source/backend
sudo npm ci --omit=dev
```

私有派生仓库可以使用只读 Deploy Key。不要把个人访问令牌写入远程 URL 或部署脚本。

## 3. 准备数据

新安装无需手动创建数据库，Hub 首次启动时会自动初始化。

迁移已有数据库时，先停止旧 Hub，再把数据库放到：

```text
/var/lib/aetherx/xuanai.db
```

设置权限：

```bash
sudo chown aetherx:aetherx /var/lib/aetherx/xuanai.db
sudo chmod 600 /var/lib/aetherx/xuanai.db
```

不要在旧 Hub 仍写入时直接复制 `xuanai.db`。详细流程见[数据、备份与恢复](../data-and-backup.md)。

## 4. 配置环境变量

生成两个不同的随机值：

```bash
openssl rand -hex 32
openssl rand -hex 32
```

第一个作为主密钥，第二个作为注册口令。创建 `/etc/aetherx.env`：

```ini
AETHERX_HOST=127.0.0.1
AETHERX_PORT=4318
AETHERX_DATA_DIR=/var/lib/aetherx
AETHERX_MASTER_KEY=替换为稳定的随机主密钥
AETHERX_REGISTRATION_SECRET=替换为单独的随机注册口令
AETHERX_SESSION_TTL_DAYS=30
AETHERX_CORS_ORIGIN=*
```

保护环境文件：

```bash
sudo chown root:aetherx /etc/aetherx.env
sudo chmod 640 /etc/aetherx.env
```

说明：

- `AETHERX_MASTER_KEY` 必须长期保持不变并单独备份；
- `AETHERX_REGISTRATION_SECRET` 用于创建第二个及后续账号，可以定期轮换；
- 没有浏览器 Web 客户端时可以保持 `AETHERX_CORS_ORIGIN=*`；若只允许固定 Web Origin，应改为实际 Origin；
- 不要把环境文件提交到 Git。

## 5. 配置 systemd

创建 `/etc/systemd/system/aetherx.service`。把 `ExecStart` 中的 Node 路径替换为 `command -v node` 的结果：

```ini
[Unit]
Description=AetherX Hub
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=aetherx
Group=aetherx
WorkingDirectory=/opt/aetherx/source/backend
EnvironmentFile=/etc/aetherx.env
ExecStart=/usr/local/bin/node src/server.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/aetherx

[Install]
WantedBy=multi-user.target
```

验证并启动：

```bash
sudo systemd-analyze verify /etc/systemd/system/aetherx.service
sudo systemctl daemon-reload
sudo systemctl enable --now aetherx
sudo systemctl status aetherx --no-pager
curl -i http://127.0.0.1:4318/health
```

健康响应应包含：

```json
{"data":{"status":"ok","service":"aetherx-backend"}}
```

## 6. 配置 Caddy 和 HTTPS

安装并启用 Caddy 后，编辑 `/etc/caddy/Caddyfile`：

```caddyfile
hub.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:4318
}
```

验证并加载：

```bash
sudo caddy fmt --overwrite /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
curl -i https://hub.example.com/health
```

如果证书申请失败，检查：

- 域名 A/AAAA 记录是否指向当前服务器；
- 云安全组和系统防火墙是否放行 80/443；
- 是否存在错误的 IPv6 记录；
- 80/443 是否被其他服务占用；
- Caddy 日志：`sudo journalctl -u caddy -n 100 --no-pager -l`。

## 7. 创建账号和配置 AI

桌面端登录页填写：

```text
https://hub.example.com
```

空数据库允许创建第一个账号。如果设置了注册口令，第一个账号也必须提供正确口令。之后在桌面端“接入设置”中填写 AI Provider、模型和 API Key。

AI Key 由服务器保存。移动端只调用 Hub 的 AI API，不需要单独配置 Key。

## 8. 更新

更新前先备份。然后：

```bash
sudo systemctl stop aetherx
cd /opt/aetherx/source
sudo git pull --ff-only
cd backend
sudo npm ci --omit=dev
sudo systemctl start aetherx
sudo systemctl status aetherx --no-pager
curl -i http://127.0.0.1:4318/health
```

数据库迁移会在启动时自动执行。不要在没有备份时跨越多个未知版本直接升级生产数据。

## 9. 回滚

如果新版本启动失败：

1. 保存 `journalctl` 错误日志；
2. 停止服务；
3. 恢复升级前的代码提交；
4. 如果新版本已经执行数据库迁移，同时恢复升级前的数据库备份；
5. 使用原来的主密钥启动；
6. 本机健康检查通过后再恢复外部流量。

只回滚代码而保留已经升级的数据库并不总是安全。

## 10. 日常运维

```bash
sudo systemctl status aetherx --no-pager
sudo journalctl -u aetherx -n 100 --no-pager -l
sudo journalctl -u caddy -n 100 --no-pager -l
curl -fsS http://127.0.0.1:4318/health
```

定期备份数据库和主密钥、检查磁盘空间、撤销丢失设备，并验证备份可以在隔离环境恢复。
