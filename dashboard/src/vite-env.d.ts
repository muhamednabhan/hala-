/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATA_MODE?: 'mock' | 'live';
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Injected by vite.config.ts (non-secret).
declare const __HALA_AGENTS__: { web: string; robot: string };
declare const __HALA_PROXY__: { talk: boolean; tools: boolean; eleven: boolean; supabase: boolean; talkUrl: string };
