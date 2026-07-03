// Pending intakes — the resident inbox that sits BEFORE the staff confirm gate.
// App-side only (not the engine's append-only Record of Truth): a transcribed
// voice drop parks here until a staffer digests + confirms it into a real
// submission, at which point the row is deleted. See db/engine-schema.sql.

import { getSql } from '@/lib/db';

export interface PendingIntake {
  id: string;
  formKey: string;
  city: string;
  transcript: string;
  source: 'voice' | 'text';
  /** Optional SMS opt-in captured at the drop. */
  phone: string | null;
  createdAt: string;
}

type Row = Record<string, any>;

/** Park a transcribed drop for staff review. Returns the new id + receipt time. */
export async function createPending(input: {
  formKey: string;
  city: string;
  transcript: string;
  source?: 'voice' | 'text';
  phone?: string | null;
}): Promise<{ id: string; createdAt: string }> {
  const sql = getSql();
  const rows = (await sql`
    insert into nf_pending_intakes (form_key, city, transcript, source, phone)
    values (${input.formKey}, ${input.city}, ${input.transcript}, ${input.source ?? 'voice'}, ${input.phone ?? null})
    returning id, created_at
  `) as Row[];
  return { id: rows[0].id as string, createdAt: new Date(rows[0].created_at).toISOString() };
}

/** The staff review queue — oldest-waiting isn't prioritized; newest first. */
export async function listPending(): Promise<PendingIntake[]> {
  const sql = getSql();
  const rows = (await sql`
    select id, form_key, city, transcript, source, phone, created_at
    from nf_pending_intakes
    order by created_at desc
    limit 100
  `) as Row[];
  return rows.map(toPending);
}

export async function getPending(id: string): Promise<PendingIntake | null> {
  const sql = getSql();
  const rows = (await sql`
    select id, form_key, city, transcript, source, phone, created_at
    from nf_pending_intakes where id = ${id}
  `) as Row[];
  return rows[0] ? toPending(rows[0]) : null;
}

/** Remove a pending row — once promoted to a submission, or dismissed. */
export async function deletePending(id: string): Promise<void> {
  const sql = getSql();
  await sql`delete from nf_pending_intakes where id = ${id}`;
}

function toPending(r: Row): PendingIntake {
  return {
    id: r.id,
    formKey: r.form_key,
    city: r.city,
    transcript: r.transcript,
    source: r.source,
    phone: r.phone ?? null,
    createdAt: new Date(r.created_at).toISOString(),
  };
}
