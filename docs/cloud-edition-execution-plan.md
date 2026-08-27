# AetherX Online 完整执行方案

> 状态：迭代实施中。本文件是 `codex/cloud-edition` 分支的工程基线。
>
> 适用范围：云端后端、AetherX Online 桌面端、AetherX Online Android 端，以及 AetherX Local 与 AetherX Online 之间的数据互导。

## 1. 文档目的

本文把 AetherX Online 从产品边界、技术架构、数据模型、接口、安全、客户端改造、数据互导、部署、测试到发布验收拆成可执行任务。实施过程中如果修改了本文定义的关键边界，必须同时新增或更新 ADR、OpenAPI、存档格式说明和对应测试，不能只改代码。

本文不把线上版理解为“给本地 Hub 套一层公网地址”。线上版是独立发行形态：数据和 Agent 运行在官方云端，桌面端和手机版都是云端 Hub 的客户端；本地版仍维持本地优先和双 Hub 单活动能力，两者通过可验证的 `.aetherx` 存档迁移数据。

## 2. 已确认的产品决策

### 2.0 现有实现优先

AetherX Online 必须基于当前仓库已经实现的后端、桌面端、Android 端、业务模块、Agent Hub、同步通知和完整存档继续修改，不另建一套同功能应用，不重写已经通过测试的业务逻辑。

执行时遵循以下优先级：

1. 现有实现能够直接使用时，只增加 Edition 配置和云端组合，不复制代码；
2. 现有实现依赖 SQLite、本地文件或进程内状态时，先抽象最小接口，再补 Cloud Adapter；
3. 现有接口能够兼容扩展时保留 `/api/v1` 路径、响应包装和稳定错误码；
4. 现有桌面页面和 Vue 移动页面继续作为 Online UI，只替换认证、连接和本地专属入口；
5. 现有 `.aetherx` v1-v4 读取能力必须保留，在其上新增 v5，而不是另造不兼容格式；
6. 任何重构都必须先用回归测试固定当前行为，并证明 Local Edition 没有被破坏。

不接受“先重写一套云端，以后再迁移功能”的实施方式。云端首个闭环应直接运行现有 Todo、钱包、记忆、手记、梦境、纪念册、Provider、Agent 和媒体能力。

### 2.1 两个独立发行版

| 维度 | AetherX Local | AetherX Online |
| --- | --- | --- |
| 数据权威 | 用户自己的电脑或 Android Hub | AetherX 云端 Hub |
| 业务数据库 | SQLite | 内测阶段 SQLite；正式阶段 PostgreSQL |
| 媒体文件 | 本机数据目录 | S3 兼容对象存储 |
| Agent 运行位置 | 当前活动本地 Hub | 云端 Agent Worker |
| AI Provider | 用户自带 API | 用户自带 API |
| 多端同步 | 电脑与 Android 双 Hub 复制 | 桌面端、手机版通过 REST + SSE 访问同一云端数据 |
| 离线能力 | 当前活动 Hub 可完整运行 | 客户端只读缓存；离线写入不在首版范围 |
| 迁移方式 | 导出/恢复 `.aetherx` | 导入/导出 `.aetherx` |

本地版和线上版不参与实时双向复制。用户可以迁移数据，但不能让同一个数据空间长期在两边同时写入后自动合并。

### 2.2 一套业务契约，两套运行适配

线上版继续复用现有业务实体、Agent 工具、REST 契约、SSE 变化模型和客户端页面。以下内容必须形成稳定共享边界：

- 业务实体及校验规则；
- `/api/v1` 业务接口和错误码；
- Agent 工具输入输出；
- `.aetherx` 可移植存档格式；
- 桌面端和移动端的页面组件与数据展示模型。

以下内容按发行版独立实现或通过适配器切换：

- 数据库和媒体存储；
- 账号生命周期与会话策略；
- Provider Key 加密材料；
- 后台任务调度和限额；
- 本地 Hub 启停、局域网发现、设备/Hub 配对和双 Hub 复制；
- 云端部署、对象存储、队列、审计、配额和运维。

### 2.3 云端 Hub 是唯一写入源

AetherX Online 中不启用 `peer`、Hub 切换、强制接管、分叉恢复、LAN 广播和 Android Local Hub。桌面端和手机版只连接一个固定的官方 HTTPS API 地址。SSE 负责通知，REST 负责读写；断线后继续按游标补拉变化。

这条边界避免把云端变成现有双节点协议中的第三个 Hub，也避免本地和云端同时写入造成无法自动合并的分叉。

### 2.4 BYOK 是线上版的成本与选择权边界

线上版不代付模型调用费用。用户配置 Provider、模型、API Base URL 和 API Key，云端 Agent 使用该配置发起请求。

必须明确告知用户：API Key 会加密保存，但云端为了完成模型请求，运行时必须能够解密。AetherX Online 不能宣称服务端对 API Key“零知识”。

### 2.5 Online 使用邮箱注册与登录

AetherX Online 的唯一登录标识是邮箱地址，不要求用户创建账号名：

- 注册输入为 `email + password + displayName`；
- 登录输入为 `email + password`；
- 邮箱验证完成前不能进入完整业务空间；
- 密码找回通过已验证邮箱完成；
- `displayName` 只用于界面称呼，不参与登录且不要求唯一；
- Local Edition 继续使用现有 `username + password`，不强迫本地用户提供邮箱；
- `.aetherx` 存档不导出或覆盖源账号邮箱，导入后仍归属目标账号。

服务端对邮箱保存原始展示值与规范化登录值。规范化只做 Unicode/空白校验和大小写无关比较，不擅自移除 `+tag`、点号或改写不同邮箱服务商的地址规则。

## 3. 当前实现基线

现有仓库已经具备以下可复用能力：

- `backend` 是可独立启动的 Node.js Hub，业务 API 已集中在 `/api/v1`；
- 业务表普遍使用 `user_id` 隔离，认证中间件从 Bearer Token 推导用户身份；
- 已有账号名注册、登录、登出、密码哈希、会话哈希和基础登录失败限制；Online 在此实现上增加邮箱字段、邮箱验证和刷新会话；
- 桌面端可通过 `AETHERX_SERVER_URL` 连接远程 Hub；
- 移动端已保存可配置的服务器地址，并把 Android 会话放入安全存储；
- 已有 REST 补拉与 SSE 实时变化通知；
- Provider 配置和密钥加密已存在；
- `.aetherx` 完整存档格式已升级为 v5，支持密码加密、Provider Key 可选迁移、结构化数据摘要、媒体 SHA-256 校验、临时区恢复、事务替换和恢复前自动备份，并兼容导入 v1-v4；
- 桌面端和移动端都已有存档导入入口；
- 后端已有完整业务模块和 Agent Hub，不需要在客户端重新实现线上 Agent。

当前实现不能直接作为公开云服务的部分包括：

