import assert from 'node:assert/strict';
import test from 'node:test';

import { getFeeQuotePresentation } from '../lib/feeQuotePresentation.ts';

test('an unconfigured quote is unknown only without a manual fee', () => {
  assert.deepEqual(getFeeQuotePresentation(false, false), {
    source: 'unknown',
    message: '未选择费用方案且未填写手动费用，平台费用、到手与净利润保持未知。',
  });
});

test('a manual fee is explicit even when no scheme is selected', () => {
  const presentation = getFeeQuotePresentation(false, true);

  assert.equal(presentation.source, 'manual');
  assert.equal(presentation.message, '本次按手动总费用估算。');
  assert.doesNotMatch(presentation.message, /未知/);
});

test('a manual fee takes precedence over the selected scheme', () => {
  assert.equal(getFeeQuotePresentation(true, true).source, 'manual');
  assert.equal(getFeeQuotePresentation(true, false).source, 'scheme');
});
