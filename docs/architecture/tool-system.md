# XuanAI 工具系统架构

## 目标

XuanAI 将 AI 作为多个业务模块的统一入口。AI 不直接读写模块数据，而是通过工具注册表调用模块公开的能力。

```text
用户 -> AI 对话 -> Tool Registry -> 权限确认 -> 模块工具 -> 模块数据
                              |
                              +-> 后续 MCP Adapter
```

当前版本在客户端进程内执行工具，以减少复杂度；工具协议与 OpenAI Chat Completions 的 function tools 对齐，未来可以在不改变模型调用层的前提下接入 MCP Server。

## 分层

1. **AI Provider**：处理 OpenAI 兼容端点、鉴权和消息请求。
2. **Agent Loop**：发送消息，接收 `tool_calls`，执行工具并回传 `tool` 消息，直到模型给出最终答复。
3. **Tool Registry**：注册、发现、校验并分发工具。
4. **Permission Gate**：根据风险级别决定是否请求用户确认。
5. **Module Tool**：将稳定的工具参数转换成模块内部操作。
6. **Module Store**：保存 Todo 等模块的业务数据。

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
| `write` | 新建、修改、完成待办 | 每次确认 |
| `destructive` | 删除待办 | 每次确认，并明确展示影响 |

用户拒绝后，Agent Loop 仍向模型回传结构化失败结果，模型不得声称操作已成功。

## Agent Loop

1. 将系统提示、历史消息和工具 Schema 发送给模型。
2. 若模型返回普通消息，结束本轮。
3. 若模型返回 `tool_calls`，逐项解析参数并查询注册表。
4. 权限门根据风险级别进行确认。
5. 执行工具，把统一结果作为 `role: "tool"` 消息回传。
6. 重复以上过程，最多 6 轮，避免模型陷入无限调用。

每次请求保留完整的 assistant `tool_calls` 与对应的 `tool_call_id`，保证 OpenAI 兼容协议的消息关联正确。

同一轮对话会按“工具名 + 规范化参数”记录调用签名。重复调用不会再次执行，
尤其避免重复创建、修改或删除；客户端会关闭工具并要求模型根据已有结果生成
最终回答。达到 6 轮上限时采用相同的无工具收口流程，而不是直接向用户报错。

兼容层同时识别旧版 `function_call`、数组文本和部分兼容端点的文本字段。
若端点明确不支持工具，客户端会移除 `tools` 重试一次普通对话，并明确告知
用户本轮不能读取或修改本地模块。

## 安全约束

- API Key 不进入工具参数、工具结果或聊天记录。
- 工具只能访问本模块授权的数据域。
- 所有写操作在客户端边界内再次校验，不信任模型生成的参数。
- 时间统一使用 ISO 8601 输入，存储时转换为 Unix 毫秒。
- 工具调用数量、参数长度和循环轮次均设置上限。
- 后续审计日志至少记录请求 ID、工具名、风险级别、状态、耗时和时间戳，不记录密钥与完整隐私内容。

## MCP 与 Skill

- **MCP** 负责“能力如何被发现和调用”，适合跨进程、跨语言或远程模块。
- **Skill** 负责“如何组合能力完成任务”，适合沉淀工作流和领域策略。

因此当前模块统一实现为 Tool；需要跨边界共享时增加 MCP Adapter，需要复杂工作流时再增加 Skill。三者不是互斥关系。