- `node:sqlite` 同步数据库和单数据目录锁限制了多实例扩展；
- 媒体和存档临时文件依赖本地磁盘；
- SSE Broker、登录限制、下载票据和任务锁主要保存在进程内存；
- 当前下载票据接口为公开路由，尚未按云端租户重新绑定授权；
- Cloud 已实现短期 Access Token 与轮换 Refresh Token；正式公开前仍需补充账号风险事件后的全会话撤销策略；
- Cloud 自定义 Provider Base URL 已接入统一 Egress Guard；正式公开前仍需把目标域名和结果码接入审计与监控；
- CORS 默认值允许 `*`，不适合公开云服务；
- Hub 配对、Peer Replication、LAN 广播和本地数据目录逻辑与应用组合根耦合；
- 缺少云端配额、用量、审计、账号删除和完整滥用控制；邮箱验证与密码找回已经形成开发闭环；
- 存档任务和大文件传输尚未对象存储化、队列化。

## 4. 范围与非目标

### 4.1 首个公开版本必须包含

1. 云端邮箱注册、邮箱验证、邮箱登录、无感刷新、退出和密码重置；首版不提供用户可见的设备管理。
2. 云端运行全部已经开放的业务模块与 Agent Hub。
3. 用户自行配置文本和图片 Provider。
4. AetherX Online 桌面端，连接固定云地址，不启动本地 Hub。
5. AetherX Online Android 端，连接固定云地址，不启动 Android Local Hub。
6. 桌面端与手机版之间的实时变化通知和断线补拉。
7. Local → Online 和 Online → Local 的完整存档互导。
8. 媒体对象存储、配额、备份、恢复、审计和账号数据删除。
9. 对 Provider 请求、登录、上传、导入导出和 Agent 并发的限流。
10. 完整的自动测试、部署清单、监控和回滚路径。

### 4.2 首版明确不做

- 本地版和线上版实时双向同步；
- 云端加入本地双 Hub 集群；
- 多人共享一个数据空间或协作编辑；
- 离线写入及重新上线后的自动冲突合并；
- AetherX 代付或转售模型额度；
- 自动导入浏览器、系统或其他应用中的私人数据；
- 面向第三方开发者的公共 OAuth 平台；
- iOS 客户端；
- Web 端完整产品界面；
- 任意文件类型的通用网盘能力。

## 5. 目标架构

### 5.1 正式运行拓扑

```text
Online Desktop ─┐
                ├── HTTPS / SSE ── Edge / Load Balancer ── Cloud API
Online Android ─┘                                      │
                                                      ├── PostgreSQL
                                                      ├── Redis / Job Queue
                                                      ├── S3-compatible Object Storage
                                                      ├── KMS / Secret Envelope
                                                      └── Agent Workers ── User AI Provider
```

职责划分：

- Edge：TLS、请求体上限、基础 DDoS 防护、静态资源、连接超时和请求 ID；
- Cloud API：认证、业务 API、租户授权、SSE、上传签名、任务创建和状态查询；
- PostgreSQL：账号、会话、业务记录、同步游标、任务、配额和审计元数据；
- Redis：分布式限流、短期挑战、SSE 跨实例广播、任务队列和短锁；
- Object Storage：原始媒体、缩略图、临时上传和短期存档产物；
- KMS：包装每个用户的 Data Encryption Key；
- Agent Worker：执行模型请求、Agent 工具循环、主动任务和耗时导入导出；
- Observability：结构化日志、指标、追踪、告警和审计检索。

### 5.2 内测过渡拓扑

为了先验证端到端体验，允许使用单个 Cloud API 进程、现有 SQLite 和持久化磁盘，但必须满足：

- 只有一个活动应用实例；
- 数据目录使用可靠持久卷，并有自动快照；
- 关闭 Peer Replication、LAN 广播和本地控制管道；
- CORS 使用明确来源；
- 媒体优先接入对象存储适配器；
- 所有业务查询继续通过 `user_id` 隔离；
- 这一形态只能用于受控内测，不能作为多实例正式架构。

正式开放注册前，PostgreSQL、对象存储、分布式限流和跨实例事件广播必须通过发布门禁。

## 6. 代码组织与发行策略

### 6.1 分支策略

- `main` 继续代表 AetherX Local；
- `codex/cloud-edition` 用于 AetherX Online 的首轮开发；
- 可移植存档、业务缺陷修复和通用 UI 能力应保持可回合并；
- 云端专属提交避免同时混入本地版无关重构；
- 每次吸收 `main` 变更后运行 Local/Online 双矩阵测试；
- 不能让 `.aetherx` 格式在两个分支各自演化而没有兼容测试。

长期维护时，建议把发行差异收敛为显式 Edition 配置，而不是永久复制文件：

```text
backend/src/
├─ core/                       业务服务、领域校验、Agent 工具
├─ editions/
│  ├─ local/                  SQLite、本地媒体、Hub/Peer 组合
│  └─ cloud/                  PostgreSQL、对象存储、云账号/队列组合
├─ infrastructure/
│  ├─ database/
│  ├─ media/
│  ├─ events/
│  ├─ jobs/
│  └─ secrets/
└─ server.js

frontend/
├─ desktop/                   共享桌面界面
│  └─ editions/local|cloud    Hub 启停、固定云地址、功能开关
└─ mobile/                    共享 Vue 界面
   └─ editions/local|cloud    Local Hub 与纯云客户端入口
```

目录迁移必须渐进进行。第一步先引入组合根和接口，不做一次性全仓搬家。

现有文件的首轮落点如下：

| 现有实现 | Online 修改方式 |
| --- | --- |
| `backend/src/app.js` | 保留现有业务服务组装，拆出 Local/Cloud 条件组合，不重写业务模块 |
| `backend/src/modules/auth` | 复用密码哈希、事务、Session 和用户初始化，增加邮箱仓储与验证流程 |
| `backend/src/infrastructure/database.js` | 内测继续复用，正式阶段通过仓储接口逐模块迁移 PostgreSQL |
| `backend/src/modules/archive` | 保留流式加密、摘要和媒体校验，扩展 v5 与 Cloud Job Adapter |
| `backend/src/modules/sync` | 保留游标和 SSE 语义，替换跨实例 Event Broker |
| `frontend/desktop` | 保留页面、IPC 和 API Client，Cloud 构建不启动本地 Hub，并把账号名输入改为邮箱 |
| `frontend/mobile` | 保留 Vue 页面、Store、API Client 和只读缓存，Cloud 构建不初始化 Local Hub，并把账号名输入改为邮箱 |

任何新建目录必须服务于上述适配边界，不能把现有模块整份复制到 `cloud-*` 目录后分别维护。

### 6.2 Edition 能力清单

后端必须通过只读能力端点暴露当前发行形态：

```http
GET /api/v1/capabilities
```

建议返回：

```json
{
  "data": {
    "edition": "cloud",
    "archiveImport": true,
    "archiveExport": true,
    "peerReplication": false,
    "localHubPairing": false,
    "customProviderBaseUrl": true,
    "maxMediaBytes": 268435456
  }
}
```

客户端根据能力隐藏不可用入口，不能只靠 CSS 隐藏后仍调用本地专属接口。

## 7. 云端数据模型

### 7.1 租户边界

首版一个账号对应一个数据空间。现有 `users.id` 继续作为业务表的租户键，客户端不能提交或切换 `user_id`。所有仓储方法必须从认证上下文获得用户 ID。

