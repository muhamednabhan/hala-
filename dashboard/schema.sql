-- HALA Concierge — Supabase schema (dashboard contract)
-- Paste into Supabase SQL editor. Share with Mohammed (backend/booking) + Briyan (voice).
-- Rule: every layer WRITES to these tables; the dashboard only READS the views at the bottom.

-- 1. CALLS — one row per conversation (filled by ElevenLabs post-call webhook)
create table if not exists calls (
  id               text primary key,             -- ElevenLabs conversation_id
  agent_id         text,
  channel          text default 'robot',         -- robot | phone | web
  started_at       timestamptz default now(),
  ended_at         timestamptz,
  duration_secs    int,
  language         text,                         -- en | ar | mixed  (data collection field)
  caller_type      text,                         -- resident | company_hr | pro | unknown
  status           text default 'in_progress',   -- in_progress | done | failed
  call_successful  text,                         -- success | failure | unknown (ElevenLabs analysis)
  sentiment        text,                         -- calm | neutral | impatient | angry
  summary          text,
  transcript       jsonb,
  analysis         jsonb,                        -- raw analysis blob, keep everything
  cost             numeric
);

-- 2. EVENTS — append-only log. Every tool call / step writes one row. This is the source of truth.
create table if not exists events (
  id          bigint generated always as identity primary key,
  call_id     text references calls(id) on delete cascade,
  created_at  timestamptz default now(),
  type        text not null,
  -- call_started | intent_detected | docs_listed | booking_created | booking_rescheduled
  -- booking_cancelled | handover | followup_sent | complaint_logged | maintenance_logged
  -- kb_miss (agent said "I don't know") | error | feedback
  service     text,   -- visa_renewal | access_card | licence | noc | maintenance | complaint | ...
  payload     jsonb default '{}'
);

