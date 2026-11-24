import type { ElevenLabs } from '@elevenlabs/elevenlabs-js'
import { BILINGUAL_GREETING, FIRST_MESSAGE, buildSystemPrompt, type Service } from '@hala/core'
import { FACTS, SERVICES } from '@hala/catalogue'
import { TOOL_NAMES, TOOL_SPECS, type ToolSpec } from '@hala/tools-api'

/**
 * Where the agent runs. They differ only in audio format:
 *  - web:   browser WebRTC. ElevenLabs defaults.
 *  - robot: the AgiBot/MangoBot bridge sends and expects PCM 16 kHz (Handover.md, phase 1).
 */
export type Channel = 'web' | 'robot'

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
  /** Thinking effort for reasoning models. Lower is faster. Leave unset to use the model's default. */
  reasoningEffort?: ElevenLabs.LlmReasoningEffort
}

/** Female, multilingual premade voice that handles English and Arabic on the flash multilingual model. */
export const DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL'
export const DEFAULT_LLM: ElevenLabs.Llm = 'gemini-3.8-flash'
/**
 * Arabic is the base language on purpose. ElevenLabs forces an English-primary agent onto the
 * English-only TTS model, which garbles Arabic (kit gotcha G1). With Arabic as the base the
 * multilingual model is used for both languages, and English is added as a language preset.
 */
export const BASE_LANGUAGE = 'ar'
export const TTS_MODEL: ElevenLabs.TtsConversationalModel = 'eleven_flash_v2_5'

export const agentName = (channel: Channel = 'web') => (channel === 'robot' ? 'HALA Concierge (robot)' : 'HALA Concierge')

function toWebhookTool(spec: ToolSpec, baseUrl: string, secret: string): ElevenLabs.PromptAgentApiModelInputToolsItem {
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
    preToolSpeech: spec.preSpeech,
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

  const prompt = buildSystemPrompt({
    services,
    facts: FACTS,
    tools: {
      findService: TOOL_NAMES.findService, listSlots: TOOL_NAMES.listSlots, book: TOOL_NAMES.book,
      reschedule: TOOL_NAMES.reschedule, cancel: TOOL_NAMES.cancel, logRequest: TOOL_NAMES.logRequest,
      lookupFact: TOOL_NAMES.lookupFact, handover: TOOL_NAMES.handover
    }
  })

  const conversationConfig = {
    agent: {
      language: BASE_LANGUAGE,
      firstMessage: BILINGUAL_GREETING,
      prompt: {
        prompt,
        llm: o.llm ?? DEFAULT_LLM,
        temperature: o.temperature ?? 0.3,
        // Spoken answers are short. A hard cap also stops a model from rambling and keeps time-to-last-word low.
        maxTokens: 300,
        ...(o.reasoningEffort ? { reasoningEffort: o.reasoningEffort } : {}),
        timezone: 'Asia/Dubai',
        tools: TOOL_SPECS.map((s) => toWebhookTool(s, o.publicBaseUrl, o.toolSecret)),
        builtInTools: {
          endCall: { name: 'end_call', params: { systemToolType: 'end_call' as const } },
          languageDetection: { name: 'language_detection', params: { systemToolType: 'language_detection' as const } }
        }
      }
    },
    tts: {
      modelId: TTS_MODEL,
      voiceId: o.voiceId ?? DEFAULT_VOICE_ID,
      stability: 0.55, similarityBoost: 0.8, speed: 1,
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
      silenceEndCallTimeout: 45,
      // If the model is slow, say a short filler in the caller's language instead of leaving silence.
      softTimeoutConfig: {
        timeoutSeconds: 1.8,
        useLlmGeneratedMessage: true,
        maxSoftTimeoutsPerGeneration: 1,
        llmGeneratedMessagePromptOverride:
          "Say ONE very short filler (two to four words) in the caller's language while you work, such as 'One moment.', 'Let me check.', 'لحظة من فضلك.' or 'خلني أشيك.'. Do not answer the question yet."
      }
    },
    conversation: { maxDurationSeconds: 600 },
    languagePresets: {
      en: { overrides: { agent: { language: 'en', firstMessage: FIRST_MESSAGE.en } } }
    }
  }

  const platformSettings = {
    // Private agent: the browser needs a short-lived token from /api/token.
    auth: { enableAuth: true },
    // The talk page may pick a language and send text-only sessions (used by the live evals).
    overrides: { conversationConfigOverride: { conversation: { textOnly: true }, agent: { language: true, firstMessage: true } } },
    evaluation: { criteria: EVALUATION_CRITERIA },
    dataCollection: {
      service_discussed: { type: 'string' as const, description: 'The id of the DSO service the caller needed, or "none".' },
      outcome: { type: 'string' as const, enum: ['booked', 'rescheduled', 'cancelled', 'request_logged', 'info_only', 'handover', 'abandoned'], description: 'How the conversation ended.' },
      caller_language: { type: 'string' as const, enum: ['en', 'ar', 'mixed'], description: 'Language the caller used.' }
    }
  }

  return {
    name: agentName(channel),
    tags: ['hala', `channel:${channel}`],
    conversationConfig,
    platformSettings
  }
}

export type AgentConfig = ReturnType<typeof buildAgentConfig>
