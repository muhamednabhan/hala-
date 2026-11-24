# HALA Concierge — Operations dashboard

The screen DSO staff use to see what the HALA voice agent handled (robot, phone, web), what is still open,
and what the data shows, and to act on it: answer questions HALA couldn't, close tickets, take over handovers,
move or cancel bookings.

It is a separate web app. It reads the agent's data; it does not run on the robot.

```bash
cd dashboard
npm install
npm run dev        # http://localhost:5173
npm test           # 38 unit tests (security rules, login, data mapping)
npm run build      # type-checks browser + server code, then builds
```

## Demo and Live

The header switch flips between them (remembered per browser).

| | Data | Needs |
|---|---|---|
| **Demo** | Seeded data, a new simulated call every 5 s | nothing; works offline (use this on a projector) |
| **Live** | The team's Supabase (`hala_*` tables), the robot log, the phone line, ElevenLabs | server settings below, staff password when deployed |

## Deploy (Vercel)

Live at **https://hala-dashboard-lime.vercel.app** (Vercel project `hala-dashboard`, account `meenion`).
The staff password is in `dashboard/.env.deploy` (git-ignored, never uploaded).

To ship an update:

```bash
cd dashboard && ./deploy.sh
```

It builds and tests locally, then deploys a clean copy without git history (Vercel blocks deployments whose git
commit author isn't on the Vercel account) and without any `.env*` file.

Settings live in the Vercel project (Settings → Environment Variables): `DASHBOARD_PASSWORD`, `SUPABASE_URL`,
`SUPABASE_SERVICE_KEY`, `VITE_DATA_MODE=live`; add `ELEVENLABS_API_KEY` + `HALA_AGENT_ID` later for transcripts and
ElevenLabs sentiment. After changing a setting, run `./deploy.sh` again.

Without `DASHBOARD_PASSWORD` a deployment refuses all live data (it fails closed); demo mode still works.

## How it is secured

```
browser ──/api/proxy?t=sb|el|hala&p=…──► dashboard server ──► Supabase / ElevenLabs / agent server
            (session cookie)               server/handler.ts      (keys added here only)
                                           server/rules.ts  ◄── allow-list
```

- **Keys never reach the browser.** Only `server/` reads them. The build is checked for leaked keys.
- **Same code locally and deployed.** `npm run dev` serves `/api/proxy` with `server/handler.ts`; Vercel runs the same file via `api/proxy.ts`.
- **Allow-list** (`server/rules.ts`, unit-tested): read the `hala_*` tables the dashboard shows; update **one**
  handover / booking / ticket / answer by its id; upsert Teach answers; read ElevenLabs conversations; cancel or move
  a booking through the agent's own tools. Everything else, including deletes, bulk updates, other tables
  (`bookings`, `hala_robots`, `hala_idempotency`), is refused with 403 before it leaves the server.
- **Login:** one staff password (`DASHBOARD_PASSWORD`), constant-time compare, slowed down on failure. The session
  is an HMAC-signed, `HttpOnly`, `SameSite=Strict`, `Secure` cookie valid 12 h; changing the password logs everyone out.
- Locally the password is optional (set it in `dashboard/.env.local` to test the login).
- Security headers (`vercel.json`): no framing, no MIME sniffing, no referrer. `noindex` so search engines skip it.

## Where the data comes from (live)

| Dashboard | Source |
|---|---|
| Bookings, tickets, handovers, live activity | `hala_bookings`, `hala_requests`, `hala_handovers`, `hala_events` (written by the agent's tools) |
| Robot calls + their transcript | `hala_robot_logs`: a robot session is "connected." → last spoken line; the conversation that starts in it is the robot's |
| Phone calls, caller names, phone chat | `hala_phone_conversations`, `hala_phone_contacts`, `hala_phone_messages` |
| Calls HALA made (appointment reminders) | `hala_phone_rings`, linked to the booking reference and to the call it started |
| Teach the agent | `fact_lookup` misses grouped by question + admin answers in `hala_knowledge_answers` |
| Web/phone transcripts, summaries, 6 evaluation checks | ElevenLabs Conversations API (with `ELEVENLABS_API_KEY`) |

**A request is the unit of work.** Everything about one booking reference is **one case**, however many calls
it took: e.g. HALA-1004 = booked by phone → HALA's reminder call → cancelled during that call.
Status per request: booking → solved; ticket → open until staff close it; fee dispute / out of scope → unsolved;
asked for a person → needs follow-up; HALA didn't know → unsolved, and listed on Teach the agent.

**Test calls** (`t`, `smoke-*`, `prod-smoke`, "Smoke Test" bookings) are hidden by default ("Hide test calls").

### Database changes

Schema changes are numbered SQL files in `agent/09-supabase/migrations/` (`002_teach_and_ticket_status.sql`
added the Teach table and ticket status). Add, don't rename or drop; review in a PR; run once in the SQL editor.

### Asks for the agent team

- `lookup_fact`: read `hala_knowledge_answers` (`status = 'answered'`) before saying "I don't know"; bump `times_used`.
- Push the phone line and robot code, and add migrations for `hala_phone_*` / `hala_robot_*` (they exist in the DB, not in git).
- Optional: write the channel on each conversation, so the dashboard doesn't have to infer it.

## Code map

| Path | What |
|---|---|
| `server/rules.ts`, `server/auth.ts`, `server/handler.ts` | the dashboard server: allow-list, login, forwarding |
| `api/proxy.ts` | Vercel function (one line: calls `server/handler.ts`) |
| `src/data/source.ts` | `DataSource`: the only way widgets read or change data |
| `src/data/teamSource.ts` | live: maps the team's tables onto the dashboard model |
| `src/data/mockSource.ts`, `mockData.ts`, `mockActions.ts` | demo |
| `src/data/compute.ts`, `insights.ts` | KPIs, feed, conversations, pattern insights (both modes) |
| `src/widgets/*.tsx`, `registry.ts` | one widget per file; pages render from the registry |

`schema.sql` is the original planning contract; the team's real tables are in `agent/09-supabase/migrations/`.
