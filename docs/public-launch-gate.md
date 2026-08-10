# 公开发布闸门

公开发布前运行：

```powershell
$env:SUPABASE_ACCESS_TOKEN = '<仅放在当前进程，不写入文件>'
$env:PUBLIC_LAUNCH_SITE_URL = 'https://你的自有域名'
$env:PUBLIC_LAUNCH_MAIL_EVIDENCE = '.tools/evidence/public-launch-mail-evidence.json'
npm run check:public-launch
```

命令只有全部检查通过时才返回退出码 `0`。任一检查缺失会返回非 `0`，并用中文列出阻断项，同时生成 `.tools/evidence/public-launch-gate-report.json`。报告只保存布尔状态、公开主机名、HTTP 状态、时间和阻断代码，不保存管理令牌、SMTP 密码、邮箱地址或邮件内容。

## 检查范围

- 正式地址必须是用户自有 HTTPS 域名；`vercel.app`、本机地址和 IP 地址不能通过。
- 通过 Supabase Management API 只读取 Auth 的非敏感状态：`mailer_autoconfirm` 必须为 `false`，SMTP host、port、user 和 sender 必须已配置。脚本不会读取或打印 SMTP 密码。
- 邮件实测凭证必须覆盖真实注册确认和忘记密码两条链路，并且在最近 30 天内完成。每条记录需填写不含个人数据的 `evidenceRef`，指向内部发布记录或证据哈希。凭证格式见 `docs/templates/public-launch-mail-evidence.example.json`；不得写入测试邮箱、Token、邮件链接或验证码。
- 首页、隐私说明、账号删除说明和公开支持入口必须直接返回 `200`，并包含相应安全响应头。
- `/.well-known/assetlinks.json` 必须是无重定向的 HTTPS JSON 响应，并匹配 `android/app/build.gradle` 的包名和 `android/release-certificate.sha256` 中的公开证书指纹。

`SUPABASE_ACCESS_TOKEN` 只允许通过当前进程环境提供，不得写入 `.env.local`、日志、截图或 Git。自有域名、Custom SMTP 或真实邮件实测缺失时，不得把闭测状态描述成公开发布就绪。
