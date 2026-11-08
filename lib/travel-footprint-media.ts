import { hashToken } from './home-auth';

const ID = /^[a-zA-Z0-9_-]{1,100}$/;
const PHOTO_ID = /^[a-f0-9-]{36}$/;

export function travelPhotoUrl(id: string, photoId: string) {
  if (!ID.test(id) || !PHOTO_ID.test(photoId)) throw new Error('足迹照片编号无效。');
  return `/api/travel/footprints/${encodeURIComponent(id)}/photos/${photoId}`;
}

export async function travelPhotoKey(userId: string, id: string, photoId: string) {
  if (!ID.test(id) || !PHOTO_ID.test(photoId)) throw new Error('足迹照片编号无效。');
  return `travel/${await hashToken(userId)}/${id}/${photoId}`;
}

export function storedTravelPhotos(value: unknown): string[] {
  if (typeof value !== 'string') throw new Error('足迹照片数据无效。');
  let photos: unknown;
  try { photos = JSON.parse(value); }
  catch { throw new Error('足迹照片数据无效。'); }
  if (!Array.isArray(photos) || photos.some(photo => typeof photo !== 'string')) {
    throw new Error('足迹照片数据无效。');
  }
  return photos;
}