每个业务表必须满足至少一项：

- 直接含 `user_id`，所有唯一约束和查询都包含用户边界；
- 通过不可绕过的父表外键归属用户，并在仓储查询中连接校验；
- PostgreSQL 正式阶段启用 Row Level Security 作为第二道隔离门禁。

禁止只用实体 `id` 查询、更新或删除多租户数据。

### 7.2 云端新增表

```text
users（在现有表上增量迁移）
- id
- email
- email_normalized
- email_verified_at
- username                  # 仅兼容 Local/旧数据，Online 不作为登录标识
- display_name
- password_hash
- created_at
- updated_at

cloud_email_verifications
- id
- user_id
- token_hash
- purpose                   # verify_email | change_email
- pending_email
- pending_email_normalized
- created_at
- expires_at
- consumed_at

cloud_password_resets
- id
- user_id
- token_hash
- created_at
- expires_at
- consumed_at

cloud_refresh_sessions
- id
- user_id
- token_hash
- created_at
- last_used_at
- expires_at
- revoked_at

cloud_provider_credentials
- id
- user_id
- provider_type
- base_url
- model
- encrypted_data_key
- encrypted_api_key
- key_fingerprint
- status
- created_at
- updated_at

cloud_usage_counters
- user_id
- period_key
- api_requests
- agent_runs
- provider_requests
- input_bytes
- output_bytes
- media_bytes
- archive_bytes
- updated_at

cloud_jobs
- id
- user_id
- job_type
- status
- progress
- input_object_key
- output_object_key
- result_json
- error_code
- created_at
- started_at
- finished_at
- expires_at

cloud_audit_events
- id
- user_id
- actor_session_id
- event_type
- target_type
- target_id
- request_id
- metadata_json
- created_at

cloud_account_deletions
- user_id
- status
- requested_at
- scheduled_at
- completed_at
```

审计记录不得保存聊天正文、Prompt、API Key、Authorization Header、完整 Provider 响应或存档密码。

Online 数据库约束：

- `email_normalized` 在未删除账号中唯一；
- 原始 `email` 用于展示和投递，登录查询只使用 `email_normalized`；
- Verification Token 和 Password Reset Token 只保存 SHA-256 或更强哈希；
- Token 单次使用、短期有效，消费与账号更新处于同一事务；
- 重发验证邮件会使旧 Token 失效或只保留一个有效挑战；
- 删除账号后是否允许邮箱重新注册必须采用明确策略，不能依赖残留唯一约束碰运气。

### 7.3 数据库迁移原则

- 每个迁移只能向前执行一次，并记录 schema version；
- 先扩展、再回填、再切读写、最后删除旧字段；
- 大表回填分批执行，不能在请求事务内完成；
- 迁移脚本必须支持演练和失败停止；
- 正式环境破坏性迁移前必须完成备份恢复演练；
- SQLite 与 PostgreSQL 在互导格式上使用同一规范化字段，不导出数据库私有字段。

## 8. Provider 与密钥安全

### 8.1 密钥保存

每个用户生成独立 Data Encryption Key：

1. KMS 主密钥包装用户 Data Encryption Key；
2. Data Encryption Key 使用带 AAD 的 AES-256-GCM 加密 Provider Key；
3. AAD 至少绑定 `user_id`、Provider 类型、凭证 ID 和密钥版本；
4. 数据库只保存密文、nonce、tag、被 KMS 包装的 Data Encryption Key 和不可逆指纹；
5. API 读取配置时只返回 `configured`、Provider、模型和脱敏指纹；
6. 更新 Key 时覆盖为新密文，旧密文不进入日志、任务结果或审计正文；
7. 解密仅发生在执行 Provider 请求的短生命周期内。

KMS 不可用时禁止降级为明文保存或使用仓库中的固定默认密钥。

### 8.2 自定义 Base URL 与 SSRF

云端允许用户配置 OpenAI 兼容地址，但出站请求必须经过统一 Egress Guard：

- 只允许 `https:`；
- 拒绝 URL 用户信息、非标准编码主机名和无效端口；
- 解析并检查全部 IPv4/IPv6 地址；
- 拒绝 loopback、私网、链路本地、组播、保留地址、Unix Socket 和云元数据地址；
- 连接时固定已验证的解析结果，防止 DNS 重绑定；
- 每次重定向都重新执行同样校验，并限制重定向次数；
- 限制连接、首字节、总请求时长、响应头和响应体大小；
- 禁止把用户 Authorization 转发到不同源重定向；
- 代理环境变量不能绕过校验；
- 记录目标域名和结果码，不记录 Key、正文或完整查询参数。

Provider 连通性测试必须走同一个 Egress Guard，不能另写宽松请求路径。

当前 Cloud 组合已经在配置保存和实际 Provider 请求两处复用同一 Guard：仅允许公开 HTTPS，检查 DNS 的全部 A/AAAA 结果，拒绝本机、内网、链路本地、保留、组播和云元数据地址；连接固定到已验证结果，重定向逐次复检且跨源时移除 Authorization，并限制连接/响应超时、响应头和正文大小。Local 组合继续允许用户连接自己的局域网 Provider。

### 8.3 Provider 使用约束

- 每个用户限制并发 Agent Run 和 Provider 请求数；
- 后台主动任务默认关闭，开启时明确提示会消耗用户 API 额度；
- 失败重试只针对安全的网络错误和服务端错误，并有上限与抖动；
- 不对模型请求自动切换到 AetherX 自有密钥；
- 用户删除 Provider Key 后，队列中尚未开始的相关任务必须取消；
- 使用量统计可以保存请求次数与估算 Token，但不得保存模型正文用于计费审计。

## 9. 认证、授权与账号生命周期

### 9.0 基于现有认证增量改造

Online Auth 不重写现有 `AuthService` 的密码和事务能力：

- 继续使用现有 `scrypt` 密码哈希，并为未来参数升级保留版本前缀；
- 继续复用 `users.id`、`display_name`、账号默认资料初始化和认证上下文；
- `AuthRepository.findUserByUsername` 在 Cloud 实现中替换为 `findUserByNormalizedEmail`；
- `register` 不再接收 `username`，而是创建邮箱未验证账号和验证挑战；
- `login` 使用规范化邮箱查找账号，并复用恒定路径的密码校验；
- Local Auth 路径保持现有行为，Cloud Auth 通过 Edition 组合注入，不能用大量分散的 `if (cloud)` 修改每个业务模块；
- 继续使用现有 `auth_sessions`，为 Cloud 增加 Refresh Token 哈希与过期时间；Local 会话行为保持不变。

开发环境已有账号名数据时，不自动把账号名猜成邮箱。用户必须通过一次性绑定流程提供并验证邮箱；全新的 Online 数据库直接按邮箱账号创建。

### 9.1 会话模型

公开云端采用短期 Access Token + 可撤销 Refresh Token：

