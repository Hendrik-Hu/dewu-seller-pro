import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('mobile design tokens keep readable type, compact spacing and touch targets', () => {
  const css = read('index.css');

  assert.match(css, /\.app-page\s*\{[\s\S]*px-4/);
  assert.match(css, /\.app-page-title\s*\{[\s\S]*text-\[22px\]/);
  assert.match(css, /\.app-section-title\s*\{[\s\S]*text-base/);
  assert.match(css, /\.app-help-text\s*\{[\s\S]*text-xs/);
  assert.match(css, /\.app-touch\s*\{[\s\S]*min-h-12[\s\S]*min-w-12/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
});

test('primary navigation and seller home expose the high-frequency workflow', () => {
  const nav = read('components/BottomNav.tsx');
  const home = read('components/Home.tsx');

  assert.match(nav, /aria-label="主导航"/);
  assert.match(nav, /aria-current=\{isActive \? 'page' : undefined\}/);
  for (const label of ['首页', '库存', '统计', '我的']) assert.match(nav, new RegExp(label));

  assert.match(home, /aria-labelledby="today-summary-title"/);
  assert.match(home, /bg-blue-600[\s\S]*入库/);
  assert.match(home, /bg-emerald-600[\s\S]*出库/);
  assert.match(home, /采购运输中/);
  assert.match(home, /id="recent-activity-title"/);
  assert.match(home, /last:border-b-0/);
});

test('inventory and statistics remain scannable and directly actionable', () => {
  const inventory = read('components/ProductList.tsx');
  const stats = read('components/Stats.tsx');

  assert.match(inventory, /aria-label=\{`管理 \$\{product\.name\}`\}/);
  assert.match(inventory, /<MoreVertical size=\{20\}/);
  assert.match(inventory, /aria-label="新增库存"/);
  assert.match(inventory, /总库存数/);
  assert.match(inventory, /该仓库预估总值/);

  for (const conclusion of ['本月销售额', '实际净利润', '预计净利润', '待结算']) {
    assert.match(stats, new RegExp(conclusion));
  }
  assert.match(stats, /打开 AI 经营分析/);
  assert.doesNotMatch(stats, /点击向 AI 提问/);
});

test('inbound and outbound use full-height mobile task surfaces with reachable actions', () => {
  const inbound = read('components/AddProductModal.tsx');
  const outbound = read('components/OutboundModal.tsx');

  for (const source of [inbound, outbound]) {
    assert.match(source, /app-task-shell/);
    assert.match(source, /app-task-panel/);
    assert.match(source, /app-task-header/);
    assert.match(source, /app-task-body/);
  }
  assert.match(inbound, /sticky bottom-0/);
  assert.match(inbound, /className="app-form-control/);
  assert.match(outbound, /sticky bottom-0/);
  assert.match(outbound, /aria-label="关闭出库"/);
});
