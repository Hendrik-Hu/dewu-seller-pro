# 卖家库存助手

个人卖家自用库存工具，非得物官方产品。库存管理产品仅通过 Android App 提供，支持商品入库、出库、仓库管理、库存统计、经营数据图表，以及通过 Supabase Edge Function 生成可确认、可追踪的 AI 分析与库存操作计划。生产 Web 仅承载 Android 使用说明、认证回跳、账号删除和政策支持页面。

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
npm run build          # Build production Web support surface to dist/
npm run build:android  # Build the complete Android-local App assets to dist/
npm run preview        # Preview production build
npm run typecheck      # Run TypeScript checks
npm run android:sync   # Build and sync Capacitor Android project
npm run check:public-launch # Verify the final public-launch gate (expected to fail in closed test)
.\build_debug_apk.ps1  # Build Android debug test APK
.\build_release_android.ps1 # Build signed Release APK and AAB
```

Android 同步会校验 `VITE_PUBLIC_SITE_URL`。它必须是已验证可公开访问的 HTTPS 站点，并提供 `/privacy.html`、`/account-deletion.html` 与 `/auth/recovery`；缺失或使用本机地址时构建会停止。

生产构建采用双目标：`npm run dev` 和 Android 构建使用完整 App；`npm run build` 只生成 Web 支撑面，并自动检查业务 chunk 没有进入生产 Web。不要直接调用 `vite build` 制作 Android 包，所有 Android 脚本必须通过 `scripts/build-target.mjs android`。

公开发布前必须额外运行 `npm run check:public-launch`。该命令核对自有域名、Supabase 邮件配置、近期注册确认/密码恢复整链凭证、公开政策与支持入口安全头，以及 Android App Link。配置和凭证格式见 `docs/public-launch-gate.md`；当前闭测环境预期因自有域名和 Custom SMTP 整链缺失而非零退出。

如果 Windows 全局没有 `npm`，项目里的 PowerShell 脚本会优先使用本地 `node-v20.11.0-win-x64`。

## Project Structure

```text
components/                 React UI screens and modals
services/                   Supabase data access helpers
lib/supabase.ts             Supabase client bootstrap
supabase/functions/         Edge Functions for AI, account security and media uploads
android/                    Capacitor Android project
public/                     PWA manifest and icon
```

## Supabase Notes

`supabase/migrations/` 是数据库结构、RLS、RPC 与存储策略的唯一权威演进路径。
迁移必须使用新的时间戳文件追加，已经应用的迁移不得改写。不要在项目根目录新增或手工执行 SQL 补丁；数据库回归脚本仅允许放在 `supabase/tests/`，并且必须在事务中回滚。

AI 库存管理逻辑位于 `supabase/functions/ai-manager`。它会鉴权当前用户，并在服务端完成计划签名、一次性确认与入库/出库执行；模型提供商密钥只配置在 Supabase 服务端。所需密钥说明见 `supabase/functions/ai-manager/README.md`。
