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

## Kiosk features (added 25 Nov): Smart Pass, phone QR, triage, scores

The laptop UI is the stand-in for the screen that will be added to the robot. It follows the robot's conversation (it reads the access key the Robot tab stores, polls `/api/robots`, and follows the robot whose `state.conversationId` is live), or its own conversation when you talk to it directly.

**Flow:** the visitor asks, HALA answers, they want an appointment → the agent calls `request_phone_link` → a QR appears on the screen → the visitor scans it and sends the text it opens (`HALA K7M2QX`) → the server links that phone to this conversation → the agent calls `get_linked_phone` and gets the contact (never read aloud) → booking → the **Smart Pass** grows out of the voice orb on the screen, and is texted to the HalaPhone app.

| Piece | Where |
|---|---|
| Pass data (service EN/AR, date, time, desk, documents, first name only), signed link, queue estimate, `.ics`, the text sent to the phone | `04-tools-api/src/pass.ts` |
| Desk per service (DEMO values) | `02-catalogue/src/desks.ts` |
| QR tools `request_phone_link`, `get_linked_phone` (web and robot agents only; the phone agent already has the number) | `11-phone/src/tools.ts` |
| Pass on the screen, phone QR, what to show from the events | `06-talk-app/components/SmartPass.tsx`, `lib/kiosk.ts` |
| Mobile pass `/pass/HALA-1001?k=…`, `/api/pass/:ref` (+ `/ics`, `/qr`) | `06-talk-app/app/pass`, `app/api/pass` |
| Texting the pass to the linked phone after a booking | `06-talk-app/lib/phone.ts` (`deliverPass`), hooked in `lib/server.ts` |

- **The pass link is signed.** References are sequential, so `/pass/HALA-1001` alone shows nothing: the QR carries `?k=` (HMAC of the ref with `HALA_TOOL_SECRET`). A wrong or missing `k` is a 404 on the API and an "invalid link" page.
- **The pass never carries a contact or a surname**, and the desk, the wait time and every fee are demo values (the pass says so). The "live queue" is a demo estimate: four minutes per person ahead, counting the real earlier bookings when the visit is today.
- **Events:** `phone_requested` (QR on screen), `phone_linked`, `booking_created` / `request_logged` / `booking_rescheduled` (each carries `pass` and `pass_url`), `pass_sent`, `handover_declined`, `conversation_scored`.

### Who deserves a person (triage)

A hand-over costs a staff member's time. The prompt now has three outcomes, decided at once, with no tool: **hand over** (emergency, fee dispute, legal, upset about a real problem, asks for a person), **offer a person** (a real DSO matter HALA cannot answer or do, asked once), **decline** (jokes, tests, nonsense, trolling, trivia, impossible asks) in one light sentence, never logged and never passed on. Behind the prompt, the `handover_to_human` tool refuses an obvious joke for the soft reasons (`out_of_scope`, `unknown_answer`, `other`) and records a `handover_declined` event instead; it never filters the five reasons that always need a person. The same caller cannot create the same hand-over twice (`conversation_id` + `reason`). No new hand-over reason was added: `hala_handovers` has a CHECK on the existing eight.

### Emirati hospitality

When the caller opens in Gulf dialect («شحالك؟ عساك طيب، بغيت أجدد الإقامة») the agent answers in warm Gulf Arabic with one hospitable phrase, then gets to the job: «يا مرحباً الساع! فديت خشمك، أبشر بالخير، الحين نرتّب لك موعد التجديد بكل سرور.» (it arranges the renewal *appointment*; it never claims the renewal is done). Formal Arabic stays Modern Standard Arabic with a light Gulf touch. A native Emirati speaker should still review the phrases.

### Sentiment and frustration into `hala_events`

ElevenLabs analyses every finished conversation. `05-provisioning/src/scoring.ts` asks its conversation list every minute (and when a conversation starts, and on `POST /api/conversations/score` with the admin key) and, for each conversation with a real score that is not written yet, adds one `conversation_scored` row and fills the same two numbers on the conversation's other rows that have none:

- `average_sentiment` = ElevenLabs `overall_sentiment_score`, **−1 (negative) to +1 (positive)**
- `average_frustration` = ElevenLabs `overall_frustration_score`, **0 (calm) to 1 (very frustrated)**

Stored unscaled. A conversation with no caller turn scored is skipped (its zeros mean "nothing"). To average **per conversation**, average over `type = 'conversation_scored'` only: the other rows repeat the same number. Supabase only (`HALA_SCORE_AUTO=0` turns the timer off).

### Voice: expressive mode and audio tags

