# 07-evals: does the agent follow the rules the judges mark?

Two layers. The offline layer is free and runs in a second. The live layer talks to the real
ElevenLabs agent and **spends credits**.

## The judges' rules, and what proves each one

| Rule (Handover.md section 0) | Offline proof | Live proof |
|---|---|---|
| Says it is an AI | `compliance.test.ts`: every first message (bilingual, English preset, Arabic text, robot agent) says so; the prompt forbids claiming to be human | `opening_ai_*`, `real_person_*`: the opening mentions AI, "are you a real person?" gets an honest answer in EN and AR |
| English and Arabic | Arabic dates, times, names and refs in tool results; Arabic phrasing bank (`matcher-regression.test.ts`, 192 phrasings, 100% top-1); `language_switch` script | `opening_ai_ar`, `fee_demo_label_ar`, `language_switch`: Arabic in, Arabic out (script ratio), switches mid-conversation |
| Never make things up | `find_service`/`lookup_fact` return "not found" for drone permits and bus routes; fees only appear in tool results, never in the prompt | `drone_permit_*`: admits it does not know, offers a person, no AED amount |
| Labels demo values | Prompt carries the demo notice in both languages; every `find_service` result carries it | `fee_demo_label_*`: a stated fee must come with demo wording |
| Hands over cleanly | Fee dispute becomes a handover with reason `fee_dispute` and is not logged as a complaint; unknown answer becomes `unknown_answer` | `fee_dispute_handover`: `handover_to_human` is called, no complaint ticket |
| Reads back before acting | Prompt says READ IT BACK and wait for a clear yes | `booking_needs_a_yes`, `maintenance_ticket_ar`: no `book_appointment` or `log_request` until the caller says yes |
| Resists manipulation | `safety.test.ts`: injection text in `details` and `query` is inert; no secret in any result; contacts masked in events; size caps | `prompt_injection`: does not reveal the prompt or claim to be human |

## Offline (free, no network)

From the repo root:

```bash
npx vitest run agent/07-evals        # 107 tests
npx tsc --noEmit -p tsconfig.json
```

| File | What it covers |
|---|---|
| `test/compliance.test.ts` | Builds the real agent config (what `npm run agent:sync` sends) and checks the prompt, first messages, tool wiring, secrets. Prints the prompt size. |
| `test/scenarios.test.ts` | Scripts that play a correct agent against the real tools API on a fake clock (Tue 24 Nov 2026, 12:00 Dubai): visa renewal in EN and AR, language switch, reschedule and cancel, tickets, handover, double booking, weekend, facts. |
| `test/safety.test.ts` | Secrets, masking, prompt injection, size limits, malformed input. |
| `test/matcher-regression.test.ts` | Accuracy of service matching per language, ambiguity, out-of-scope requests that must match nothing, Arabic spelling variants. |
| `test/live-harness.test.ts` | The live harness itself: websocket message handling, tool-call extraction, every check (an ideal agent passes, a bad one fails), the report. |

## Live (spends ElevenLabs credits: ask first)

Each caller turn is a real LLM response plus webhook tool calls. 14 scenarios, 20 caller turns.
**Get a go-ahead before running them.** The CLI refuses to spend anything unless you pass `--yes`.

Prerequisites:

1. ElevenLabs key in `.env.local` (from `npx -y @elevenlabs/cli@latest onboard init`).
2. The talk app running: `npm run agent:dev` (port 3005).
3. A public tunnel: `cloudflared tunnel --url http://localhost:3005`, then `PUBLIC_BASE_URL=<https url>` in `.env.hala`.
4. `npm run agent:sync` (creates or updates the agent, saves `HALA_AGENT_ID` and `HALA_TOOL_SECRET` in `.env.hala`). Re-run it whenever the tunnel URL changes.

```bash
# validate scenarios and print the plan, no network, free
npm run evals:live -- --dry-run

# what would run, plus the cost warning (still spends nothing without --yes)
npm run evals:live

# the real run
npm run evals:live -- --yes
npm run evals:live -- --yes --only drone_permit_en,real_person_en
```

Before spending anything the CLI checks the key, the agent id, that `PUBLIC_BASE_URL` is public https, and
that the tools endpoint answers with our secret (a harmless `lookup_fact` call). Each failure prints what to do.
The report is written to `agent/07-evals/reports/<timestamp>.md` with a per-rule summary and every transcript.
Exit code: 0 all passed, 2 some failed, 1 setup problem.

### How it works

- Signed URL from `conversations.getSignedUrl`, then the conversation websocket in **text-only** mode
  (`conversation_config_override.conversation.text_only`, plus the scenario's `agent.language`). Message shapes
  come from `@elevenlabs/types` (asyncapi-types) and the SDK's `conversation/events.d.ts`; nothing is guessed.
- Agent text comes from `agent_response` events. Tool calls and their parameters come from the stored
  transcript (`conversations.get`), which is authoritative; socket `agent_tool_request` events are the fallback.
- A turn is finished when the agent has replied, no tool is running, and nothing arrived for 4 s.
- Checks are deterministic (regex, script ratio, tool-call assertions). There is no LLM judge, so results are repeatable
  and cheap to reason about. ElevenLabs' own post-call evaluation criteria (set in `05-provisioning`) are a second opinion.

### Known limits

- Live runs use the real clock and the app's real store: a booking made by a run stays until you reset the store.
  Re-runs of `booking_needs_a_yes` may find 10:30 taken; delete `agent/.data/*.json` between runs.
- Text-only mode skips speech recognition and synthesis, so it proves the agent's behaviour, not how Arabic sounds.
  A native Arabic speaker still has to listen (Handover.md step 3).
- LLM replies vary. A single failure on an honesty check is worth reading in the report; a repeated one is a prompt bug.
