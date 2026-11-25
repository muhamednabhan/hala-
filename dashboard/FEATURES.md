# HALA Concierge dashboard — what every feature does

The dashboard is the operations screen for DSO staff. HALA (the voice agent on the robot, the phone line and the
web page) talks to callers; the dashboard shows what HALA did, what is still waiting on a person, and lets staff act.

**Live** shows the team's real data (Supabase). **Demo** shows realistic made-up data and works with no internet.
Switch between them in the header.

---

## Everywhere (header and filters)

| Feature | What it does |
|---|---|
| **Live / Demo switch** | Live = real calls from the robot, phone and web. Demo = simulated calls (a new one every 5 seconds), safe for a projector. Remembered per browser. |
| **Connection dot** (Live) | Green = Supabase is connected. Hover for details (e.g. "4 bookings · 30 events"). |
| **Alerts bell** | Turns the handover pop-up (and its chime) on or off on this screen. |
| **Sign out** (Live, deployed) | Ends the staff session. Live data needs the staff password; demo doesn't. |
| **Clock** | Current time and date, for the operations room. |
| **Period filter** | Today / 7 days / All. Applies to every page. |
| **Channel filter** | All / Robot / Phone / Web: only calls from that channel. |
| **Language filter** | All / English / Arabic: only calls in that language. |
| **Hide test calls** (Live) | Leaves out the team's tests ("Smoke Test", `smoke-*`, `prod-smoke`, `t`) so numbers are real. On by default. |
| **Call drawer** | Click any call, row or feed item: a side panel with the call's channel, language, caller, requests (with the full case across calls), HALA's evaluation (when ElevenLabs is connected) and the transcript. "Copy call ID" copies the ElevenLabs id for the team. |

### Handover pop-up
Appears (with a chime) the moment HALA hands a caller over to a person, on any page:

- **Who:** caller's name and number as HALA collected them (filled from the phone contact or booking if HALA didn't ask).
- **Why:** the reason (fee dispute, out of scope, asked for a person, emergency, upset caller, legal question, didn't know) and HALA's one-line summary for the human.
- **On the call now:** the last lines of the conversation.
- **History:** this caller's earlier calls and cases (bookings, tickets, earlier handovers) with status; complaints and
  disputes in red, still-open items in amber. "First time HALA has heard from this caller" if there is none.
- **Pick up:** takes the handover (saved to Supabase) and closes the pop-up. **Full call:** opens the call drawer.
- Several at once queue up ("+1 more waiting"). Handovers already waiting when the page opened don't pop up; they are on the Handovers page.

---

## 1. Overview — the pitch screen

### Service performance (metric cards — every card is clickable)
| Card | Meaning | Click opens |
|---|---|---|
| **Resolution rate** (headline) | % of requests HALA solved end-to-end, without staff | Requests → Solved |
| **Total calls** | Conversations in the period; "today" underneath | Conversations |
| **Total requests** | Things callers asked for (one call can hold several); average per call | Requests → All |
| **Calls with an action** | Calls that ended in a booking, ticket or handover | Conversations |
| **Solved / Open / Needs follow-up / Unsolved** | Requests in each status, with % of all requests | Requests filtered to that status |
| **Bookings made** | Appointments booked by HALA; rescheduled and cancelled underneath | Bookings → Upcoming |
| **Handovers waiting** | Callers waiting for a person right now (amber when > 0) | Handovers → Waiting |
| **Knowledge gaps** | Questions HALA couldn't answer, waiting for staff | Teach the agent → Waiting |
| **Average call** (or **Caller rating** if ratings exist) | Average call length | Conversations |
| **Language split** | English / Arabic / mixed share of calls | — |

**Status meanings:** *Solved* = HALA finished it (booked, cancelled, moved, answered). *Open* = a ticket staff still
have to do. *Needs follow-up* = promised a person, or open too long. *Unsolved* = HALA couldn't help (didn't know,
out of scope, fee dispute, caller left).

### Live activity
Every action HALA takes, newest first: "18:53 · EN · NOC · HALA-1001 · booked for Wed 09:30". Colour = status of that
request now. Includes HALA's own reminder calls. Click a line → the call.

### Pattern insights (clickable)
Findings worked out from the collected data, most urgent first:
- **Most-asked question with no answer** → Teach the agent.
- **Weakest / strongest service** (resolution rate per service vs overall) → those requests.
- **Why requests go unsolved** (top reason, with what to do about it).
- **Arabic vs English** resolution — flags a language gap.
- **Repeat callers** who still have something open.
- **Services asked together** in the same call.
- **Peak hour** of demand.
- **What an unsolved request costs in rating** (when ratings exist).

