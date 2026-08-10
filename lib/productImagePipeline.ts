export const PRODUCT_IMAGE_MAX_SOURCE_BYTES = 20 * 1024 * 1024;
export const PRODUCT_IMAGE_MAX_PIXELS = 32_000_000;
export const PRODUCT_IMAGE_MAX_DIMENSION = 2048;
export const PRODUCT_IMAGE_MAX_OUTPUT_BYTES = 3 * 1024 * 1024;

export type SupportedProductImageType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface ProductImageInfo {
  type: SupportedProductImageType;
  width: number;
  height: number;
}

const readUint24LE = (bytes: Uint8Array, offset: number) =>
  bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);

const parseJpegDimensions = (bytes: Uint8Array) => {
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    if (marker === 0xda) break;
    const segmentLength = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (segmentLength < 2 || offset + 2 + segmentLength > bytes.length) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return {
        height: (bytes[offset + 5] << 8) | bytes[offset + 6],
        width: (bytes[offset + 7] << 8) | bytes[offset + 8],
      };
    }
    offset += 2 + segmentLength;
  }
  return null;
};

export const inspectProductImageBytes = (bytes: Uint8Array): ProductImageInfo => {
  let type: SupportedProductImageType;
  let dimensions: { width: number; height: number } | null = null;

  if (bytes.length >= 24 && bytes.slice(0, 8).every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index])) {
    type = 'image/png';
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    dimensions = { width: view.getUint32(16), height: view.getUint32(20) };
  } else if (bytes.length >= 10 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    type = 'image/jpeg';
    dimensions = parseJpegDimensions(bytes);
  } else if (
    bytes.length >= 30
    && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  ) {
    type = 'image/webp';
    const chunk = String.fromCharCode(...bytes.slice(12, 16));
    if (chunk === 'VP8X') {
      dimensions = { width: 1 + readUint24LE(bytes, 24), height: 1 + readUint24LE(bytes, 27) };
    } else if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
      dimensions = { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    } else if (chunk === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      dimensions = {
        width: (bytes[26] | (bytes[27] << 8)) & 0x3fff,
        height: (bytes[28] | (bytes[29] << 8)) & 0x3fff,
      };
    }
  } else {
    throw new Error('仅支持 JPEG、PNG 或 WebP 商品图片');
  }

  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
    throw new Error('无法识别图片尺寸，请换一张照片');
  }
  if (dimensions.width * dimensions.height > PRODUCT_IMAGE_MAX_PIXELS) {
    throw new Error('图片像素过大，请选择不超过 3200 万像素的照片');
  }
  return { type, ...dimensions };
};

export const inspectProductImageFile = async (file: File): Promise<ProductImageInfo> => {
  if (file.size <= 0) throw new Error('图片文件为空');
  if (file.size > PRODUCT_IMAGE_MAX_SOURCE_BYTES) throw new Error('原图不能超过 20 MB');
  const header = new Uint8Array(await file.slice(0, Math.min(file.size, 512 * 1024)).arrayBuffer());
  return inspectProductImageBytes(header);
};

const canvasToBlob = (canvas: HTMLCanvasElement, quality: number) => new Promise<Blob>((resolve, reject) => {
  canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('图片压缩失败')), 'image/jpeg', quality);
});

export const prepareProductImage = async (file: File): Promise<File> => {
  const info = await inspectProductImageFile(file);
  if (typeof createImageBitmap !== 'function') throw new Error('当前设备不支持安全图片处理');
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const scale = Math.min(1, PRODUCT_IMAGE_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    if (width * height > PRODUCT_IMAGE_MAX_PIXELS || info.width * info.height > PRODUCT_IMAGE_MAX_PIXELS) {
      throw new Error('图片像素过大');
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('当前设备无法处理图片');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    let blob = await canvasToBlob(canvas, 0.84);
    if (blob.size > PRODUCT_IMAGE_MAX_OUTPUT_BYTES) blob = await canvasToBlob(canvas, 0.7);
    if (blob.size > PRODUCT_IMAGE_MAX_OUTPUT_BYTES) throw new Error('压缩后图片仍超过 3 MB，请换一张照片');
    const baseName = (file.name.replace(/\.[^.]+$/, '') || 'product').slice(0, 80);
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  } finally {
    bitmap.close();
  }
};