Web and phone agents use `eleven_v3_conversational` with expressive mode and 7 suggested tags (`warmly, reassuring, cheerfully, thoughtful, apologetic, softly, chuckles`). The robot agent keeps the voice chosen by hand in the ElevenLabs dashboard on 24 Nov (`eleven_v4_turbo`, expressive mode, tags `empathetically, warmly, laughing, chuckles, enthusiastically, excitedly, sighs`), now **in code** so `agent:sync` does not overwrite it. The prompt allows at most one tag per reply and none in text messages, tags are stripped from text-thread replies, and `--voice flash` switches any channel to the plain fast voice (no tags, no tag paragraph in the prompt).

### Robot face, lights and screen (bridge 1.1.0)

The robot's emoji face, LED strip and screen follow the conversation (AgiBot docs 5.2.2 Screen Control, 6.1.26 Emoji Control, 6.1.33 LED Strip Control).

| What | How |
|---|---|
| **States** (instant, decided by the bridge itself) | listening: calm eyes + cyan breathing · speaking: calm eyes + cyan flowing · thinking (a tool is running, or the caller just finished a sentence): thinking face + blue blinking · conversation over: calm eyes once, then the face goes back to the robot's own system |
| **Moments** (decided by the website from what HALA did, within ~2 s) | booking confirmed: delighted + green flowing · request logged / phone linked / booking moved: happy + green · cancelled, hand-over: sympathy + amber (emergency: serious + red blinking) · joke declined: playful + cyan · tool trouble / no matching service: confused + amber |
| **QR on the robot's screen** | The screen plays video only, so the bridge builds a 2-second video of the QR (ffmpeg MP4, or a plain AVI without ffmpeg), puts it on PC3, and plays it on a loop. The **phone-link QR** shows while the agent waits for a number; the **Smart Pass QR** shows for 30 s after a booking. Same content as the laptop screen. |

