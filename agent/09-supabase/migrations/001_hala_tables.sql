-- HALA concierge agent: storage tables.
--
-- Run once in the Supabase SQL editor (project uzmgqdoqtfpvqrdvoaxt). Safe to re-run.
-- All tables are prefixed hala_ so they never touch the existing `bookings` table.
-- The agent server uses the service-role key, which bypasses row-level security.
-- RLS is enabled with no policies, so the anon key can read and write nothing.

create sequence if not exists hala_booking_seq start 1001;

create table if not exists hala_bookings (
  ref text primary key,
  service_id text not null,
  attendee_name text not null,
  booked_by_name text,
  contact text not null,                       -- demo data only
  date date not null,
  time time not null,                          -- Asia/Dubai wall clock, 30-minute grid
  language text not null check (language in ('en','ar')),
  conversation_id text,
  status text not null default 'confirmed' check (status in ('confirmed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One confirmed appointment per slot. The database is the last line of defence against double booking.
create unique index if not exists hala_bookings_one_per_slot on hala_bookings (date, time) where status = 'confirmed';
create index if not exists hala_bookings_date on hala_bookings (date);

create table if not exists hala_requests (
  ref text primary key,
  service_id text not null,
  caller_name text not null,
  contact text not null,
  details text not null,
  location text,
  language text not null check (language in ('en','ar')),
  conversation_id text,
  created_at timestamptz not null default now()
);

create table if not exists hala_handovers (
  id text primary key,
  reason text not null check (reason in ('fee_dispute','legal_question','upset_caller','out_of_scope','unknown_answer','caller_requested','emergency','other')),
  language text not null check (language in ('en','ar')),
  summary text not null,
  caller_name text,
  contact text,
  conversation_id text,
  status text not null default 'open' check (status in ('open','taken','closed')),
  created_at timestamptz not null default now()
);
create index if not exists hala_handovers_status on hala_handovers (status, created_at desc);

create table if not exists hala_events (
  id text primary key,
  ts timestamptz not null default now(),
  conversation_id text,
  type text not null,
  data jsonb not null default '{}'
);
create index if not exists hala_events_conversation on hala_events (conversation_id, ts);

-- Retried tool calls: the same key returns the original booking or request instead of a duplicate.
create table if not exists hala_idempotency (
  key text primary key,
  kind text not null check (kind in ('booking','request')),
  ref text not null,
  created_at timestamptz not null default now()
);

alter table hala_bookings enable row level security;
alter table hala_requests enable row level security;
alter table hala_handovers enable row level security;
alter table hala_events enable row level security;
alter table hala_idempotency enable row level security;
