# Handover to teammate A (Supabase) and teammate B (admin dashboard)

Everything the agent needs from storage is behind interfaces in `agent/01-core/src/ports.ts`. Nothing in the agent code knows whether data lives in a JSON file or in Supabase.

## A: swapping the JSON store for Supabase

Implement `Stores` (`bookings`, `requests`, `handovers`, `events`) and change one line in `agent/06-talk-app/lib/server.ts`: replace `createStores({ file })` with your adapter. All methods are async already.

| Port | Methods you implement |
|---|---|
| `BookingRepo` | `create`, `get(ref)`, `update`, `listByDate(date)` (confirmed only), `list`, `maxSequence`, `findByKey`, `saveKey` |
| `RequestRepo` | `create`, `get`, `list`, `maxSequence`, `findByKey`, `saveKey` |
| `HandoverRepo` | `create`, `update`, `list` |
| `EventBus` | `publish`, `history(conversationId?)`, `subscribe(listener, conversationId?)` |

Keep these behaviours (they are tested in `agent/03-booking/test`):

- References are `HALA-1001, HALA-1002 ...` for bookings and `REQ-1001 ...` for requests. Use sequences; `maxSequence` is only needed for the JSON store.
- **No double booking.** Enforce it in the database too (partial unique index below), not only in code.
- `findByKey`/`saveKey` make tool retries idempotent. A unique constraint on `idempotency_key` does the same job.
- `events.subscribe` is the live feed. With Supabase use Realtime on the `events` table, or keep a thin in-process bus that also inserts rows.
- Keep the service-role key server-side only. The browser never talks to Supabase from the talk page.

### Suggested schema

```sql
create sequence booking_seq start 1001;
create sequence request_seq start 1001;

create table bookings (
  ref text primary key default 'HALA-' || nextval('booking_seq'),
  service_id text not null,
  attendee_name text not null,
  booked_by_name text,
  contact text not null,                 -- demo data only
  date date not null,
  time time not null,                    -- Asia/Dubai wall clock, 30-minute grid
  language text not null check (language in ('en','ar')),
  conversation_id text,
  status text not null default 'confirmed' check (status in ('confirmed','cancelled')),
  idempotency_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- one confirmed appointment per slot (capacity 1)
create unique index bookings_one_per_slot on bookings (date, time) where status = 'confirmed';

create table service_requests (
  ref text primary key default 'REQ-' || nextval('request_seq'),
  service_id text not null,
  caller_name text not null,
  contact text not null,
  details text not null,
  location text,
  language text not null check (language in ('en','ar')),
  conversation_id text,
  idempotency_key text unique,
  created_at timestamptz not null default now()
);

create table handovers (
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

create table events (
  id uuid primary key,
  ts timestamptz not null default now(),
  conversation_id text,
  type text not null,
  data jsonb not null default '{}'
);
create index events_conversation on events (conversation_id, ts);
```

Row-level security: the agent server uses the service role; the dashboard should read through a role that can read all four tables and update `handovers.status` only.

## B: admin dashboard

Until the dashboard reads Supabase directly, use the read-only API of the talk app (all need header `x-hala-admin-key`, the value is `HALA_ADMIN_KEY` in `.env.hala`):

| Endpoint | Returns |
|---|---|
| `GET /api/admin/bookings` | all bookings, newest first |
| `GET /api/admin/handovers` | all hand-overs, newest first |
| `GET /api/admin/requests` | maintenance requests and complaints |
| `GET /api/admin/events` | last 200 events |
| `GET /api/events?key=<admin key>` | **live** server-sent stream of every event (event name `hala`) |
| `GET /api/events?conversation_id=<id>` | live stream for one conversation (what the talk page uses) |

Event shape (`HalaEvent`, `01-core/src/types.ts`):

```json
{ "id": "uuid", "ts": "2026-11-24T08:00:00.000Z", "conversationId": "conv_...", "type": "handover_requested",
  "data": { "id": "HO-1a2b3c4d", "reason": "fee_dispute", "language": "en", "summary": "...", "caller": "Sara" } }
```

Types: `service_matched`, `slots_listed`, `booking_created`, `booking_rescheduled`, `booking_cancelled`, `request_logged`, `handover_requested`, `fact_lookup`, `tool_error`. Contacts are always masked in events (`***4567`); the full contact is on the booking or request row.

Hand-over fields for the dashboard list (Handover.md phase 3): `reason`, `language`, `summary` (written by the agent for the human), `callerName`, `contact`, `status`, `createdAt`, `conversationId`. A short transcript is not stored by the agent: ElevenLabs keeps it. Fetch it with `client.conversationalAi.conversations.get(conversationId)` on the server, or use the post-call webhook, if the dashboard needs it.

Handover status changes (`open` to `taken` to `closed`) are a write on the `handovers` table; the agent never reads the status back.

## What stays the same for both of you

- The tool contracts in `agent/04-tools-api/src/specs.ts` are the single source of truth for what the agent can do. If a table column changes, change the adapter, not the tools.
- The catalogue lives in code (`agent/02-catalogue/src/services.ts`) with every fee and time marked DEMO. If you want it in a table, load it into the same `Service` shape and pass it to `createToolApi({ services })` and `buildAgentConfig({ services })`.
