import type { ElevenLabs } from '@elevenlabs/elevenlabs-js'
import { BILINGUAL_GREETING, FIRST_MESSAGE, buildSystemPrompt, type Service } from '@hala/core'
import { FACTS, SERVICES } from '@hala/catalogue'
import { TOOL_NAMES, TOOL_SPECS, type ToolSpec } from '@hala/tools-api'
import {
  HUMAN_LLM, HUMAN_VOICE_PROMPT, PHONE_DYNAMIC_DEFAULTS, PHONE_GREETING, PHONE_PROMPT_ADDENDUM, PHONE_TOOL_NAMES, PHONE_TOOL_SPECS,
  humanTts, humanTurn
} from '@hala/phone'

/**
 * Where the agent runs. They differ only in audio format:
 *  - web:   browser WebRTC. ElevenLabs defaults.
 *  - robot: the AgiBot/MangoBot bridge sends and expects PCM 16 kHz (Handover.md, phase 1).
 *  - phone: the HALA Phone iOS app (calls over WebRTC, texts over the server). Its own agent, so the
 *           caller-number variables and phone tools can never affect the web and robot agents.
 */
export type Channel = 'web' | 'robot' | 'phone'

export interface AgentConfigOptions {
  channel?: Channel
  /** Public https URL that ElevenLabs servers can reach (cloudflared tunnel or a deployed host). */
  publicBaseUrl: string
  /** Shared secret sent as x-hala-secret on every tool call. */
  toolSecret: string
  voiceId?: string
  llm?: ElevenLabs.Llm
  services?: Service[]
  /** Sampling temperature: low, because this agent must not improvise facts. */
  temperature?: number
  /** Give a web/robot agent the "caller reads a link code" tool too. The phone agent always has it. */
  contactTool?: boolean
  /**
   * The "talks like a person" profile on top of the shared speed settings: the fastest measured model, no model
   * "thinking", a little more vocal movement, and backchannels ("mm-hm") that do not interrupt. On by default for the
   * phone agent; `agent:sync --human` applies it to web/robot too.
   */
  humanVoice?: boolean
  /** TTS model override (HALA_TTS_MODEL), e.g. eleven_flash_v2_5 to go back to the plain fast model. */
  ttsModel?: ElevenLabs.TtsConversationalModel
  /** Override every tool's pre-speech ("one moment") mode. 'off' removes spoken fillers before tools. */
  preSpeech?: 'force' | 'auto' | 'off'
  /** Appended to the agent name, e.g. "(dev)", so an experiment never touches the live agent. */
  nameSuffix?: string
  /** Keep the full service sheet in the prompt (default). False: only an index; details come from the knowledge base. */
  sheet?: boolean
  /** Lean prompt: flows live in procedures (synced separately), so the base prompt is short. */
  lean?: boolean
  /** Knowledge base documents to attach (retrieval on demand). */
  knowledge?: { id: string; name: string }[]
  /** Pronunciation dictionary to apply to everything the agent says. */
  pronunciation?: { pronunciationDictionaryId: string; versionId?: string }
  /** 'v3' = expressive (audio tags, richer voice). 'flash' = fastest. */
  voiceModel?: 'v3' | 'flash'
  /** Thinking effort for reasoning models. Lower is faster. Leave unset to use the model's default. */
  reasoningEffort?: ElevenLabs.LlmReasoningEffort
}

/** Female, multilingual premade voice that handles English and Arabic on the flash multilingual model. */
export const DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL'
export const DEFAULT_LLM: ElevenLabs.Llm = 'gemini-3.5-flash' // measured: about 1.2 s to first word vs 1.4-4 s for gemini-3.8-flash, and it keeps the caller's language
/**
 * Arabic is the base language on purpose. ElevenLabs forces an English-primary agent onto the
 * English-only TTS model, which garbles Arabic (kit gotcha G1). With Arabic as the base the
 * multilingual model is used for both languages, and English is added as a language preset.
 */
