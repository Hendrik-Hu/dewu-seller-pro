import { spawnSync } from 'node:child_process';
import path from 'node:path';

const requested = process.argv[2];
if (!['android', 'web-support'].includes(requested)) {
  console.error('Usage: node scripts/build-target.mjs <android|web-support>');
  process.exit(2);
}

const viteBin = path.resolve('node_modules/vite/bin/vite.js');
const result = spawnSync(process.execPath, [viteBin, 'build'], {
  cwd: process.cwd(),
  env: { ...process.env, SELLER_INVENTORY_BUILD_TARGET: requested },
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