### Live conversation
The newest call as chat bubbles: "On air" while it is happening, robot/phone/web, language, the requests in it.
Arabic reads right-to-left. "Details →" opens the call drawer.

---

## Calendar
The **appointments HALA booked**, placed on the date and time they are booked for (not when the call happened),
**tagged by service** — each of the 14 services has its own colour.

- **Week view:** days across, hours down (08:00–18:00, stretched if a slot falls outside). **Month view:** up to 3 per
  day and "+N more"; click a day number to open that week.
- Each appointment shows its time, service, reference (e.g. HALA-1004), attendee and number. Click → the call it was booked in.
- **Service tags** above the grid are the legend *and* the filter (with counts); "Show all" resets.
- **Show cancelled** adds cancelled appointments, struck through. **← Today →** moves through weeks or months.
- Test bookings ("Smoke Test", "Latency Test"…) are hidden with "Hide test calls".

## 2. Conversations
Every call, newest first: time, **channel** (Robot / Phone / Web, plus "↗ HALA called" for calls HALA made), language,
services, caller name, what was said, outcome dots (one per request, coloured by status), length.
**Search** what callers and HALA said, in English or Arabic. Click a row → call drawer.

Where transcripts come from: robot calls from the robot's log, phone chats from the phone line, web/phone voice calls
from ElevenLabs (when its key is connected).

---

## 3. Requests
Every request across all calls. **Tabs:** All / Solved / Open / Needs follow-up / Unsolved (with counts), and a
**service filter**. Columns: time, caller (language + number), service — with **"↻ 2 calls · HALA-1004"** when one case
spans several calls — the caller's question, status, how it ended, age.

**A case across calls:** everything about one booking reference is one request: booked by phone → HALA's reminder
call → cancelled. The call drawer lists the steps with links between the calls.

**Actions:** *Mark solved* and *Edit* (status + "what staff did") on maintenance tickets and complaints — saved to
Supabase. Other rows show "—"; hover says where they are handled (Bookings, Handovers or Teach the agent).

---

## 4. Follow-ups
**Waiting on DSO:** requests where the caller was promised a person, or that stayed open too long. Each shows how long
it has waited, the question, the number, and whether HALA already called them back. Buttons go to where it is handled:
**Take over →** (Handovers), **Answer it →** (Teach the agent), **Open booking →**; **Mark solved** for tickets.

**Appointments in the next 24 hours:** time, service, reference, attendee, number, and whether **HALA's reminder call**
went out and its result (e.g. "answered").

---

## 5. Teach the agent
Questions HALA answered with "I don't know", grouped (the same question typed differently counts once) and sorted
by how often they were asked.

- **Counters:** questions waiting, answered by admins, times asked.
- **Answer:** type the answer in English (Arabic optional), pick the service → saved in Supabase `hala_knowledge_answers`, moves to *Answered*.
- **+ Add a question and answer:** teach something before anyone asks.
- **Out of scope:** HALA should hand this to a person instead of answering. **Move back** undoes it.
- **Edit answer** on the Answered tab.

HALA starts giving these answers to callers once the agent's `lookup_fact` tool reads the table (agent team's part).

---

## 6. Handovers
Callers HALA passed to a person. **Tabs:** Waiting / Picked up / Resolved. Each card: reason, language, service, when,
**live waiting time** (amber after 10 minutes), and **"HALA already collected"** — the agent's summary, so staff don't
re-ask. **Pick up** → Picked up. **Resolve** → Resolved, and the caller's request counts as solved.
**Transcript →** opens the call.

---

## 7. Bookings
HALA's appointments by day (Today / Tomorrow / date). **Tabs:** Upcoming / Past, and a service filter. Each: time,
service, reference, attendee (and who booked, if different), number, status (Confirmed / Cancelled).

**Actions:** **Reschedule** (pick a new date and time; the database refuses a slot that is already taken) and
**Cancel** — both go through the agent's own booking rules.

---

## Security (for the team)
- Keys live only on the server (`server/`), never in the browser.
- Live data needs the staff password when deployed; sessions last 12 hours.
- The server allows only what these features need: reading the `hala_*` tables, updating **one** handover, booking,
  ticket or answer at a time, and adding Teach answers. Deletes, bulk changes and other tables are refused.
- 39 automated tests cover the security rules, login and data mapping.

---

## Design
Follows the *Dubai Silicon Oasis Design System* (concept v0.1): Midnight sidebar with the linked-nodes mark, Oasis Navy / Signal Blue / Circuit Cyan / Slate / Sky Mist / Cloud colours, Barlow Condensed headings and numbers, Oxygen body text, 6 px controls, 12 px cards, pill chips, "The Link" bar in the agent panel, and the three-tone sonic logo on handover.
