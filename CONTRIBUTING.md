# 参与贡献

感谢你愿意改进 AetherX。这个项目会处理私人对话、记忆和凭证，因此功能正确之外，还特别重视数据兼容、隐私边界和可恢复性。

## 开始之前

1. 搜索现有 Issue，确认问题是否已经被报告；
2. 较大的功能或架构调整先创建讨论 Issue，说明使用场景、数据影响和兼容方案；
3. 安全漏洞不要提交公开 Issue，请按 [SECURITY.md](SECURITY.md) 私下报告；
4. 不要在 Issue、日志、截图或测试数据中上传真实 API Key、密码、会话令牌、配对秘密或私人对话。

## 开发环境

- Node.js 22.13+
- npm 10+
- 桌面端：Windows 10/11
- Android：Android Studio、JDK 21、Android SDK 36

安装和测试命令见[开发者指南](docs/development.md)。

## 推荐流程

```powershell
git clone https://github.com/HanLoney/AetherX.git
cd AetherX
git switch -c feature/short-description
```

完成修改后：

```powershell
cd backend
npm test

cd ..\frontend\desktop
npm test

cd ..\mobile
npm test
npm run build
```

只需运行与你改动相关的测试，但 Pull Request 必须清楚列出已经执行和没有执行的检查。

## 代码与架构约束

- Hub 是业务数据的唯一写入者，客户端不得直接打开或同步 `xuanai.db`；
- 新增业务接口时同步更新 `backend/openapi.yaml` 和相关文档；
- 数据库迁移只能追加，不要修改已经发布的迁移内容；
- 所有业务查询必须使用认证上下文中的 `user_id` 进行隔离；
- API Key、密码和令牌不得进入日志、错误详情、工具参数或聊天记录；
- 危险操作必须有明确的用户确认和可理解的结果反馈；
- 桌面端保持 `contextIsolation: true` 与 `nodeIntegration: false`；
- Android 长期凭证必须使用系统 Keystore，不得退化到普通 Preferences；
- UI 改动应沿用现有粉蓝、纸张和毛玻璃设计语言，并同时检查窄屏与长内容状态。

## 提交与 Pull Request

提交信息可以使用中文或英文，建议采用清晰的前缀：

- `新增：` / `feat:` 新功能
- `修复：` / `fix:` 缺陷修复
- `优化：` / `refactor:` 不改变行为的结构调整
- `文档：` / `docs:` 文档修改
- `测试：` / `test:` 测试修改

Pull Request 应包含：

- 改动目的和用户可见结果；
- 受影响的客户端、API 和数据表；
- 数据迁移、兼容性与回滚说明；
- 已运行的测试；
- 涉及 UI 时附上截图或录屏；
- 涉及安全边界时说明威胁模型和凭证流向。

请保持 PR 聚焦，不要混入无关格式化、构建产物、数据库、压缩包或个人配置。

## 文档贡献

文档同样是正式交付的一部分。命令示例必须能在对应平台运行；路径、默认值和环境变量应以当前代码为准。新增页面后，请在 [docs/README.md](docs/README.md) 中加入入口。

提交前运行：

```powershell
node scripts\check-docs.js
```

## 许可证

提交贡献即表示你有权提交该内容，并同意其按项目的 [MIT License](LICENSE) 发布。
