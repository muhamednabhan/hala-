# HALA agent

The AI agent half of the HALA Concierge (Voice of the Oasis, Team Kanban). A bilingual (Arabic and English) voice agent for Dubai Silicon Oasis that finds the right service, lists the documents, books a slot, logs a request, and hands over to a person.

Teammate A owns Supabase, teammate B owns the admin dashboard. This folder is everything on the agent side. Each feature is its own folder and its own git branch, so anything can be traced back or reverted on its own.

## Feature map

| Folder | Branch | What it is |
|---|---|---|
| `01-core` | `feature/01-core` | Domain types, storage **ports**, Dubai time, Arabic/English text normalisation, guardrail wording, the system prompt |
| `02-catalogue` | `feature/02-catalogue` | 12 demo services (EN + AR), the Arabic-aware matcher, the grounded fact base |
| `03-booking` | `feature/03-booking` | Calendar rules (Mon–Fri 08:00–15:00 Dubai, 30 min, no double booking, retry-safe), in-memory and JSON-file stores, event bus |
| `04-tools-api` | `feature/04-tools-api` | The 9 webhook tools the agent calls, with auth, validation and event publishing |
| `05-provisioning` | `feature/05-provisioning` | Builds the ElevenLabs agent config from code and syncs it (create or update in place) |
| `06-talk-app` | `feature/06-talk-app` | Next.js app: talk page, `/api/token`, `/api/research`, `/api/tools/*`, `/api/events`, `/api/admin/*` |
| `07-evals` | `feature/07-evals` | Offline evals and a live text-mode harness |
| `11-phone` | `feature/11-phone` | The phone line for the HALA Phone iOS app: texts, voice-message replies, QR link codes, proactive calls (see its README). The app itself is in `ios/HalaPhone` |
| `09-supabase` | `feature/09-supabase` | Supabase adapter for the storage ports, plus the SQL migration |

## How it fits together

```
 caller ── voice ──► ElevenLabs agent (Arabic base language, prompt from 01-core)
                          │  webhook tool calls (x-hala-secret header)
                          ▼
              cloudflared tunnel ──► 06-talk-app  /api/tools/:tool
                                          │
                                   04-tools-api ──► 02-catalogue (services, facts)
                                          │      └─► 03-booking  (calendar)
                                          ▼
                              Stores (ports from 01-core)
                    JSON file, or Supabase when its hala_* tables exist
                                          │
                              events ─► /api/events (SSE) ─► live screen, admin dashboard
```

Why webhook tools (not browser client tools): the robot has no browser, and the same tool API then serves web, robot and phone, and feeds the dashboard. The cost: ElevenLabs servers must reach us, so a public https URL (cloudflared) is needed from the first test.

## Run it

```bash
npm install
npm test                         # all offline tests (no network, no API key)
npx tsc --noEmit -p tsconfig.json
```

One-time ElevenLabs setup (writes the API key into `.env.local`, never printed):

```bash
npx -y @elevenlabs/cli@latest onboard init      # follow what it prints
```

Then, with the app running behind a tunnel:

```bash
npm run agent:dev                                 # http://localhost:3005
cloudflared tunnel --url http://localhost:3005    # copy the https URL
# put PUBLIC_BASE_URL=https://....trycloudflare.com in .env.hala
npm run agent:sync -- --channel both              # create/update web + robot agents, pins their ids
```

Tunnel URLs change on every restart, so re-run `agent:sync` after restarting cloudflared. It updates in place; it never duplicates the agent.

Check it works:

```bash
curl http://localhost:3005/api/health
curl "http://localhost:3005/api/token?channel=web"
curl -X POST localhost:3005/api/research -H 'content-type: application/json' -d '{"question":"Which bus routes serve DSO?"}'
```

The research call should answer `found:false` (no bus-route fact is in the brief). That is correct: the agent then says it does not know and offers a person. Then open the page, press Start, say "Hello" or «مرحبا».

## Settings files (all gitignored)

| File | Holds | Written by |
|---|---|---|
| `.env.local` | `ELEVENLABS_API_KEY` | ElevenLabs onboarding |
| `.env.hala` | `HALA_TOOL_SECRET`, `HALA_ADMIN_KEY`, `PUBLIC_BASE_URL`, `HALA_AGENT_ID`, `HALA_AGENT_ID_ROBOT`, `HALA_VOICE_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | `agent:sync` and the app |
| `.data/hala-store.json` | bookings, requests, handovers, events | the app |

## Rules the agent follows (what the judges mark)

- **Says it is an AI**: in the opening line, in both languages, and whenever asked.
- **English and Arabic**: Gulf-friendly Modern Standard Arabic, feminine self-reference, switches when the caller switches.
- **Never invents**: fees, times, documents and facts come only from tool results. The fact base holds only facts from the brief and `handover.md`. Not found means "I don't know" plus an offer to hand over.
- **Demo values labelled**: every fee and processing time is spoken with a demonstration notice.
- **Hands over**: fee disputes, legal questions, upset callers, requests for a person, out-of-scope, emergencies.
- **Reads back before it books, changes or cancels**, then confirms the reference digit by digit.
- **Privacy**: asks only for a name and one contact (demo data). Never IDs, passports or payment details. Contacts are masked in event feeds.

## Decisions (and why)

- **Arabic is the base language** of the ElevenLabs agent, English is a language preset. ElevenLabs forces an English-primary agent onto an English-only voice model that garbles Arabic.
- **Server owns the calendar.** The agent passes "tomorrow" or "thursday"; the server resolves it. The model never does date arithmetic.
- **Idempotent tools.** ElevenLabs may retry a webhook; the same booking or request is returned, never duplicated.
- **Webhook tools fail closed**: no `HALA_TOOL_SECRET` means every call is refused.
- **Grounded `/api/research`**: unlike the starter kit's, it never calls a third-party service, so no question text leaves our server and nothing unverified is spoken.
- **Own catalogue content.** Services, documents, fees (all DEMO) and Arabic wording are written for this project. The Arabic still needs a native speaker's review.

## Known limits

- Fees and times are demonstration values by design. Document lists are also demo content.
- The calendar is one desk (capacity 1). Storage is the JSON file until the SQL in `09-supabase/migrations` is run in Supabase.
- Not yet verified against the live ElevenLabs API until the key is connected and testing is approved.
- The robot needs the PCM 16 kHz agent (`--channel robot`) and the bridge from the Team Guide. See `handover.md` phase 1.
