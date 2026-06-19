// Public form definition — the client renders the verify panel from this.
import { engineEnv } from '@/lib/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { formKey: string } }) {
  const form = await engineEnv().repo.getFormDefinition(params.formKey);
  if (!form) return Response.json({ error: 'Unknown form.' }, { status: 404 });
  return Response.json({
    key: form.key,
    title: form.title,
    city: form.city,
    version: form.version,
    fields: form.fields,
  });
}
