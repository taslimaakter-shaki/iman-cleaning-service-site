create table if not exists public.bookings (
  id text primary key,
  created_at timestamptz not null default now(),
  status text not null default 'New',
  service text not null,
  service_label text not null,
  schedule text not null,
  schedule_label text not null,
  bedrooms_label text not null,
  bathrooms_label text not null,
  sqft integer not null default 0,
  addons jsonb not null default '[]'::jsonb,
  client_name text not null,
  phone text not null,
  email text not null,
  address text not null,
  notes text not null default '',
  estimate jsonb not null default '{}'::jsonb
);

alter table public.bookings enable row level security;

drop policy if exists "No direct browser access to bookings" on public.bookings;
create policy "No direct browser access to bookings"
on public.bookings
for all
using (false)
with check (false);

create index if not exists bookings_created_at_idx
on public.bookings (created_at desc);

create index if not exists bookings_status_idx
on public.bookings (status);

create table if not exists public.cleaner_applications (
  id text primary key,
  created_at timestamptz not null default now(),
  status text not null default 'Submitted',
  full_name text not null,
  phone text not null,
  email text not null,
  city text not null,
  service_area text not null,
  experience text not null default '',
  services jsonb not null default '[]'::jsonb,
  languages text not null default '',
  has_insurance boolean not null default false,
  has_transportation boolean not null default false,
  notes text not null default ''
);

alter table public.cleaner_applications enable row level security;

drop policy if exists "No direct browser access to cleaner applications" on public.cleaner_applications;
create policy "No direct browser access to cleaner applications"
on public.cleaner_applications
for all
using (false)
with check (false);

create index if not exists cleaner_applications_created_at_idx
on public.cleaner_applications (created_at desc);

create index if not exists cleaner_applications_status_idx
on public.cleaner_applications (status);

create table if not exists public.live_chat_sessions (
  id text primary key,
  short_code text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text not null default 'active',
  visitor_name text not null default '',
  visitor_contact text not null default '',
  page_url text not null default '',
  referrer text not null default '',
  last_visitor_message_at timestamptz,
  last_owner_reply_at timestamptz,
  closed_at timestamptz
);

alter table public.live_chat_sessions enable row level security;

drop policy if exists "No direct browser access to live chat sessions" on public.live_chat_sessions;
create policy "No direct browser access to live chat sessions"
on public.live_chat_sessions
for all
using (false)
with check (false);

create index if not exists live_chat_sessions_updated_at_idx
on public.live_chat_sessions (updated_at desc);

create index if not exists live_chat_sessions_status_idx
on public.live_chat_sessions (status);

create table if not exists public.live_chat_messages (
  id bigint generated always as identity primary key,
  session_id text not null references public.live_chat_sessions(id) on delete cascade,
  created_at timestamptz not null default now(),
  sender text not null check (sender in ('visitor', 'owner', 'system')),
  body text not null,
  client_message_id text not null default '',
  twilio_message_sid text not null default ''
);

alter table public.live_chat_messages enable row level security;

drop policy if exists "No direct browser access to live chat messages" on public.live_chat_messages;
create policy "No direct browser access to live chat messages"
on public.live_chat_messages
for all
using (false)
with check (false);

create index if not exists live_chat_messages_session_created_idx
on public.live_chat_messages (session_id, created_at asc);

create unique index if not exists live_chat_messages_client_message_uidx
on public.live_chat_messages (session_id, client_message_id)
where client_message_id <> '';
