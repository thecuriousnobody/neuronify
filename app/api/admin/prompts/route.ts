import { NextResponse } from 'next/server';
import { isAuthedAdmin, adminActor } from '@/lib/requireAdmin';
import { getAllPrompts, setPrompt, resetPrompt, isValidPromptKey } from '@/lib/prompts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX = 20000;

export async function GET() {
  if (!(await isAuthedAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ prompts: await getAllPrompts() });
}

export async function POST(req: Request) {
  if (!(await isAuthedAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const key = String(body?.key ?? '');
  if (!isValidPromptKey(key)) return NextResponse.json({ error: 'Unknown prompt' }, { status: 400 });

  if (body?.reset === true) {
    await resetPrompt(key);
    return NextResponse.json({ ok: true, reset: true });
  }

  const content = String(body?.content ?? '');
  if (!content.trim()) return NextResponse.json({ error: 'Prompt cannot be empty' }, { status: 400 });
  if (content.length > MAX) {
    return NextResponse.json({ error: `Keep it under ${MAX} characters` }, { status: 400 });
  }

  await setPrompt(key, content, await adminActor());
  return NextResponse.json({ ok: true });
}
