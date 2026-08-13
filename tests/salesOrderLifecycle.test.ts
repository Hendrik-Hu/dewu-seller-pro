import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getSalesOrderTodoGroup,
  getSalesOrderTransitions,
  isSalesOrderTerminal,
  resolveSalesOrderTransition,
} from '../lib/salesOrderLifecycle.ts';

test('sale order keeps inventory reservation separate from outbound ledger creation', () => {
  const pendingActions = getSalesOrderTransitions('pending_shipment');
  assert.deepEqual(pendingActions.map((item) => item.action), ['ship', 'cancel']);
  assert.equal(resolveSalesOrderTransition('pending_shipment', 'ship').inventoryEffect, 'write_outbound');
  assert.equal(resolveSalesOrderTransition('pending_shipment', 'cancel').inventoryEffect, 'restore_inventory');
});

test('authentication failure must pass through return before inventory is restored', () => {
  assert.equal(resolveSalesOrderTransition('authenticating', 'fail_authentication').to, 'auth_failed');
  assert.equal(resolveSalesOrderTransition('auth_failed', 'start_return').to, 'returning');
  assert.equal(resolveSalesOrderTransition('returning', 'confirm_return').inventoryEffect, 'restore_inventory');
  assert.throws(() => resolveSalesOrderTransition('auth_failed', 'confirm_return'), /不能执行/);
});

test('restored inventory cannot be restored twice', () => {
  assert.deepEqual(getSalesOrderTransitions('returning', { inventoryRestored: true }), []);
  assert.throws(() => resolveSalesOrderTransition('returning', 'confirm_return', { inventoryRestored: true }), /不能执行/);
});

test('refund completion requires an actual settlement', () => {
  assert.deepEqual(getSalesOrderTransitions('returned', { hasSettlement: false }), []);
  assert.equal(resolveSalesOrderTransition('returned', 'complete_refund', { hasSettlement: true }).to, 'refunded');
  assert.equal(isSalesOrderTerminal('returned', false), true);
  assert.equal(isSalesOrderTerminal('returned', true), false);
});

test('order todos use seller-facing fulfillment groups', () => {
  assert.equal(getSalesOrderTodoGroup('pending_shipment'), 'shipment');
  assert.equal(getSalesOrderTodoGroup('authenticating'), 'authentication');
  assert.equal(getSalesOrderTodoGroup('authenticated'), 'settlement');
  assert.equal(getSalesOrderTodoGroup('returning'), 'exception');
  assert.equal(getSalesOrderTodoGroup('settled'), 'done');
});
