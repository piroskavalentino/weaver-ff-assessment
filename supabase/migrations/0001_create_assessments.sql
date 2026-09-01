-- Weaver Upstream Field-to-Finance Maturity Assessment — Nashville / Enertia 2026
-- One table. Records are created with status = in_progress at role selection
-- (via the assessment-api Edge Function's /start route) so an abandoned
-- assessment is visible and a tablet crash loses nothing centrally, even
-- though the respondent never sees this — the booth device already has its
-- own full local copy regardless of what Supabase says.

create table if not exists public.assessments (
  id                  uuid primary key default gen_random_uuid(),
  response_id         text not null,
  instance_id         text,
  event_id            text not null,
  content_version     text not null,
  app_version         text,
  status              text not null default 'in_progress'
                        constraint assessments_status_check check (status in ('in_progress','completed')),
  role                text,
  perception          boolean not null default false,
  profile             jsonb not null default '{}'::jsonb,
  answers             jsonb not null default '{}'::jsonb,
  contact_name        text,
  contact_company     text,
  contact_email       text,
  raffle_eligible     boolean not null default false,
  result_snapshot     jsonb,
  write_token_hash    text not null,
  follow_up_owner     text
                        constraint assessments_follow_up_owner_check check (follow_up_owner in ('Sparsh','Joseph')),
  teaser_sent_at      timestamptz,
  teaser_sent_by      text
                        constraint assessments_teaser_sent_by_check check (teaser_sent_by in ('Sparsh','Joseph')),
  report_sent_at      timestamptz,
  report_sent_by      text
                        constraint assessments_report_sent_by_check check (report_sent_by in ('Sparsh','Joseph')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  completed_at        timestamptz,

  constraint assessments_event_response_unique unique (event_id, response_id)
);

create index if not exists assessments_event_id_idx on public.assessments (event_id);
create index if not exists assessments_status_idx on public.assessments (status);
create index if not exists assessments_completed_at_idx on public.assessments (completed_at);

-- Keep updated_at current on every row change. The Edge Function is the only
-- writer (RLS below allows no anonymous access at all), but this stays
-- correct regardless of which code path touches a row.
create or replace function public.assessments_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists assessments_set_updated_at on public.assessments;
create trigger assessments_set_updated_at
  before update on public.assessments
  for each row
  execute function public.assessments_set_updated_at();

-- Row Level Security: enabled, with deliberately zero policies. The
-- publishable key (anon role) must not be able to select, insert, or update
-- this table under any circumstance — all reads and writes happen inside the
-- assessment-api Edge Function using the Supabase secret key, which bypasses
-- RLS entirely and is never exposed to the browser.
alter table public.assessments enable row level security;