- Access Token 只用于 API 和 SSE；
- Refresh Token 只在刷新端点使用，服务端仅保存哈希；
- Refresh Token 每次使用后轮换，旧 Token 立即失效；
- 桌面端使用 Electron 安全存储保存刷新凭证；
- Android 使用 Keystore 支持的 SecureSession；
- 登录状态只属于账号会话，不要求用户命名、绑定或管理设备；
- 首版不提供设备列表和逐设备撤销界面；当前退出撤销本次会话，修改密码撤销该账号全部会话；
- SSE 在 Access Token 过期后正常断开，客户端刷新并按最后游标重连。

### 9.2 账号功能

公开注册前必须实现：

- 邮箱注册、验证、登录和更换邮箱；
- 密码重置；
- 登录、注册、重置和刷新端点限流；
- 规范化邮箱唯一性；
- 数据导出；
- 账号删除确认、冷静期、任务取消和最终擦除；
- 服务条款、隐私说明和 BYOK 风险提示确认版本。

客户端不能把本地版“首位用户自动认领遗留数据”的逻辑带到云端。

### 9.3 邮箱认证流程

注册：

1. 客户端提交 `email`、`password`、可选 `displayName` 和条款版本；
2. 服务端规范化并校验邮箱长度与基本语法；
3. 无论邮箱是否已存在，对外响应都避免泄露账号状态；
4. 新账号在事务内写入用户、默认资料和验证挑战；
5. 邮件 Worker 发送一次性验证链接或验证码；
6. 验证成功后原子更新 `email_verified_at` 并消费挑战；
7. 验证完成后签发 Access/Refresh Session，进入已有业务空间。

登录：

1. 客户端提交 `email + password`；
2. 服务端使用 `email_normalized` 查询，继续走恒定成本的密码校验；
3. 未验证账号返回稳定但不泄露过多状态的验证提示；
4. 成功后创建服务端账号会话，客户端无感保存并轮换 Refresh Token；
5. 返回的用户对象含 `email`、`displayName` 和验证状态，不要求 `username`。

找回密码：

1. 请求端点始终返回同样的接受响应，避免邮箱枚举；
2. 存在且已验证的账号才创建单次 Reset Token；
3. 新密码提交时验证 Token、更新密码哈希并撤销全部旧 Refresh Session；
4. 完成后发送安全通知，但通知中不包含新密码或会话令牌。

邮箱发送必须经过 `EmailSender` 接口，业务服务不绑定具体邮件厂商。测试使用内存 Fake；开发环境使用文件捕获邮箱；正式环境可通过 `AETHERX_EMAIL_TRANSPORT=qq` 注入 QQ SMTP Adapter。QQ 模式固定使用 `smtp.qq.com:465`、SSL/TLS 和授权码，缺少凭证或 HTTPS 公共链接时拒绝启动；授权码不进入数据库、日志或客户端包。

### 9.4 授权规则

- 所有业务路由默认要求认证，公开路由使用显式白名单；
- 存档下载即使使用短期票据，也必须验证当前登录用户与票据所有者；
- 媒体下载使用认证代理或短期、用户绑定、对象绑定的签名 URL；
- Web Origin、桌面协议和 Android 请求来源分别配置；
- 管理员后台使用独立身份域和权限，不复用普通用户令牌；
- 客服和管理员默认不能读取用户正文或 Provider Key。

## 10. 数据互导规范

### 10.1 兼容目标

Local 和 Online 使用同一个 `.aetherx` 扩展名与媒体类型。线上版必须能导入现有 v1-v4 存档；新增格式使用 v5，并保留至少两个主版本的向后读取能力。

v5 继续采用流式密码加密，不把原始 SQLite/PostgreSQL 数据文件放入存档。逻辑内容包括：

```text
encrypted envelope
└─ metadata
   ├─ format / formatVersion / digestAlgorithm
   ├─ sourceEdition / sourceAppVersion / schemaVersion
   ├─ archiveMode
   ├─ secretPolicy
   ├─ account display metadata
   ├─ records grouped by logical table
   ├─ media manifest
   ├─ record counts / byte counts
   └─ continuity digest
└─ media byte streams ordered by manifest
```

### 10.2 必须导出的业务数据

- 对话、消息和消息载荷；
- 用户画像和偏好；
- 记忆、证据与记忆设置；
- AI 伙伴资料、人格事件和共同记忆；
- Prompt 设置和版本；
- 待办、提醒、手记、情绪、梦境、纪念册；
- 钱包账户和流水；
- 模块设置；
- AI Provider 非秘密配置；
- 图片 Provider 非秘密配置；
- 媒体元数据、原文件和必要缩略图；
- 未来新增且被标记为 portable 的业务实体。

### 10.3 禁止导出的运行数据

- 登录密码、邮箱验证状态和账号 ID；
- Access/Refresh Session；
- 设备令牌、配对会话和二维码秘密；
- Hub 节点身份、私钥、Space Key、Peer 凭证；
- Replication Operation、Watermark、Epoch 和分叉控制现场；
- 进程锁、SSE 游标、缓存、日志和临时任务；
- 云端套餐、支付信息、风控标记和管理员审计。

### 10.4 Provider Key 迁移

v5 增加：

```text
secretPolicy: "excluded" | "password_encrypted"
```

- 默认 `excluded`：存档不含 Provider Key；
- 用户明确选择后可用 `password_encrypted`：Key 只存在于整个存档的密码加密信封内；
- 导入界面必须再次提示 Key 将进入目标运行环境；
- 云端导入后立即用云端 KMS 重新加密；
- 本地导入后立即用本地主密钥重新加密；
- 旧版 v1-v4 中已有的凭证按 `password_encrypted` 处理，并在导入前明确提示；
- 任何导入结果和错误日志都不能回显 Key。

### 10.5 导入语义

首版不实现合并，只实现“导入到空空间”或“完整替换”：

1. 目标为空时直接进入完整导入流程；
2. 目标非空时必须明确二次确认；
3. 导入前创建可恢复备份；
4. 上传先进入隔离对象或临时目录；
5. 解密、格式、字段、数量、大小、摘要、媒体哈希和配额全部通过后才允许提交；
6. 数据替换与业务元数据更新在一个逻辑事务内完成；
7. 媒体先写临时前缀，数据库提交后再发布；
8. 失败时删除临时媒体并保留原数据；
9. 成功后发出 `archive_restore/reset` 事件，客户端清理缓存并全量重载；
10. 原账号身份、密码和登录会话按策略保留，不使用存档中的用户 ID。

未来若实现合并，必须按实体设计冲突规则并新增独立的 `merge` 模式，不能修改 `full_restore_only` 的语义。

### 10.6 云端导入导出任务

大存档不能占用普通 API 请求直到完成。云端采用异步任务：

```http
POST /api/v1/archive-jobs/exports
GET  /api/v1/archive-jobs/:id
POST /api/v1/archive-jobs/imports/uploads
POST /api/v1/archive-jobs/imports
POST /api/v1/archive-jobs/:id/cancel
```

