import { augment } from '@/lib/augment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const transcript = String(body?.transcript ?? '').trim();
  const existingLanes: string[] = Array.isArray(body?.existingLanes) ? body.existingLanes : [];

  if (!transcript) {
    return Response.json({ error: 'transcript is required' }, { status: 400 });
  }
  if (transcript.length > 2000) {
    return Response.json({ error: 'transcript too long' }, { status: 400 });
  }

  try {
    const result = await augment(transcript, existingLanes);
    return Response.json(result);
  } catch (err: any) {
    return Response.json({ error: String(err?.message ?? err) }, { status: 500 });
  }
}
