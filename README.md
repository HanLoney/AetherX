# XuanAI

XuanAI 是一个以 AI 为核心、持续扩展能力模块的多端个人智能助手。

## 项目结构

```text
XuanAI/
├─ desktop/  # Electron 桌面端
└─ uniapp/   # UniApp 多端客户端
```

两个客户端目前都包含小玄日历与待办功能，后续会共同接入 XuanAI 的 AI 大脑、账号和同步服务。

## 运行桌面端

```bash
cd desktop
npm install
npm start
```

## 运行 UniApp H5

```bash
cd uniapp
npm install
npm run dev:h5
```

App 调试与发行可使用 HBuilderX 打开 `uniapp` 目录。
