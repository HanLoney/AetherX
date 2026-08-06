# AetherX 双 Hub 复制与安全切换实现方案

> 状态：实施中，作为后续实现与验收的工作基线。
>
> 架构决策见 [ADR-0004：双 Hub 采用双节点单活动复制](../adr/0004-dual-hub-single-active-replication.md)。迁移完成前，运行时默认行为继续兼容 [ADR-0002：家庭节点单写与增量同步](../adr/0002-home-hub-single-writer-sync.md)。

## 1. 文档目的

本文描述如何让一台电脑和一部 Android 手机各自拥有一份完整、可运行的 AetherX Hub，并在不依赖官方数据云的前提下实现：

- 电脑关闭时，用户仍可打开手机独立使用 AetherX；
- 手机与电脑首次配对后完成全量数据复制；
- 两个 Hub 在局域网或 AetherX Anywhere 通道可用时持续增量复制；
- 用户可以选择当前 Hub，桌面端和手机端跟随当前 Hub；
- 切换前验证结构化数据、媒体文件、密钥和同步游标的一致性；
- 网络中断后可以续传、补拉、审计和恢复；
- 不通过复制正在运行的 SQLite 文件实现同步；
- 不通过“更新时间较新者覆盖”掩盖冲突。

本文是工程实现文档，不只是概念说明。后续修改协议、数据模型或关键约束时，必须同步更新本文和对应测试。

建议阅读顺序：先看第 4、7 节理解不可破坏的架构约束，再看第 9 至 16 节实现复制和切换协议；Android 侧从第 20 节开始，实际开发任务以第 27、28、32 节为准。

## 2. 目标与非目标

### 2.1 目标

1. **两个完整数据副本**：电脑 Hub 和手机 Hub 都拥有当前用户的全部业务数据、媒体和必要配置。
2. **单活动写入**：同一 AetherX 数据空间正常情况下只有一个 Hub 接受业务写入。
3. **安全计划切换**：两个 Hub 在线时，只有同步追平并通过完整性校验后才能移交当前 Hub 身份。
4. **可控强制接管**：原 Hub 不可达时允许用户明确接管，同时保留风险提示、旧分支和恢复证据。
5. **最终可验证**：同步完成不是“请求成功”，而是两端对同一逻辑数据计算出相同摘要。
6. **传输可替换**：局域网、Tailscale 直连和中继只负责连通，不改变复制语义。
7. **渐进迁移**：保留现有 REST、SSE、SQLite、Agent Hub 和完整存档能力，分阶段替换同步底层。

### 2.2 非目标

- 不实现两个 Hub 在网络分区时无限制并发写入后自动无损合并；
- 不直接同步 `xuanai.db`、WAL 文件或整个数据目录；
- 不把 Tailscale 身份直接当成 AetherX 数据授权；
- 不承诺 Android 应用被系统彻底停止后仍能作为永久可访问的网络服务器；
- 不在第一阶段建设第三方仲裁云、官方数据中继或通用 CRDT 数据库；
- 不迁移正在生成的 AI 回复、流式连接或尚未完成的工具调用现场。

## 3. 当前实现基线

实现前必须承认现有能力边界，不能把客户端同步误认为 Hub 复制。

### 3.1 当前可复用能力

- `backend/src/infrastructure/database.js` 通过 SQLite 触发器写入 `sync_changes`；
- `backend/src/modules/sync` 提供增量游标查询和 SSE 变化通知；
- Android 已能保存按 Hub 地址和用户隔离的同步游标；
- 桌面端已有轮询式变化协调器；
- 设备配对已有一次性秘密、设备公钥、确认和令牌兑换流程；
- 完整存档包含结构化数据、原始媒体、记录摘要和媒体 SHA-256 校验；
- 存档恢复已有写锁、临时目录、数据库事务、回滚和恢复后摘要复验；
- 媒体表已有 `content_hash`，可作为内容寻址迁移的起点；
- Agent、工具授权、记忆和业务 API 已集中在后端运行。

### 3.2 当前不能直接复用的语义

`sync_changes` 只包含实体类型、实体 ID、操作类型和顺序号。它可以通知客户端“重新读取某类数据”，但不能独立重建另一个 Hub，因为它没有：

- 变更后的规范化数据；
- 删除墓碑的完整上下文；
- 每个来源节点的序列；
- 操作唯一 ID 和幂等语义；
- 实体版本、前置版本或冲突条件；
- 媒体块清单；
- 哈希链、签名和对端确认位置；
- Hub 角色和切换代次。

完整存档适合首次引导和缺口过大时重建副本，不适合每次实时同步。双 Hub 需要新增独立的 Peer Replication 协议。

## 4. 核心架构决策

### 4.1 双节点、单活动

每个用户拥有一个逻辑 `space_id`。电脑 Hub 和手机 Hub 是该数据空间内的两个 `node_id`。

同一时刻只有一个节点处于 `active`：

- 接受聊天、资料、记忆、待办、钱包等业务写入；
- 运行 Agent、主动提醒、手记、梦境和其他后台任务；
- 为本代次分配业务操作；
- 向客户端发出变化通知。

另一个节点处于 `standby`：

- 保存完整副本；
- 接收和校验复制操作；
- 提供健康状态和只读检查接口；
- 不执行产生业务副作用的后台任务；
- 收到业务写请求时返回当前 Hub 信息，不自行写入。

### 4.2 代次而非时间戳决定权威

每次成功切换生成新的单调递增 `epoch`。权威顺序由 `(epoch, origin_sequence)` 表达，不使用设备本地时间决定新旧。

时间戳只用于展示和诊断。手机与电脑时钟偏差不能改变写入归属。

### 4.3 两节点无法同时满足强一致和任意分区可写

当两个节点无法通信时，系统无法只凭两台设备证明另一端没有继续写入。因此：

- **计划切换**可以保证零分叉；
- **强制接管**只能保证过程显式、可审计、可恢复，不能数学上证明旧节点没有孤立写入；
- 强制接管后，旧节点重新加入时必须先隔离旧代次未确认操作，禁止自动覆盖；
- 不提供静默自动故障转移。

如果未来要求两个节点在分区期间都可写并自动合并，需要针对每种业务实体设计 CRDT 或领域冲突规则，那是另一项架构工程。

## 5. 术语

| 术语 | 含义 |
| --- | --- |
| Space | 某个用户拥有的完整 AetherX 逻辑数据空间 |
| Node | 承载一个 Space 副本的 Hub 实例 |
| Active Hub | 当前唯一允许业务写入和运行 Agent 的 Hub |
| Standby Hub | 只复制、不产生业务副作用的 Hub |
| Epoch | 当前 Hub 身份的单调递增代次 |
| Operation | 一次可复制、可校验、可幂等应用的业务变更 |
| Watermark | 某节点已经连续应用到的来源序列 |
| Snapshot | 某个一致性边界上的全量结构化数据和媒体清单 |
| Blob | 以内容哈希标识的原图、缩略图或其他二进制文件 |
| Planned switchover | 两端在线并追平后的安全切换 |
| Forced takeover | 原 Hub 不可达时由用户确认的强制接管 |
| Divergent branch | 强制接管后发现的旧代次未同步写入集合 |

## 6. 目标拓扑

```text
桌面客户端 ── Hub Router ──┐
                           ├── 当前 Hub（唯一写入）── AI Provider
手机客户端 ── Hub Router ──┘             │
                                         │ Peer Replication
                                         ▼
                                  备用 Hub（完整副本）
```

物理部署通常是：

```text
电脑
├─ Electron 桌面客户端
└─ Node Hub Host
   ├─ Desktop Storage Adapter
   ├─ Peer Replication
   └─ SQLite + Media Store

Android 手机
├─ Vue + Capacitor UI
└─ Mobile Hub Host
   ├─ Hub Core
   ├─ Android Storage Adapter
   ├─ Android Keystore Adapter
   ├─ Peer Replication
   └─ Native Background Coordinator
```

## 7. 必须始终成立的不变量

1. 一个 Space 在正常状态下只有一个 `active_node_id`。
2. 备用 Hub 不运行 Agent 和会产生记录的后台任务。
3. 每次业务写入和对应复制操作必须在同一数据库事务提交。
4. 同一个 `operation_id` 在任意节点最多应用一次。
5. 一个来源节点的操作必须按 `origin_sequence` 连续应用。
6. 删除必须保留墓碑，直到所有已登记节点确认越过删除操作。
7. 客户端写入必须带 `request_id`，重试不能产生第二次业务效果。
8. 计划切换前，两端结构化数据根摘要必须相同。
9. 计划切换前，不允许存在未传完的必要 Blob。
10. 计划切换前，当前 Hub 必须处于 Agent 空闲或已明确取消状态。
11. 角色切换控制记录不能只靠普通业务复制隐式产生。
12. 旧 epoch 的节点不能自动接受新业务写入。
13. 任何校验失败都必须停在临时区或隔离区，不修改正式副本。
14. Hub 复制不复制节点私钥、登录会话、运行日志和临时授权现场。

## 8. 数据范围

### 8.1 必须复制

- 对话、消息和消息载荷；
- 用户画像、偏好和界面设置；
- AI 伙伴资料、人格事件、共同记忆；
- 长期记忆、证据、记忆配置；
- Prompt 设置和版本；
- 待办、手记、心情、梦境、纪念册；
- 钱包账户和每一笔流水；
- 模块开关；
- AI Provider 和图片 Provider 配置；
- 媒体元数据、原图、缩略图；
- 可恢复的后台任务计划；
- 业务墓碑、幂等请求和复制元数据。

### 8.2 节点本地保存，不跨节点复制

- 节点身份私钥；
- 本机登录会话和 Bearer Token；
- 一次性配对会话；
- 设备健康心跳；
- SSE 连接状态；
- 运行日志、缓存和临时下载；
- 当前正在流式生成的 AI 文本；
- 尚未结束的工具授权弹窗；
- 数据库 WAL、锁文件和临时恢复目录。

### 8.3 需要重新建模的秘密

