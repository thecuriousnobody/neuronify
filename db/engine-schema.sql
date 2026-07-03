-- Neuronify v2 (workflow engine) schema — Neon Postgres.
-- Run once: `npm run engine:db:setup`.
--
-- DELIBERATELY SEPARATE from v1 (db/schema.sql). All v2 tables are prefixed
-- `nf_` because v1 already owns the unprefixed `submissions`/`sessions` names.
-- v1 is left entirely untouched.
--
-- Design: the audit log (nf_audit_events) is the SOURCE OF TRUTH. The live
-- workflow state is never stored — it is re-derived from the log on read
-- (engine `deriveInstance`). Re-submits APPEND events; nothing is ever updated
-- or deleted. There is intentionally no nf_workflow_instances table.

-- Form & workflow definitions, versioned. The whole engine object is stored as
-- a JSONB doc so the definition can evolve without a migration; (key, version)
-- is the natural key, latest version wins when a caller omits the version.
create table if not exists nf_form_definitions (
  key         text not null,
  version     integer not null,
  doc         jsonb not null,
  created_at  timestamptz not null default now(),
  primary key (key, version)
);

create table if not exists nf_workflow_definitions (
  key         text not null,
  version     integer not null,
  doc         jsonb not null,
  created_at  timestamptz not null default now(),
  primary key (key, version)
);

-- The Record of Truth root. Created at the human verify-and-submit moment.
-- `id` is supplied by the engine (UUID); `values` is the materialized latest
-- field state — the authoritative history lives in the audit log.
create table if not exists nf_submissions (
  id            uuid primary key,
  form_key      text not null,
  form_version  integer not null,
  city          text not null,
  source        text not null,                 -- 'voice' | 'text'
  submitted_at  timestamptz not null,
  values        jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now()
);

-- Append-only audit ledger — the spine. `seq` gives a total insertion order
-- (the order the engine emitted events), which is the order deriveInstance
-- replays them in. `actor_side` is what timing uses to split external/internal.
create table if not exists nf_audit_events (
  seq                  bigserial primary key,
  id                   text not null unique,    -- engine-generated event id
  submission_id        uuid not null references nf_submissions(id) on delete cascade,
  workflow_instance_id text,
  type                 text not null,
  actor                text not null,
  actor_side           text not null,           -- 'external' | 'internal' | 'system'
  at                   timestamptz not null,
  payload              jsonb not null default '{}'::jsonb
);

create index if not exists nf_audit_events_submission_idx
  on nf_audit_events (submission_id, seq);

-- Communications outbox (the relay). The engine emits intents; the Notifier
-- adapter writes them here; a delivery worker (Phase 4) drains undelivered rows.
-- Decoupling emission from delivery keeps "tracking/relaying, never doing".
create table if not exists nf_communications (
  id            uuid primary key default gen_random_uuid(),
  submission_id uuid not null references nf_submissions(id) on delete cascade,
  reason        text not null,
  message       text not null,
  created_at    timestamptz not null default now(),
  delivered_at  timestamptz
);

create index if not exists nf_communications_undelivered_idx
  on nf_communications (created_at) where delivered_at is null;

-- Pending intakes — the resident's inbox BEFORE the staff confirm gate. A voice
-- drop is transcribed and parked here; a staffer reviews it on /desk/intake,
-- digests + confirms, and only THEN does it become a submission with a workflow.
-- Deliberately app-side (not the engine's Record of Truth): nothing here is
-- audited yet. Deleted once promoted to a submission (or dismissed).
create table if not exists nf_pending_intakes (
  id          uuid primary key default gen_random_uuid(),
  form_key    text not null,
  city        text not null,
  transcript  text not null,
  source      text not null default 'voice',      -- 'voice' | 'text'
  created_at  timestamptz not null default now()
);

create index if not exists nf_pending_intakes_created_idx
  on nf_pending_intakes (created_at desc);

-- Staff feedback on the agent's work (thumbs on the composed workflow, etc.).
-- The tuning signal: real staff judgments about compositions, kept with enough
-- context (the proposal snapshot) to learn from later.
create table if not exists nf_agent_feedback (
  id          uuid primary key default gen_random_uuid(),
  surface     text not null,                    -- e.g. 'composed_workflow'
  verdict     text not null,                    -- 'up' | 'down'
  department  text,                             -- which staffer's desk voted
  context     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- ── Beta layer (interim — replace when the real identity/auth system lands) ──
-- Who is trying the app. Captured at Google sign-in (auth.ts). DELIBERATELY
-- separate from nf_submissions so the Record of Truth stays anonymous: identity
-- lives here, the public record never carries PII.
create table if not exists nf_beta_testers (
  email       text primary key,
  name        text,
  image       text,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);

-- Links a submission to the beta tester who filed it — beta-only visibility
-- ("who filed what"). Drop this table to restore full anonymity post-beta.
create table if not exists nf_beta_submissions (
  submission_id uuid primary key references nf_submissions(id) on delete cascade,
  email         text not null references nf_beta_testers(email),
  created_at    timestamptz not null default now()
);

create index if not exists nf_beta_submissions_email_idx
  on nf_beta_submissions (email, created_at desc);
