# Dewu Seller Pro

得物卖家库存管理与 AI 经营助手。项目面向移动端使用，支持商品入库、出库、仓库管理、库存统计、经营数据图表，以及通过 Supabase 和 Coze Agent 执行 AI 分析与库存操作。

## Tech Stack

- React 19 + TypeScript
- Vite
- Supabase Auth / Database / Storage / Edge Functions
- Coze Agent
- Capacitor Android
- Recharts
- lucide-react

## Local Setup

1. 安装依赖

   ```powershell
   .\install_deps.ps1
   ```

   或者使用系统自带 Node.js：

   ```powershell
   npm install
   ```

2. 创建本地环境变量

   ```powershell
   Copy-Item .env.example .env.local
   ```

   至少填写：

   ```env
   VITE_SUPABASE_URL=
   VITE_SUPABASE_ANON_KEY=
   ```

3. 启动前端

   ```powershell
   .\run_dev.ps1
   ```

   或：

   ```powershell
   npm run dev
   ```

4. 如果要本地调通 Agent 接口，再额外启动：

   ```powershell
   npm run dev:agent
   ```

   可选前端变量：

   ```env
   VITE_AGENT_API_URL=http://localhost:3001/api/agent/chat
   VITE_AGENT_MANAGE_API_URL=http://localhost:3001/api/agent/manage
   ```

## Scripts

```powershell
npm run dev            # Start Vite dev server
npm run dev:agent      # Start local Coze agent bridge
npm run build          # Build web app to dist/
npm run preview        # Preview production build
npm run typecheck      # Run TypeScript checks
npm run android:sync   # Build and sync Capacitor Android project
.\build_apk.ps1        # Build Android debug APK
```

如果 Windows 全局没有 `npm`，项目里的 PowerShell 脚本会优先使用本地 `node-v20.11.0-win-x64`。

## Project Structure

```text
components/                 React UI screens and modals
services/                   Supabase data access helpers
lib/supabase.ts             Supabase client bootstrap
supabase/functions/         Edge Functions for AI and SKU lookup
api/agent/                  Coze bridge endpoints for web deployment
android/                    Capacitor Android project
public/                     PWA manifest and icon
```

## Supabase Notes

项目根目录内的 SQL 文件记录了当前数据库结构补丁和优化步骤，例如：

- `setup_storage.sql`
- `fix_activities_rls.sql`
- `add_platform_column.sql`
- `add_source_column.sql`
- `db_data_layer_optimization.sql`

AI 库存管理逻辑位于 `supabase/functions/ai-manager`，它会鉴权当前用户，并在服务端使用 service role 执行入库/出库相关操作。所需密钥说明见 `supabase/functions/ai-manager/README.md`。

## Coze Agent Deployment

生产环境建议将前端与 `/api/agent/*` 部署到同域，例如 Vercel。服务端需要按需配置：

- `COZE_STREAM_RUN_URL`
- `COZE_PROJECT_ID`
- `COZE_STREAM_TOKEN`
- `COZE_PAT`（可选）
- `COZE_MANAGE_STREAM_RUN_URL`（可选）
- `COZE_MANAGE_PROJECT_ID`（可选）
- `COZE_MANAGE_STREAM_TOKEN`（可选）

`vercel.json` 已保留 `/api/*` 路由，不会被 SPA rewrite 覆盖。
