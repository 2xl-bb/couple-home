import { copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export async function vendorExifr() {
  const source=fileURLToPath(new URL('../node_modules/exifr/dist/lite.umd.js',import.meta.url));
  const target=fileURLToPath(new URL('../public/exifr.js',import.meta.url));
  await copyFile(source,target);
}
