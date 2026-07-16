# AetherX UniApp（旧原型）

此目录是早期跨端 Todo 与日历原型，仅保留用于参考 UI 和 UniApp 构建方式，不再作为 AetherX 的正式移动客户端。

> [!WARNING]
> 该原型使用 `uni.setStorageSync` 保存本地数据，不接入当前账号隔离、Hub API、设备配对和增量同步。不要把它与正式桌面端或 Android 客户端混用，也不要把这里的数据视为 Hub 备份。

正式 Android 客户端位于 [`frontend/mobile`](../mobile)。

## 运行旧原型

```powershell
cd frontend\uniapp
npm install
npm run dev:h5
```

## 构建

```powershell
npm run build:h5
npm run build:mp-weixin
```

App 真机运行和发行可使用 HBuilderX 打开本目录。

## 维护边界

- 只接受必要的依赖安全修复和文档修正；
- 新的移动端功能应提交到 `frontend/mobile`；
- 不为该原型增加新的独立数据模型或同步协议；
- 如果需要迁移旧原型数据，应先设计显式导入流程，不能直接复制到 Hub 数据库。
