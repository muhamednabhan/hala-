# HALA Concierge — Admin Dashboard

Hackathon project (Voice of the Oasis, DSO). Code freeze Wed 25 Nov 08:30 Dubai time.
Speed > polish. Never break the build. Commit after every working feature.

## What this is
Live ops dashboard for an ElevenLabs voice agent ("HALA Concierge") that handles DSO services by voice
in English + Arabic: visa (new/renewal/cancellation), establishment card, access/ID card, trade licence
renewal/amendment, NOCs, leasing, maintenance requests, complaints.
It shows what the agent did, what is still open, and lets an admin TEACH the agent answers it didn't know.

## Stack
- Vite + React + TypeScript + Tailwind, Recharts, @supabase/supabase-js
- Env in .env.local (never commit): VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_DATA_MODE=mock|live

## Core idea: a REQUEST is the unit of work
One call can contain several requests (e.g. visa renewal + access card in one call).
Every request ends in exactly one status:
- `solved`          — agent fully handled it (booked, cancelled, rescheduled, or answered correctly)
- `open`            — in progress / waiting on a booking date or a human task
- `needs_followup`  — open for longer than the follow-up threshold, or caller was promised a callback
- `unsolved`        — agent could not answer / out of scope / caller left unhappy
And one resolution: `booked | rescheduled | cancelled | info_given | task_created | handed_over | unanswered`

Data contract: see `schema.sql` (tables: calls, requests, events, bookings, tasks, handovers,
knowledge_gaps, feedback + views). Dashboard reads ONLY through `src/data/source.ts`.

## Architecture rules
- `src/data/source.ts` = `DataSource` interface. Implementations: `mockSource.ts` (seeded, plus a timer
  that adds a new fake call/request every 5s) and `supabaseSource.ts`. Mock mode must ALWAYS work.
- `src/widgets/<Name>.tsx` — one widget per file, exported as `{ id, title, size, Component }`.
- `src/widgets/registry.ts` — list of widgets; pages render from it.
- Actions (buttons that change data) go through `DataSource` methods, never direct Supabase calls in widgets.
- Global filter bar: date range (Today / 7 days / All), channel (robot/phone/web), language (EN/AR/All).

## PAGES

### 1. Overview (the screen shown during the pitch)
METRICS (KPI cards, big numbers):
- Total calls | Calls today
- Total requests | Requests per call (avg)
- Solved | Open | Needs follow-up | Unsolved   (count + % of total requests)
- Resolution rate = solved / total requests  ← headline number
- Calls that led to an action (booking / task / handover) + %
- Bookings made | Rescheduled | Cancelled
- Handovers to a human (waiting now)
- Knowledge gaps waiting for an admin answer
- Avg call duration | Avg rating (1–5) | Language split EN / AR / mixed

CHARTS:
- Most asked services (horizontal bar, sorted, stacked by status solved/open/followup/unsolved)
- Request status funnel: requests → solved / open / follow-up / unsolved
- Calls per hour (line)
- Language split (donut)
- Unsolved reasons (bar: out_of_scope, fee_dispute, unknown_answer, caller_hung_up, other)

LIVE FEED (realtime, newest top): "12:41 · AR · Visa renewal · booked for Thu 10:00",
colour by status, AR/EN badge, click → call detail.

### 2. Requests
Table of all requests: time, caller, service, language, status, resolution, age.
Filters by status + service. Click row → Call detail drawer.
ACTIONS: change status, mark solved, assign to a person, add note.

### 3. Follow-ups
List of `needs_followup` + open items older than threshold (demo: 2 minutes; real: 2 days)
+ appointments in the next 24h (reminder).
ACTIONS:
- "Send follow-up" → mock SMS/WhatsApp preview modal (EN + AR text), logs `followup_sent`
- "Call back" → logs `callback_scheduled`
- "Mark solved"

### 4. Teach the agent (Knowledge gaps)  ← key differentiator
Every unsolved request where the agent said "I don't know" creates a knowledge_gap row with:
the caller's exact question, service, language, how many times it was asked, first/last asked.
Sorted by times asked (most frequent gap first).
ACTIONS:
- "Answer" → admin types answer (EN, optional AR) + picks service → status `answered`
  → the agent's `lookup_admin_answers` tool reads this table, so next caller gets the answer instantly
- "Mark out of scope" → agent will hand over to a human for this question next time
- "Merge duplicate" (optional)
METRICS on this page: gaps open, gaps answered, times an admin answer was used by the agent.

### 5. Handovers
Queue of calls handed to a human: reason, service, waiting time, what the agent already collected.
ACTIONS: "Pick up" (→ picked_up), "Resolve" (→ resolved, request → solved).

### 6. Bookings (mock calendar)
Day/week list of slots per service; status confirmed/rescheduled/cancelled/completed.
ACTIONS: reschedule, cancel, mark completed.

### 7. Call detail drawer (opens from anywhere)
Summary, transcript (dir="auto" for Arabic), list of requests in the call, events timeline, rating.

## UI
- Dark, big readable numbers (projected during the pitch). Status colours: solved green, open blue,
  needs_followup amber, unsolved red.
- Arabic text renders RTL inside cells (dir="auto").
- Every fee/processing time shown is labelled "DEMO".

## Build order (stop and commit after each)
1. Scaffold + DataSource + mock data + registry
2. Overview KPI cards + live feed
3. Most asked services chart + status funnel
4. Teach the agent page
5. Follow-ups page
6. Handovers + Requests pages
7. Bookings + call detail drawer
8. Switch to live Supabase