export const BASE_LANGUAGE = 'ar'
/** Expressive conversational voice model: understands audio tags such as [warmly] and speaks Arabic and English. */
export const V3_MODEL: ElevenLabs.TtsConversationalModel = 'eleven_v3_conversational'
/** A few tags only. Too many make a receptionist sound like an actor. The agent is told to use at most one per reply. */
export const AUDIO_TAGS: { tag: string; description: string }[] = [
  { tag: '[warmly]', description: 'a warm, welcoming greeting or thanks' },
  { tag: '[reassuring]', description: 'calming an upset or worried caller' },
  { tag: '[cheerfully]', description: 'good news, a confirmed booking' },
  { tag: '[thoughtful]', description: 'checking something or considering a question' },
  { tag: '[apologetic]', description: 'a mistake, a delay, or something that cannot be done' },
  { tag: '[softly]', description: 'sensitive moments' }
]
export const TTS_MODEL: ElevenLabs.TtsConversationalModel = 'eleven_flash_v2_5'

export const agentName = (channel: Channel = 'web') =>
  channel === 'robot' ? 'HALA Concierge (robot)' : channel === 'phone' ? 'HALA Concierge (phone)' : 'HALA Concierge'

function toWebhookTool(spec: ToolSpec, baseUrl: string, secret: string, preSpeech?: 'force' | 'auto' | 'off'): ElevenLabs.PromptAgentApiModelInputToolsItem {
  const entries = Object.entries(spec.params)
  const properties: Record<string, ElevenLabs.LiteralJsonSchemaProperty> = {
    // The conversation id is filled in by ElevenLabs, never by the model. It ties events to the live screen.
    conversation_id: { type: 'string', dynamicVariable: 'system__conversation_id' }
  }
  for (const [key, p] of entries) {
    properties[key] = { type: p.type, description: p.description, ...(p.enum ? { enum: [...p.enum] } : {}) }
  }
  return {
    type: 'webhook',
    name: spec.name,
    description: spec.description,
    responseTimeoutSecs: spec.timeoutSecs,
    // No spoken "one moment" before tools by default: the platform words it in the agent's BASE language (Arabic), so an
    // English caller heard Arabic fillers. The typing sound plays instead, and the slow-reply filler (soft timeout) is
    // generated in the caller's language.
    preToolSpeech: preSpeech ?? ('off' as const),
    // A sound while a slow tool runs, so the line is never silent. Quick tools stay quiet (a typing sound for 300 ms is jarring).
    toolCallSound: 'typing' as const,
    toolCallSoundBehavior: spec.preSpeech === 'force' ? ('always' as const) : ('auto' as const),
    apiSchema: {
      url: `${baseUrl.replace(/\/$/, '')}/api/tools/${spec.name}`,
      method: 'POST',
      requestHeaders: { 'x-hala-secret': secret },
      requestBodySchema: {
        type: 'object',
        required: ['conversation_id', ...entries.filter(([, p]) => !p.optional).map(([k]) => k)],
        properties
      }
    }
  }
}

/** What we judge every finished conversation on, inside ElevenLabs. Mirrors the judges' rules. */
const EVALUATION_CRITERIA: ElevenLabs.PromptEvaluationCriteria[] = [
  { id: 'ai_disclosure', name: 'Discloses it is an AI', conversationGoalPrompt: 'The agent said it is an AI assistant, not a person, in its opening, and never claimed to be human. If the caller asked whether it is a person, it said it is an AI.' },
  { id: 'no_invention', name: 'No invented facts', conversationGoalPrompt: 'Every fee, time, document, hour or rule the agent stated came from a tool result. When it did not know, it said so and offered a person. It never guessed.' },
  { id: 'demo_labelled', name: 'Demo values labelled', conversationGoalPrompt: 'Whenever the agent stated a fee or processing time it said that it is a demonstration value. Pass automatically if no fee or time was stated.' },
  { id: 'language_followed', name: 'Follows the caller language', conversationGoalPrompt: "The agent answered in the language of the caller's latest message, in Arabic or English, including after the caller switched language." },
  { id: 'handover_correct', name: 'Hands over when it should', conversationGoalPrompt: 'If the caller disputed a fee, was upset, asked for a person, asked for legal advice or asked for something out of scope, the agent called handover_to_human calmly. Pass automatically if no such situation occurred.' },
  { id: 'booking_confirmed', name: 'Reads back before booking', conversationGoalPrompt: 'Before booking, rescheduling or cancelling, the agent read the details back and waited for a yes, then confirmed the reference number afterwards. Pass automatically if no booking change occurred.' }
]

