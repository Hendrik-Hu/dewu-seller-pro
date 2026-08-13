import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(new URL('../supabase/migrations/20260813030000_link_sales_order_settlement.sql', import.meta.url), 'utf8');
const restoreHardening = readFileSync(new URL('../supabase/migrations/20260813040000_harden_sales_order_backup_restore.sql', import.meta.url), 'utf8');
const modal = readFileSync(new URL('../components/SalesOrdersModal.tsx', import.meta.url), 'utf8');

test('actual settlement advances an authenticated order in the same transaction', () => {
  assert.match(sql, /before insert on public\.outbound_settlement_audit/i);
  assert.match(sql, /status not in \('authenticated','settled'\)/i);
  assert.match(sql, /update public\.sales_orders set status='settled'/i);
  assert.match(sql, /insert into public\.sales_order_events/i);
});

test('order UI sends settlement work to the audited outbound ledger', () => {
  assert.match(modal, /前往出库流水/);
  assert.match(modal, /item\.action !== 'settle'/);
  assert.match(modal, /保存后订单会自动完成结算/);
});

test('order UI pages queues, exposes event history, and reconciles uncertain actions', () => {
  assert.match(modal, /PAGE_SIZE = 20/);
  assert.match(modal, /listSalesOrderEvents/);
  assert.match(modal, /订单时间线/);
  assert.match(modal, /getSalesOrder\(userId, selected\.id\)/);
  assert.match(modal, /订单状态已变化，已按数据库最新状态刷新/);
});

test('order restore hardening rejects ambiguous links and malformed event snapshots', () => {
  assert.match(restoreHardening, /restore_ledger_backup_pre_order_validation_v23/);
  assert.match(restoreHardening, /关联出库流水已被另一订单占用/);
  assert.match(restoreHardening, /事件包含未知字段/);
  assert.match(restoreHardening, /fromStatus/);
  assert.match(restoreHardening, /128 KB 上限/);
});
