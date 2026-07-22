# AetherX Windows 启动器

AetherX 启动器是 Windows 上的组件部署与健康控制中心。安装启动器后，可以在同一界面中安装、启动和停止 AetherX Hub 与桌面端，并持续查看两端是否真正可用。

## 当前能力

- 一键安装并启动 Hub 与桌面端；
- 单独安装、启动或安全停止任一组件；
- 每两秒检测 Hub 健康接口、响应延迟和控制通道；
- 每两秒检测桌面端控制通道与进程响应；
- Hub 独立于启动器窗口运行，关闭启动器不会中断服务；
- 桌面端与 Hub 均通过本机命名管道安全退出，不依赖强制结束进程；
- 组件式界面为后续模型服务、扩展和诊断工具预留空间。

## 开发运行

先构建一次桌面端载荷，再启动启动器：

```powershell
cd frontend\launcher
npm install
npm run build:desktop
npm run prepare:payload
npm start
```

## 构建 Windows 安装包

```powershell
cd frontend\launcher
npm install
npm run dist
```

安装包输出到 `frontend\launcher\dist`。它内置当前版本的 Hub 与桌面端载荷，目标电脑不需要预装 Node.js。

## 数据与安装位置

- Hub 数据：`%APPDATA%\AetherX\hub`
- Hub 日志：`%APPDATA%\AetherX\logs\launcher-hub.log`
- 桌面端：`%LOCALAPPDATA%\Programs\AetherX Desktop`

更新桌面端时，启动器会先写入暂存目录，再替换现有版本；替换失败时会恢复旧版本。
