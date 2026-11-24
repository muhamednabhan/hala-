-- HALA phone line: storage for the HALA Phone iOS app (link codes, phones, texts, calls to ring).
--
-- Run once in the Supabase SQL editor, after 001_hala_tables.sql. Safe to re-run.
-- Same rules as the other hala_ tables: the agent server uses the service-role key, RLS is on with no
-- policies, so the anon key can read and write nothing.

create sequence if not exists hala_phone_seq start 1;

-- One-time codes shown as a QR on the robot's screen. A code links exactly one phone.
create table if not exists hala_phone_codes (
  code text primary key,
  created_at timestamptz not null default now(),
  phone text,
  linked_at timestamptz,
  conversation_id text                       -- robot conversation that displayed the QR, when known
);

-- Who each phone is. `codes` lists every code the phone linked with, so a person can be repeated to the robot later.
create table if not exists hala_phone_contacts (
  phone text primary key,                    -- E.164, e.g. +971501234567 (dummy numbers in the demo)
  name text,
  language text not null default 'en' check (language in ('en','ar')),
  codes text[] not null default '{}',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- The SMS thread. `seq` is a cursor the app polls with ("anything after 42?").
create table if not exists hala_phone_messages (
  id text primary key,
  seq bigint not null unique default nextval('hala_phone_seq'),
  phone text not null,
  from_who text not null check (from_who in ('user','agent')),
  kind text not null default 'text' check (kind in ('text','voice')),
  text text not null,                        -- for a voice message: the transcript
  audio_url text,
  duration_sec int,
  ts timestamptz not null default now()
);
create index if not exists hala_phone_messages_phone_seq on hala_phone_messages (phone, seq);

-- Calls HALA starts. The app turns a pending one into an incoming-call screen.
create table if not exists hala_phone_rings (
  id text primary key,
  seq bigint not null unique default nextval('hala_phone_seq'),
  phone text not null,
  reason text not null,                      -- plain words, derived from store data, never invented
  opening text not null,                     -- first thing HALA says; starts with the AI disclosure
  language text not null check (language in ('en','ar')),
  kind text not null check (kind in ('manual','appointment_reminder')),
  nudge_key text unique,                     -- one call per appointment, not one per scan
  status text not null default 'pending' check (status in ('pending','delivered','answered','declined','missed')),
  created_at timestamptz not null default now()
);
create index if not exists hala_phone_rings_phone_seq on hala_phone_rings (phone, seq);

-- ElevenLabs conversation -> phone, so a tool call (send a text, book) knows who it is talking to.
create table if not exists hala_phone_conversations (
  conversation_id text primary key,
  phone text not null,
  created_at timestamptz not null default now()
);

alter table hala_phone_codes enable row level security;
alter table hala_phone_contacts enable row level security;
alter table hala_phone_messages enable row level security;
alter table hala_phone_rings enable row level security;
alter table hala_phone_conversations enable row level security;
