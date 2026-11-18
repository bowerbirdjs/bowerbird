import type { AssetAdapter } from '@bowerbirdjs/editor';

const MAX_CHARS = 100_000; // the image component's src limit

/**
 * Demo asset adapter: shrinks the picked image and stores it inline as a data URI. A real product
 * would upload the file to its own storage or CDN and return that URL.
 */
export const demoAssets: AssetAdapter = {
  async upload(file) {
    if (!file.type.startsWith('image/')) throw new Error('Pick an image file.');
    const bitmap = await createImageBitmap(file);
    for (const max of [1200, 800, 500]) {
      const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
      const width = Math.round(bitmap.width * scale);
      const height = Math.round(bitmap.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height);
      const src = canvas.toDataURL('image/webp', 0.72);
      if (src.length <= MAX_CHARS)
        return {
          src,
          width,
          height,
          alt: file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' '),
        };
    }
    throw new Error('That image is too detailed for the demo (it stores images inline).');
  },
};
