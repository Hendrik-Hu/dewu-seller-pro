import assert from 'node:assert/strict';
import test from 'node:test';
import { mapSalesOrderEventFromDb, mapSalesOrderFromDb } from '../lib/salesOrderMapping.ts';

const row = {
  id: '00000000-0000-0000-0000-000000000001', status: 'pending_shipment', product_id: 'p1',
  product_name: 'Dunk Low', brand: 'Nike', sku: 'DD1391', size: '42', warehouse: '主仓',
  quantity: 2, unit_sale_price: '899.00', frozen_unit_cost: 749, platform: '得物',
  fee_snapshot: { schemaVersion: 'fee-snapshot@1', status: 'unknown' }, inventory_restored: false,
  version: 1, created_at: '2026-08-13T00:00:00Z', updated_at: '2026-08-13T00:00:00Z',
};

test('maps a complete sales order without recalculating frozen values', () => {
  const order = mapSalesOrderFromDb({ ...row, estimated_net_profit: '-12.50' });
  assert.equal(order.unitSalePrice, 899);
  assert.equal(order.frozenUnitCost, 749);
  assert.equal(order.estimatedNetProfit, -12.5);
  assert.equal(order.version, 1);
});

test('rejects malformed status, amount, quantity, and fee snapshots', () => {
  assert.throws(() => mapSalesOrderFromDb({ ...row, status: 'shipping' }), /未知状态/);
  assert.throws(() => mapSalesOrderFromDb({ ...row, unit_sale_price: null }), /unit_sale_price/);
  assert.throws(() => mapSalesOrderFromDb({ ...row, quantity: 0 }), /数量或版本/);
  assert.throws(() => mapSalesOrderFromDb({ ...row, fee_snapshot: [] }), /费用快照/);
});

test('does not accept negative frozen sales or cost amounts', () => {
  assert.throws(() => mapSalesOrderFromDb({ ...row, frozen_unit_cost: -1 }), /无效金额/);
  assert.throws(() => mapSalesOrderFromDb({ ...row, unit_sale_price: -0.01 }), /无效金额/);
});

test('maps order events and rejects unknown actions or statuses', () => {
  const eventRow = {
    id: '00000000-0000-0000-0000-000000000002',
    order_id: row.id,
    action: 'ship',
    from_status: 'pending_shipment',
    to_status: 'shipped',
    details: {},
    result: { status: 'shipped' },
    created_at: '2026-08-13T00:10:00Z',
  };
  const event = mapSalesOrderEventFromDb(eventRow);
  assert.equal(event.action, 'ship');
  assert.equal(event.fromStatus, 'pending_shipment');
  assert.throws(() => mapSalesOrderEventFromDb({ ...eventRow, action: 'force' }), /未知动作/);
  assert.throws(() => mapSalesOrderEventFromDb({
    id: event.id, order_id: row.id, action: 'ship', from_status: 'pending_shipment',
    to_status: 'shipping', details: {}, result: {}, created_at: event.createdAt,
  }), /未知状态/);
});
