# AetherX 工具系统架构

## 目标

AetherX 将 AI 作为多个业务模块的统一入口。AI 不直接读写模块数据，而是通过工具注册表调用模块公开的能力。

```text
桌面端 ─┐
        ├─> AetherX Agent Hub ─> AI Provider
手机端 ─┘          │
                   ├─> Tool Registry ─> 模块服务 ─> SQLite
                   └─> 记忆召回、人格、心情、时间上下文
```

Agent Hub 位于后端，是对话处理的唯一实现。桌面端和手机端只负责发送消息、展示
服务端返回的消息流，以及把用户对写操作的允许或拒绝传回 Hub。客户端不得再维护
第二套提示词拼装、工具循环、DSML 解析或会话写入逻辑。

## 分层

1. **Client UI**：提交消息、渲染 Markdown 与工具卡片、收集授权选择。
2. **Agent API**：建立或恢复会话，维护一次对话运行的状态。
3. **Context Composer**：组合时间、人格、心情和记忆召回上下文。
4. **AI Provider**：处理 OpenAI 兼容端点、鉴权和消息请求。
5. **Agent Loop**：接收工具调用、执行并回传结果，直到得到最终答复。
6. **Tool Registry**：注册、发现、校验并分发工具。
7. **Permission Gate**：读操作自动执行，写入和删除操作暂停等待用户确认。
8. **Module Service / Store**：按认证用户隔离并保存业务数据。

依赖方向只能从上向下。Skill 可以编排多个工具，但不能绕过工具层直接访问模块存储。

## 工具契约

工具名称使用 `module.action`：

- 模块名和动作名使用小写英文。
- OpenAI function name 不支持点号，Provider Adapter 在传输时将其映射为
  `module_action`，收到调用后再还原为内部工具。
- 名称一旦发布应保持兼容；破坏性修改通过新工具名或新版本实现。
- 参数使用 JSON Schema 描述，所有对象默认 `additionalProperties: false`。

每个工具包含：

```ts
interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  risk: "read" | "write" | "destructive";
  execute(input: unknown): Promise<ToolResult>;
}

interface ToolResult {
  ok: boolean;
  content: string;
  data?: unknown;
  error?: { code: string; message: string };
}
```

模型只接收名称、描述和输入 Schema，不接收内部执行函数与安全策略。

## 风险与授权

| 级别 | 示例 | 默认策略 |
| --- | --- | --- |
| `read` | 查询待办 | 自动执行 |
| `write` | 新建、修改、完成待办 | 暂停运行，在聊天内确认 |
| `destructive` | 删除待办 | 暂停运行，明确展示影响后确认 |

工具状态始终由 Hub 写入展示消息流。用户拒绝后，Agent Loop 仍向模型回传
结构化失败结果，模型不得声称操作已成功。待确认运行只保存在 Hub 内存中并有
短时有效期；服务重启或超时后，客户端应提示用户重新发送原消息。

## Agent Loop

1. 将系统提示、历史消息和工具 Schema 发送给模型。
2. 若模型返回普通消息，结束本轮。
3. 若模型返回 `tool_calls`，逐项解析参数并查询注册表。
4. 读工具立即执行；写入或删除工具返回 `approval_required` 并暂停。
5. 执行工具，把统一结果作为 `role: "tool"` 消息回传。
6. 重复以上过程，最多 6 轮，避免模型陷入无限调用。

每次请求保留完整的 assistant `tool_calls` 与对应的 `tool_call_id`，保证 OpenAI 兼容协议的消息关联正确。

同一轮对话会按“工具名 + 规范化参数”记录调用签名。重复调用不会再次执行，
尤其避免重复创建、修改或删除；Hub 会关闭工具并要求模型根据已有结果生成
最终回答。达到 6 轮上限时采用相同的无工具收口流程，而不是直接向用户报错。

兼容层同时识别原生 `tool_calls`、旧版 `function_call`、数组文本和 DSML 文本
工具协议。DSML 只用于兼容异常 Provider；执行后会重新生成干净的最终回复，
不会把协议、工具参数或图片提示词写入可见聊天内容。

同一账号的同一会话只允许一个活跃运行。桌面端和手机端同时发送时，后到请求
会收到 `AGENT_CONVERSATION_BUSY`，避免两端覆盖历史或产生乱序工具写入。

## 安全约束

- API Key 不进入工具参数、工具结果或聊天记录。
- 工具只能访问本模块授权的数据域。
- 所有工具参数在 Hub 的工具边界内再次校验，不信任模型生成的参数。
- 工具运行通过服务端认证上下文绑定用户，客户端不能指定数据所有者。
- 图片提示词不进入模型可见工具结果，也不作为最终回复或悬停文案返回。
- 时间统一使用 ISO 8601 输入，存储时转换为 Unix 毫秒。
- 工具调用数量、参数长度和循环轮次均设置上限。
- 后续审计日志至少记录请求 ID、工具名、风险级别、状态、耗时和时间戳，不记录密钥与完整隐私内容。

## MCP 与 Skill

- **MCP** 负责“能力如何被发现和调用”，适合跨进程、跨语言或远程模块。
- **Skill** 负责“如何组合能力完成任务”，适合沉淀工作流和领域策略。

因此当前模块统一实现为 Tool；需要跨边界共享时增加 MCP Adapter，需要复杂工作流时再增加 Skill。三者不是互斥关系。
