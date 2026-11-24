# HALA Concierge: admin dashboard

The operations screen for DSO staff: what the voice agent handled, what is still open, and what the data shows.
It is a separate web app; it reads the agent's data, it does not run on the robot.

```bash
cd dashboard
npm install
npm run dev          # http://localhost:5173
```

## Two modes

| `VITE_DATA_MODE` | Data | Needs |
|---|---|---|
| `mock` (default) | Seeded demo data, a new fake call every 5 s | nothing |
| `live` | The team's agent server + ElevenLabs | the agent running, keys below |

Set it in `dashboard/.env.local` (git-ignored).

## Live mode: where the data comes from

```
ElevenLabs agent ──webhook tools──► agent server (agent/06-talk-app, :3005) ──► Supabase hala_* tables
       │                                   │  /api/admin/*  /api/events (live)
       │ stores every conversation         ▼
       └── transcript, summary,      Vite dev server proxy  ◄── keys are added HERE, never in the browser
           evaluation, data           /hala-api  → agent server   (x-hala-admin-key, x-hala-secret)
           collection                 /el-api    → api.elevenlabs.io (xi-api-key)
                                            │
                                            ▼
                                      dashboard (browser)
```

| Dashboard shows | Comes from |
|---|---|
| Bookings, tickets (maintenance/complaints), handovers, live activity feed | Agent server `/api/admin/*` + `/api/events` (Supabase `hala_*` tables behind it) |
| Calls, transcripts, summaries, language, robot vs web, rating, ElevenLabs evaluation (6 criteria) | ElevenLabs Conversations API (`/v1/convai/conversations`) |
| Requests and their status | Derived from agent events: booking → solved, ticket → open, fee dispute / out of scope → unsolved, asked for a person → needs follow-up, `lookup_fact` not found → unsolved + knowledge gap |
| Teach the agent (questions HALA could not answer) | `fact_lookup` events with `found: false`, grouped by question |

### Settings

The dev server reads them from `dashboard/.env.local` first, then from the agent's own files at the repo root
(`.env.hala`, written by `npm run agent:sync`, and `.env.local`, written by ElevenLabs onboarding).
**If you run the dashboard on the same laptop as the agent, you only need `VITE_DATA_MODE=live`.**

| Variable | What for | Secret |
|---|---|---|
| `VITE_DATA_MODE=live` | switch to live data | no |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | read the `hala_*` tables directly (preferred); pick up / resolve handovers, cancel / move bookings | **yes: full DB access** |
| `TALK_APP_URL` | agent server URL (default `http://localhost:3005`), fallback when Supabase isn't set | no |
| `HALA_ADMIN_KEY` | read bookings / handovers / requests / events | yes |
| `HALA_TOOL_SECRET` | cancel and reschedule bookings from the dashboard | yes |
| `ELEVENLABS_API_KEY` | conversations and transcripts | yes |
| `HALA_AGENT_ID`, `HALA_AGENT_ID_ROBOT` | which ElevenLabs agents to list (robot vs web) | no |

The header shows a green/red dot per feed; hover it for the reason.

**The Supabase service key bypasses all row-level security**, so the dev server only lets these through
`/sb-api` and refuses everything else with 403 before it reaches Supabase: `GET` on the four `hala_*`
tables (+ `hala_knowledge_answers`), `PATCH` of one `hala_handovers` / `hala_bookings` row by id or ref,
`POST` to `hala_knowledge_answers`. Browser headers are stripped so the call is server-to-server.
Keep the dev server on localhost (Vite's default); don't start it with `--host` while the key is set.

## Conversation transcripts: where they are stored

**ElevenLabs already stores every conversation** (transcript, audio, summary, evaluation results, data
collection). The dashboard reads them on demand through the proxy; nothing is copied, nothing to build.
Finished transcripts are cached in the browser; the newest 40 are loaded and refreshed every 10 s.

If the team later wants transcripts in our own database (history beyond ElevenLabs' retention, SQL search,
joining with bookings), the place is the **ElevenLabs post-call webhook** (agent settings → Webhooks →
post-call transcription). ElevenLabs POSTs the full conversation to a URL after each call. That needs:

1. a route on the agent server, e.g. `POST /api/webhooks/elevenlabs`, that checks the webhook signature, and
2. a table such as:

```sql
create table if not exists hala_conversations (
  conversation_id text primary key,
  agent_id text,
  started_at timestamptz,
  duration_secs int,
  language text,
  summary text,
  call_successful text,
  transcript jsonb,          -- [{ role, message, time_in_call_secs }]
  analysis jsonb,            -- evaluation_criteria_results + data_collection_results
  created_at timestamptz default now()
);
```

The dashboard's `teamSource.ts` would then read that table instead of calling ElevenLabs. This is agent-server
work (Briyan / Supabase owner), not dashboard work.

## Teach the agent and ticket status (migration 002)

`agent/09-supabase/migrations/002_teach_and_ticket_status.sql` (branch `feature/12-teach-answers`) adds:

- `hala_knowledge_answers`: one row per question HALA could not answer. The Teach page saves answers and
  "out of scope" here (upsert on `question_norm`). The agent's `lookup_fact` should read `status = 'answered'`
  rows before saying "I don't know" and bump `times_used` (agent-side change, owned by the agent team).
- `hala_requests.status / resolution / updated_at`: "Mark solved" and "Edit" on maintenance tickets and
  complaints write here.

Until 002 is run, those buttons say so, and the Supabase dot's tooltip says "Teach table missing".

## What does not work in live mode yet

Follow-ups, assigning / noting non-ticket requests, and marking a booking completed need agent-side storage
that doesn't exist; those buttons explain why. Everything works in mock mode.

## Code map

| Path | What |
|---|---|
| `src/data/source.ts` | `DataSource` interface: the only way widgets read or change data |
| `src/data/mockSource.ts`, `mockData.ts`, `mockActions.ts` | demo mode |
| `src/data/teamSource.ts` | live mode: maps agent server + ElevenLabs data onto the dashboard tables |
| `src/data/compute.ts`, `insights.ts` | KPIs, feed, conversations, pattern insights (same for both modes) |
| `src/widgets/*.tsx` + `registry.ts` | one widget per file; pages render from the registry |
| `vite.config.ts` | the proxy that keeps keys out of the browser |

`schema.sql` is the original data contract from planning; the team's real tables are `agent/09-supabase/migrations/001_hala_tables.sql`.