Code: `13-robot/src/display.ts` (emoji table, LED modes, looks, what to show for a conversation), `13-robot/bridge/hala_robot_bridge.py` (the `Display` class), `06-talk-app/lib/robot-display.ts` and `app/api/robot/sync` (the website's side).

**Test everything from the dashboard:** Robot tab → select the robot → **Face & lights**. *Run all checks* goes through 5 looks, 3 LED colours and a QR, a few seconds each; every emoji, look, LED mode/colour, QR text and video path also has its own button, and each test shows what the robot answered (worked / failed + the reason). A test takes over the face for 12 s, then the conversation looks resume. Tests are kept in the server's memory, not the database (`hala_robot_commands` has a CHECK on its four original command types).

**Set-up on the robot** (all optional environment variables of the bridge; see the top of `hala_robot_bridge.py`):

- Download the new bridge (the Connect tab's command does it) and restart it. Older bridges answer "unknown command display" in the test card.
- **LEDs:** run `aima em stop-app task_manager` on PC1 first, or it fights for the strip. The strip answers in up to 5 s.
- **Priorities:** emoji/video priority 11 (`HALA_FACE_PRIORITY`) beats the system's 10 for faults, which also means HALA's face hides fault expressions while it is showing. Idle is played once and not repeated so the robot's own faces can return.
- **Videos must be on PC3** (the interaction computer), readable by all. If the bridge runs on PC2 set `HALA_PC3_SSH=user@10.0.1.42` (key login, no password prompt) so it copies the file with scp; otherwise the file is written to `HALA_VIDEO_DIR` (default `/var/tmp/hala`) on the computer the bridge runs on.
- `HALA_FACE=0` turns all of it off (voice only). `HALA_VIDEO_SIZE=720x720` sets the QR video size; the screen's real size is not documented, so adjust it if the QR looks small.

**Verified:** the bridge in simulation mode against the running website (every command round trip, the generated MP4 decodes with OpenCV back to the exact URL), the look logic with a stub robot (`13-robot/test`), and the dashboard tab in a real browser. **Not verified: anything on the real robot.** The three AimDK services are called exactly as in the AgiBot samples, but the request header field names (`header.header.stamp` vs `request.header.stamp`) and whether PC3 plays a raw AVI are untested; the test card shows the robot's own answer for each, which is what to check first.

### Syncing the live agents safely

`agent:sync` replaces the whole agent config, so a change made by hand in the ElevenLabs dashboard is lost unless it is also in code. **Always look first** (read-only, changes nothing):

```bash
npm run agent:diff -- --channel web --lean --no-sheet     # also: --channel robot --lean --no-sheet, --channel phone
```

Sync only from **this checkout (`hala-phone`)**, never from `hala` (it would overwrite the new prompt and tools), with the flags each live agent was built with, and with `.env.hala` holding `HALA_KB_B64` and `HALA_PROC_START_*` (without the first, the web and robot agents lose their knowledge base). The phone line has no knowledge base on purpose and the sync keeps it that way.

```bash
npm run agent:sync -- --channel web --lean --no-sheet
npm run agent:knowledge -- --only procedures --agent web      # the lean agents read their flows from procedures
npm run agent:sync -- --channel robot --lean --no-sheet
npm run agent:knowledge -- --only procedures --agent robot
npm run agent:sync -- --channel phone
```
Try a change on a throw-away copy first: `--dev` creates "HALA Concierge (dev)", and `HALA_AGENT_ID=<its id> npm run evals:live -- --yes` runs real conversations against it.

**Conversation first, booking on request (25 Nov).** Naming a service no longer starts a booking. The prompt section "Talk first, book later" (`01-core/src/prompt.ts`) makes HALA answer briefly, ask ONE question about the caller's situation per turn, and offer an appointment once; the booking procedure only loads for an explicit ask or a yes to that offer. The first procedure in `01-core/src/procedures.ts` is pinned as the START procedure (`HALA_PROC_START_*`, sent with every web and robot conversation, so it is in context from the first word): it is now "Understand what the caller needs", never the booking flow. When the booking flow was the start procedure, every conversation began with "one appointment in as few turns as possible" and the agent asked for a day before it had listened (text-only tests never load the start procedure, so only a voice run shows it: `agent/13-robot/tools/voice_latency.py`). After changing procedures, re-run `agent:knowledge --only procedures --agent web|robot`. What it learned goes into the optional `notes` of `book_appointment`, stored on the `booking_created` event (no database change). Live check: `npm run evals:live -- --yes --only talks_before_booking`. The full-prompt budget in `07-evals/test/compliance.test.ts` was raised to 17,900 characters for this.

`agent:diff` (25 Nov) now compares every webhook tool field by field (URL, timeout, fields) and, with `--lean`, every procedure (exact content and trigger, unpublished drafts). "0 difference(s)" means the live agent equals the code. It deliberately ignores `built_in_tools`: a sync through the SDK does not store `end_call` / `language_detection` (a raw API call does), so they were never live on any HALA agent, and real calls follow the caller's language without them. It also cannot see the phone agent's `dynamic_variable_placeholders` or `thinking_budget: 0` (same reason: the calls always pass all four variables, and the placeholders are only a safety net).

### Robot test day: before you press Start

1. **Serve the production build, never `next dev`.** `next dev` compiles each route on its first call; for the tool route that took about 7 s, longer than the agent's 8 s tool timeout, so the first booking-related tool call of a fresh server failed twice on 24 Nov. `.\start-phone-demo.ps1 -Force` builds, starts the production server, and runs the pre-flight. If scripts are blocked: `powershell -ExecutionPolicy Bypass -File .\start-phone-demo.ps1 -Force`.
2. **`.\warm-up.ps1`** is the pre-flight (read-only, writes nothing): server up, Supabase store, the public tunnel reaches the server, every tool route accepts the secret through the tunnel in under 1.5 s, and the robot's status (online, bridge version, last seen). Run it again right before filming.
3. **Do not restart cloudflared.** A new quick-tunnel URL means: put it in `.env.hala`, re-run `agent:sync` for web, robot and phone (tools point at it), and change `HALA_URL` on the robot.
4. **The robot needs bridge 1.1.1** (`curl -fsSL $HALA_URL/hala_robot_bridge.py`). The file is served from the build, so rebuild after editing `public/hala_robot_bridge.py`.
5. The website's `desired` state for the robot is remembered: if it says `running`, the bridge opens a conversation (and the greeting plays) the moment it starts. Press Stop on the Robot page first if you do not want that.
6. If the start of sentences sounds choppy on the robot: `HALA_PREBUFFER=0.25`. If the robot hears itself: raise `HALA_ECHO_TAIL` (default 0.3). With the raw microphone the robot cannot be interrupted while it speaks (no echo cancellation, so the mic is closed): do not script an interruption.
7. When a conversation ends (end of call, or the 10-minute cap) the bridge starts the next one by itself, with the greeting. Press Start right before the take.

## Rules the agent follows (what the judges mark)

- **Says it is an AI**: in the opening line, in both languages, and whenever asked.
- **English and Arabic**: Gulf-friendly Modern Standard Arabic, feminine self-reference, switches when the caller switches.
- **Never invents**: fees, times, documents and facts come only from tool results. The fact base holds only facts from the brief and `handover.md`. Not found means "I don't know" plus an offer to hand over.
- **Demo values labelled**: every fee and processing time is spoken with a demonstration notice.
- **Hands over only when it is worth a person**: fee disputes, legal questions, upset callers, requests for a person, emergencies, and real DSO matters it cannot do. Jokes, tests and impossible requests are declined, not passed to staff.
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
