import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { File } from 'node:buffer';
import {
  PRODUCT_IMAGE_MAX_SOURCE_BYTES,
  inspectProductImageBytes,
  inspectProductImageFile,
} from '../lib/productImagePipeline.ts';

const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('PNG inspection uses the file signature and preserves exact dimensions', () => {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 3024);
  view.setUint32(20, 4032);
  assert.deepEqual(inspectProductImageBytes(bytes), { type: 'image/png', width: 3024, height: 4032 });
});

test('JPEG inspection reads dimensions from a start-of-frame marker', () => {
  const bytes = new Uint8Array(21);
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x06, 0x40, 0x09, 0x60]);
  assert.deepEqual(inspectProductImageBytes(bytes), { type: 'image/jpeg', width: 2400, height: 1600 });
});

test('image inspection rejects renamed non-images and excessive pixel counts', () => {
  assert.throws(() => inspectProductImageBytes(new TextEncoder().encode('not really a jpeg')), /仅支持/);
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 9000);
  view.setUint32(20, 9000);
  assert.throws(() => inspectProductImageBytes(bytes), /像素过大/);
});

test('source files over 20 MB are rejected before decoding', async () => {
  const oversized = new File([new Uint8Array(PRODUCT_IMAGE_MAX_SOURCE_BYTES + 1)], 'large.jpg', { type: 'image/jpeg' });
  await assert.rejects(() => inspectProductImageFile(oversized as unknown as globalThis.File), /20 MB/);
});

test('photo drafts keep binary data in account-isolated IndexedDB instead of Preferences Base64', async () => {
  const [modal, drafts, accountSecurity] = await Promise.all([
    source('components/AddProductModal.tsx'),
    source('services/productPhotoDrafts.ts'),
    source('components/AccountSecurityModal.tsx'),
  ]);
  assert.doesNotMatch(modal, /readAsDataURL/);
  assert.match(modal, /saveProductPhotoDraft\(userId, photoDraftId, preparedFile\)/);
  assert.match(modal, /imageDataUrl:\s*undefined/);
  assert.match(modal, /draftHydratedRef\.current = false/);
  assert.match(modal, /!draftHydratedRef\.current/);
  assert.match(modal, /photoRequestIdRef\.current \+= 1/);
  assert.match(modal, /requestId !== photoRequestIdRef\.current/);
  assert.match(drafts, /draftKey = \(userId: string, draftId: string\) => `\$\{userId\}:\$\{draftId\}`/);
  assert.match(drafts, /record\.userId !== userId/);
  assert.match(accountSecurity, /deleteAllProductPhotoDraftData\(deletingUserId\)/);
  assert.match(accountSecurity, /clearProductImageCleanupQueue\(deletingUserId\)/);
});

test('uploads are immutable and cleanup fails closed around live product and activity references', async () => {
  const [app, storage, migration, limitsMigration] = await Promise.all([
    source('App.tsx'),
    source('services/storageImages.ts'),
    source('supabase/migrations/20260809150000_harden_image_storage.sql'),
    source('supabase/migrations/20260811033000_harden_product_image_upload_limits.sql'),
  ]);
  assert.match(storage, /SHA-256/);
  assert.match(storage, /upsert:\s*false/);
  assert.match(storage, /path\.startsWith\(`\$\{userId\}\//);
  assert.match(storage, /from\('products'\).*eq\('image_url', value\)/s);
  assert.match(storage, /from\('activities'\).*eq\('image_url', value\)/s);
  assert.match(storage, /if \(productsResult\.error\) throw/);
  assert.match(storage, /if \(activitiesResult\.error\) throw/);
  assert.match(app, /enqueueProductImageCleanup/);
  assert.match(app, /cleanupStartedForUser\.current !== session\.user\.id/);
  assert.match(app, /cleanupStartedForUser\.current = session\.user\.id/);
  assert.doesNotMatch(app, /removeProductImageRef\(/);
  assert.doesNotMatch(app, /upload\(path, file, \{ upsert: true \}\)/);
  assert.match(migration, /values \('product-images', 'product-images', false\)/);
  assert.match(migration, /auth\.uid\(\)::text = \(storage\.foldername\(name\)\)\[1\]/);
  assert.match(limitsMigration, /file_size_limit = 3145728/);
  assert.match(limitsMigration, /allowed_mime_types = array\['image\/jpeg'\]/);
  assert.match(limitsMigration, /drop policy if exists "Users can update their own product images"/);
});

test('an uncertain batch response keeps the stable draft operation and queues only conservative cleanup', async () => {
  const [modal, products, app] = await Promise.all([
    source('components/AddProductModal.tsx'),
    source('services/products.ts'),
    source('App.tsx'),
  ]);
  assert.match(modal, /const productId = initialData\?\.id \|\| productData\.id \|\| createDraftId\(\)/);
  assert.match(products, /p_batch_id: `manual-\$\{products\[0\]\?\.id/);
  assert.match(app, /uploadProductImage[\s\S]*enqueueProductImageCleanup[\s\S]*batchInboundProducts/);
  assert.match(app, /registerUploadedImageReceipt[\s\S]*removeProductImageRefIfUnreferenced[\s\S]*已停止本次保存/);
  assert.match(app, /catch \(batchError\)[\s\S]*enqueueProductImageCleanup[\s\S]*throw batchError/);
  assert.match(modal, /await onSave[\s\S]*deleteProductPhotoDraft[\s\S]*Preferences\.remove/);
});