- 导出任务在一致性边界采集数据，流式写入对象存储；
- 下载 URL 短期、单用户、单对象有效；
- 导入上传使用短期签名 URL 和严格 Content-Length；
- Worker 从对象存储流式解密与校验，不把整个存档载入内存；
- 任务状态至少含 `queued/running/succeeded/failed/cancelled/expired`；
- 任务结果只保存摘要和稳定错误码；
- 临时存档按过期策略自动删除；
- 同一用户同一时间只允许一个导入或导出任务；
- Agent 正在写入时导出等待一致性边界，导入则要求 Agent 空闲并锁定该用户写入。

## 11. 云端媒体存储

### 11.1 对象键

对象键不能使用用户提供的文件名：

```text
users/<user-id>/media/<sha256>/original
users/<user-id>/media/<sha256>/preview/<variant>
users/<user-id>/archives/tmp/<job-id>
```

数据库保存用户可见文件名、MIME、字节数、SHA-256、对象键和状态。对象键必须再次绑定用户边界，不能只凭媒体 ID 读取。

### 11.2 上传与处理

- 服务端生成上传会话和短期签名 URL；
- 上传前检查账号配额，完成后重新读取实际字节数；
- 校验 MIME 魔数，不信任扩展名和请求头；
- 计算 SHA-256，去重仅限同一用户；
- 图片解码和缩略图生成在隔离 Worker 中执行；
- 拒绝超大尺寸、解压炸弹和不支持格式；
- 删除采用数据库墓碑 + 对象清理任务，任务幂等；
- 对象存储 Lifecycle 只清理明确的临时前缀，不直接猜测业务对象是否孤立。

## 12. 桌面端执行方案

### 12.1 构建形态

新增明确的 Cloud Edition 构建配置：

- 产品名称和包标识与 Local Edition 区分；
- API 基础地址在签名构建中固定为官方 HTTPS 地址；
- 用户不能在普通设置中改为任意 Hub 地址；
- 开发构建允许通过显式环境变量覆盖测试地址；
- 自动更新通道、安装目录和本地数据目录与 Local Edition 分开；
- 两个发行版允许同时安装，不能互相覆盖会话和缓存。

### 12.2 禁用本地专属能力

Cloud Desktop 不执行：

- 内置 Hub 启动、接管或退出；
- `AETHERX_DATA_DIR` 管理；
- LAN 广播和移动 Hub 探测；
- 普通设备/Hub 一体化配对；
- Hub 切换、强制接管和分叉恢复；
- Tailscale Serve 管理；
- 本地控制管道。

对应菜单、状态组件和 IPC 必须由 Edition 能力控制，不留下可调用但必然失败的入口。

### 12.3 必须保留和新增

- 邮箱注册、邮箱验证、邮箱登录、密码找回和无感会话续期；
- 安全保存 Refresh Token；
- REST/SSE 同步和断线重连；
- 全部业务页面与 Agent 功能；
- Provider 设置与连通性测试；
- 云端存档任务进度、下载和导入；
- 云端配额与媒体使用量；
- 网络离线状态和只读缓存提示；
- 账号数据导出与删除入口。

桌面端下载存档仍使用系统保存对话框，但数据来源改为云端任务产物；写文件时继续流式处理，不能先把整个文件放进渲染进程内存。

Cloud Desktop 直接修改现有 `auth.html`、`auth.js`、`api-client.js` 和主进程认证 IPC 的 Online 构建路径：隐藏服务器地址、账号名和本地 Hub 扫描，改为邮箱输入、验证状态和重发验证邮件。其他业务页面继续使用现有实现。

## 13. Android 端执行方案

### 13.1 构建形态

- Cloud Edition 使用独立 `applicationId`、应用名、深链域名和签名配置；
- API 地址固定为官方 HTTPS 地址；
- 会话保存在 Android Keystore 支持的 SecureSession；
- 网络安全配置禁止明文 HTTP；
- 允许开发变体连接受控测试环境，但发布变体不能读取任意服务器地址；
- Local 和 Online 可以同时安装，Preferences、数据库和文件目录完全分开。

### 13.2 禁用本地专属能力

Cloud Android 不初始化：

- `LocalHub` 原生插件和网络服务器；
- Android 本地数据库副本；
- Hub LAN Discovery；
- Hub 配对、Space Key、Peer 凭证和本地 Agent Runtime；
- 计划切换、强制接管和分叉恢复；
- ADB Reverse 自动连接。

构建产物应通过依赖/源码检查证明发布包没有意外启用本地网络服务器组件。

### 13.3 在线与离线行为

- 在线时使用现有 REST/SSE 数据流；
- 断线后展示最后一次成功缓存，明确标记只读和可能过期；
- 首版不排队提交离线写操作；
- 恢复网络后按持久化游标补拉变化，再重新连接 SSE；
- 401 时先尝试刷新；刷新失败才清除会话并回到登录页；
- 媒体缓存不得在退出后被另一个账号复用；
- 存档上传和下载通过 Android 文档选择器流式传输。

Cloud Android 直接复用现有 `LoginView.vue`、`stores/session.ts`、`lib/api.ts` 和安全存储：隐藏服务器地址、账号名与配对模式，增加邮箱、验证、重发验证邮件和密码找回流程。登录后的业务路由、Store 和页面不另写一套。

## 14. API 契约改造

### 14.1 保持兼容的接口

现有 `/api/v1` 业务接口保持语义，桌面和手机共享同一 OpenAPI。任何 Cloud 特有字段使用向后兼容的可选字段或新端点，不修改 Local 已发布响应的必填含义。

### 14.2 新增接口域

```text
/api/v1/capabilities
/api/v1/auth/refresh
/api/v1/auth/email/verify
/api/v1/auth/email/resend
/api/v1/auth/password/forgot
/api/v1/auth/password/reset
/api/v1/account/export
/api/v1/account/deletion
/api/v1/usage
/api/v1/archive-jobs/*
/api/v1/media-uploads/*
```

每个接口必须在 `backend/openapi.yaml` 中定义：认证、请求体上限、幂等要求、稳定错误码、示例和权限。

Cloud Auth 请求契约：

```json
POST /api/v1/auth/register
{
  "email": "user@example.com",
  "password": "user-selected-password",
  "displayName": "用户称呼"
}

POST /api/v1/auth/login
{
  "email": "user@example.com",
  "password": "user-selected-password"
}
```

共享的 `AuthUser` 契约使用兼容字段：Local 可返回 `username`，Online 返回 `email`；客户端依据 `capabilities.edition` 和显式 `loginIdentifier` 渲染，不能把邮箱伪装塞进 `username` 字段。

### 14.3 幂等与并发

- 所有创建型业务写入支持 `Idempotency-Key` 或现有 `request_id`；
- 同一个键绑定用户、路由和请求摘要；
- 重试不能产生第二份待办、消息、流水或媒体记录；
- Agent 同一会话保持单运行约束；
- 导入锁只阻塞目标用户，不阻塞其他租户；
- 乐观并发失败返回稳定的 `409` 错误码，不静默覆盖。

## 15. 同步与事件

线上版继续沿用现有模式：

1. 客户端保存最后确认的 `sync_changes.seq`；
2. 启动或重连时先调用 `GET /api/v1/sync/changes?after=<seq>`；
3. 补拉完成后连接 SSE；
4. SSE 只传实体变化和游标，不传聊天正文或密钥；
5. 客户端按实体类型重新读取业务 API；
6. 存档恢复发送 reset 事件，客户端丢弃旧缓存并全量加载。

