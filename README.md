# 卖家库存助手

个人卖家自用库存工具，非得物官方产品。项目面向移动端使用，支持商品入库、出库、仓库管理、库存统计、经营数据图表，以及通过 Supabase Edge Function 生成可确认、可追踪的 AI 分析与库存操作计划。

## Tech Stack

- React 19 + TypeScript
- Vite
- Supabase Auth / Database / Storage / Edge Functions
- Supabase Edge Functions
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
   VITE_PUBLIC_SITE_URL=https://你的正式公开站点
   ```

3. 启动前端

   ```powershell
   .\run_dev.ps1
   ```

   或：

   ```powershell
   npm run dev
   ```

## Scripts

```powershell
npm run dev            # Start Vite dev server
npm run build          # Build web app to dist/
npm run preview        # Preview production build
npm run typecheck      # Run TypeScript checks
npm run android:sync   # Build and sync Capacitor Android project
.\build_debug_apk.ps1  # Build Android debug test APK
.\build_release_android.ps1 # Build signed Release APK and AAB
```

Android 同步会校验 `VITE_PUBLIC_SITE_URL`。它必须是已验证可公开访问的 HTTPS 站点，并提供 `/privacy.html`、`/account-deletion.html` 与 `/auth/recovery`；缺失或使用本机地址时构建会停止。

如果 Windows 全局没有 `npm`，项目里的 PowerShell 脚本会优先使用本地 `node-v20.11.0-win-x64`。

## Project Structure

```text
components/                 React UI screens and modals
services/                   Supabase data access helpers
lib/supabase.ts             Supabase client bootstrap
supabase/functions/         Edge Functions for AI and SKU lookup
android/                    Capacitor Android project
public/                     PWA manifest and icon
```

## Supabase Notes

`supabase/migrations/` 是数据库结构、RLS、RPC 与存储策略的唯一权威演进路径。
迁移必须使用新的时间戳文件追加，已经应用的迁移不得改写。不要在项目根目录新增或手工执行 SQL 补丁；数据库回归脚本仅允许放在 `supabase/tests/`，并且必须在事务中回滚。

AI 库存管理逻辑位于 `supabase/functions/ai-manager`。它会鉴权当前用户，并在服务端完成计划签名、一次性确认与入库/出库执行；模型提供商密钥只配置在 Supabase 服务端。所需密钥说明见 `supabase/functions/ai-manager/README.md`。
