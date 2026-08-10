import { inspectProductImageFile } from './productImagePipeline.ts';

export const AVATAR_MAX_SOURCE_BYTES = 10 * 1024 * 1024;
export const AVATAR_MAX_DIMENSION = 512;
export const AVATAR_MAX_OUTPUT_BYTES = 512 * 1024;

const canvasToJpeg = (canvas: HTMLCanvasElement, quality: number) => new Promise<Blob>((resolve, reject) => {
  canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('头像压缩失败')), 'image/jpeg', quality);
});

export const prepareAvatarImage = async (file: File): Promise<File> => {
  if (file.size > AVATAR_MAX_SOURCE_BYTES) throw new Error('头像原图不能超过 10 MB');
  await inspectProductImageFile(file);
  if (typeof createImageBitmap !== 'function') throw new Error('当前设备不支持安全头像处理');
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const scale = Math.min(1, AVATAR_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('当前设备无法处理头像');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    let blob = await canvasToJpeg(canvas, 0.82);
    if (blob.size > AVATAR_MAX_OUTPUT_BYTES) blob = await canvasToJpeg(canvas, 0.65);
    if (blob.size > AVATAR_MAX_OUTPUT_BYTES) throw new Error('压缩后头像仍超过 512 KB，请换一张图片');
    return new File([blob], 'avatar.jpg', { type: 'image/jpeg', lastModified: Date.now() });
  } finally {
    bitmap.close();
  }
};
