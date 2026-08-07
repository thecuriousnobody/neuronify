// Which attachment URLs a submission may cite.
//
// Residents upload photos to the app's own Vercel Blob store (via
// /api/v2/upload); a submission then references the returned URL, and a
// department will open whatever URL the record carries. So the rule is
// strict: only URLs from OUR store are stored — anything else is rejected.
//
// The store issues URLs shaped
//   https://<store-id>.<access>.blob.vercel-storage.com/<pathname>
// where <access> is 'private' or 'public' (this is the SDK's own
// construction — see @vercel/blob's URL builder). When the store id is
// known we require it exactly; a hostname pattern alone would accept
// ANYONE's store, which is how a submission could smuggle in an
// attacker-controlled image. Without a store id (read-write-token setups,
// tests) we fall back to accepting only the official host shape.

import type { FormField, FieldValue } from '../domain/types';

const BLOB_HOST_SUFFIX = '.blob.vercel-storage.com';
const ACCESS_SEGMENTS = ['private', 'public'] as const;
const STORE_ID_RE = /^[a-z0-9-]+$/;

/** The env's BLOB_STORE_ID may carry a `store_` prefix; the SDK strips it
 *  before building the hostname, so we must normalize identically. */
function hostLabel(storeId: string): string {
  const id = storeId.toLowerCase();
  return id.startsWith('store_') ? id.slice('store_'.length) : id;
}

export function isAllowedAttachmentUrl(url: string, storeId?: string | null): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false; // not a URL at all (e.g. a blob: object URL, a bare path)
  }
  if (parsed.protocol !== 'https:') return false;

  const host = parsed.hostname.toLowerCase();
  const id = storeId ? hostLabel(storeId) : null;
  if (id) {
    return ACCESS_SEGMENTS.some((access) => host === `${id}.${access}${BLOB_HOST_SUFFIX}`);
  }

  // No store id to pin to — accept the official host shape only.
  if (!host.endsWith(BLOB_HOST_SUFFIX)) return false;
  const front = host.slice(0, -BLOB_HOST_SUFFIX.length);
  const parts = front.split('.');
  if (parts.length === 1) return STORE_ID_RE.test(parts[0]); // legacy <store>.blob… shape
  return (
    parts.length === 2 &&
    STORE_ID_RE.test(parts[0]) &&
    (ACCESS_SEGMENTS as readonly string[]).includes(parts[1])
  );
}

/**
 * The only object shape the resident path is allowed to write, and therefore the
 * only shape it is allowed to read back. Mirrors PATHNAME_RE in
 * /api/v2/upload — that route pins what may be PUT; this pins what may be
 * signed for GET. Slightly longer than the upload cap because the store appends
 * a random suffix to the name we asked for.
 *
 * Keep the two in step. A read allow-list looser than the write allow-list means
 * the store's authorization has quietly become "do you know the object key".
 */
const ATTACHMENT_PATHNAME_RE = /^reports\/[A-Za-z0-9._-]{1,180}\.(?:jpe?g|png|webp|heic|heif)$/i;

/**
 * The blob pathname an attachment URL points at, or null if we won't sign it.
 * Reading a private blob means presigning its pathname, and the only record of
 * that pathname is the stored URL.
 *
 * This is a SIGNING GATE, and it is strict in three ways on purpose:
 *
 *  - Host must be our store (`isAllowedAttachmentUrl`).
 *  - Pathname must match what our own upload route is willing to write. Without
 *    this, the host check alone let an anonymous caller name ANY key in the
 *    store — /api/v2/submit-anon takes attachmentIds from the request body, so
 *    the key that gets signed was attacker-chosen end to end.
 *  - The decoded pathname must not itself be a URL. `%2F%2F` and friends decode
 *    into `https://evil.example/x.png`, and the Blob SDK short-circuits its own
 *    store-URL construction for anything starting `http://` or `https://` — so a
 *    signed URL would point at someone else's host, turning both the desk
 *    redirect and the resident's page into an open redirect.
 */
export function attachmentPathname(url: string, storeId?: string | null): string | null {
  if (!isAllowedAttachmentUrl(url, storeId)) return null;
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(url).pathname).replace(/^\/+/, '');
  } catch {
    return null; // undecodable percent-escapes
  }
  if (!pathname) return null;
  // Belt and braces: the allow-list below already excludes these, but the SDK's
  // behaviour here is surprising enough to reject explicitly rather than rely on
  // a regex staying strict through future edits.
  if (/^https?:\/\//i.test(pathname)) return null;
  if (!ATTACHMENT_PATHNAME_RE.test(pathname)) return null;
  return pathname;
}

/** True when a stored attachment URL is one we would both keep and serve. */
export function isStorableAttachmentUrl(url: string, storeId?: string | null): boolean {
  return attachmentPathname(url, storeId) !== null;
}

/**
 * Required-field check for a submission.
 *
 * An attachment field is satisfied by an attachment OR by a nonempty string
 * value — the resident's recorded reason they can't provide a photo. That's
 * the conservative photo policy: a report is never blocked over a photo, but
 * skipping one always leaves a reason in the record for the crew to read.
 * Every other field type is satisfied by a nonempty value.
 *
 * Returns the labels of whatever is still missing.
 */
export function missingRequiredFields(fields: FormField[], values: FieldValue[]): string[] {
  const byKey = new Map(values.map((v) => [v.fieldKey, v]));
  return fields
    .filter((f) => {
      if (!f.required) return false;
      const v = byKey.get(f.key);
      if (!v) return true;
      if (f.type === 'attachment') {
        const hasReason = typeof v.value === 'string' && v.value.trim() !== '';
        return !((v.attachmentIds?.length ?? 0) > 0 || hasReason);
      }
      return v.value == null || v.value === '';
    })
    .map((f) => f.label);
}