Provider Key 采用“本机静态加密 + Space Key 复制信封”的双层模型：

1. 每个 Hub 落库时仍使用自己的本机主密钥加密 Provider Key；
2. 产生 Provider 配置 Operation 时，活动 Hub 临时解密本机密文，再使用 Space Key 和实体绑定 AAD 生成 AES-256-GCM 复制信封；
3. Operation 不包含明文 Key，也不复制只能由源 Hub 解密的本机密文；
4. 备用 Hub 验证 Operation 后用 Space Key 解封，再立即使用自己的本机主密钥重新加密入库；
5. Space Key 分别由电脑安全存储和 Android Keystore 对应的本机包装密钥保护；
6. 配对时只传输经节点公钥协商密钥再次包装后的 Space Key；节点私钥永不进入同步数据或存档正文。

这个方案保留现有 `AETHERX_MASTER_KEY` 的本机静态保护，不需要把数据库里的 Provider 密文统一改成 Space Key 密文，同时允许两台 Hub 使用不同的本机主密钥。Space Key 轮换前必须保留可解密历史复制信封的旧版本密钥，当前阶段尚未开放轮换。

## 9. 数据库模型

以下字段为协议要求，实际迁移可以拆成多个版本。

### 9.1 Space 与节点

```text
aetherx_spaces
- id                       TEXT PRIMARY KEY
- local_user_id            TEXT NOT NULL
- display_name             TEXT NOT NULL
- created_at               INTEGER NOT NULL
- updated_at               INTEGER NOT NULL

hub_nodes
- id                       TEXT PRIMARY KEY
- space_id                 TEXT NOT NULL
- node_name                TEXT NOT NULL
- platform                 TEXT NOT NULL
- public_identity          TEXT NOT NULL
- protocol_version         INTEGER NOT NULL
- schema_version           INTEGER NOT NULL
- status                   TEXT NOT NULL
- last_seen_at             INTEGER
- created_at               INTEGER NOT NULL
- revoked_at               INTEGER

hub_endpoints
- id                       TEXT PRIMARY KEY
- space_id                 TEXT NOT NULL
- node_id                  TEXT NOT NULL
- transport                TEXT NOT NULL
- address                  TEXT NOT NULL
- priority                 INTEGER NOT NULL
- certificate_fingerprint  TEXT NOT NULL
- last_success_at          INTEGER

space_data_keys
- space_id                 TEXT PRIMARY KEY
- key_version              INTEGER NOT NULL
- encrypted_sync_key       TEXT NOT NULL
- created_at               INTEGER NOT NULL
- rotated_at               INTEGER

hub_peer_credentials
- space_id                 TEXT NOT NULL
- peer_node_id             TEXT NOT NULL
- key_id                   TEXT NOT NULL
- encrypted_shared_secret  TEXT NOT NULL
- created_at               INTEGER NOT NULL
- rotated_at               INTEGER
- revoked_at               INTEGER

peer_request_nonces
- space_id                 TEXT NOT NULL
- peer_node_id             TEXT NOT NULL
- nonce                    TEXT NOT NULL
- request_timestamp        INTEGER NOT NULL
- seen_at                  INTEGER NOT NULL

hub_pairing_sessions
- id                       TEXT PRIMARY KEY
- user_id                  TEXT NOT NULL
- space_id                 TEXT NOT NULL
- secret_hash              TEXT NOT NULL
- status                   TEXT NOT NULL
- server_ephemeral_public_key TEXT NOT NULL
- encrypted_server_ephemeral_private_key TEXT NOT NULL
- requested_node_id        TEXT
- node_name                TEXT
- platform                 TEXT
- public_identity          TEXT
- client_ephemeral_public_key TEXT
- protocol_version         INTEGER
- schema_version           INTEGER
- created_at               INTEGER NOT NULL
- expires_at               INTEGER NOT NULL
- claimed_at               INTEGER
- approved_at              INTEGER
- redeemed_at              INTEGER
```

`local_user_id` 只用于映射本节点现有表的 `user_id`。跨节点协议始终使用 `space_id`，不能假定两个数据库里的用户 ID 一定相同。

### 9.2 当前 Hub 控制状态

```text
hub_cluster_state
- space_id                 TEXT PRIMARY KEY
- epoch                    INTEGER NOT NULL
- active_node_id           TEXT NOT NULL
- transition_id            TEXT NOT NULL DEFAULT ''
- state                    TEXT NOT NULL
- state_hash               TEXT NOT NULL
- control_signature        TEXT NOT NULL
- updated_at               INTEGER NOT NULL
```

`state` 可取：

- `stable`
- `preparing_switch`
- `draining`
- `committing_switch`
- `forced_active`
- `divergence_detected`
- `recovery_required`

### 9.3 可复制操作日志

```text
replication_operations
- operation_id             TEXT PRIMARY KEY
- space_id                 TEXT NOT NULL
- origin_node_id           TEXT NOT NULL
- origin_sequence          INTEGER NOT NULL
- epoch                    INTEGER NOT NULL
- entity_type              TEXT NOT NULL
- entity_id                TEXT NOT NULL
- operation                TEXT NOT NULL
- entity_version           INTEGER NOT NULL
- previous_entity_version  INTEGER
- payload_json             TEXT NOT NULL
- payload_hash             TEXT NOT NULL
- previous_operation_hash  TEXT NOT NULL
- operation_hash           TEXT NOT NULL
- authentication_tag       TEXT NOT NULL
- created_at               INTEGER NOT NULL
- UNIQUE(space_id, origin_node_id, origin_sequence)
```

`operation` 至少支持：

- `upsert`
- `delete`
- `reset_marker`
- `control`

### 9.4 应用状态和确认

```text
replication_watermarks
- space_id                 TEXT NOT NULL
- peer_node_id             TEXT NOT NULL
- origin_node_id           TEXT NOT NULL
- contiguous_sequence      INTEGER NOT NULL
- operation_hash           TEXT NOT NULL
- acknowledged_at          INTEGER NOT NULL
- PRIMARY KEY(space_id, peer_node_id, origin_node_id)

applied_operations
- operation_id             TEXT PRIMARY KEY
- space_id                 TEXT NOT NULL
- applied_at               INTEGER NOT NULL

replication_entity_versions
- space_id                 TEXT NOT NULL
- entity_type              TEXT NOT NULL
- entity_id                TEXT NOT NULL
- version                  INTEGER NOT NULL
- updated_at               INTEGER NOT NULL
- PRIMARY KEY(space_id, entity_type, entity_id)

idempotency_requests
- space_id                 TEXT NOT NULL
- request_id               TEXT NOT NULL
- result_status            INTEGER NOT NULL
- result_hash              TEXT NOT NULL
- result_json              TEXT NOT NULL
- created_at               INTEGER NOT NULL
- expires_at               INTEGER NOT NULL
- PRIMARY KEY(space_id, request_id)
```

### 9.5 Blob 清单

```text
content_blobs
- content_hash             TEXT PRIMARY KEY
- byte_size                INTEGER NOT NULL
- mime_type                TEXT NOT NULL
- storage_name             TEXT NOT NULL
- chunk_size               INTEGER NOT NULL
- chunk_count              INTEGER NOT NULL
- complete                 INTEGER NOT NULL
- verified_at              INTEGER
- created_at               INTEGER NOT NULL

blob_chunks
- content_hash             TEXT NOT NULL
- chunk_index              INTEGER NOT NULL
- chunk_hash               TEXT NOT NULL
- byte_size                INTEGER NOT NULL
- received                 INTEGER NOT NULL
- PRIMARY KEY(content_hash, chunk_index)

replication_blob_requirements
- space_id                 TEXT NOT NULL
- peer_node_id             TEXT NOT NULL
- content_hash             TEXT NOT NULL
- required_by_operation    TEXT NOT NULL
- status                   TEXT NOT NULL
- updated_at               INTEGER NOT NULL
- PRIMARY KEY(space_id, peer_node_id, content_hash)
```

原图和缩略图分别作为 Blob。业务记录只引用内容哈希，不以本机文件名作为跨节点身份。

### 9.6 快照、校验和分叉

```text
replication_snapshots
- id                       TEXT PRIMARY KEY
- space_id                 TEXT NOT NULL
- source_node_id           TEXT NOT NULL
- epoch                    INTEGER NOT NULL
- boundary_json            TEXT NOT NULL
- records_root             TEXT NOT NULL
- blobs_root               TEXT NOT NULL
- manifest_hash            TEXT NOT NULL
- status                   TEXT NOT NULL
- created_at               INTEGER NOT NULL
- completed_at             INTEGER

divergent_operations
- operation_id             TEXT PRIMARY KEY
- space_id                 TEXT NOT NULL
- source_node_id           TEXT NOT NULL
- source_epoch             INTEGER NOT NULL
- reason                   TEXT NOT NULL
- payload_json             TEXT NOT NULL
- payload_hash             TEXT NOT NULL
- detected_at              INTEGER NOT NULL
- resolution               TEXT NOT NULL DEFAULT 'pending'
```

## 10. Operation 规范

### 10.1 规范示例

```json
{
  "protocolVersion": 1,
  "operationId": "019...",
  "spaceId": "space-...",
  "originNodeId": "node-mobile-...",
  "originSequence": 1842,
  "epoch": 7,
  "entityType": "wallet_transactions",
  "entityId": "transaction-...",
  "operation": "upsert",
  "entityVersion": 3,
  "previousEntityVersion": 2,
  "payload": {
    "id": "transaction-...",
    "account_id": "account-...",
    "event_type": "income",
    "change_minor": 69942,
    "detail": "闲鱼到账",
    "created_at": 1780000000000
  },
  "payloadHash": "sha256:...",
  "previousOperationHash": "sha256:...",
  "operationHash": "sha256:...",
  "authenticationTag": "..."
}
```

### 10.2 规范化要求

