# 娱乐圈模拟器（本地文件记忆版）

## 启动方式

1. 在项目根目录执行：
   - `npm start`
2. 浏览器打开：
   - `http://localhost:3000`

## 目录结构

- `public/index.html`：页面入口（已从单文件拆分）
- `public/styles.css`：样式文件
- `public/app.jsx`：React 逻辑
- `server.js`：本地服务与文件持久化 API

## 人物记忆文件

- 联系人目录：`data/contacts/*.md`
- 主角目录：`data/protagonist/人物信息/主角.md`

联系人与主角都使用固定 Markdown 分级结构存储，聊天/事件触发的人物变化会同步更新到对应人物文件。