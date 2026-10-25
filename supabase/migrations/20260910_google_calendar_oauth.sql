-- Private server-side Google Calendar credentials and short-lived OAuth attempts.
begin;
create table if not exists public.google_calendar_connection (
  id text primary key check (id = 'business'),
  calendar_id text not null check (calendar_id = 'info@imancleaningservice.com'),
  account_email text not null,
  token_encrypted text not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.google_calendar_oauth_states (
  state_hash text primary key,
  browser_hash text not null,
  verifier_encrypted text not null,
  expires_at timestamptz not null
);
alter table public.google_calendar_connection enable row level security;
alter table public.google_calendar_oauth_states enable row level security;
revoke all on public.google_calendar_connection, public.google_calendar_oauth_states from public, anon, authenticated;
grant select, insert, update, delete on public.google_calendar_connection, public.google_calendar_oauth_states to service_role;
notify pgrst, 'reload schema';
commit;