- Payload 使用确定性键排序后计算 SHA-256；
- 金额继续使用整数最小货币单位，禁止浮点数；
- 时间保存整数时间戳，但不参与权威顺序判断；
- 空值、空字符串和缺失字段必须有固定规范；
- `user_id` 在传输层替换为 `space_id` 或当前用户占位符；
- 接收端应用前将逻辑用户重新映射为本地 `user_id`；
- 删除操作必须携带实体 ID、删除前版本和必要父级关系；
- 接收端必须验证协议版本、字段白名单和最大 Payload 大小。

### 10.3 写入路径

所有可复制业务写入必须逐步迁移到统一入口：

```text
ReplicationAwareUnitOfWork.execute(context, mutation)
├─ 验证当前节点为 active
├─ 验证客户端 request_id
├─ BEGIN IMMEDIATE
├─ 执行业务写入
├─ 生成规范化 Operation
├─ 写 replication_operations
├─ 写 idempotency_requests
├─ COMMIT
├─ 发布本地客户端变化事件
└─ 唤醒 Peer Replicator
```

SQLite 触发器可以暂时保留为覆盖审计，但不能继续作为 Hub 复制 Operation 的唯一来源。业务服务需要返回本次真实变更实体，或者通过 Unit of Work 显式登记变更。

## 11. Hub 配对和首次全量复制

设备客户端配对与 Hub 节点配对必须分开。节点配对拥有复制完整数据和接收 Space Data Key 的高权限。

### 11.1 二维码内容

Hub 配对二维码包含：

- 协议版本；
- `space_id`；
- 发起节点 ID；
- 一次性配对会话 ID；
- 一次性高熵秘密；
- 临时密钥协商公钥；
- 证书指纹；
- 局域网和 Anywhere 候选地址；
- 过期标记。

不得包含长期设备令牌、Space Data Key 或节点私钥。

### 11.2 配对步骤

1. 当前 Hub 创建节点配对会话；
2. 手机扫描二维码并生成自己的节点身份；
3. 双方完成临时密钥协商并证明持有公钥；
4. 当前 Hub 展示手机型号、节点指纹和请求权限；
5. 用户在当前 Hub 确认；
6. 双方建立受应用层认证保护的复制会话；
7. 当前 Hub 将 Space Data Key 包装给新节点；
8. 新节点验证自己能够解密测试密文；
9. 开始 Bootstrap Snapshot；
10. 完整性验证通过后将新节点登记为 `standby`。

### 11.3 一致快照算法

```text
记录快照边界 B
→ 使用 SQLite Backup API 或受控读事务导出结构化数据
→ 生成媒体 Manifest
→ 计算 records_root / blobs_root / manifest_hash
→ 将快照传到目标 staging 目录
→ 目标校验并恢复到 staging 数据库
→ 从 B 之后补拉 Operation
→ 校验连续 Watermark
→ 校验最终逻辑根摘要
→ 原子启用新副本
```

快照期间当前 Hub 可以继续写入。新写入由 B 之后的 Operation 补齐，因此不需要长时间停服。

如果增量日志已被清理或出现无法修复的缺口，放弃当前 staging，重新生成快照，不能猜测缺失数据。

## 12. Peer Replication 协议

### 12.1 传输原则

- 控制消息和操作批次使用 HTTPS 或双向认证 WebSocket；
- 大媒体使用独立 HTTP Range/分块传输；
- 优先采用拉取模型，避免对端地址变化导致推送失败；
- 手机可主动连接电脑并在同一会话中完成上传和下载；
- 断线后从 Watermark 续传；
- 单批操作和单批字节均设上限；
- 压缩只用于结构化批次，不对 JPEG、PNG 等已压缩媒体重复压缩；
- 协议错误返回稳定错误码，不以中文消息作为机器判断依据。

### 12.2 建议接口

```text
POST /api/v1/hub-pairing/sessions
POST /api/v1/hub-pairing/sessions/:id/claim
POST /api/v1/hub-pairing/sessions/:id/approve
POST /api/v1/hub-pairing/sessions/:id/redeem

POST /api/v1/peer/hello
GET  /api/v1/peer/operations?origin=<node>&after=<seq>&limit=<n>
POST /api/v1/peer/operations/apply
POST /api/v1/peer/acknowledgements
POST /api/v1/peer/sync-complete
POST /api/v1/peer/switch/preflight
POST /api/v1/peer/switch/control
POST /api/v1/peer/switch/final-sync
GET  /api/v1/peer/blobs/:hash/manifest
GET  /api/v1/peer/blobs/:hash/chunks/:index
POST /api/v1/peer/integrity/compare

POST /api/v1/cluster/switch/preflight
POST /api/v1/cluster/switch/prepare
POST /api/v1/cluster/switch/commit
POST /api/v1/cluster/switch/abort
POST /api/v1/cluster/takeover/force
GET  /api/v1/cluster/status
GET  /api/v1/cluster/conflicts
```

Peer 接口使用独立认证中间件，不接受普通用户 Bearer Token。普通客户端也不能调用节点复制接口。

`POST /api/v1/peer/sync-complete` 不接受单纯的“我同步完了”布尔值。发起方必须提交本次同步方向对应的 `originNodeId`、`originSequence` 和 `operationHash`。接收 Hub 只在该链头与本地 Operation Log 完全一致时更新 `replication_peer_health`；启动器再以这个服务端校验后的 `caughtUp` 和 `lastSuccessAt` 收尾同步任务。这样手机 Hub 成为活动节点、普通手机客户端心跳暂停后，电脑端也不会一直停留在“等待手机上线”。

### 12.3 Hello 协商

双方连接后交换：

```json
{
  "protocolVersion": 1,
  "schemaVersion": 31,
  "spaceId": "space-...",
  "nodeId": "node-...",
  "epoch": 7,
  "activeNodeId": "node-mobile-...",
  "watermarks": {
    "node-desktop-...": 1510,
    "node-mobile-...": 1842
  },
  "recordsRoot": "sha256:...",
  "pendingBlobCount": 0,
  "capabilities": ["operation-v1", "blob-chunks-v1", "snapshot-v1"]
}
```

拒绝条件：

- `space_id` 不同；
- 对端节点已撤销；
- 协议版本没有交集；
- Schema 无法向前迁移；
- 对端声称不可能的 epoch 倒退；
- 节点身份签名无效；
- 当前正在恢复或切换且请求不属于相同 `transition_id`。

### 12.4 增量循环

1. 比较双方 Watermark；
2. 按来源节点和连续序列请求缺失 Operation；
3. 验证操作哈希链、认证标签和 epoch；
4. 在单个事务中按顺序应用一批；
5. 写入 `applied_operations` 和本地 Watermark；
6. 提交后返回确认；
7. 扫描该批次引用的缺失 Blob；
8. 并行、限速下载 Blob；
9. 达到校验周期或切换前计算逻辑根摘要。

任何序列缺口都必须停在缺口前。后续 Operation 不得越过缺口先应用。

## 13. 媒体复制

图片通常是同步最慢的数据，因此必须与结构化复制解耦。

### 13.1 内容寻址

- 原图内容 SHA-256 是跨节点主身份；
- 缩略图拥有自己的 SHA-256；
- 元数据引用哈希，不引用对端本地文件名；
- 相同内容只保存和传输一次；
- 本机 `storage_name` 可以不同；
- 正式读取路径只允许引用 `complete = 1` 且验证过的 Blob。

### 13.2 传输优先级

1. 用户当前打开的图片；
2. 最新对话和当前相册页缩略图；
3. 当前相册页原图；
4. 最近消息引用媒体；
5. 其余历史原图；
6. 可重新生成的派生缩略图。

### 13.3 完整性

- 每个块有独立 SHA-256；
- 全部块到齐后再验证整体 SHA-256；
- 临时文件使用 `.partial` 或 staging 目录；
- 整体校验成功后原子重命名；
- 网络中断后只补缺失块；
- 切换检查分别展示“结构化数据已同步”和“媒体已同步”；
- 必要 Blob 未完成时禁止计划切换。

## 14. 完整性校验

完整性分为五层，不能只做一个总哈希。

### 14.1 传输层

- HTTPS、Tailscale 或受保护局域网通道；
- 证书指纹固定；
- 请求随机数和过期窗口，防止重放。

### 14.2 Operation 层

- Payload 哈希；
- 来源节点连续哈希链；
- Space Sync Key 认证标签；
- 节点 ID、epoch 和序列校验；
- `operation_id` 幂等校验。

### 14.3 数据库层

- Schema 版本；
- `PRAGMA quick_check`；
- `PRAGMA foreign_key_check`；
- 业务不变量检查，例如钱包流水重算结果等于账户余额；
- 所有表的用户归属检查。

### 14.4 逻辑数据层

沿用完整存档的规范化思路，为每张表生成稳定排序后的叶子哈希，再组成 Merkle Root：

```text
space_root
├─ table_root: conversations
├─ table_root: messages
├─ table_root: memories
├─ table_root: wallet_accounts
├─ table_root: wallet_transactions
└─ ...
```

对比失败时先定位到表，再定位到实体，不要只显示“校验失败”。

### 14.5 媒体层

- Blob Manifest Root；
- 原图和缩略图数量；
- 总字节数；
- 每个 Blob 的内容哈希；
- 未完成、缺失和孤立 Blob 清单。

## 15. 当前 Hub 切换状态机

### 15.1 计划切换

```text
stable
  → preparing_switch
  → draining
  → final_sync
  → integrity_check
  → committing_switch
  → stable(new epoch, new active node)
```

具体步骤：

1. 用户在任意可信客户端选择目标 Hub；
2. 当前 Hub 创建唯一 `transition_id`；
3. 两端确认目标节点可运行所需协议和 Schema；
4. 当前 Hub 进入 `draining`，拒绝新的业务写入；
5. 已开始的普通请求完成；
6. Agent 流式回复、工具调用和存档操作完成或由用户取消；
7. 复制最后一批 Operation 和必要 Blob；
8. 双方交换连续 Watermark；
9. 双方计算并比较逻辑根摘要；
10. 当前 Hub 生成 `epoch + 1` 的切换控制记录；
11. 双方确认控制记录；
12. 目标节点变为 `active`，原节点变为 `standby`；
13. 客户端刷新 Hub 路由并重放尚未确认的幂等请求；
14. 原 Hub 解除只读维护状态，只保留备用复制能力。

