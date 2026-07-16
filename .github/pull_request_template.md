## 改动说明

<!-- 说明为什么要改，以及用户能看到什么变化。 -->

## 影响范围

- [ ] Hub 后端 / API
- [ ] 桌面端
- [ ] Android 客户端
- [ ] 数据库迁移
- [ ] 多端同步
- [ ] 文档

## 数据与兼容性

<!-- 说明账号隔离、数据库迁移、旧数据、回滚和跨版本兼容。没有影响请写“无”。 -->

## 安全与隐私

<!-- 说明凭证流向、权限边界和敏感数据处理。没有新增影响请写“无”。 -->

## 验证

- [ ] 后端测试通过：`cd backend && npm test`
- [ ] 桌面端测试通过：`cd frontend/desktop && npm test`
- [ ] 移动端测试通过：`cd frontend/mobile && npm test`
- [ ] 移动端生产构建通过：`cd frontend/mobile && npm run build`
- [ ] `git diff --check` 通过
- [ ] UI 改动已附截图或录屏

## 提交前检查

- [ ] 未提交数据库、备份、构建产物、密钥、令牌或私人数据
- [ ] 新增或变更 API 已更新 `backend/openapi.yaml`
- [ ] 新增文档已加入 `docs/README.md`
- [ ] 数据库迁移只追加，没有修改已发布迁移
