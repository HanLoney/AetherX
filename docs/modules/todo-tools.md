# Todo 模块工具

Todo 工具共享日历模块的本地存储 `xuan-todo-items-v1`。时间参数使用带时区的 ISO 8601 字符串；列表中的日期使用本地日期 `YYYY-MM-DD`。

## `todo.list`

- 风险：`read`
- 用途：按日期和完成状态查询待办。
- 参数：`date?`、`status?`（`all | active | completed`）。

## `todo.get`

- 风险：`read`
- 用途：按 ID 获取单条待办。
- 参数：`id`。

## `todo.create`

- 风险：`write`
- 用途：新建待办。
- 参数：`title`、`startAt`、`endAt`。
- 规则：标题不能为空，结束时间必须晚于开始时间。

## `todo.update`

- 风险：`write`
- 用途：修改已有待办。
- 参数：`id`，以及至少一个 `title | startAt | endAt`。
- 规则：合并更新后仍需满足时间先后关系。

## `todo.complete`

- 风险：`write`
- 用途：设置待办完成状态。
- 参数：`id`、可选 `completed`，省略时默认为 `true`。

## `todo.delete`

- 风险：`destructive`
- 用途：永久删除待办。
- 参数：`id`。

## 返回格式

成功：

```json
{
  "ok": true,
  "content": "已创建待办“完成工具协议文档”。",
  "data": {
    "id": "..."
  }
}
```

失败：

```json
{
  "ok": false,
  "content": "未找到指定待办。",
  "error": {
    "code": "TODO_NOT_FOUND",
    "message": "未找到指定待办。"
  }
}
```
