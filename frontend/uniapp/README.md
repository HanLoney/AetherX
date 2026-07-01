# AetherX UniApp

AetherX 的跨端客户端工程。当前阶段复刻桌面版的小玄日历与待办能力，支持 H5、App 和微信小程序构建。

## 本地运行

```bash
npm install
npm run dev:h5
```

## 构建

```bash
npm run build:h5
npm run build:mp-weixin
```

App 真机运行与发行可使用 HBuilderX 打开此目录。

## 当前能力

- 月历、跨日待办标记和每日完成进度
- 新建、编辑、删除、完成和筛选待办
- 五套主题、自定义首页文案与自定义背景
- 使用 `uni.setStorageSync` 在本地保存数据
