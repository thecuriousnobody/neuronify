-- Neuronify schema — Neon Postgres.
-- Run once: `npm run db:setup` (reads DATABASE_URL), or paste into the Neon SQL editor.
--
-- Privacy: submissions are anonymous. raw_text holds exactly what the resident
-- said. We never store names, emails, or phone numbers.
--
-- Note: category/severity are plain text (no CHECK constraint) on purpose —
-- the community edits the category list live in the prompt on demo day, and a
-- hard DB constraint would reject a freshly-coined category.

create table if not exists sessions (
  id          uuid primary key default gen_random_uuid(),
  city        text not null default 'Peoria, IL',
  label       text,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz
);

create table if not exists submissions (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid not null references sessions(id) on delete cascade,
  created_at          timestamptz not null default now(),
  source              text not null default 'text',   -- 'voice' | 'text'
  raw_text            text not null,
  status              text not null default 'pending', -- 'pending' | 'triaged' | 'error'

  -- Agent A (triage) output, written back onto the row:
  summary             text,
  category            text,
  severity            text,
  intervention        text,
  cost_low_usd        integer,
  cost_high_usd       integer,
  cost_basis          text,
  actionable_by_city  boolean,
  referral            text,
  confidence          text,
  needs_more_info     text,
  error               text
);

create index if not exists submissions_session_created_idx
  on submissions (session_id, created_at desc);

create index if not exists sessions_open_idx
  on sessions (started_at desc) where ended_at is null;

-- Early-access waitlist. This is OPT-IN contact info a person volunteers via
-- the landing "Request access" form — distinct from the anonymous civic
-- submissions above. Email is stored lowercased and unique so re-submits are safe.
create table if not exists access_requests (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  created_at  timestamptz not null default now(),
  source      text,
  note        text
);

-- Editable agent system prompts. A row here OVERRIDES the code default for that
-- agent; no row means the code default is used. Edits take effect on the next
-- agent run. This is the live-editable surface for demo day.
create table if not exists agent_prompts (
  key         text primary key,
  content     text not null,
  updated_at  timestamptz not null default now(),
  updated_by  text
);
