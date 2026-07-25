// Photo upload for resident reports, via Vercel Blob (presigned-URL flow).
//
// The browser calls `uploadPresigned(...)` from '@vercel/blob/client' pointing
// here; this route mints a short-lived delegation scoped to one pathname and
// signs a presigned PUT, so the file streams straight to Blob storage (no
// serverless body-size limit). Anonymous like the rest of the resident path,
// but rate-limited and constrained to images with a size cap.
//
// Why presigned and not the older client-token flow: our Blob store is PRIVATE
// and connected over OIDC, so the project gets BLOB_STORE_ID +
// BLOB_WEBHOOK_PUBLIC_KEY and no static BLOB_READ_WRITE_TOKEN. `handleUpload`
// can't work here — it HMAC-signs the client token *with* the read-write token.
// `issueSignedToken` authenticates over OIDC (VERCEL_OIDC_TOKEN + store id),
// which is what this project actually has. A read-write token still works if
// one is ever set; the SDK prefers OIDC and falls back to it.
import { issueSignedToken } from '@vercel/blob';
import { handleUploadPresigned, type HandleUploadPresignedBody } from '@vercel/blob/client';
import { rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const MAX_BYTES = 15 * 1024 * 1024; // 15 MB — comfortably covers a phone photo
const UPLOAD_WINDOW_MS = 10 * 60 * 1000; // long enough for a slow phone upload
// The endpoint is anonymous, so the delegation is scoped to exactly what the
// resident path is allowed to write: an image under reports/.
const PATHNAME_RE = /^reports\/[A-Za-z0-9._-]{1,120}\.(jpe?g|png|webp|heic|heif)$/i;

function missingConfig(): string | null {
  if (!process.env.BLOB_STORE_ID && !process.env.BLOB_READ_WRITE_TOKEN) {
    return 'BLOB_STORE_ID (or BLOB_READ_WRITE_TOKEN)';
  }
  // handleUploadPresigned requires this even when no completion callback is used.
  if (!process.env.BLOB_WEBHOOK_PUBLIC_KEY) return 'BLOB_WEBHOOK_PUBLIC_KEY';
  return null;
}

export async function POST(req: Request): Promise<Response> {
  // Config check runs BEFORE the rate limit on purpose: the page re-asks this
  // route why an upload failed, and that follow-up lands inside the limiter's
  // min-gap. Answering "unconfigured" costs nothing and can't be abused.
  const missing = missingConfig();
  if (missing) {
    return Response.json(
      { error: `Photo storage isn’t configured yet (${missing} missing).` },
      { status: 503 },
    );
  }

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';
  const limit = rateLimit(ip);
  if (!limit.ok) return Response.json({ error: limit.reason }, { status: 429 });

  const body = (await req.json()) as HandleUploadPresignedBody;
  try {
    const result = await handleUploadPresigned({
      body,
      request: req,
      getSignedToken: async (pathname) => {
        if (!PATHNAME_RE.test(pathname)) {
          throw new Error('Only image files under reports/ can be uploaded.');
        }
        return {
          // Constraints live on the delegation — the control plane enforces
          // them on the write. urlOptions may only narrow these, never widen.
          token: await issueSignedToken({
            pathname,
            operations: ['put'],
            allowedContentTypes: IMAGE_TYPES,
            maximumSizeInBytes: MAX_BYTES,
            validUntil: Date.now() + UPLOAD_WINDOW_MS,
          }),
          urlOptions: { addRandomSuffix: true },
        };
      },
      // No completion callback: the report submission isn't wired yet, so
      // there's nothing to attach the blob to. When submit lands, this is
      // where the uploaded pathname gets recorded against the report.
    });
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
