import type { ElevenLabs } from '@elevenlabs/elevenlabs-js'
import type { AgentConfig } from './agent-config'

/**
 * Compile-time proof that our config matches the SDK's create-agent request. Never executed.
 * The tool list is checked by the webhook builder's own return type (the SDK declares different
 * Input and Output variants for tools, so a whole-object assignment would be a false alarm).
 */
type Body = ElevenLabs.conversationalAi.BodyCreateAgentV1ConvaiAgentsCreatePost
type Conv = NonNullable<Body['conversationConfig']>

export const assertConfigMatchesSdk = (c: AgentConfig) => {
  const cc = c.conversationConfig
  const checks: { tts: Conv['tts']; asr: Conv['asr']; turn: Conv['turn']; conversation: Conv['conversation']; platform: Body['platformSettings'] } = {
    tts: cc.tts, asr: cc.asr, turn: cc.turn, conversation: cc.conversation, platform: c.platformSettings
  }
  return checks
}
