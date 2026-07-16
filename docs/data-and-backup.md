# 数据、备份与恢复

AetherX 的同步用于让多个客户端看到同一个 Hub 的最新数据，不等于备份。误删除、数据库损坏或主机丢失会同步影响所有客户端，因此必须单独备份 Hub。

## 数据位置

### 后端开发模式

默认目录：

```text
backend/.data/
```

数据库文件：

```text
backend/.data/xuanai.db
```

可以通过 `AETHERX_DATA_DIR` 修改。

### 桌面端内置 Hub

开发模式仍使用 `backend/.data`。打包后的桌面端默认使用 Electron `userData` 目录下的 `hub` 子目录；Windows 通常位于：

```text
%APPDATA%\AetherX\hub
```

具体路径可能受产品名、安装方式和环境变量影响，应以实际 `AETHERX_DATA_DIR` 或应用日志为准。

桌面登录会话保存在 `userData/auth.json`，令牌由 Electron `safeStorage` 加密。它不是业务数据备份的必要组成部分，恢复后可以重新登录。

### Linux 自托管

推荐目录：

```text
/var/lib/aetherx/xuanai.db
```

主密钥通常位于受权限保护的 `/etc/aetherx.env`，但也可以由其他秘密管理方式注入。

## 必须保护的内容

| 内容 | 必须备份 | 作用 |
| --- | --- | --- |
| `xuanai.db` | 是 | 账号、记忆、对话、待办、配置等业务数据 |
| `AETHERX_MASTER_KEY` | 是 | 解密数据库中保存的 AI Provider 凭证 |
| `AETHERX_REGISTRATION_SECRET` | 建议 | 保持当前注册流程，可在恢复后轮换 |
| 桌面 `auth.json` | 否 | 本机登录会话，可重新登录生成 |
| 手机设备令牌 | 否 | 可以重新配对生成 |

数据库和主密钥都很敏感。可以使用不同的存储位置和访问控制进行备份，但恢复时二者必须匹配。

## 安全备份方式

### 方式一：停机备份

这是当前最简单、最稳妥的方式。

桌面端：

1. 在托盘菜单选择“退出”，确认内置 Hub 已停止；
2. 复制整个 Hub 数据目录到受保护的位置；
3. 重新启动 AetherX。

Linux systemd：

```bash
sudo systemctl stop aetherx
sudo install -d -m 700 /var/backups/aetherx
sudo cp --reflink=auto --sparse=always /var/lib/aetherx/xuanai.db /var/backups/aetherx/xuanai.db
sudo systemctl start aetherx
curl -fsS http://127.0.0.1:4318/health
```

再通过独立的安全渠道备份主密钥。不要把包含密钥的 `/etc/aetherx.env` 上传到公开网盘或仓库。

### 方式二：SQLite 在线备份

需要持续在线时，应使用 SQLite Backup API 或 `VACUUM INTO` 创建一致快照。不要只复制正在写入的 `xuanai.db`，也不要忽略 WAL 状态。项目尚未内置一键在线备份命令，部署者应在经过恢复测试后再自动化这一流程。

## 完整性检查

停止 Hub 后，可以使用 Node.js 22 检查：

```bash
node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('/var/lib/aetherx/xuanai.db',{readOnly:true});console.log(db.prepare('PRAGMA quick_check').get().quick_check);db.close()"
```

输出应为 `ok`。完整性通过不代表备份可恢复，仍应定期进行恢复演练。

## 恢复

1. 停止 Hub；
2. 保留当前损坏或错误版本的副本，便于后续排查；
3. 恢复 `xuanai.db`；
4. 设置正确的文件所有者和权限；
5. 恢复与该数据库匹配的 `AETHERX_MASTER_KEY`；
6. 启动 Hub；
7. 检查健康接口、账号登录、记忆数量和 AI 配置；
8. 客户端重新连接后确认同步游标可以继续推进。

Linux 示例：

```bash
sudo systemctl stop aetherx
sudo cp /var/backups/aetherx/xuanai.db /var/lib/aetherx/xuanai.db
sudo chown aetherx:aetherx /var/lib/aetherx/xuanai.db
sudo chmod 600 /var/lib/aetherx/xuanai.db
sudo systemctl start aetherx
```

## 从本地迁移到服务器

1. 完全退出本地桌面端或停止本地后端；
2. 备份本地 Hub 数据目录；
3. 上传数据库到服务器临时目录；
4. 在服务器上校验文件和 SQLite 完整性；
5. 停止服务器 Hub；
6. 替换服务器数据库并修复权限；
7. 使用原数据库对应的主密钥；
8. 启动并验证服务；
9. 桌面端改为服务器 HTTPS 地址；
10. 确认成功后再处理临时上传文件。

如果本地数据库过去依赖自动生成的本地主密钥，迁移前必须确认密钥来源。无法取得原密钥时，迁移后需要重新填写 AI API Key，但其他未加密业务数据仍可使用。

## 多账号与旧数据

空数据库中的第一个账号会认领 `local-user` 旧数据。这个过程只在创建首个账号时发生，并在一个数据库事务内完成。不要通过手工 SQL 把多个账号的数据合并；需要迁移账号归属时，应先设计和测试专用迁移。

## 不要这样做

- 不要用 Syncthing、OneDrive、网盘或共享目录同步活跃数据库；
- 不要在 Hub 运行时只复制 `xuanai.db` 并假定它一定一致；
- 不要把数据库、环境文件或备份压缩包提交到 Git；
- 不要只备份数据库却丢弃主密钥；
- 不要未经验证就在唯一一份生产数据上测试新迁移；
- 不要把“客户端现在能看到数据”当作备份成功。
