// Photo upload for resident reports, via Vercel Blob (client-upload token flow).
//
// The browser calls `upload(...)` from '@vercel/blob/client' pointing here; this
// route mints a short-lived, scoped upload token so the file goes straight to
// Blob storage (no serverless body-size limit). Anonymous like the rest of the
// resident path, but rate-limited and constrained to images with a size cap.
//
// Requires a Blob store enabled on the project → BLOB_READ_WRITE_TOKEN in env.
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const MAX_BYTES = 15 * 1024 * 1024; // 15 MB — comfortably covers a phone photo

export async function POST(req: Request): Promise<Response> {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';
  const limit = rateLimit(ip);
  if (!limit.ok) return Response.json({ error: limit.reason }, { status: 429 });

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return Response.json(
      { error: 'Photo storage isn’t configured yet (BLOB_READ_WRITE_TOKEN missing).' },
      { status: 503 },
    );
  }

  const body = (await req.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: IMAGE_TYPES,
        maximumSizeInBytes: MAX_BYTES,
        addRandomSuffix: true,
      }),
      // Nothing to persist yet — the report submission isn't wired. When it is,
      // this is where we'd attach the blob URL to the pending submission.
      onUploadCompleted: async () => {},
    });
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
