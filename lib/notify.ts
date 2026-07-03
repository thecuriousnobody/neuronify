// The delivery worker: drain undelivered outbox rows for a submission and send
// them. SMS via Twilio when TWILIO_* env is set; otherwise a console stub logs
// exactly what WOULD have been sent (demo-honest — the cadence is visible in the
// dev log). Called fire-and-forget after every engine action that emits comms
// (confirm, desk decide, resubmit) — serverless-friendly, no cron needed.
//
// Destinations:
//   recipient 'submitter'          → nf_submission_contacts.phone (SMS opt-in)
//   recipient 'department:<key>'   → DESK_CONTACTS env ("dept:+1555...,dept2:+1555...")
// A row with no reachable destination is marked delivered with channel 'none'
// so it never re-logs; the outbox row itself remains the audit record.

import { getSql } from '@/lib/db';

const TRACK_REASONS = new Set(['submitted', 'step_completed', 'requires_resubmit', 'denied', 'completed']);

function deskContacts(): Map<string, string> {
  const m = new Map<string, string>();
  for (const pair of (process.env.DESK_CONTACTS || '').split(',')) {
    const i = pair.indexOf(':');
    if (i === -1) continue;
    const dept = pair.slice(0, i).trim();
    const dest = pair.slice(i + 1).trim();
    if (dept && dest) m.set(dept, dest);
  }
  return m;
}

async function sendSms(to: string, body: string): Promise<'twilio_sms' | null> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (!sid || !token || !from) return null;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });
  if (!res.ok) {
    console.error('[relay] twilio error', res.status, await res.text().catch(() => ''));
    return null;
  }
  return 'twilio_sms';
}

/** Drain and deliver every undelivered communication for one submission. */
export async function drainOutbox(submissionId: string): Promise<void> {
  const sql = getSql();
  const rows = (await sql`
    select id, reason, message, recipient from nf_communications
    where submission_id = ${submissionId} and delivered_at is null
    order by created_at asc
  `) as Record<string, any>[];
  if (rows.length === 0) return;

  const base = process.env.APP_BASE_URL || 'http://localhost:3000';
  const contactRows = (await sql`
    select phone from nf_submission_contacts where submission_id = ${submissionId}
  `) as Record<string, any>[];
  const residentPhone: string | null = contactRows[0]?.phone ?? null;
  const desks = deskContacts();

  for (const row of rows) {
    const isResident = row.recipient === 'submitter';
    const dept = isResident ? null : String(row.recipient).replace(/^department:/, '');
    const dest = isResident ? residentPhone : (dept ? desks.get(dept) ?? null : null);
    const link = isResident
      ? (TRACK_REASONS.has(row.reason) ? ` Track: ${base}/track/${submissionId}` : '')
      : ` Desk: ${base}/desk`;
    const body = `${row.message}${link}`;

    let channel: string = 'none';
    if (dest) {
      channel = (await sendSms(dest, body)) ?? 'log';
      if (channel === 'log') console.log(`[relay:${row.recipient}→${dest}] ${body}`);
    } else {
      console.log(`[relay:${row.recipient}→(no contact)] ${body}`);
    }
    await sql`update nf_communications set delivered_at = now(), channel = ${channel} where id = ${row.id}`;
  }
}
