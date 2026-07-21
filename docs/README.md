# AetherX 文档中心

这里收录面向使用者、部署者和贡献者的完整文档。第一次接触项目时，从“使用与部署”开始；准备修改代码时，再阅读“开发与架构”。

## 使用与部署

- [快速上手](getting-started.md)：安装桌面端、创建账号、配置 AI 和连接手机；
- [Windows Hub 部署](deployment/windows.md)：前台运行、计划任务常驻、局域网接入、更新与备份；
- [Linux Hub 部署](deployment/self-hosted.md)：Ubuntu、systemd、Caddy、HTTPS、更新与回滚；
- [数据、备份与恢复](data-and-backup.md)：数据位置、主密钥、停机备份和迁移；
- [常见问题与排障](troubleshooting.md)：连接、注册、AI 凭证、同步和 Android 调试。

## 开发与 API

- [开发者指南](development.md)：环境、启动方式、测试矩阵和数据库迁移规则；
- [API 使用说明](api.md)：认证、响应格式、请求示例和 OpenAPI 入口；
- [OpenAPI 契约](../backend/openapi.yaml)：机器可读的接口定义；
- [后端说明](../backend/README.md)；
- [桌面端说明](../frontend/desktop/README.md)；
- [Android 客户端说明](../frontend/mobile/README.md)。

## 架构与决策

- [家庭节点与多端同步架构](architecture/home-hub-sync.md)；
- [工具系统架构](architecture/tool-system.md)；
- [ADR-0001：内部 Tool Registry 与 MCP Adapter](adr/0001-internal-tools-mcp-adapter.md)；
- [ADR-0002：家庭节点单写与增量同步](adr/0002-home-hub-single-writer-sync.md)；
- [ADR-0003：由后端统一托管 Agent Hub](adr/0003-server-owned-agent-hub.md)；
- [Todo 工具契约](modules/todo-tools.md)；
- [模块设置](modules/module-settings.md)；
- [聊天 Markdown 约定](ui/chat-markdown.md)。

## 项目治理

- [贡献指南](../CONTRIBUTING.md)；
- [社区行为准则](../CODE_OF_CONDUCT.md)；
- [安全策略](../SECURITY.md)；
- [隐私说明](../PRIVACY.md)；
- [获取帮助](../SUPPORT.md)；
- [变更记录](../CHANGELOG.md)；
- [MIT License](../LICENSE)。

## 文档维护规则

- 示例命令必须标注适用平台；
- 默认值、环境变量和接口路径以当前代码为准；
- 架构决策发生变化时新增 ADR，不直接抹去旧决策；
- 新增文档后在本页加入入口；
- 不在文档、截图或示例中放入真实密钥、令牌和私人数据。
