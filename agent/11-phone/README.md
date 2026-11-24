# 11-phone: the HALA phone line

Server half of the **HALA Phone** iPhone app (`ios/HalaPhone`, built by GitHub Actions): calls, texts, voice-message replies, a QR link flow, and calls that HALA starts by itself. No Twilio: the "phone network" is our own server and a dummy-phone app.

```
 iPhone app ──voice (WebRTC)──────────────► ElevenLabs "HALA Concierge (phone)" agent
     │  GET /api/token?channel=phone                │ webhook tools (same 9 + 2 phone tools)
     │  POST /api/phone/sms {from, body}            ▼
     ├────────────────────────► 06-talk-app ──► text session (websocket) ─► same agent, text-only
     │  GET /api/phone/inbox (poll 2 s)              │            │
     ◄── texts, voice messages, calls to ring ───────┘            └─► TTS (mp3) for voice-message replies
 robot screen ── QR halaphone://link?code=K7M2QX&server=https://… ──► app opens on Messages, text pre-filled
```

## What is here

| File | What it does |
|---|---|
| `src/store.ts` | `PhoneStore` port + JSON adapter: link codes, who each phone is, threads, pending calls. Swap for Supabase later (same interface). |
| `src/codes.ts` | Link codes (6 chars, no 0/O/1/I/L), parsing, the `halaphone://` deep link. |
| `src/sms.ts` | A text arrives: link a code, or ask the agent, store the answer; voice reply if asked. |
| `src/agent-text.ts` | One live text-only websocket session per phone to the ElevenLabs agent (tools work as on a call). |
| `src/nudge.ts` | Proactive calls: plan from the bookings store, word with a small model, check against the facts. |
| `src/hackclub-ai.ts` | Hack Club AI client (OpenAI-compatible, `Authorization: Bearer`). |
| `src/tools.ts`, `src/prompt.ts` | Two phone-only tools and the prompt addendum. `TOOL_SPECS` is untouched. |

## Setup (about 5 minutes)

```bash
npm install
npm run agent:sync -- --channel phone        # creates "HALA Concierge (phone)", pins HALA_AGENT_ID_PHONE in .env.hala
npm run agent:dev                            # http://localhost:3005  (the tunnel keeps pointing here)
curl localhost:3005/api/phone/status         # what is ready, and what is missing
```

The tunnel (`cloudflared tunnel --url http://localhost:3005`) and `PUBLIC_BASE_URL` work as for the web agent. If the tunnel URL changes, re-run `agent:sync -- --channel all` so the agents call the new address. The robot page shows the QR; the QR carries the tunnel URL, so scanning it also points the app at the right server.

Optional, in `.env.hala` (never commit, never paste in chat):

```
HACKCLUB_AI_KEY=…        # Hack Club AI key. Without credits/quota the fixed wording is used (see below)
HACKCLUB_AI_MODEL=…      # comma separated, tried in order. Default: gemma-4-31b-it:free, ling-3.2-flash:free, claude-haiku-5.5
HALA_NUDGE_AUTO=0        # off switch. By default the server scans bookings every minute and rings people with an appointment in the next 24 h
```

**Hack Club AI status (checked 2026-11-24):** the key authenticates, but paid models answer `402 insufficient credits` and the free models answered `429` (daily free quota used up). `queueNudges` and the demo button therefore fall back to the fixed template, which is correct and already says it is an AI. When credits or the daily reset arrive, the model wording switches on by itself (`/api/phone/status` shows `hackClubAi: true` once a key is set, and the demo response says `byModel`).

**Supabase:** the booking tables are live. For the phone tables, paste `migrations/002_hala_phone_tables.sql` into the Supabase SQL editor once. Until then phone data uses `.data/phone-store.json` (`/api/phone/status` says which). After running it, restart the server; the phone store switches to Supabase on its own. DDL cannot be run with the service key, so this one paste is manual.

The phone agent is a separate agent on purpose: the robot take on Wednesday 07:30 uses the web/robot agents, and none of the phone variables or tools touch them. To let the robot agent also accept "read me your code", run `agent:sync -- --channel robot --contact-tool` (adds `lookup_contact_by_code` only).

## The flows

1. **Link a phone (QR).** The talk page shows a QR with a one-time code. The iPhone camera opens HALA Phone on Messages, pre-filled with `HALA K7M2QX`. Sending it makes the server store *code → this phone* and the page flips to "Phone linked ✓" (masked number). Later the person can read the code to the agent and `lookup_contact_by_code` returns the number, so nobody says a phone number aloud.
2. **Text.** `POST /api/phone/sms {from, body, voice?}`. The first text of a thread gets the AI disclosure. Replies can come back as a voice message (mp3, with transcript).
3. **Call HALA.** The app dials `800 4252` (800-HALA) and joins the agent over WebRTC with `caller_number` / `caller_name` as dynamic variables, so the agent already has the contact for bookings.
4. **HALA calls you.** `POST /api/phone/nudge` (or `HALA_NUDGE_AUTO=1`) finds linked phones with a confirmed booking in the next 24 h. Wording: AI disclosure (code) + model sentence checked to contain the real time, else a template. The app polls `/api/phone/inbox`, shows an incoming-call screen with a ringtone, and on *Accept* starts the call with the opening line as the agent's first message.
5. **Different people.** The app's *Lines* tab holds several dummy numbers; the active one is the `from` and `caller_number`.

## Five-minute demo, start to finish

1. Install the IPA (see `ios/HalaPhone/README.md`). Lines tab → *Test connection* shows what is ready.
2. Open `http://localhost:3005`. Scan the QR with the iPhone camera → HALA Phone opens on Messages with `HALA XXXXXX` filled in. Send it → the page flips to *Phone linked*.
3. Text it: "How do I get an access card?" then «المكيف خربان». Turn on *Reply with voice messages* (the + button) and text again.
4. Keypad → 800 4252 → call. Say "Hello"; ask for something. Try *captions*.
5. Lines → *HALA calls me about my appointment*. The phone rings, Accept, and HALA opens with the reminder (AI disclosure first).
6. Lines → pick *Omar Haddad* and text/call again: a different person, Arabic first.

Test helpers (admin key = `HALA_ADMIN_KEY`; the demo button needs none):

```bash
curl -X POST localhost:3005/api/phone/ring -H "x-hala-admin-key: $KEY" -H 'content-type: application/json' -d '{"phone":"+971501234567"}'
curl -X POST localhost:3005/api/phone/nudge -H "x-hala-admin-key: $KEY"
curl localhost:3005/api/phone/contacts -H "x-hala-admin-key: $KEY"
```

## Honest limits

- **No VoIP push on a free Apple ID.** HALA can ring you while the app is open, or in the background if *Keep line open* is on (a silent audio loop; the screen can be locked, the app must not be force-quit). A ring while the app is fully closed needs PushKit/APNs: a paid developer account, then CallKit for the native call screen. The server side (`rings`) is already shaped for it.
- **The number is a label, not proof.** Anyone can type any number in the app. That is the point of the demo; do not put real data behind it.
- Sideloaded builds from a free Apple ID expire after 7 days.

## Supabase

`createSupabasePhoneStore` implements the same `PhoneStore` port as the JSON file (one shared contract test runs against both). Tables: `hala_phone_codes`, `hala_phone_contacts`, `hala_phone_messages`, `hala_phone_rings`, `hala_phone_conversations`. Voice-message mp3 files stay on the server's disk (`.data/voice`). The proactive source (`planNudges`) reads `BookingRepo`, so it follows whatever store the bookings use.
