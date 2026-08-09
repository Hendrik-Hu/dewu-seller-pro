import assert from 'node:assert/strict';
import test from 'node:test';
import { validateDataRepairInput } from '../lib/dataHealthValidation.ts';

test('blank repair quantity is never interpreted as zero', () => {
  assert.equal(
    validateDataRepairInput('products', '', '已核对实物', 'sold').error,
    '请填写核对后的实际库存',
  );
  assert.equal(
    validateDataRepairInput('products', '   ', '已核对实物', 'sold').error,
    '请填写核对后的实际库存',
  );
});

test('product repair requires an explicit status consistent with stock', () => {
  assert.equal(validateDataRepairInput('products', '1', '已核对实物').error, '请选择修正后的商品状态');
  assert.equal(validateDataRepairInput('products', '1', '已核对实物', 'sold').error, '库存大于 0 时不能选择已售罄');
  assert.equal(validateDataRepairInput('products', '0', '已核对实物', 'instock').error, '库存为 0 时状态必须为已售罄');
  assert.deepEqual(validateDataRepairInput('products', '2', '已核对实物', 'instock'), { value: 2 });
});

test('activity repair only accepts a positive integer and evidence', () => {
  assert.equal(validateDataRepairInput('activities', '0', '已核对流水').error, '流水数量必须是大于 0 的整数');
  assert.equal(validateDataRepairInput('activities', '2', '').error, '请填写核对依据');
  assert.deepEqual(validateDataRepairInput('activities', '2', '已核对流水'), { value: 2 });
});
