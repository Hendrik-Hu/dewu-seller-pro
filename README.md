<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Dewu Seller Pro

## 本地运行

1. 安装依赖：`npm install`
2. 启动前端：`npm run dev`

默认前端地址：`http://localhost:3000`

如果你要在本地调通 Agent 接口，请额外启动：

- `npm run dev:agent`
- 并在 `.env.local` 配置：
  - `VITE_AGENT_API_URL=http://localhost:3001/api/agent/chat`
  - `VITE_AGENT_MANAGE_API_URL=http://localhost:3001/api/agent/manage`

## 生产接入 Coze Agent

本项目采用「前端调用本项目后端 API，后端再调用 Coze」的架构，避免在浏览器暴露密钥。
当前后端默认按 `stream_run` 方式调用 Coze 项目接口。

### 1) 配置服务端环境变量

在部署平台（如 Vercel）配置以下变量：

- `COZE_STREAM_RUN_URL`：例如 `https://your-subdomain.coze.site/stream_run`
- `COZE_PROJECT_ID`：Coze 项目 ID（数字）
- `COZE_STREAM_TOKEN`：`Authorization: Bearer` 使用的 token
- `COZE_PAT`：可选，未配置 `COZE_STREAM_TOKEN` 时作为兜底 token
- `COZE_MANAGE_STREAM_RUN_URL`：可选，AI 管理专用 stream_run 地址
- `COZE_MANAGE_PROJECT_ID`：可选，AI 管理专用项目 ID
- `COZE_MANAGE_STREAM_TOKEN`：可选，AI 管理专用 token

### 2) 可选前端环境变量

- `VITE_AGENT_API_URL`：可选，默认使用同域 `/api/agent/chat`
- `VITE_AGENT_MANAGE_API_URL`：可选，默认使用同域 `/api/agent/manage`

### 3) 已实现的接口

- `POST /api/agent/chat`
  - 入参：`message`、`context`（可选）、`conversationId`（可选）、`userId`（可选）
  - 出参：`reply`、`conversationId`（对应 stream_run 的 `session_id`）
- `POST /api/agent/manage`
  - 入参：`message`、`confirm`、`conversationId`（可选）、`inventorySnapshot`（可选）
  - 出参：`reply`、`conversationId`、`requiresConfirmation`、`executionConfirmed`、`executed`、`dryRun`、`actions`

## 部署

- 推荐部署到 Vercel，前端静态资源与 `/api/agent/chat` 服务端函数同域运行。
- `vercel.json` 已保留 `/api/*` 路由，不会被 SPA rewrite 覆盖。
