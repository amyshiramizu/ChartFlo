// Clinic logo/favicon storage backed by the private S3 bucket.
// Actions: { action: 'upload', path, contentType, base64 } -> { path }
//          { action: 'sign', path, expiresIn }             -> { signedUrl }
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const BUCKET = 'chartflo-clinic-logos-557485610536';
const s3 = new S3Client({ region: 'us-east-2' });

const SAFE_PATH = /^[a-zA-Z0-9/_.-]+$/;

export default async function handler(body, ctx) {
  const { action, path } = body || {};
  if (!path || !SAFE_PATH.test(path) || path.includes('..')) {
    return ctx.json(400, { error: 'Invalid path' });
  }

  if (action === 'upload') {
    const { base64, contentType } = body;
    if (!base64) return ctx.json(400, { error: 'No file content' });
    const buf = Buffer.from(base64, 'base64');
    if (buf.length > 2 * 1024 * 1024) return ctx.json(400, { error: 'File too large (2 MB max)' });
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET, Key: path, Body: buf,
      ContentType: contentType || 'application/octet-stream',
      CacheControl: 'max-age=3600',
    }));
    return ctx.json(200, { path });
  }

  if (action === 'sign') {
    const expiresIn = Math.min(Math.max(parseInt(body.expiresIn) || 3600, 60), 60 * 60 * 24 * 7);
    const signedUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: path }), { expiresIn });
    return ctx.json(200, { signedUrl });
  }

  return ctx.json(400, { error: 'Unknown action' });
}