-- 3. BOOKINGS — the mock calendar
create table if not exists bookings (
  id             uuid primary key default gen_random_uuid(),
  call_id        text references calls(id),
  service        text not null,
  customer_name  text not null,
  contact        text not null,
  company        text,
  slot_at        timestamptz not null,
  status         text default 'confirmed',   -- confirmed | rescheduled | cancelled | completed
  documents      jsonb default '[]',
  demo_fee_aed   numeric,                    -- DEMO DATA
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

-- 4. TASKS — anything a human must action (maintenance, complaints, follow-ups)
create table if not exists tasks (
  id          uuid primary key default gen_random_uuid(),
  call_id     text references calls(id),
  kind        text not null,                 -- maintenance | complaint | followup | noc_review
  service     text,
  priority    text default 'normal',         -- low | normal | high | urgent
  status      text default 'open',           -- open | in_progress | done
  title       text,
  details     jsonb default '{}',
  created_at  timestamptz default now()
);

-- 5. HANDOVERS — out-of-scope / fee disputes / angry callers → human
create table if not exists handovers (
  id          uuid primary key default gen_random_uuid(),
  call_id     text references calls(id),
  reason      text not null,                 -- out_of_scope | fee_dispute | caller_request | low_confidence
  service     text,
  status      text default 'waiting',        -- waiting | picked_up | resolved
  context     text,                          -- what the agent already collected, so the human doesn't re-ask
  created_at  timestamptz default now()
);

-- 5b. REQUESTS — one row per service the caller asked about (a call can have several)
create table if not exists requests (
  id             uuid primary key default gen_random_uuid(),
  call_id        text references calls(id),
  contact        text,                        -- phone/email: links repeat callers
  service        text not null,
  question       text,                        -- caller's ask in their words
  language       text,
  status         text default 'open',         -- solved | open | needs_followup | unsolved
  resolution     text,                        -- booked | rescheduled | cancelled | info_given | task_created | handed_over | unanswered
  unsolved_reason text,                       -- out_of_scope | fee_dispute | unknown_answer | caller_hung_up | other
  assigned_to    text,
  note           text,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

-- 5c. KNOWLEDGE GAPS — questions the agent couldn't answer; admin fills the answer
create table if not exists knowledge_gaps (
  id             uuid primary key default gen_random_uuid(),
  question       text not null,
  service        text,
  language       text,
  times_asked    int default 1,
  first_asked_at timestamptz default now(),
  last_asked_at  timestamptz default now(),
  status         text default 'waiting',      -- waiting | answered | out_of_scope
  answer_en      text,
  answer_ar      text,
  answered_by    text,
  answered_at    timestamptz,
  times_used     int default 0                -- incremented by the agent's lookup_admin_answers tool
);

-- 6. FEEDBACK — end-of-call rating
create table if not exists feedback (
  id          uuid primary key default gen_random_uuid(),
  call_id     text references calls(id),
  rating      int check (rating between 1 and 5),
  comment     text,
  created_at  timestamptz default now()
);

-- ===== VIEWS the dashboard reads (change tables freely, keep these stable) =====

create or replace view v_kpis as
select
  (select count(*) from calls)                                              as total_calls,
  (select count(*) from calls where started_at::date = current_date)        as calls_today,
  (select count(distinct call_id) from events
     where type in ('booking_created','booking_rescheduled','booking_cancelled',
                    'complaint_logged','maintenance_logged','followup_sent')) as calls_with_action,
  (select count(*) from bookings where status <> 'cancelled')               as active_bookings,
  (select count(*) from tasks where status <> 'done')                       as pending_tasks,
  (select count(*) from handovers where status = 'waiting')                 as waiting_handovers,
  (select round(avg(duration_secs)) from calls where duration_secs is not null) as avg_duration_secs,
  (select round(avg(rating)::numeric,2) from feedback)                      as avg_rating,
  (select count(*) from events where type = 'kb_miss')                      as kb_misses;

create or replace view v_service_breakdown as
select service, count(*) as requests,
       count(*) filter (where type = 'booking_created') as bookings,
       count(*) filter (where type = 'handover')        as handovers
from events where service is not null group by service order by requests desc;

create or replace view v_language_split as
select coalesce(language,'unknown') as language, count(*) from calls group by 1;

create or replace view v_calls_per_hour as
select date_trunc('hour', started_at) as hour, count(*) from calls group by 1 order by 1;

create or replace view v_live_feed as
select e.created_at, e.type, e.service, e.call_id, c.language, c.caller_type, e.payload
from events e left join calls c on c.id = e.call_id
order by e.created_at desc limit 100;

create or replace view v_request_stats as
select
  count(*)                                              as total_requests,
  count(*) filter (where status = 'solved')             as solved,
  count(*) filter (where status = 'open')               as open,
  count(*) filter (where status = 'needs_followup')     as needs_followup,
  count(*) filter (where status = 'unsolved')           as unsolved,
  round(100.0 * count(*) filter (where status = 'solved') / nullif(count(*),0), 1) as resolution_rate_pct
from requests;

create or replace view v_top_services as
select service, count(*) as total,
  count(*) filter (where status = 'solved')         as solved,
  count(*) filter (where status = 'open')           as open,
  count(*) filter (where status = 'needs_followup') as needs_followup,
  count(*) filter (where status = 'unsolved')       as unsolved
from requests group by service order by total desc;

create or replace view v_unsolved_reasons as
select coalesce(unsolved_reason,'other') as reason, count(*)
from requests where status = 'unsolved' group by 1 order by 2 desc;

-- ===== Realtime (dashboard updates live during the demo) =====
alter publication supabase_realtime add table events, bookings, tasks, handovers, calls, requests, knowledge_gaps;
alter table requests disable row level security;
alter table knowledge_gaps disable row level security;

-- Hackathon only: RLS off so the anon key can read. Say "would be locked down in prod" in the pitch.
alter table calls disable row level security;
alter table events disable row level security;
alter table bookings disable row level security;
alter table tasks disable row level security;
alter table handovers disable row level security;
alter table feedback disable row level security;