任一步失败都会尝试向双方应用 `abort`，原 Hub 保持 active。只有目标 Hub 确认中止后，源 Hub 才解除切换写锁；如果目标不可达，源 Hub 保留当前切换阶段，等待使用同一 `transition_id` 重试中止，避免两端各自回到不同状态。

当前实现的控制路径：

```text
POST /api/v1/cluster/switch/prepare
  → 双端 preparing_switch
  → 双端 draining
  → 双端 final_sync
  → 目标 Hub 拉取最后一批 Operation 与原图
  → 双端 integrity_check

POST /api/v1/cluster/switch/commit
  → 双端 committing_switch
  → 目标先应用 stable(epoch + 1, target active)
  → 源端验证绑定 control hash 与 state hash 的 ACK
  → 源端应用同一 stable 状态

POST /api/v1/cluster/switch/abort
  → 仅允许 committing_switch 之前的阶段
  → 目标确认 stable(原 epoch, 原 active)
  → 源端恢复相同状态
```

Android Local Hub 与 Windows 启动器已经接入同一状态机：

```text
启动器 POST /api/v1/cluster/mobile-hubs/:nodeId/switch
  → Hub 按手机 installation_id 定向发送 SSE hub-command
  → 备用手机收到 switch-local-hub
  → 手机先执行增量追平，再生成 stable 阶段证明
  → 手机通过 /api/v1/peer/mobile-switch/start 与 /advance 推进切换

手机 Hub 正在承载时
  → 手机保留到电脑 Hub 的只读控制与健康上报 SSE
  → 启动器发送 switch-desktop-hub
  → 手机通过相同状态机把 active 角色安全交还电脑 Hub
```

控制命令必须定向到与该 Local Hub 心跳绑定的手机安装，不能把桌面端自身的 SSE 订阅误算为“手机已收到”。切换命令不离线排队，手机控制通道不在线时直接返回 `MOBILE_HUB_CONTROL_OFFLINE`，避免设备稍后上线后发生用户已不再预期的延迟切换。普通“立即同步”命令可以定向排队，并且只能由目标手机安装取走。

手机在第一次 `stable → preparing_switch` 前必须先执行一次增量复制，Bootstrap 完成证明只代表全量基线完成，不代表此后新增的 Operation 已经追平。预检失败会保留原活动 Hub，并向界面报告具体失败项：`cluster`、`target`、`space`、`epoch`、`protocol`、`schema`、`database`、`credentials`、`agent`、`operations`、`records`、`media` 或 `bootstrap`。

当前 Android Local Hub 是 Capacitor 进程内 Host，`serverUrl` 为 `capacitor://local-hub`，尚未开放可供电脑直接访问的 HTTP 端点。因而手机 Hub 承载期间，手机端可以独立使用；桌面端发起新的写请求时，如果会话交接返回 `PEER_ENDPOINT_UNAVAILABLE`，桌面端会通过保留的手机控制通道请求安全切回电脑 Hub，等待电脑节点恢复 `stable + active` 后使用同一 `request_id` 自动重试原请求。未来 Android 网络 Host 完成后，可移除该兼容回退并让桌面端直接连接手机 Hub。

阶段、提交和中止消息同时经过 Peer 请求 HMAC 与 Space Key HMAC；控制消息只接受 30 秒内的新鲜时间戳。目标已经应用 commit 但响应丢失时，源 Hub 会保持 `committing_switch`，同一 `transition_id` 可以重试并获得目标的幂等 ACK。当前阶段使用共享 Space Key 认证控制状态，后续仍应升级为节点身份私钥签名和可审计控制日志。

### 15.2 切换期间客户端行为

- 读取可以继续，但应标记数据可能正在追平；
- 新写入返回 `423 HUB_SWITCH_IN_PROGRESS`；
- 客户端显示阶段和进度，不用无限加载动画；
- 对已发送但未收到响应的写请求，用相同 `request_id` 重试；
- 客户端收到 `409 HUB_NOT_ACTIVE` 时读取响应中的签名路由信息并重新连接。

### 15.3 不能切换的条件

- Peer 不可达；
- Operation 存在缺口；
- 根摘要不一致；
- 必要 Blob 未传完；
- 目标节点 Schema 太旧；
- 目标节点不能解密 Provider 配置；
- 数据库检查失败；
- 存档恢复、数据库迁移或另一次切换正在进行；
- Agent 无法安全结束。

## 16. 强制接管与分叉恢复

> 实现状态：Android 手机 Hub 已支持显式风险确认后的强制接管。接管证明由 Space Key HMAC 签名，包含完整性快照与 Operation 链头；旧电脑 Hub 收到更高 `epoch` 后会立即自我隔离。若检测到旧代未确认 Operation，集群进入 `divergent` 且停止自动覆盖。桌面恢复中心已支持选择手机或电脑作为完整权威分支，并通过加密快照、媒体校验、Operation 链复验、签名恢复控制和双端确认闭环到新的统一 `epoch`。隔离分支会归档到签名证据，逐实体比较、复制为新实体和逐项合并尚未开放。

### 16.1 允许强制接管的场景

- 当前 Hub 关机或损坏；
- 当前 Hub 网络长期不可达；
- 用户确认要以备用副本继续工作。

界面必须展示：

- 最后一次确认同步位置；
- 最后一次成功完整校验；
- 待同步结构化操作数量；
- 待同步媒体数量和字节数；
- “另一台 Hub 可能存在尚未复制的数据”的明确说明。

### 16.2 强制接管流程

1. 用户进行二次确认；
2. 备用节点保存当前完整性报告；
3. 创建 `forced_takeover` 控制记录并提升 epoch；
4. 本节点进入 `forced_active`；
5. 客户端切换到新节点；
6. 新写入带新 epoch；
7. 旧节点重新出现时，先进入只读握手；
8. 新节点拉取旧节点未确认 Operation 到隔离区；
9. 检查是否存在分叉；
10. 无分叉则补齐并将旧节点降为 standby；
11. 有分叉则进入恢复中心，禁止自动覆盖。

### 16.3 分叉处理规则

优先自动处理：

- 相同 `operation_id`：去重；
- 同一内容哈希媒体：去重；
- 只在一侧存在、且没有版本冲突的独立新增实体：可建议导入；
- 完全相同 Payload：合并确认位置。

必须人工或领域规则处理：

- 同一钱包流水被两边修改；
- 同一账户余额链产生不同后继；
- 同一消息或对话顺序发生分叉；
- 同一记忆被一侧删除、另一侧修改；
- 同一配置被两侧赋不同值；
- 两边都运行了会产生内容的后台任务。

禁止通用 Last-Write-Wins。当前已经提供完整分支级的“保留手机 Hub”与“保留电脑 Hub”、证据导出和恢复进度；逐实体复制、比较和合并属于后续能力，不能伪装成已经安全解决。

### 16.4 两阶段恢复闭环

恢复开始前，桌面端要求用户明确选择唯一权威 Hub，并说明另一分支的隔离 Operation 会保留在签名证据中。恢复会话持久化到 `hub_divergence_recoveries`，失败后不会把集群标记为已解决，可以重新发起。

第一阶段传输并验证权威快照：

- 集群保持 `divergent` 或 `recovering_divergence`，普通业务写入继续冻结；
- 电脑权威时，由 Node Archive Service 收集结构化记录、Provider 凭据、媒体清单、全部 Operation 和 Entity Version；
- 手机权威时，由 Android Local Hub 导出同等恢复包并通过 Peer HMAC 路由连续分块上传；
- 整个恢复包使用 Space Key AES-256-GCM 加密，分块校验 SHA-256，总包校验规范化摘要；
- 接收端复验 Space、接管 ID、来源节点、源/目标 `epoch`、Manifest、逐表根、媒体根、Operation HMAC、连续序列、链头和实体版本；
- 原始媒体通过 Peer 分块传输，逐块和整文件摘要都通过后才允许进入正式媒体目录。

第二阶段应用并统一集群：

- 目标 Hub 原子替换业务记录、Provider 凭据、Operation 和 Entity Version；
- 应用由 Space Key HMAC 签名的 `apply_divergence_recovery` 控制，把双方切到目标 `epoch`；
- 手机 Hub 返回包含恢复 ID、节点、权威节点、`epoch` 和快照摘要的 HMAC 确认；
- 电脑 Hub 验证确认后，归档被舍弃分支 Operation，标记强制接管记录已协调，并将集群恢复为 `stable`；
- 恢复证据继续可导出，证据包包含接管证明、完整性摘要、恢复状态和归档 Operation。

### 16.5 当前产品边界

当前恢复是完整分支级选择，不提供通用字段级 Last-Write-Wins。若用户需要同时保留两边部分内容，应先导出签名证据，再选择一个完整权威分支；逐实体比较、复制为新实体和领域化合并需要单独实现钱包链、消息顺序、记忆删除/修改等规则。

## 17. Agent 与后台任务

### 17.1 唯一执行权

只有 active Hub 可以：

- 创建 Agent Run；
- 请求模型和图片 Provider；
- 执行有副作用工具；
- 生成主动提醒文案；
- 自动写手记、梦境、心情和记忆；
- 发送基于 Hub 状态的通知。

Standby Hub 的调度器必须处于冻结状态，即使它拥有相同任务数据。

### 17.2 切换行为

- 运行中的 AI 回复不迁移；
- 计划切换默认等待 Agent 空闲；
- 用户可以取消当前 Run 后切换；
- 强制接管时旧 Run 视为未知状态，相关工具操作依赖 `request_id` 去重；
- 新 Hub 根据持久化任务状态恢复尚未执行的计划；
- 每个后台任务保存 `job_id`、计划版本、最后执行 epoch 和幂等键；
- 已完成任务不能因切换再次执行。

