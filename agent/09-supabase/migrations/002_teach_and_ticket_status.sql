-- HALA concierge: 002 — "Teach the agent" answers + a status on tickets.
--
-- Run once in the Supabase SQL editor, after 001. Safe to re-run.
-- Additive only: one new table, three new columns with defaults. Existing rows and the agent's
-- current inserts keep working unchanged.

-- 1. Answers an admin writes for questions HALA could not answer ("Teach the agent").
--    Written by the admin dashboard. Read by the agent's lookup_fact tool (rows with status 'answered')
--    before it says "I don't know". 'out_of_scope' means: don't answer, hand over to a person.
create table if not exists hala_knowledge_answers (
  id uuid primary key default gen_random_uuid(),
  question text not null,                -- the caller's question, as first asked
  question_norm text not null,           -- lower(trim(question)): one row per question
  service_id text,                       -- catalogue service id, or null for general questions
  answer_en text,
  answer_ar text,
  status text not null default 'waiting' check (status in ('waiting', 'answered', 'out_of_scope')),
  answered_by text,
  answered_at timestamptz,
  times_used int not null default 0,     -- incremented by the agent each time it gives this answer
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists hala_knowledge_answers_question on hala_knowledge_answers (question_norm);
create index if not exists hala_knowledge_answers_status on hala_knowledge_answers (status);
-- Same rule as 001: RLS on, no policies. Only service-key servers (agent, dashboard dev server) can access it.
alter table hala_knowledge_answers enable row level security;

-- 2. Tickets (maintenance requests, complaints) get a status, so staff can close them from the dashboard.
--    The agent doesn't need to change: new tickets default to 'open'.
alter table hala_requests add column if not exists status text not null default 'open';
alter table hala_requests add column if not exists resolution text;          -- what staff did, free text
alter table hala_requests add column if not exists updated_at timestamptz not null default now();
do $$
begin
  alter table hala_requests add constraint hala_requests_status_check check (status in ('open', 'in_progress', 'done'));
exception when duplicate_object then null;
end $$;