多实例阶段，事务提交后使用 Outbox 表发布事件：

- 业务写入、`sync_changes` 和 outbox 记录在同一数据库事务提交；
- Publisher 幂等读取未发布事件并写入 Redis Pub/Sub；
- 任一 API 实例可把对应用户事件推送给已连接客户端；
- Redis 消息丢失不影响正确性，因为客户端仍能按数据库游标补拉；
- SSE 连接数、持续时长、断线率和游标滞后进入监控。

## 16. 配额与滥用控制

首版至少定义以下限制，并由配置而非散落常量控制：

- 每账号总媒体字节数；
- 单媒体文件大小和像素数；
- 单存档和临时存档总字节数；
- 每账号并发 Agent Run；
- 每账号/会话/IP 的 API 速率；
- 登录、注册、刷新、密码重置的独立速率；
- Provider 连通性测试频率；
- 导入导出任务并发和频率；
- SSE 同账号并发连接数；
- 单会话消息数量和上下文预算。

超限返回稳定的 `429` 或 `413`，并提供可展示的剩余或恢复信息。不能因为用户自带模型 Key 就取消云端 CPU、网络、存储和任务配额。

## 17. 可观测性、备份与恢复

### 17.1 日志与指标

所有请求生成 `requestId`，日志使用结构化字段：

- edition、service、environment、requestId；
- user 使用不可逆或轮换后的内部标识；
- route、status、latency、bytes；
- jobId、jobType、providerDomain、结果类别；
- 不记录 Authorization、Cookie、API Key、存档密码、消息正文和 Prompt。

核心指标包括：

- API 成功率和延迟；
- 登录失败和限流命中；
- SSE 活跃连接、重连和游标滞后；
- Agent 队列、执行时长、取消和 Provider 错误；
- 数据库连接、慢查询、锁和迁移状态；
- 对象存储上传、校验、孤立对象和清理失败；
- 导入导出成功率、大小和阶段耗时；
- 每租户媒体与任务配额；
- KMS 解密失败和异常频率。

### 17.2 备份

- PostgreSQL 使用持续归档和定期全量快照；
- 对象存储开启版本保护或等价恢复能力；
- KMS 配置和密钥生命周期独立备份，不能只备份密文数据库；
- 备份与生产账号隔离，恢复权限最小化；
- 定期在隔离环境执行数据库 + 对象 + KMS 联合恢复演练；
- 用户级误操作优先通过导入前备份或 `.aetherx` 存档恢复；
- 灾难恢复必须验证结构化摘要与媒体哈希，而不是只确认服务启动。

### 17.3 删除

账号删除流程按顺序处理：

1. 撤销登录和 Refresh Session；
2. 停止 Agent、后台任务和导入导出；
3. 标记账号不可登录；
4. 删除业务数据、Provider 密文和对象存储；
5. 删除队列残留和临时存档；
6. 保留最小化、无正文的法定安全审计；
7. 记录删除完成证明；
8. 根据备份保留策略最终过期，不承诺已删除数据可从普通入口恢复。

## 18. CI/CD 与环境

### 18.1 环境分层

- Local development：本地依赖与测试 Provider；
- Cloud development：云端组合根、测试数据库和对象存储；
- Staging：与正式同构，使用独立域名、KMS、数据库、桶和客户端签名；
- Production：只能通过受控流水线发布。

环境之间禁止复用用户数据、Session 密钥、KMS 主密钥、对象桶和 OAuth/邮件凭证。

### 18.2 流水线门禁

每次云端发布至少通过：

1. 后端单元与集成测试；
2. SQLite 与 PostgreSQL 契约测试；
3. 租户隔离负向测试；
4. Archive v1-v5 兼容矩阵；
5. Desktop Cloud 单元、打包和冒烟测试；
6. Android Cloud 单元、构建、签名和真机冒烟；
7. OpenAPI 与实现一致性检查；
8. 数据库迁移演练；
9. 依赖与镜像漏洞扫描；
10. 秘密扫描；
11. SSRF 回归测试；
12. Staging 导入导出和跨端同步验收。

部署采用向后兼容顺序：先数据库扩展，再 Worker，再 API，最后客户端；回滚时不能运行无法读取旧数据的新迁移。

## 19. 分阶段执行清单

### 阶段 A：架构边界与回归基线

- [ ] 新增 ADR：Local 与 Online 独立发行、只通过存档互导；
- [ ] 新增 ADR：Cloud 数据库、对象存储、队列与 KMS；
- [ ] 为现有业务 API、Archive v4 和双客户端建立回归快照；
- [ ] 盘点所有业务表、`user_id` 查询和缺失租户条件；
- [ ] 盘点 Local 专属模块在后端、桌面和 Android 的入口；
- [x] 定义 Edition 能力模型和环境配置；
- [x] 固定当前 `AuthService`、`AuthRepository`、桌面认证页和移动认证页回归行为；
- [x] 定义 Online 邮箱规范化、验证、登录、重发和找回密码契约；
- [x] 确定 Online 独立包名、应用 ID 和协议；独立更新通道仍在发布阶段接入。

完成门禁：不改变 Local 行为，测试可以明确区分 Local/Cloud 组合。

### 阶段 B：Cloud 后端最小闭环

- [x] 引入 Cloud 组合根，关闭 LAN、Peer、Hub 切换和本地控制服务；
- [x] 增加 `/api/v1/capabilities`；
- [x] 在现有 `users`、密码哈希和账号初始化上增加邮箱身份字段；
- [x] 实现邮箱注册、验证、登录、重发与开发环境 EmailSender；
- [x] 保持 Local 账号名注册登录测试全部通过；
- [ ] 收紧 CORS、请求体、代理信任和安全响应头；
- [ ] 把登录限制、下载票据和用户锁从进程局部状态抽象成可替换存储；
- [x] 建立租户隔离自动测试；
- [x] 增加 Cloud Provider Egress Guard、DNS 固定、重定向复检和响应上限；
- [ ] 增加 KMS Secret Adapter；
- [ ] 增加配额和基础用量表；
- [ ] 在受控环境部署单节点内测 Hub。

完成门禁：两个不同邮箱账号不能互读；邮箱验证后，桌面和手机都能连接同一云端账号完成现有业务闭环。

### 阶段 C：可移植存档 v5

- [x] 定义并测试 v5 manifest；
- [x] 增加 `sourceEdition`、`sourceAppVersion`、`schemaVersion` 和 `secretPolicy`；
- [x] 保持 v1-v4 导入兼容；
- [x] 增加默认不含 Provider Key 的导出选项；
- [ ] 增加异步 Archive Job 和对象存储临时对象；
- [ ] 下载票据绑定用户和对象；
- [ ] 导入实现隔离、配额预检、事务替换和对象发布；
- [x] 建立 Local → Online → Local 往返摘要测试；
- [x] 建立损坏、截断、错误密码、超限和恶意路径测试。

