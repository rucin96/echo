// Wspólne ustawienia i logika dopasowania głosu do silnika TTS (lustrzane odbicie syncVoiceAndTtsModel z public/app.js)

export const DEFAULT_SETTINGS = {
  serverUrl: 'http://localhost:3000',
  voiceId: 'google-gemini-neural',
  ttsModel: 'gemini-2.5-flash-preview-tts',
  speed: 1
};

export const DEFAULT_KEYS = {
  elevenLabsKey: '',
  googleKey: '',
  openaiKey: ''
};

// Używane, gdy serwer Echo jest niedostępny i nie da się pobrać /api/voices
export const FALLBACK_VOICES = [
  { voice_id: 'google-gemini-neural', name: 'Google Gemini Voice (AI)', category: 'google' },
  { voice_id: 'pl-PL-Wavenet-A', name: 'Google Cloud WaveNet A (Kobieta)', category: 'google' },
  { voice_id: 'pl-PL-Wavenet-B', name: 'Google Cloud WaveNet B (Mężczyzna)', category: 'google' },
  { voice_id: 'pl-PL-Wavenet-D', name: 'Google Cloud WaveNet D (Kobieta)', category: 'google' },
  { voice_id: 'pl-PL-MarekNeural', name: 'Marek (Mężczyzna - Naturalny PL)', category: 'google' },
  { voice_id: 'pl-PL-ZofiaNeural', name: 'Zofia (Kobieta - Naturalna PL)', category: 'google' },
  { voice_id: 'openai-marin', name: 'Marin (Naturalny, najnowszy - OpenAI)', category: 'openai' },
  { voice_id: 'openai-cedar', name: 'Cedar (Naturalny, najnowszy - OpenAI)', category: 'openai' },
  { voice_id: 'openai-coral', name: 'Coral (Kobiecy - OpenAI)', category: 'openai' },
  { voice_id: 'openai-onyx', name: 'Onyx (Męski, głęboki - OpenAI)', category: 'openai' },
  { voice_id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah (Ciepła, wyrazista - ElevenLabs)', category: 'premade' },
  { voice_id: 'ErXwobaYiN019PkySvjV', name: 'Antoni (Męski, zbalansowany - ElevenLabs)', category: 'premade' },
  { voice_id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George (Ciepły lektor - ElevenLabs)', category: 'premade' },
  { voice_id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam (Głęboki, lektorski - ElevenLabs)', category: 'premade' }
];

const GEMINI_MODELS = [
  { id: 'gemini-2.5-flash-preview-tts', name: 'Gemini 2.5 Flash TTS' },
  { id: 'gemini-3.1-flash-tts-preview', name: 'Gemini 3.1 Flash TTS Preview' }
];
const WAVENET_MODELS = [{ id: 'google-cloud-wavenet', name: 'Google Cloud WaveNet' }];
const EDGE_MODELS = [{ id: 'edge-neural', name: 'Edge Neural PL (darmowy)' }];
const OPENAI_MODELS = [
  { id: 'gpt-4o-mini-tts', name: 'OpenAI GPT-4o mini TTS' },
  { id: 'tts-1-hd', name: 'OpenAI TTS-1 HD' },
  { id: 'tts-1', name: 'OpenAI TTS-1 (niska latencja)' }
];
const LOCAL_MODELS = [
  { id: 'chatterbox-cpu', name: 'Chatterbox CPU (lokalny)' },
  { id: 'chatterbox-mps', name: 'Chatterbox MPS (lokalny, GPU Apple)' }
];
const ELEVEN_MODELS = [
  { id: 'eleven_multilingual_v2', name: 'Eleven Multilingual v2 (jakość studyjna)' },
  { id: 'eleven_flash_v2_5', name: 'Eleven Flash v2.5 (szybki)' },
  { id: 'eleven_turbo_v2_5', name: 'Eleven Turbo v2.5 (niska latencja)' }
];

export function modelsForVoice(voiceId = '') {
  if (voiceId.startsWith('google-gemini')) return GEMINI_MODELS;
  if (voiceId.startsWith('pl-PL-Wavenet')) return WAVENET_MODELS;
  if (voiceId === 'pl-PL-MarekNeural' || voiceId === 'pl-PL-ZofiaNeural') return EDGE_MODELS;
  if (voiceId.startsWith('openai-')) return OPENAI_MODELS;
  if (voiceId.startsWith('local-')) return LOCAL_MODELS;
  return ELEVEN_MODELS;
}

export function normalizeServerUrl(url) {
  return (url || DEFAULT_SETTINGS.serverUrl).trim().replace(/\/+$/, '');
}
