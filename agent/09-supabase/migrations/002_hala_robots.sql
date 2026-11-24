-- HALA robot control: robots paired with the website, remote commands and the bridge's log lines.
-- Run once in the Supabase SQL editor, after 001. Safe to re-run. RLS on, no policies (service role only).

create table if not exists hala_robots (
  id text primary key,
  name text not null,
  notes text,
  ip text,
  domain_id integer,
  aimdk_path text,
  mic_stream smallint not null default 0 check (mic_stream in (0,1,2)),
  half_duplex boolean not null default false,
  volume integer check (volume between 0 and 100),
  token_hash text not null unique,        -- sha256 of the pairing token; the token is shown once
  desired text not null default 'stopped' check (desired in ('running','stopped')),
  last_seen timestamptz,
  bridge_version text,
  state jsonb,
  created_at timestamptz not null default now()
);

create table if not exists hala_robot_commands (
  id text primary key,
  robot_id text not null references hala_robots(id) on delete cascade,
  type text not null check (type in ('speaker_test','say','set_volume','reconnect')),
  payload jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending','done','failed')),
  result text,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists hala_robot_commands_pending on hala_robot_commands (robot_id, status, created_at);

create table if not exists hala_robot_logs (
  id text primary key,
  robot_id text not null references hala_robots(id) on delete cascade,
  ts timestamptz not null default now(),
  level text not null check (level in ('info','warn','error','user','agent')),
  message text not null
);
create index if not exists hala_robot_logs_robot on hala_robot_logs (robot_id, ts desc);

alter table hala_robots enable row level security;
alter table hala_robot_commands enable row level security;
alter table hala_robot_logs enable row level security;
