// Anonymous structured submit — the route-direct end of the smart-intake flow.
//
// This is the moment the Record of Truth begins for a resident report, with NO
// sign-in and NO staff confirm gate: the conversation (/api/v2/converse) has
// already vetted the report against its category's schema, so it goes straight
// into the owning department's queue.
//
// Why not the existing routes:
//   /api/v2/submit  — sign-in gated (beta), and takes a formKey the resident
//                     has no way to know.
//   /api/v2/report  — anonymous, but transcript-only: it parks a PENDING intake
//                     for a staffer to digest, and drops every structured field
//                     the conversation just worked to collect.
//
// The client sends a CATEGORY, not a formKey — the taxonomy owns the mapping
// from category to form to owning department, so a client can't route its own
// report by naming a form. Required fields are re-validated here, including
// attachments: the photo-critical categories mean it.

import { engineEnv } from '@/lib/engine';
import {
  submitForm,
  formForCategory,
  resolveCategory,
  departmentFor,
  departmentFlowKey,
  isAllowedAttachmentUrl,
  missingRequiredFields,
  TEMPLATE_FORM_CITY,
  type FieldValue,
} from '@/engine';
import { configuredDepartments } from '@/lib/desk-auth';
import { rateLimit } from '@/lib/ratelimit';
import { resolveCity } from '@/lib/cities';
import { errorResponse } from '@/lib/engine/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Free-form text can't be unbounded — this is an anonymous, public endpoint. */
const MAX_TEXT = 4000;
const MAX_VALUES = 40;

export async function POST(req: Request) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';
  const limit = rateLimit(ip, 'submit');
  if (!limit.ok) return Response.json({ error: limit.reason }, { status: 429 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // The taxonomy resolves the category — a bad/unknown key fails closed onto
  // other_inquiry rather than letting the caller pick an arbitrary form.
  const rawCategory = String(body?.category ?? '').trim();
  if (!rawCategory) return Response.json({ error: 'Missing category.' }, { status: 400 });
  const category = resolveCategory(rawCategory);
  const form = formForCategory(category);

  const source = body?.source === 'text' ? 'text' : 'voice';
  const rawValues = Array.isArray(body?.values) ? body.values.slice(0, MAX_VALUES) : [];

  const known = new Map(form.fields.map((f) => [f.key, f]));
  const values: FieldValue[] = [];
  for (const v of rawValues) {
    if (!v || typeof v.fieldKey !== 'string') continue;
    const field = known.get(v.fieldKey);
    if (!field) continue; // ignore anything not on this category's form

    let value = v.value ?? null;
    if (typeof value === 'string') {
      if (value.length > MAX_TEXT)
        return Response.json(
          { error: `“${field.label}” is too long — keep it under ${MAX_TEXT} characters.` },
          { status: 400 },
        );
      value = value.trim();
    }

    const out: FieldValue = { fieldKey: field.key, value };

    // Attachments arrive as Blob URLs the client already uploaded via
    // /api/v2/upload. Only URLs pinned to OUR store are stored — and a
    // rejection is a loud 400, never a silent drop: silently discarding the
    // photo here made a fully-attached report fail as "Still missing: A
    // photo", which is undiagnosable from the client's side.
    if (field.type === 'attachment') {
      const supplied: string[] = (Array.isArray(v.attachmentIds) ? v.attachmentIds : []).filter(
        (u: any): u is string => typeof u === 'string',
      );
      const urls = supplied
        .filter((u) => isAllowedAttachmentUrl(u, process.env.BLOB_STORE_ID))
        .slice(0, 5);
      if (supplied.length && !urls.length) {
        return Response.json(
          { error: `The photo for “${field.label}” couldn’t be verified — please re-attach it.` },
          { status: 400 },
        );
      }
      if (urls.length) {
        out.attachmentIds = urls;
        out.value = null; // the URL lives in attachmentIds, not the value
      }
      // No attachment: a string value is the resident's recorded reason they
      // can't provide a photo (the escape hatch) — keep it for the crew.
    }

    if (field.type === 'location' && v.geo && typeof v.geo === 'object') {
      const lat = Number(v.geo.lat);
      const lon = Number(v.geo.lon);
      const matched = String(v.geo.matched ?? '').slice(0, 300);
      if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        out.geo = { lat, lon, matched };
      }
    }

    values.push(out);
  }

  // Re-validate server-side — never trust the client's sense of "ready".
  // (A required attachment is satisfied by a photo OR a recorded reason the
  // resident can't provide one — see missingRequiredFields.)
  const missing = missingRequiredFields(form.fields, values);
  if (missing.length) {
    return Response.json({ error: `Still missing: ${missing.join(', ')}` }, { status: 400 });
  }

  const city = resolveCity(body?.city ?? TEMPLATE_FORM_CITY);
  const canonical = departmentFor(city.db, category);

  // Reconcile the canonical owner against the desks that can actually be signed
  // into. Routing to an unstaffed department opens a workflow nobody can reach:
  // the report persists and notifies, then goes silent forever. Same rule the
  // digest path already applies (see classify's `departments` option) — hand it
  // to a staffed desk so a human receives it and can reassign.
  const staffed = configuredDepartments();
  const reachable = staffed.length === 0 || staffed.includes(canonical);
  const department = reachable ? canonical : staffed[0];
  if (!reachable) {
    console.error(
      `[submit-anon] "${category}" is owned by "${canonical}", which has no desk in DESK_PASSCODES. ` +
        `Routing to "${department}" for reassignment. Add "${canonical}:<passcode>" to route it straight through.`,
    );
  }

  try {
    const result = await submitForm(engineEnv(), {
      formKey: form.key,
      city: city.db,
      source,
      values,
      // The form is authored against the canonical owner; if that desk isn't
      // staffed, run the reachable department's flow instead.
      ...(reachable ? {} : { workflowKey: departmentFlowKey(department as any) }),
    });
    return Response.json({ ...result, category, department, canonicalDepartment: canonical });
  } catch (err) {
    return errorResponse(err);
  }
}
