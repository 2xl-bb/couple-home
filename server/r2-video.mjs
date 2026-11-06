import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const ACCOUNT = /^[a-f0-9]{32}$/;
const CREDENTIAL = /^[A-Za-z0-9_-]{16,128}$/;
const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const VIDEO_KEY = /^videos\/[a-f0-9]{64}\/[a-f0-9-]{36}$/;
const VIDEO_TYPE = /^video\/(?:mp4|webm|quicktime)$/;

function validateKey(key) {
  if (typeof key !== 'string' || !VIDEO_KEY.test(key)) throw new Error('无效的视频存储键');
  return key;
}

function validateType(value) {
  const type = typeof value === 'string' ? value.toLowerCase() : '';
  if (!VIDEO_TYPE.test(type)) throw new Error('只支持 MP4、WebM 或 MOV 视频');
  return type;
}

export function createR2VideoStore({ accountId, accessKeyId, secretAccessKey, bucket, client, signer = getSignedUrl } = {}) {
  if (!ACCOUNT.test(accountId || '') || !CREDENTIAL.test(accessKeyId || '') ||
      typeof secretAccessKey !== 'string' || secretAccessKey.length < 32 || !BUCKET.test(bucket || '')) {
    throw new Error('R2 配置无效');
  }
  const s3 = client || new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
  const browserOrigin = `https://${accountId}.r2.cloudflarestorage.com`;
  return {
    browserOrigin,
    async health() { await s3.send(new HeadBucketCommand({ Bucket: bucket })); },
    async createUpload({ key, contentType, sizeBytes, expiresIn = 600 }) {
      validateKey(key); const type = validateType(contentType);
      if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > 500 * 1024 * 1024) {
        throw new Error('视频大小必须在 1 字节到 500 MB 之间');
      }
      const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: type, ContentLength: sizeBytes });
      return signer(s3, command, { expiresIn, signableHeaders: new Set(['content-type']) });
    },
    async complete({ key, contentType, sizeBytes }) {
      validateKey(key); const expectedType = validateType(contentType);
      const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      const actualType = String(head.ContentType || '').split(';', 1)[0].toLowerCase();
      if (Number(head.ContentLength) !== sizeBytes || actualType !== expectedType) {
        throw new Error('R2 中的视频大小或类型与上传申请不一致');
      }
      return { etag: typeof head.ETag === 'string' ? head.ETag.replaceAll('"', '') : '' };
    },
    async createDownload({ key, expiresIn = 120 }) {
      validateKey(key);
      return signer(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn });
    },
    async delete(key) {
      validateKey(key);
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    async close() { s3.destroy?.(); },
  };
}