## 18. 身份、认证与密钥

### 18.1 三类身份分离

1. **用户身份**：登录和拥有 Space；
2. **客户端设备身份**：桌面/手机 UI 调用业务 API；
3. **Hub 节点身份**：复制完整数据、交换控制状态和包装密钥。

Hub 节点权限高于普通客户端，不能复用普通设备令牌。

### 18.2 跨 Hub 客户端会话

本地 `auth_sessions` 不复制。客户端获得可跨节点验证的 Space Device Credential，再向当前 Hub 兑换短期本地会话：

```text
客户端设备证书
→ 当前 Hub 验证 Space 签名和撤销状态
→ 兑换短期本地 Bearer Token
→ Hub 切换后重新兑换
```

这样切换 Hub 不要求用户退出登录，也不需要复制活跃 Session。

### 18.3 撤销

- 撤销节点后，立即拒绝它的复制身份；
- 撤销记录是 Space 控制数据，必须复制；
- 被撤销节点不能通过旧快照重新加入；
- 删除备用 Hub 前应确认当前 Hub拥有完整数据和 Space Data Key；
- 丢失节点后的密钥轮换作为独立恢复流程。

## 19. 网络与发现

### 19.1 路径优先级

1. 本机回环或进程内调用；
2. 同一局域网直连；
3. Tailscale 点对点直连；
4. Tailscale Peer Relay；
5. Tailscale DERP；
6. 无可用路径，进入离线状态。

复制层只看到“经过认证的字节流”，不根据路径改变一致性规则。

### 19.2 局域网发现

- 使用 mDNS 广播 `_aetherx-hub._tcp`；
- 广播内容只包含节点 ID、协议版本和端口，不包含用户数据或长期秘密；
- 发现后仍必须验证证书指纹和节点签名；
- 地址变化后更新 `hub_endpoints`；
- 防火墙开放必须由用户明确开启。

### 19.3 Anywhere / Tailscale

- 保存 MagicDNS 名称和 Tailnet 地址作为候选端点；
- Hub 页面显示当前是局域网、Tailscale 直连还是中继；
- 媒体同步遇到中继时降低后台并发，当前查看图片仍保持高优先级；
- Tailscale 只提供网络可达性，AetherX Peer Authentication 始终启用。

## 20. Android Mobile Hub 实现

### 20.1 不直接复制当前 Node 后端

当前后端依赖 Node.js、`node:sqlite`、文件流和 HTTP Server。Android APK 不能把 Electron 的 Node 运行环境直接复用为稳定产品能力。

建议逐步抽离：

```text
packages/hub-core
├─ domain/                 业务实体和规则
├─ application/            用例、Unit of Work、Agent 编排
├─ replication/            Operation、快照、摘要、切换状态机
└─ ports/                  Store、Blob、Secret、Network、Scheduler 接口

backend/src/hosts/node
├─ node-sqlite-adapter
├─ node-blob-adapter
├─ node-secret-adapter
└─ http-host

frontend/mobile/android/.../hub
├─ android-sqlite-adapter
├─ android-blob-adapter
├─ keystore-adapter
├─ native-sync-worker
└─ capacitor-hub-plugin
```

不要求第一步就重写全部后端。优先抽离复制协议、规范化摘要和少量关键业务接口，再逐模块迁移。

### 20.2 手机本机调用

移动 UI 不应绕公网访问自己的 Hub。新增统一 `HubClient`：

```text
RemoteHubClient  → HTTP/SSE → 电脑 Hub
LocalHubClient   → Capacitor Bridge → 手机 Hub Core
```

Store 和 View 只依赖 `HubClient` 接口。当前 Hub 切换时重建客户端实例、同步游标和缓存作用域。

### 20.3 后台语义

产品目标定义为：

- 用户任何时候打开 App，手机 Hub 都能在不依赖电脑的情况下启动并提供完整功能；
- App 前台或系统允许时保持实时 Peer Session；
- 后台受限时通过 WorkManager 周期补同步；
- 重要待办使用原生计划通知，不依赖 WebView 永久存活；
- 系统彻底停止 App 后，不承诺手机继续对其他设备提供入站 Hub 服务；
- 如果未来提供“保持手机 Hub 在线”，必须使用合规的前台服务、持续通知和明确电量说明，不能隐藏常驻行为。

### 20.4 手机作为当前 Hub、电脑客户端同时使用

MVP 可以采用两种路径：

1. 手机 App 活跃时，由 Android Native Gateway 提供受认证的本地/Tailscale入口；
2. 手机主动建立到电脑备用 Hub 的双向 Peer Session，桌面客户端通过本机 Hub Router 转发到当前手机 Hub。

第二种路径避免要求手机在复杂 NAT 下被动接受连接。转发只用于在线业务请求，不成为数据权威；所有写入仍由手机 Hub 产生 Operation。

## 21. 客户端 Hub Router

桌面端和手机端不再只保存一个裸 `serverUrl`，而是保存：

```text
space_id
known_nodes[]
last_active_node_id
last_epoch
preferred_endpoints[]
client_device_credential
```

连接流程：

1. 优先连接上次已知当前 Hub；
2. 请求 `/api/v1/cluster/status`；
3. 验证返回的控制签名和 epoch；
4. 如果命中 standby，根据签名路由切到 active；
5. 向 active 兑换本地 Session；
6. 按 `space_id + node_id + user` 隔离缓存和同步游标；
7. 收到更高 epoch 时停止向旧 Hub 写入；
8. 两个 Hub 都不可达时，只有本机 Mobile Hub 可以进入用户确认后的接管流程。

服务端建议使用稳定错误码：

```text
409 HUB_NOT_ACTIVE
409 HUB_EPOCH_STALE
409 HUB_DIVERGENCE_DETECTED
423 HUB_SWITCH_IN_PROGRESS
423 HUB_RESTORE_IN_PROGRESS
426 HUB_PROTOCOL_UNSUPPORTED
503 HUB_REPLICA_NOT_READY
```

## 22. 管理界面

设置页新增“Hub 与副本”入口。

### 22.1 总览

显示：

- 当前 Hub；
- 电脑 Hub 和手机 Hub 在线状态；
- 当前 epoch；
- 结构化操作延迟；
- 待同步媒体数量与大小；
- 最近完整性校验结果；
- 当前路径：本机、局域网、Tailscale 直连或中继；
- Agent 是否空闲；
- 副本是否具备接管条件。

### 22.2 切换交互

按钮文案使用“切换到手机 Hub”“切换到电脑 Hub”。点击后展示真实阶段：

```text
正在暂停新写入
正在等待当前回复结束
正在同步 18 条变更
正在补齐 3 张图片
正在校验完整性
正在切换客户端连接
切换完成
```

不要只显示无法判断进度的旋转加载。

### 22.3 异常交互

- 摘要不一致：展示差异表和重新同步入口；
- 原 Hub 离线：提供“等待恢复”和“强制接管”；
- 分叉：进入恢复中心，不在普通弹窗里用一句话处理；
- 手机后台受限：明确说明实时同步可能暂停；
- 目标 Hub 版本过旧：先升级，禁止切换。

## 23. 可观测性

### 23.1 结构化日志

每条复制日志至少包含：

- `space_id` 的脱敏标识；
- 本地和对端节点 ID；
- `transition_id`；
- epoch；
- 操作批次范围；
- 耗时、字节数和重试次数；
- 网络路径；
- 稳定错误码。

禁止记录 Provider Key、配对秘密、完整消息正文和 Space Data Key。

### 23.2 指标

- `replication_operation_lag`
- `replication_blob_pending_count`
- `replication_blob_pending_bytes`
- `replication_last_ack_age`
- `replication_integrity_state`
- `replication_last_full_check_age`
- `hub_epoch`
- `hub_role`
- `hub_switch_duration`
- `hub_divergent_operation_count`

### 23.3 健康状态

```text
healthy       当前 Hub 可用，副本追平且摘要一致
syncing       业务可用，副本正在追平
degraded      当前 Hub 可用，但副本不可达或媒体积压
switching     正在执行计划切换
forced_active 已强制接管，等待旧节点核对
conflicted    发现分叉，需恢复
blocked       数据库、密钥或协议校验失败
```

## 24. 日志保留与压缩

Operation 不能无限增长，也不能在对端尚未确认时清理。

清理条件：

1. 所有未撤销节点都确认越过该 Operation；
2. 存在更新的已验证 Snapshot；
3. 删除墓碑超过安全保留窗口；
4. 没有正在进行的分叉恢复引用该 Operation。

清理前保存：

- Snapshot 边界；
- 每个来源节点最终 Operation Hash；
- 逻辑数据根摘要；
- Blob Manifest Root。

长期离线节点回来后，如果请求的序列已经压缩，必须走 Snapshot Bootstrap，不能把当前状态伪装成连续增量。

## 25. Schema 与版本兼容

### 25.1 版本字段

- `app_version`
- `protocol_version`
- `schema_version`
- `snapshot_format_version`
- `operation_format_version`

### 25.2 升级规则

- 新节点加入前先声明能力；
- 接收端必须能理解所有即将应用的 Operation；
- Schema 迁移先在 standby 执行并验证；
- 目标 Hub 版本低于最低兼容版本时禁止切换；
- 不允许在两个节点分别升级并同时继续写；
- 推荐流程：升级 standby → 追平 → 校验 → 切换 → 升级旧 active；
- 迁移失败时 standby 回滚，不影响 active。

## 26. 代码组织与改造触点

建议新增：

```text
backend/src/modules/hub-cluster/
├─ cluster-service.js
├─ cluster-repository.js
├─ cluster-routes.js
├─ hub-pairing-service.js
└─ hub-pairing-routes.js

backend/src/modules/replication/
├─ replication-service.js
├─ replication-repository.js
├─ replication-routes.js
├─ operation-codec.js
├─ integrity-service.js
├─ snapshot-service.js
└─ blob-replicator.js

frontend/mobile/src/lib/hub-client/
├─ contract.ts
├─ remote-hub-client.ts
├─ local-hub-client.ts
└─ hub-router.ts
```

