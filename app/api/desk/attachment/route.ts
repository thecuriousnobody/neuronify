// Serves a resident's photo to a signed-in desk.
//
// Redirects to a short-lived presigned URL rather than returning it as JSON, so
// the desk page can point an <img> straight here and the capability never sits
// in page JavaScript or the browser's history.
//
// The caller names a submission and an index — never a URL. The photo's address
// is read out of the stored record, so a signed-in desk cannot use this route to
// sign an arbitrary object in the store by asking for it.
import { currentDepartment } from '@/lib/desk-auth';
import { deskSubmissionDetail } from '@/engine';
import { engineEnv } from '@/lib/engine';
import { signedPhotoUrl } from '@/lib/blob-read';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const department = currentDepartment();
  if (!department) return Response.json({ error: 'Not signed in.' }, { status: 401 });

  const url = new URL(req.url);
  const submissionId = url.searchParams.get('submissionId') ?? '';
  const fieldKey = url.searchParams.get('field') ?? '';
  const index = Number(url.searchParams.get('i') ?? '0');
  if (!submissionId || !fieldKey || !Number.isInteger(index) || index < 0) {
    return Response.json({ error: 'Bad request.' }, { status: 400 });
  }

  const detail = await deskSubmissionDetail(engineEnv(), department, submissionId);
  if (!detail) return Response.json({ error: 'Not found.' }, { status: 404 });

  const stored = detail.values.find((v) => v.fieldKey === fieldKey)?.attachmentIds?.[index];
  if (!stored) return Response.json({ error: 'No such attachment.' }, { status: 404 });

  const signed = await signedPhotoUrl(stored);
  if (!signed) return Response.json({ error: 'Photo storage is unavailable.' }, { status: 503 });

  // 302, and never cached: the target expires, so a cached redirect would send
  // staff to a dead URL long after this response was fresh.
  return new Response(null, {
    status: 302,
    headers: { location: signed, 'cache-control': 'no-store' },
  });
}
