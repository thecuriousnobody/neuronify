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
