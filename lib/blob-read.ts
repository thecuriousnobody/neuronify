// Reading a photo back out of the private Blob store.
//
// Uploads have always worked; nobody could ever LOOK at the result. The store is
// private, so its URLs 404 without a signature, and the only signing the codebase
// did was `operations: ['put']` for the upload itself. So a crew was required to
// collect a photo it could not open, and residents tracking a report saw a dash
// where their own photo should be (Blake 1.3 / 4.1).
//
// Both surfaces sign through here. Signatures are short-lived on purpose: a
// presigned URL is a bearer capability, so a leaked one should expire in minutes
// rather than persist in a browser history or a shared screenshot.

import { issueSignedToken, presignUrl } from '@vercel/blob';
import { attachmentPathname } from '@/engine';

/** How long a signed photo URL stays good. Long enough to load and glance at. */
export const PHOTO_URL_TTL_MS = 10 * 60 * 1000;

export function blobReadConfigured(): boolean {
  return Boolean(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);
}

/**
 * A temporary readable URL for one stored attachment, or null if it can't be
 * signed. Fails closed on every path: an unconfigured store, a URL that isn't
 * ours, or an SDK error all return null and the caller renders "unavailable"
 * rather than a broken image.
 */
export async function signedPhotoUrl(storedUrl: string): Promise<string | null> {
  if (!blobReadConfigured()) return null;

  const pathname = attachmentPathname(storedUrl, process.env.BLOB_STORE_ID);
  if (!pathname) return null;

  const validUntil = Date.now() + PHOTO_URL_TTL_MS;
  try {
    const token = await issueSignedToken({ pathname, operations: ['get'], validUntil });
    const { presignedUrl } = await presignUrl(token, {
      operation: 'get',
      pathname,
      access: 'private',
      validUntil,
    });
    return presignedUrl;
  } catch {
    // Expired OIDC, revoked store, deleted blob — none of it should take a page
    // down. The caller shows that the photo can't be opened right now.
    return null;
  }
}

/** Sign several attachments at once, dropping any that can't be signed. */
export async function signedPhotoUrls(storedUrls: string[]): Promise<string[]> {
  const signed = await Promise.all(storedUrls.map((u) => signedPhotoUrl(u)));
  return signed.filter((u): u is string => Boolean(u));
}