需要重点修改：

- `backend/src/app.js`：初始化 Cluster、Replication、Integrity 和写入守卫；
- `backend/src/lib/router.js`：支持当前 Hub 检查、切换写锁和稳定错误码；
- `backend/src/infrastructure/database.js`：新增复制表和迁移；
- 各业务 Service：迁移到 Replication-aware Unit of Work；
- `backend/src/modules/archive`：抽出可复用的规范化、快照和摘要能力；
- `backend/src/modules/media`：切换到内容寻址和 Blob Manifest；
- `backend/src/modules/agent`：加入 Hub role、epoch 和幂等守卫；
- `frontend/mobile/src/lib/storage.ts`：保存 Space、节点和路由信息；
- `frontend/mobile/src/lib/sync.ts`：客户端通知同步与 Peer Replication 明确分层；
- `frontend/mobile/src/stores/session.ts`：支持跨 Hub 会话兑换；
- Android Native：本地 Store、Keystore、后台补同步和 Capacitor Hub 插件；
- Electron 主进程：Hub Router、节点状态、计划切换和本地转发。

## 27. 分阶段实施计划

### 阶段 0：冻结协议与测试夹具

任务：

- 将本文评审为实现基线；
- 新增正式 ADR，记录双节点单活动决策；
- 定义 Operation JSON Schema 和错误码；
- 建立固定摘要测试向量；
- 建立跨平台规范化测试夹具；
- 明确所有业务表的复制范围。

验收：

- Node 和浏览器/Android 侧对同一夹具计算相同摘要；
- 金额、Unicode、空值、数组和键排序结果固定；
- 协议兼容失败有稳定错误码。

### 阶段 1：桌面 Hub 内部复制底座

任务：

- 新增 Space、Node、Cluster、Operation 和 Watermark 表；
- 实现 Replication-aware Unit of Work；
- 为所有写接口增加 `request_id`；
- 让少量模块先写 Operation；
- 实现重复应用、序列缺口和哈希链校验；
- 构建两个临时桌面 Hub 的测试环境。

优先模块：

1. 用户资料和设置；
2. 待办；
3. 对话和消息；
4. 钱包；
5. 记忆与其他扩展模块。

验收：

- 同一请求重试不会生成重复记录；
- 断线后按 Watermark 补齐；
- 删除后备用节点不会复活实体；
- 钱包余额链在两端一致；
- 所有业务写入均产生 Operation。

### 阶段 2：完整快照和完整性服务

任务：

- 从 ArchiveService 抽出 Snapshot Builder；
- 实现 staging 恢复；
- 实现表级 Merkle Root；
- 实现 `quick_check`、外键和领域不变量检查；
- 实现 Bootstrap 后增量追平；
- 实现日志缺口回退快照。

验收：

- 在线生成快照不丢失快照期间写入；
- 人为破坏一条记录能定位到表和实体；
- 恢复失败不修改正式数据库；
- 两端最终 Space Root 一致。

### 阶段 3：内容寻址媒体

任务：

- 原图和缩略图迁移为 Blob；
- 分块清单和 Range 下载；
- 断点续传和优先级队列；
- 媒体根摘要；
- 孤立 Blob 清理。

验收：

- 大图片中断后续传而不是重头开始；
- 当前查看图片优先；
- 相同图片不重复传输；
- 错误块不会进入正式媒体目录；
- 切换时能准确显示缺失媒体。

### 阶段 4：电脑到电脑的双 Hub 验证

在实现 Android Hub 前，先用两个 Node Host 验证分布式协议。

任务：

- 节点配对；
- Peer Authentication；
- 局域网发现；
- 增量复制；
- 计划切换；
- 强制接管和分叉隔离；
- 版本兼容。

验收：

- 连续切换多次没有重复 Agent 任务；
- 任意阶段断网后恢复到明确状态；
- 两边同时被人为写入时能检测分叉；
- 不发生静默覆盖。

### 阶段 5：抽离 Hub Core 和 Android Store

任务：

- 定义 Store、BlobStore、SecretStore、Scheduler 和 Transport Port；
- 抽离共享业务规范和复制协议；
- 实现 Android SQLite Adapter；
- 实现 Keystore Adapter；
- 实现 LocalHubClient；
- 实现手机本地数据库迁移和恢复。

验收：

- 飞行模式、电脑关闭时，打开手机仍能查看并修改完整数据；
- 本机聊天、钱包、待办和记忆均走手机 Hub；
- 手机重启 App 后数据完整；
- Provider 密钥能在手机安全解密且不进入日志。

### 阶段 6：Android Peer Replication

任务：

- 手机与电脑 Hub 配对；
- 首次完整复制；
- 局域网和 Tailscale 路径；
- 前台实时会话；
- WorkManager 后台补同步；
- Blob 优先级和网络策略；
- 手机健康状态上报。

验收：

- 手机写入后电脑上线能自动补齐；
- 电脑写入后手机打开能先显示缓存，再增量更新；
- 网络切换、锁屏和进程重建不破坏 Watermark；
- 原图可以断点续传并校验。

### 阶段 7：产品化切换和恢复中心

任务：

- Hub Router；
- Hub 管理界面；
- 计划切换进度；
- 强制接管；
- 分叉比较和人工恢复；
- 节点撤销与密钥轮换；
- 导出诊断包。

验收：

- 普通用户无需理解端口和游标即可完成切换；
- 所有失败有可恢复路径；
- UI 展示真实进度和错误；
- 旧节点恢复后不会偷偷覆盖当前数据。

## 28. 测试矩阵

### 28.1 单元测试

- 规范化序列化；
- Operation Hash 和认证标签；
- Watermark 连续推进；
- 重复 Operation；
- 序列缺口；
- epoch 拒绝；
- 实体版本冲突；
- 墓碑；
- Blob 分块和整体哈希；
- Space Key 包装和轮换；
- 切换状态机每个非法跃迁。

### 28.2 集成测试

- 两个临时数据库全量 Bootstrap；
- Bootstrap 期间持续写入；
- 双向多轮复制；
- 对话、记忆、钱包和媒体组合数据；
- 计划切换前后继续聊天；
- Agent 运行中尝试切换；
- 存档恢复与 Peer Replication 互斥；
- Schema 升级；
- 日志压缩后旧节点重新加入。

### 28.3 故障注入

- 请求发送后响应前断网；
- 事务提交后通知前进程退出；
- Blob 传输中断；
- 操作批次被截断；
- 操作 Payload 被篡改；
- 手机磁盘空间不足；
- 数据库损坏；
- Provider Key 无法解密；
- 两个节点时钟相差较大；
- 强制接管后旧节点产生孤立写入；
- 切换控制记录只到达一侧。

### 28.4 Android 真机

- Wi-Fi 与蜂窝网络切换；
- Tailscale 直连和中继；
- 锁屏、后台、强制停止和系统回收；
- 省电模式；
- App 升级和数据库迁移；
- 手机存储不足；
- 大相册首次同步；
- 电脑突然关机后手机强制接管；
- 手机当前 Hub 时桌面端访问。

## 29. 性能边界

首版建议默认值，后续以压测调整：

- Operation 批次最多 200 条；
- 单批规范化 Payload 不超过 2 MiB；
- Blob 块默认 1 MiB；
- 局域网媒体并发 4；
- 中继路径后台媒体并发 1；
- 当前查看媒体拥有独立前台槽位；
- 小 Operation 在前台实时复制；
- 完整逻辑摘要按空闲、切换前和周期任务执行；
- 连接失败使用带抖动的指数退避；
- 电量不足或按流量计费网络暂停低优先级历史原图。

这些数值必须集中配置并暴露测试覆盖，不能散落在多个客户端里。

## 30. 迁移与回滚

### 30.1 启用前

- 自动创建完整存档；
- 验证存档可读取；
- 记录旧 Schema 和主密钥状态；
- 双 Hub 功能使用 Feature Flag；
- 未完成 Bootstrap 时保持原单 Hub 工作方式。

### 30.2 启用过程

1. 升级电脑 Hub Schema；
2. 创建 Space 和电脑 Node；
3. 初始化 epoch 1，电脑为 active；
4. 将现有 Provider 密钥迁移到 Space Key；
5. 创建初始 Snapshot；
6. 配对手机 Hub；
7. 手机验证并成为 standby；
8. 用户明确开启双 Hub 模式。

### 30.3 回滚

- 手机 Bootstrap 未完成：删除 staging，不影响电脑；
- 复制协议失败：关闭 Peer Replication，电脑继续作为 active；
- Space Key 迁移失败：恢复旧密文和旧主密钥路径；
- 计划切换失败：执行 abort，原 active 恢复写入；
- 已成功切到手机后不能直接回滚程序版本，必须先安全切回兼容节点或导出完整存档；
- 发现分叉时禁止自动降级数据库或覆盖数据。

## 31. 明确禁止的实现

- 使用网盘、Syncthing 或文件复制同步活跃 SQLite；
- 两边都写，再按 `updated_at` 取较新值；
- 删除后不保留墓碑；
- 将 `sync_changes` 原样当作 Hub 复制日志；
- 把登录 Token、Space Key 或节点私钥放入二维码；
- 因为使用 Tailscale 就跳过应用层身份验证；
- 校验失败后仍把 staging 数据投入正式使用；
- 手机后台被系统停止后对用户宣称 Hub 仍永久在线；
- standby 运行主动任务或重复调用 AI Provider；
- 强制接管后自动丢弃旧节点未同步分支；
- 用一个总进度百分比掩盖结构化数据和媒体的不同状态。

## 32. 完成定义

双 Hub 功能只有同时满足以下条件才算完成：