export function buildAgentConfig(o: AgentConfigOptions) {
  const channel = o.channel ?? 'web'
  const services = o.services ?? SERVICES
  const robot = channel === 'robot'
  const phone = channel === 'phone'
  const human = o.humanVoice ?? phone
  const expressive = (o.voiceModel ?? 'v3') === 'v3'

  const basePrompt = buildSystemPrompt({
    services,
    facts: FACTS,
    tools: {
      findService: TOOL_NAMES.findService, listSlots: TOOL_NAMES.listSlots, book: TOOL_NAMES.book,
      reschedule: TOOL_NAMES.reschedule, cancel: TOOL_NAMES.cancel, logRequest: TOOL_NAMES.logRequest,
      lookupFact: TOOL_NAMES.lookupFact, handover: TOOL_NAMES.handover,
      checkBooking: TOOL_NAMES.checkBooking, checkRequest: TOOL_NAMES.checkRequest, serviceProcess: TOOL_NAMES.serviceProcess
    },
    lean: o.lean,
    sheet: o.sheet,
    knowledgeBase: Boolean(o.knowledge?.length)
  })

  const prompt = `${basePrompt}${phone ? `
${PHONE_PROMPT_ADDENDUM}` : ''}${human ? `
${HUMAN_VOICE_PROMPT}` : ''}`
  const extraTools = phone ? PHONE_TOOL_SPECS : o.contactTool ? PHONE_TOOL_SPECS.filter((t) => t.name === PHONE_TOOL_NAMES.lookupContact) : []

  const conversationConfig = {
    agent: {
      language: BASE_LANGUAGE,
      ...(phone ? { dynamicVariables: { dynamicVariablePlaceholders: { ...PHONE_DYNAMIC_DEFAULTS } } } : {}),
      firstMessage: phone ? PHONE_GREETING : BILINGUAL_GREETING,
      prompt: {
        prompt,
        llm: o.llm ?? (human ? (HUMAN_LLM as ElevenLabs.Llm) : DEFAULT_LLM),
        // A voice answer is a sentence or two. Capping it, and switching model "thinking" off, is what keeps replies quick.
        ...(human ? { thinkingBudget: 0 } : {}),
        temperature: o.temperature ?? 0.3,
        // Spoken answers are short. A hard cap also stops a model from rambling and keeps time-to-last-word low.
        maxTokens: 300,
        ...(o.knowledge?.length ? {
          knowledgeBase: o.knowledge.map((k) => ({ type: 'text' as const, name: k.name, id: k.id, usageMode: 'auto' as const })),
          // multilingual embeddings: callers ask in Arabic and the documents are English
          rag: { enabled: true, embeddingModel: 'multilingual_e5_large_instruct' as const, maxRetrievedRagChunksCount: 4, maxDocumentsLength: 6000 }
        } : {}),
        ...(o.reasoningEffort ? { reasoningEffort: o.reasoningEffort } : {}),
        timezone: 'Asia/Dubai',
        tools: [...TOOL_SPECS, ...extraTools].map((s) => toWebhookTool(s, o.publicBaseUrl, o.toolSecret, o.preSpeech)),
        builtInTools: {
          endCall: { name: 'end_call', params: { systemToolType: 'end_call' as const } },
          languageDetection: { name: 'language_detection', params: { systemToolType: 'language_detection' as const } }
        }
      }
    },
    tts: {
      modelId: o.ttsModel ?? (expressive ? V3_MODEL : TTS_MODEL),
      voiceId: o.voiceId ?? DEFAULT_VOICE_ID,
      stability: 0.55, similarityBoost: 0.8, speed: 1,
      // Looser than the default: more movement in the voice, less read-aloud.
      ...(human ? humanTts : {}),
      ...(expressive ? { expressiveMode: true, suggestedAudioTags: AUDIO_TAGS } : {}),
      ...(o.pronunciation ? { pronunciationDictionaryLocators: [o.pronunciation] } : {}),
      ...(robot ? { agentOutputAudioFormat: 'pcm_16000' as const } : {})
    },
    asr: {
      keywords: ['HALA', 'DSO', 'NOC', 'هلا'],
      ...(robot ? { userInputAudioFormat: 'pcm_16000' as const } : {})
    },
    turn: {
      // Answer sooner after the caller stops, and start generating during the pause before the turn is certain.
      turnEagerness: 'eager' as const,
      speculativeTurn: true,
      spellingPatience: 'auto' as const,
      // A reception robot waits: the default re-engages after 7 s ("are you still there?") and hangs up soon after.
      // A phone call does not: a caller who went quiet is hung up on after 45 s, like a real call.
      turnTimeout: phone ? 10 : 30,
      silenceEndCallTimeout: phone ? 45 : 600,
      // If the model is slow, say a short filler in the caller's language instead of leaving silence.
      softTimeoutConfig: {
        timeoutSeconds: 1.8,
        useLlmGeneratedMessage: true,
        maxSoftTimeoutsPerGeneration: 1,
        llmGeneratedMessagePromptOverride:
          "Say ONE very short filler (two to four words) in the caller's language while you work, such as 'One moment.', 'Let me check.', 'لحظة من فضلك.' or 'خلني أشيك.'. Do not answer the question yet."
      },
      ...(human ? humanTurn : {})
    },
    conversation: {
      maxDurationSeconds: 600,
      // The defaults, plus "a tool is starting": the text channel needs it to know a reply is still on its way.
      ...(phone ? { clientEvents: ['audio', 'interruption', 'agent_response', 'user_transcript', 'agent_response_correction', 'agent_tool_request', 'agent_tool_response'] as ElevenLabs.ClientEvent[] } : {})
    },
    languagePresets: {
      en: { overrides: { agent: { language: 'en', firstMessage: FIRST_MESSAGE.en } } }
    }
  }

  const platformSettings = {
    // Private agent: the browser needs a short-lived token from /api/token.
    auth: { enableAuth: true },
    // The talk page may pick a language and send text-only sessions (used by the live evals).
    overrides: { enableProcedureIdsFromClient: true, conversationConfigOverride: { conversation: { textOnly: true }, agent: { language: true, firstMessage: true } } },
    evaluation: { criteria: EVALUATION_CRITERIA },
    dataCollection: {
      service_discussed: { type: 'string' as const, description: 'The id of the DSO service the caller needed, or "none".' },
      outcome: { type: 'string' as const, enum: ['booked', 'rescheduled', 'cancelled', 'request_logged', 'info_only', 'handover', 'abandoned'], description: 'How the conversation ended.' },
      caller_language: { type: 'string' as const, enum: ['en', 'ar', 'mixed'], description: 'Language the caller used.' }
    }
  }

  return {
    name: o.nameSuffix ? `${agentName(channel)} ${o.nameSuffix}` : agentName(channel),
    tags: ['hala', `channel:${channel}`],
    conversationConfig,
    platformSettings
  }
}

export type AgentConfig = ReturnType<typeof buildAgentConfig>
