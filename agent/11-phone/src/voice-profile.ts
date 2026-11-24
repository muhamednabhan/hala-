/**
 * The "talks like a person" profile for the phone agent: everything that decides how fast and how natural a
 * call feels. Plain data, so provisioning can apply it to any channel (`agent:sync --human`).
 *
 * Why these values (measured on 2026-11-24, text-mode turns against the live agent, time to the first words):
 *
 *   model                  plain reply   with a tool, EN   with a tool, AR
 *   gemini-3.8-flash          2.1 s          4.7 s             8.8 s        (the old default)
 *   gemini-3.1-flash-lite     0.85 s         1.8 s             2.3 s        <- chosen, and the only one that
 *   gemini-3.5-flash-lite     0.83 s         1.8 s             2.6 s           called the tool in both languages
 *   gpt-4.1-mini              0.86 s         2.2 s             1.1 s (no tool call)
 *   gpt-4.1-nano              1.4 s          2.9 s             3.0 s
 *
 * Speech: time to first audio was the same for eleven_flash_v2_5, eleven_v4_turbo and eleven_v3_conversational
 * (about 520 to 700 ms from the laptop); eleven_v4 was twice as slow, so it is not used. v3_conversational is the
 * most natural of the fast ones, and flash stays one env var away (HALA_TTS_MODEL).
 */
export const HUMAN_LLM = 'gemini-3.1-flash-lite'
export const HUMAN_TTS_MODEL = 'eleven_v3_conversational'

/** Shorter than the shared greeting: still says it is an AI in both languages, but a caller hears it in ~4 s. */
export const PHONE_GREETING = "Hi, this is HALA, an AI assistant. أهلاً، معك هلا، مساعدة ذكاء اصطناعي. How can I help? كيف أقدر أساعدك؟"

/** A caller saying "mm-hm" or "yeah" while HALA talks is listening, not interrupting. */
export const BACKCHANNEL_TERMS = [
  'mm-hmm', 'mhm', 'uh-huh', 'yeah', 'yep', 'okay', 'ok', 'right', 'i see', 'got it', 'sure', 'aha',
  'اها', 'اه', 'ايه', 'أيوه', 'طيب', 'تمام', 'ماشي', 'اوكي', 'صح', 'مم'
]

export const humanTurn = {
  /** Jump in as soon as the caller has finished, the way a person does. */
  turnEagerness: 'eager' as const,
  spellingPatience: 'auto' as const,
  /** Start the answer while the caller's last word is still settling. */
  speculativeTurn: true,
  turnModel: 'turn_v3' as const,
  silenceEndCallTimeout: 45,
  turnTimeout: 8,
  /** If the model is slow (a tool call, a long answer), say something natural instead of going silent. */
  softTimeoutConfig: {
    timeoutSeconds: 1.4,
    useLlmGeneratedMessage: true,
    maxSoftTimeoutsPerGeneration: 2,
    disableUntilFirstUserMessage: true
  },
  interruptionIgnoreTerms: BACKCHANNEL_TERMS,
  interruptionIgnoreTermLanguages: ['en', 'ar'],
  mergeWithDefaultIgnoreTerms: true
}

export const humanTts = {
  /** Lower than the default: more movement in the voice, less read-aloud. */
  stability: 0.45,
  similarityBoost: 0.8,
  speed: 1.03,
  expressiveMode: false
}

/** Tools that only read data are announced before they run ("let me check"), so the wait is never silent. */
export const SPOKEN_BEFORE_TOOLS = ['find_service', 'list_slots', 'lookup_fact', 'check_booking']

export const HUMAN_VOICE_PROMPT = `
# Sound like a person on the phone
- Talk the way a warm, quick receptionist talks: short sentences, contractions, plain words. One or two sentences a turn, then stop and let them speak.
- React before you answer when it fits: "Sure.", "Of course.", "Ah, got it." In Arabic: «أكيد»، «تمام»، «أبشر»، «آه فهمت». Vary them. Never open two turns the same way.
- Answer first, details second. Never list more than two things at once; offer the rest if they want it.
- Ask one question at a time. Do not repeat back what the caller just said unless you are confirming a booking.
- If you need a moment for a step, say a few natural words first ("Let me check that for you."). Do not go silent.
- Never say "as an AI language model". Do not apologise more than once. Do not stack fillers.
`