完成门禁：往返迁移后所有 portable 记录摘要与媒体 SHA-256 一致，任一步失败不改变目标原数据。

### 阶段 D：Online Desktop

- [x] 增加独立产品标识和构建配置；
- [x] 固定云端 API 地址，分离本地存储；
- [x] 基于现有认证页把账号名注册登录改为邮箱注册登录；
- [x] 增加邮箱验证和重发验证邮件状态；
- [x] 增加密码找回状态；
- [x] 从 Cloud 构建和运行路径禁用本地 Hub、配对、切换、Tailscale 和分叉恢复；
- [x] 实现 Access/Refresh Session 和客户端 401 自动刷新；
- [x] Online 首版只使用账号登录，不提供用户可见的设备管理；
- [ ] 接入云端存档任务 UI；
- [ ] 接入配额、账号导出和删除 UI；
- [ ] 完成安装、升级、退出登录、断网和 SSE 重连测试；
- [ ] 验证与 Local Desktop 同时安装互不干扰。

完成门禁：全新设备只安装 Online Desktop 即可注册、配置 BYOK、聊天、使用全部模块并导出数据。

### 阶段 E：Online Android

- [x] 增加独立 `applicationId`、应用名、深链和签名配置；
- [x] 固定 HTTPS API，分离 Preferences 和缓存；
- [x] 基于现有 LoginView 和 Session Store 把账号名注册登录改为邮箱注册登录；
- [x] 增加邮箱验证和重发验证邮件状态；
- [x] 增加密码找回状态；
- [x] 从 Cloud 构建中禁用 Local Hub 与本地网络服务器；
- [x] 实现 Access/Refresh Session 和客户端 401 自动刷新；
- [x] Online 首版只使用账号登录，不提供用户可见的设备管理；
- [ ] 完成只读缓存与断线恢复；
- [ ] 接入云端存档任务和 Android 文档选择器；
- [ ] 接入配额、账号导出和删除 UI；
- [ ] 完成真机通知、前后台切换、弱网和升级测试；
- [ ] 验证与 Local Android 同时安装互不干扰。

完成门禁：桌面创建的数据可在 Android 通过补拉/SSE 看见，Android 修改后桌面同样更新，断网不会产生未声明的离线写入。

### 阶段 F：正式云基础设施

- [ ] 抽象数据库访问并迁移 PostgreSQL；
- [ ] 建立 schema migration 和回滚门禁；
- [ ] 媒体迁移 S3 Adapter；
- [ ] 引入 Redis 限流、队列和事件广播；
- [ ] Agent 与 Archive 迁移 Worker；
- [ ] 增加 Outbox；
- [x] 增加 QQ SMTP 正式 EmailSender、HTML/纯文本模板和临时错误重试；
- [ ] 接入正式 QQ 发件账号授权码，完成真实投递、退信观测和发送限流；
- [ ] 增加完整审计、监控、告警和账号删除 Worker；
- [ ] 完成备份恢复演练；
- [ ] 完成容量、并发和故障注入测试。

完成门禁：任一 API 实例退出不会丢业务提交或同步游标；数据库、对象存储和 KMS 可联合恢复。

### 阶段 G：受控发布

- [ ] 只允许邀请账号；
- [ ] 准备隐私、条款、BYOK 和数据删除说明；
- [ ] 建立支持和安全事件流程；
- [ ] 观察配额、Provider 错误、存档失败和 SSE 稳定性；
- [ ] 完成 Local/Online 互导真实数据演练；
- [ ] 修复阻断问题后再开放注册；
- [ ] 保留快速关闭注册、暂停后台任务和回滚客户端的开关。

## 20. 测试矩阵

### 20.1 租户隔离

- 用户 A 不能用猜测 ID 读取、更新或删除用户 B 的任何实体；
- 搜索、FTS、媒体、存档、同步、Agent Run、任务和错误详情同样隔离；
- 删除父实体不能跨用户级联；
- 导入包中的用户 ID 被规范化为当前用户；
- 管理端和普通端令牌不能互用。

### 20.2 邮箱认证

- 邮箱大小写和首尾空白按规范化规则命中同一账号；
- 不移除 `+tag` 或点号，不擅自合并两个合法邮箱；
- 未验证邮箱不能进入完整业务空间；
- 验证 Token 单次使用、过期失效，重发后的旧 Token 按策略失效；
- 注册、登录和找回密码响应不泄露邮箱是否已存在；
- 修改密码撤销全部旧 Refresh Session；
- Desktop 和 Android 使用同一邮箱账号登录后得到同一个 `user_id`；
- Local 账号名登录回归测试保持通过；
- `.aetherx` 往返不导出、不覆盖目标账号邮箱。

### 20.3 数据互导

- v1-v4 Local 存档导入 Online；
- v5 Local 导入 Online；
- v5 Online 导入 Local；
- Local → Online → Local 往返；
- Online → Local → Online 往返；
- 含/不含 Provider Key；
- 空目标与非空目标完整替换；
- 错误密码、截断、篡改摘要、篡改媒体、重复 ID、越界路径、超限、对象存储中断；
- 导入时 Agent 忙、同用户并发导入、用户取消和 Worker 重启；
- 成功后缓存 reset、全文搜索重建和媒体可读。

### 20.4 双客户端

- Desktop 写入、Android 收到；
- Android 写入、Desktop 收到；
- 两端同时打开同一会话，保持单 Agent Run；
- SSE 中断后按游标补拉；
- Access Token 过期后刷新并重连；
- 旧 Refresh Token 重放失败，刷新失败才回到登录页；
- 当前客户端退出、密码重置后旧会话失效；
- 大图片上传、取消、失败重试和配额不足；
- Local 与 Online 安装共存。

### 20.5 安全

- SSRF 覆盖 IPv4、IPv6、十进制/十六进制主机、重定向、DNS 重绑定和元数据地址；
- 日志和追踪中搜索真实测试 Key，结果必须为空；
- CORS、Origin、Host、代理头和请求体大小；
- 登录枚举、暴力尝试、Refresh Token 重放；
- 存档 Zip/路径类攻击即使格式变化也必须拒绝；
- 恶意图片、超大像素和 MIME 欺骗；
- 对象签名 URL 越权、过期和重放；
- KMS 不可用时安全失败。

## 21. 验收标准

线上版达到可公开发布状态时，必须同时满足：

1. 桌面端和 Android 使用独立 Online 包，可与 Local 共存。
2. Online 客户端不会启动或暴露任何本地 Hub/Peer 网络服务。
3. 用户使用已验证邮箱注册和登录；桌面与 Android 连接同一个邮箱账号，所有已开放业务模块行为一致。
4. 同步断线恢复不丢变更，不依赖 SSE 消息绝对可靠。
5. 用户能配置、更新和删除自己的 Provider Key，API 永不回显明文。
6. 自定义 Provider 地址通过 SSRF 防护测试。
7. 不同账号的跨租户负向测试全部通过。
8. Local 与 Online 能使用 v5 完整存档双向迁移。
9. 导入失败不会改变现有数据，成功后结构化摘要和媒体哈希一致。
10. 用户能随时导出数据并发起账号删除。
11. PostgreSQL、对象存储、Redis、Worker 和 KMS 故障都有可观察、可恢复行为。
12. 备份恢复演练能够恢复业务数据、媒体和密钥解密能力。
13. OpenAPI、用户文档、隐私说明、发布检查清单与代码一致。
14. 所有正式构建通过签名、升级和回滚验收。