- 手机在电脑关闭时可以独立完成核心业务读写和聊天；
- 两端拥有完整结构化数据和媒体；
- 所有业务写入都有 Operation 和幂等请求；
- 计划切换只有在零 Operation 延迟、零必要 Blob 缺失、摘要一致时成功；
- standby 不产生 Agent 或后台副作用；
- 强制接管有明确风险、证据保存和分叉恢复入口；
- Android 后台限制在产品文案和行为上保持一致；
- 网络中断、进程退出和重复请求不会造成静默数据丢失；
- 完整存档仍然可以导出并在独立环境恢复；
- 双 Hub 关闭后仍能回到受支持的单 Hub 模式；
- 后端、桌面端、移动端和 Android 真机测试全部通过；
- 文档、API 契约、数据库迁移和故障排查指南同步更新。

## 33. 后续决策检查表

实现过程中遇到新问题时，按以下顺序判断：

1. 是否破坏单活动写入？
2. 是否能在事务内产生可复制 Operation？
3. 重试是否幂等？
4. 删除和历史修改能否在备用节点重现？
5. 网络中断后能否从明确 Watermark 恢复？
6. 是否能定位完整性差异，而不是只得到失败？
7. 是否扩大了 Provider Key 或 Space Key 的暴露面？
8. Android 被系统暂停时，产品是否仍诚实描述状态？
9. 强制接管是否保留了旧分支证据？
10. 是否有自动化测试覆盖该故障点？

如果答案不明确，先停在设计和测试阶段，不直接把不确定逻辑接入用户正式数据。

## 34. 当前实施进度

已经落地：

- ADR-0004 已建立，双节点单活动成为正式分阶段实施决策；
- Operation v1 JSON Schema 和固定 Unicode 测试向量已建立；
- 第 30 版数据库迁移已加入 Space、Node、Cluster State、Operation、Entity Version、Watermark、Applied Operation 和 Idempotency 表；
- 第 31 版数据库迁移已加入本机加密的 Space 同步密钥、Peer 凭据和请求防重放 Nonce 表；
- 第 32 版数据库迁移已加入与普通手机客户端配对完全隔离的 Hub 配对会话表；
- 第 33 版数据库迁移已加入 Snapshot 主记录和逐表完整性摘要，能够保存生成边界与验证状态；
- 第 34 版数据库迁移已加入加密 Snapshot Payload 和目标 Hub Bootstrap staging 状态；
- 第 35 版数据库迁移已加入逐原图的 Bootstrap 接收偏移、临时文件与校验状态；
- 第 36 版数据库迁移已加入配对端点的加密包持久化信息、最近失败时间和连续失败次数；
- 第 37 版数据库迁移已加入逐 Peer 的常驻复制健康、连续失败、下次尝试时间和 Operation 延迟记录；
- 第 38 版数据库迁移已加入 Bootstrap 后原图增量复制的持久化暂存、已接收偏移和校验状态；
- 第 39 版数据库迁移已为 Cluster State 加入切换目标节点和切换开始时间，用于持久化恢复计划切换阶段；
- 第 41 版数据库迁移已加入强制接管记录与分歧 Operation 隔离表；
- 第 42 版数据库迁移已加入分歧恢复会话、加密快照分块和被舍弃 Operation 归档表；
- `ClusterService` 可以为现有账号惰性建立单节点 epoch 1 状态；
- `GET /api/v1/cluster/status` 已提供当前 Space、节点、角色和协议状态；
- Operation Codec 已实现确定性规范化、SHA-256、连续哈希和 HMAC 认证标签；
- Replication-aware Unit of Work 已实现业务事务、Operation、实体版本和幂等结果的原子提交；
- 待办 HTTP API 的新增、修改、单条删除和清理已接入 Operation Log；
- 用户资料 HTTP API 的完整保存和局部修改已接入固定逻辑实体 `profile`、实体版本和幂等结果；
- 用户偏好 HTTP API 的新增、更新和删除已接入 Operation Log，删除会产生可复制墓碑；
- 待办、用户资料和偏好已使用共用复制写入门面，Agent 工具、记忆提炼和后台任务直接调用 Service 时也会原子产生 Operation；
- 钱包账户和每一笔流水已接入同一复制写入门面；HTTP 与 Agent 写入都使用整数分，并在同一事务中提交业务数据、实体版本、幂等结果和 Operation；
- 新建存款会分别产生账户和期初流水 Operation；收入、支出、资料修改与历史流水更正只发送真实变化的账户/流水，更正历史时会把所有受影响的后续余额链逐项复制；
- 删除存款会先为其每笔流水产生删除墓碑，再产生账户墓碑；重试相同请求 ID 不会重复入账、重复更正或产生第二组 Operation；
- 会话元数据、展示消息流和模型上下文流已作为独立实体接入复制写入门面；Agent 创建会话和持久化回复时也会自动产生 Operation，不依赖客户端另行补写；
- 每条消息会保留原 ID、所属会话、流类型、位置、角色、正文、结构化 Payload 和创建时间；工具调用上下文不会因切换 Hub 只剩展示文本；
- 删除会话会先为两条消息流中的每条消息生成墓碑，再生成会话墓碑；相同请求 ID 重试不会创建第二个会话、重复保存消息或重复删除；
- 长期记忆、记忆证据和记忆自动确认配置已接入复制写入门面；更新、确认和删除接口支持请求 ID 幂等，删除记忆会先产生证据墓碑，再产生记忆墓碑；
- AI 人格画像、人格成长事件和共同记忆已接入复制写入门面；人格事件确认或直接生效时，事件和由它演化出的画像会在同一业务事务中登记为独立 Operation；
- 人格画像中的 traits/values 使用确定性 JSON 序列化，避免两个 Hub 内容相同却因对象键顺序不同导致 Snapshot 完整性误判；
- 双数据库测试已覆盖长期记忆、证据、记忆配置、人格画像、人格事件与共同记忆的完整重放，并拒绝缺少父记忆的孤立证据；HTTP 测试已覆盖这些写入的请求 ID 重试不重复产生 Operation；
- AI 手记已接入复制写入门面；桌面 API 和 Agent 后台写入使用同一入口，保存会产生完整手记 Operation，删除会产生墓碑；
- 心情事件、生命状态和首页展示已拆成三个独立复制实体；模型推理先在事务外完成，随后事件及其派生状态在一个本地写事务中提交并登记 Operation，重试相同请求 ID 不会再次调用模型或重复写入；
- 心情状态、事件原始 Payload 和展示依据使用确定性 JSON 序列化；双数据库测试已覆盖手记、心情事件、生命状态和展示内容的逐表完全一致重放；
- 纪念册时刻、梦境及各自来源关系已接入复制写入门面；创建父实体时会在同一事务登记父项和全部来源，删除时先产生来源墓碑，再产生父项墓碑；
- 同一纪念册或梦境来源被替换时，会显式复制旧来源墓碑和新来源实体，不依赖 SQLite `REPLACE` 的隐式删除；接收端会校验父实体归属和逻辑唯一键；
- 双数据库测试已覆盖纪念册与梦境父子实体的创建、来源替换和逐表完全一致重放；HTTP 测试已覆盖请求 ID 重试及删除墓碑顺序；
- 提示词当前设置和每次新增的历史版本已作为两个独立实体接入复制写入门面；保存和恢复在同一事务中写入两条 Operation，并使用真实版本记录 ID 保持历史身份一致；
- 模块开关及依赖级联停用已接入复制写入门面；一次操作影响多个模块时会为每个真实变化的 `module_settings` 行生成独立 Operation；全局写工具授权的保留逻辑 ID 也通过同一实体复制，但不会暴露在普通模块清单中；
- 普通 Provider 与图像 Provider 配置已接入固定逻辑实体 `config`；API Key 只以 Space Key AES-256-GCM 复制信封进入 Operation，目标 Hub 解封后使用自己的本机主密钥重新加密，复制日志不含明文或源 Hub 本机密文；
- 双数据库测试已验证使用不同本机主密钥的两个 Hub 可以还原同一 Provider Key、两边落库密文不同，并拒绝被篡改的凭证信封；HTTP 测试已覆盖提示词、模块、工具授权和 Provider 写入的请求 ID 幂等；
- `POST /api/v1/cluster/switch/preflight` 已提供只读计划切换门禁；活动 Hub 会通过 Peer HMAC 请求目标备用 Hub 生成实时证明，再比较协议、Schema、Space、epoch、活动节点、Operation 头、结构化数据根和原图根；
- 预检双方都会在用户级锁内确认 Agent 空闲、SQLite `quick_check` 通过、Provider 凭证可解密、没有待传媒体和未完成 Bootstrap；证明只包含摘要和状态，不包含业务正文或凭证明文，并使用 Space Key HMAC 签名且仅接受 30 秒内的新鲜证明；
- 双 Hub HTTP 测试已覆盖完全一致时 `ready: true`，以及直接篡改备用 Hub 结构化数据后门禁准确返回 `ready: false`；预检不会修改 epoch、活动节点或 Cluster State；
- 计划切换状态机已实现 `prepare → draining → final_sync → integrity_check → committing_switch → commit/abort`；非 stable 阶段普通业务写入统一返回 `423 HUB_SWITCH_IN_PROGRESS`，最终同步所需的 Peer 握手、Operation 应用、Watermark 确认和原图读取仍可继续；
- 切换控制与 ACK 使用 Space Key HMAC，校验协议版本、新鲜时间戳、来源角色、epoch、阶段顺序、控制消息哈希和应用后状态哈希；目标先提交、源端后提交，目标 ACK 丢失时允许源端在 `committing_switch` 使用同一事务继续重试；
- 双 Hub HTTP 测试已覆盖切换期间双端写锁、可中止恢复、epoch 1 到 epoch 2 的正式提交、新旧 Hub 角色互换、新活动 Hub 写入生成 epoch 2 Operation，以及原 Hub 反向拉取新活动 Hub 数据；控制 Codec 测试已覆盖篡改、过期、未知版本和错误状态哈希；
- 内部 Peer Replication Service 已实现 `hello` 兼容性协商、按来源节点连续拉取、哈希校验确认位置，以及双向同步完成链头证明；
- 双数据库测试已覆盖桌面测试 Hub 与手机测试 Hub 的握手、Operation 拉取、Watermark 确认、错误完成证明拒绝和复制健康收尾；
- Space 同步密钥会由本机主密钥加密保存，所有新 Operation 都带 HMAC 认证标签，已有未签名试验 Operation 会在首次建钥时补签；
- Peer 请求认证已覆盖方法、路径、正文摘要、时间戳和随机数，并拒绝篡改、过期、撤销节点和 Nonce 重放；
- 接收端已能在单个事务内验证并应用待办、用户资料、偏好、钱包、会话双流、长期记忆、AI 人格、手记、心情、纪念册、梦境、提示词、模块设置和 Provider 配置相关实体，严格检查来源节点、epoch、连续序列、哈希链、实体版本、父子引用、实体归属和凭证信封；
- 双数据库测试已覆盖上述实体落库、重复批次幂等跳过、批次回滚、内容篡改、孤立证据和乱序缺口；
- Hub 专用配对 API 已实现创建、认领、账号确认和一次性兑换状态机；
- 新 Hub 使用 P-256 长期身份签名证明私钥持有，临时密钥使用 X25519 协商；
- Peer 凭据和 Space 同步密钥只会出现在 HKDF-SHA256 派生密钥加密的 AES-256-GCM 密钥包中，不进入二维码或明文响应；
- 配对会话会拒绝错误秘密、跨账号确认、未批准兑换、协议或 Schema 不兼容、伪造身份、过期和重复兑换；
- 兑换成功后服务端会清除会话临时私钥，并将新节点登记为 `pairing`，不会提前标记为可切换的 `standby`；
- 目标 Hub 已能解密并原子导入相同的 Space、完整节点清单、Cluster State、Space 同步密钥和双向 Peer 凭据；
- 导入只允许替换没有业务数据和 Operation 的临时 Space，发现本机身份、集群状态或数据冲突时会整体回滚；
- `hello`、Operation 拉取、批量应用和 Watermark 确认已通过独立 Peer HMAC 路由开放，普通 Bearer Token 不能调用；
- 双 Hub HTTP 端到端测试已覆盖配对、密钥包导入、协议握手、签名拉取、目标落库和源端确认；
- 活动 Hub 已能通过独立 Peer API 在稳定边界生成 Bootstrap Manifest，记录同步游标和各来源 Operation 头；
- Bootstrap Manifest 会为每张业务表、账号、Provider 凭据和媒体清单分别生成稳定 Merkle Root，单表内容变化可以被准确定位；
- 快照生成会复用完整存档的媒体哈希校验，并对生成前后的同步游标与 Operation 边界做乐观复核，持续变化时不会输出伪一致快照；
- 结构化记录、账号连续性信息、Provider 凭据、Operation 哈希链和实体版本会整体封装，并使用 Space Key 通过 AES-256-GCM 加密；
- 目标 Hub 会重新验证存档连续摘要、Manifest、逐表根、Operation HMAC、连续序列、边界哈希和实体版本，再将密文原子写入 staging；
- 密文篡改、错误来源节点、错误 Space、错误 epoch、越界 Operation 和同 ID 不同载荷都会被拒绝，失败不会修改正式业务表；
- 当前结构化明文单包上限为 10 MiB、加密包上限为 15 MiB，超过后明确要求进入后续的分块 Bootstrap，不会静默截断；
- staging 已能在单个事务中恢复全部结构化业务表、原始媒体、Operation、Applied Operation 和实体版本，任一阶段失败会整体回滚；
- 原图使用快照内的内容哈希识别，Peer API 以最大 1 MiB 的固定上限分块传输；目标 Hub 只接受连续偏移，并支持已确认块的字节级幂等重试；
- 每个分块先校验 SHA-256，全部接收后再流式校验整文件 SHA-256；错误、缺失或被篡改的临时文件不会进入正式媒体目录；
- 带媒体快照恢复会先从已验证的 Blob staging 制作一次性恢复副本，再与结构化记录原子启用；旧缩略图不跨 Hub 搬运，由目标 Hub 按原图重新生成；
- 配对双方的 LAN/Anywhere 根地址会被规范化并写入加密配对包；Anywhere 只接受 HTTPS，地址不得携带账号密码、查询参数、片段或伪造 API 子路径；
- Peer Transport 会按优先级和最近成功记录选择地址，连接失败时记录失败次数并自动回退下一端点，签名不会跟随 HTTP 重定向泄露；
- 目标 Hub 已能通过一次 `bootstrap/run` 自动完成握手、Snapshot、Blob 续传、原子恢复、增量追平、Watermark 确认和双端 standby 收口；
- 完成 Bootstrap 的备用 Hub 会启动常驻拉取循环，只接受活动节点产生的连续 Operation；每批落库后立即确认 Watermark；
- 常驻循环成功时恢复短轮询，失败时使用带抖动的指数退避并持久化 `degraded` 状态，手动同步可以跳过等待立即重试；
- `replication/status` 会返回最近尝试、最近成功、错误码、连续失败、本地/远端序列和待同步 Operation 数，Hub 停止时会等待当前循环安全退出；
- 活动 Hub 已通过 Peer HMAC API 分页提供稳定排序的原始媒体清单，并按最大 1 MiB 分块提供原图；清单只含媒体 ID、MIME、文件名、字节数、创建时间和 SHA-256，不传输缩略图；
- 备用 Hub 的常驻循环会在 Operation 追平后扫描媒体清单：已有同 ID 且元数据一致的原图直接跳过，缺失原图进入独立持久化 staging，并从磁盘实际长度继续断点传输；
- 每个增量媒体块都会校验偏移、分块 SHA-256、整文件 SHA-256 和总字节数；验证完成后才将原图和精确的 `media_assets` 记录原子提升到正式目录，异常文件不会覆盖现有内容；
- `replication/status` 已独立返回媒体暂存数量、剩余字节和已接收字节；媒体同步失败会使本轮复制进入 `degraded`，但不会回滚已经安全落库的 Operation；
- 增量同步当前只复制原图，缩略图仍由目标 Hub 按需生成；尚未复制“删除媒体”语义，避免在引用该媒体的其余业务实体完成 Operation 化之前误删有效文件；
- 快照恢复后会从 Manifest 的 Operation 边界继续增量拉取，不会从零重复应用已经包含在快照中的变更；
- 最终确认采用 `pairing → standby_pending → standby` 两阶段节点状态，源 Hub 不会在目标本机确认回执前把它视为可切换副本；
- 两端会再次计算 records root、blobs root 和各来源连续 Operation 头，完全一致后 Snapshot 才标记为 `completed`，Cluster Status 的 replication ready 才变为 true；
- 旧数据认领改为检查 SQLite 实际列定义，避免 `local_user_id` 被误判为 `user_id`；
- OpenAPI 已登记 Cluster Status、Hub 导入、Peer API，以及待办、用户资料、偏好、钱包、会话、长期记忆、AI 人格、手记、心情、纪念册、梦境、提示词、模块、工具授权和 Provider 写入的幂等请求头。

尚未启用：

- 媒体前台优先级调度、删除墓碑和孤立文件清理；
- 节点身份私钥签名控制日志，以及分歧内容的逐实体比较、复制和领域化合并；
- Android Local Hub 活动且电脑完全离线时的原生完整存档导出与恢复。

当前关键业务写入已经覆盖提示词设置、模块开关、全局工具授权和 Provider 配置；只读预检与可中止的计划切换已经能够真正修改 epoch 和活动节点。未完成切换已能在启动后继续 Commit 或安全 Abort，目标不可达时保持只读并退避重试；桌面端与移动端 Hub Router 已能通过会话交接切到活动节点并用相同 request_id 重试写入。

Android Local Hub 已进入可独立运行的 Host：原生 SQLite 保存集群状态、完整结构化副本、Operation、Entity Version、Watermark、幂等结果和快照边界；原图通过最大 1 MiB 分块断点续传，逐块与整文件校验后进入应用私有 Blob Store；增量同步会分页扫描媒体 Manifest 并继续未完成传输。Space Key、Peer 凭据和 Provider Key 均由 Android Keystore 重加密保存，SQLite 对 Provider 凭据只保留摘要。Android 本地写入会在进入 SQLite 前按 Node `ReplicationEntityApplier` 的字段、枚举、长度、金额链和时间范围约束统一校验，避免无效数据到电脑端才被拒绝。

Bootstrap 已在 Android 侧计算与 Node 一致的 records root、blobs root 和各来源 Operation heads，并完成 `standby_pending → standby` 双端回执；WorkManager 能恢复被系统中断的原图传输和最终确认。LocalHubClient 已实现待办、钱包、用户/AI 资料、偏好、长期记忆、人格成长、共同记忆、会话、手记、心情、纪念册、梦境、模块状态和相册原图等读取与写入。活动状态下，本地 Agent 会按模块开关注册工具，执行只读工具，暂停普通写入等待授权，始终确认破坏性操作，并在完成后派生带原文证据的记忆和连续心情/心率状态。图像 Provider 返回的原图会进入本地 Blob Store 和 `media_assets` Operation。

Android 已能作为切换发起方，通过签名的 `mobile-switch/start` 与 `mobile-switch/advance` 控制消息参与 `preparing_switch → draining → final_sync → integrity_check → committing_switch → stable`，并在完整性证明通过后成为活动 Hub。手机生成的原图支持向备用电脑 Hub 调用 `/api/v1/peer/media/status` 和 `/api/v1/peer/media/chunks` 反向上传，覆盖断点查询、续传、偏移校验、分块篡改、整文件摘要和元数据冲突保护。

仍需明确的产品边界：强制接管和完整分支级分叉恢复已经开放，逐实体比较、复制与领域化合并尚未实现；媒体删除墓碑与孤立文件清理尚未实现；完整存档仍由 Node Archive Service 提供，Android Local Hub 活动且电脑完全离线时暂时不能直接生成或恢复兼容 `.aetherx` 存档。除这些管理与灾难恢复边界外，已迁移模块可在电脑关闭后由手机 Hub 独立运行，并在重新连通后通过 Operation 与校验媒体回同步。