## 22. 风险与控制

| 风险 | 后果 | 控制措施 |
| --- | --- | --- |
| Local 与 Online 长期分支漂移 | 业务和存档不兼容 | 共享契约测试、固定互导矩阵、定期吸收主分支 |
| 为 Online 重写已有模块 | 功能回退、维护成本翻倍 | 现有实现优先、最小 Adapter、Local/Online 回归矩阵 |
| SQLite 直接公开承载增长 | 单点、锁争用、难扩展 | 仅限受控内测，PostgreSQL 作为公开注册门禁 |
| Provider Base URL 被用于 SSRF | 内网和云凭证泄露 | 统一 Egress Guard、固定 DNS 结果、重定向复检 |
| Provider Key 泄露 | 用户资产损失 | KMS 信封加密、最小日志、运行时短生命周期解密 |
| 导入覆盖错误 | 用户数据丢失 | 临时区、完整校验、自动备份、事务替换、明确确认 |
| 大存档占满内存或磁盘 | 服务不可用 | 对象存储、流式处理、配额、异步 Worker、自动清理 |
| SSE 多实例丢事件 | 客户端显示过期 | 数据库游标补拉为权威，Redis 只负责低延迟通知 |
| 移动端误带 Local Hub | 攻击面和行为混乱 | 独立构建变体、组件禁用、产物静态检查和真机端口检查 |
| 用户误以为云端看不到 Key | 信任和合规风险 | 设置页、隐私说明和导入提示明确运行时可解密事实 |
| 后台任务消耗 BYOK 额度 | 意外费用 | 默认关闭、显式授权、并发/频率限制和用量展示 |

## 23. 实施过程中的强制规则

- 任何阶段都不能破坏 Local Edition 的现有数据和双 Hub 行为；
- Online 必须增量复用当前实现；新代码应集中在 Edition 组合和基础设施 Adapter，不复制现有业务模块；
- Online 注册和登录只能使用邮箱，`displayName` 不得成为登录标识，Local 的账号名登录保持不变；
- 不直接复制运行中的 SQLite 或 PostgreSQL 文件实现互导；
- 不以“更新时间较新”为依据自动合并 Local 与 Online；
- 不在错误信息、日志、测试快照或监控中放入真实用户正文和密钥；
- 不为了内测便利把 CORS、SSRF、租户隔离或存档校验留到公开发布后；
- 不允许云端使用默认固定主密钥；
- 不允许客户端自行声明 `user_id`；
- 每个新增云端状态都必须定义归属、过期、清理和恢复策略；
- 每个阶段结束时更新本文复选框、OpenAPI、测试结果和已知限制。

## 24. 推荐的首轮提交顺序

1. `docs: define local and online edition boundary`
2. `feat: add edition capabilities and cloud composition root`
3. `test: enforce cloud tenant isolation`
4. `feat: add provider egress guard and cloud secret adapter`
5. `feat: add portable archive v5 contract`
6. `feat: add cloud archive jobs and object storage adapter`
7. `feat: add online desktop build`
8. `feat: add online android build`
9. `feat: add invisible account session refresh`
10. `feat: add postgres redis worker production adapters`
11. `ops: add cloud deployment observability and recovery`
12. `docs: publish online security migration and operations guides`

每个提交必须独立可测试，涉及格式和协议的提交必须先有失败测试，再实现通过；不要把后端、双客户端、数据库迁移和部署全部压进一个无法审查的提交。

## 25. 当前已落地的首阶段基线

当前分支已具备可继续迭代的 Cloud 最小闭环：

- 后端通过 `AETHERX_EDITION=cloud` 启动 Cloud 组合，复用现有业务路由并关闭 Local 专属的 LAN、Peer、双 Hub 切换、复制调度和本地控制入口；
- Cloud 账号使用邮箱注册、一次性令牌验证和邮箱登录，Local 账号名认证保持原行为；
- 开发环境验证邮件写入 `AETHERX_EMAIL_OUTBOX_DIR`；正式环境可切换 QQ SMTP，固定使用 `smtp.qq.com:465`、SSL/TLS 和授权码发送验证及密码重置邮件。仓库不保存真实发件地址或授权码，真实投递仍需部署时注入凭证并验收；
- 桌面端可使用 `npm run start:cloud` 进入 Online 认证和云端状态界面，服务地址由 `AETHERX_SERVER_URL` 注入；
- 手机版可使用 `npm run dev:cloud` 或 `npm run build:cloud`，服务地址由 `VITE_AETHERX_SERVER_URL` 注入；Cloud 路径不初始化 Android Local Hub；
- 桌面端和手机版均复用现有业务页面、Store、API Client 与同步机制，没有复制业务模块；
- 已有邮箱大小写规范化、验证令牌单次使用、重发验证、Local 回归与跨账号 Todo 隔离测试。
- 密码找回采用不枚举账号的接受响应；重置令牌单次有效，成功后撤销该账号旧登录会话，桌面端和手机版共用现有认证页完成流程。
- `.aetherx` 已升级到 v5，默认排除 Provider Key，可显式选择随密码加密信封迁移；v1-v4 仍可导入，并有 Local → Online → Local 往返摘要测试。
- Online Desktop 使用 `com.xuanxiaotech.aetherx.online.desktop`、`AetherX Online`、独立安装输出和 `%APPDATA%\AetherX Online` 数据目录；签名包固定连接 `https://api.aetherx.tech`，开发模式才允许显式覆盖测试地址，Cloud 安装包不再携带本地 Hub 后端和防火墙安装脚本。
- Online Android 使用 `com.xuanxiaotech.aetherx.online`、`AetherX Online`、`aetherx-online` 深链和独立签名变量；Local/Cloud product flavor 可同时安装。Cloud 合并清单移除 AetherX Local Hub 前台服务、开机接收器及对应权限，主 Activity 不注册或启动 Local Hub，网络安全配置全面拒绝明文 HTTP。
- Cloud 后端签发短期 Access Token 和单次轮换 Refresh Token；桌面端加密保存刷新凭证，手机版保存到现有安全会话，并在 401 后自动刷新和重试。界面不展示设备列表，也不要求用户管理设备；退出撤销当前会话，密码重置撤销账号全部旧会话。
- Cloud 文本与图片 Provider 共用统一 Egress Guard：配置保存和请求执行都会拒绝非 HTTPS、本机、私网、保留地址与云元数据地址；DNS 结果被固定到连接，重定向重新校验，跨源不转发 Provider Key，并对超时及响应大小设置边界。Local 的局域网 Provider 行为不变。

这仍是开发基线，不是可公开部署版本。QQ 发件账号真实投递验收与退信观测、KMS、PostgreSQL、对象存储、异步存档任务、正式签名凭证、独立升级通道、Provider 出站审计以及生产安全加固仍按上文阶段推进。
