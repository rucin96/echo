import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import Anthropic from '@anthropic-ai/sdk';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors({
  exposedHeaders: ['X-Duration-Ms', 'X-Duration-Sec']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Multer in-memory storage for handling audio uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 } // 25 MB max
});

// Helper to resolve API keys (from request header or env)
function getElevenLabsKey(req) {
  return req.headers['x-elevenlabs-key'] || process.env.ELEVENLABS_API_KEY || '';
}

function getAnthropicKey(req) {
  return req.headers['x-anthropic-key'] || process.env.ANTHROPIC_API_KEY || '';
}

function getGoogleKey(req) {
  return req.headers['x-google-key'] || req.headers['x-gemini-key'] || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
}

function getGroqKey(req) {
  return req.headers['x-groq-key'] || process.env.GROQ_API_KEY || '';
}

function isPlaceholderKey(value) {
  return !value || value.startsWith('twoj_klucz');
}

// Akceptujemy zarówno standardową nazwę OPENAI_API_KEY, jak i OPEN_API_KEY z .env
function getEnvOpenAIKey() {
  return [process.env.OPENAI_API_KEY, process.env.OPEN_API_KEY].find(k => !isPlaceholderKey(k)) || '';
}

function getOpenAIKey(req) {
  return req.headers['x-openai-key'] || getEnvOpenAIKey();
}

// Głosy OpenAI mają prefiks "openai-", żeby nie mylić ich z identyfikatorami głosów ElevenLabs
function isOpenAIVoiceId(voiceId) {
  return Boolean(voiceId && voiceId.startsWith('openai-'));
}

function isElevenVoiceId(voiceId) {
  return Boolean(voiceId && !voiceId.startsWith('google-') && !voiceId.startsWith('pl-PL-') && !isOpenAIVoiceId(voiceId));
}

function isOpenAIChatModel(modelId) {
  return /^(gpt-|chatgpt-|o\d)/.test(modelId || '');
}

// Groq udostępnia tylko modele whisper-large-v3(-turbo); whisper-1 to model OpenAI
function isGroqSttModel(modelId) {
  return Boolean(modelId && modelId.startsWith('whisper-large'));
}

function isOpenAISttModel(modelId) {
  return modelId === 'whisper-1' || Boolean(modelId && modelId.startsWith('gpt-') && modelId.includes('transcribe'));
}

// Helper: Convert raw 16-bit mono PCM into standard WAV buffer
function pcmToWavBuffer(pcmBuffer, sampleRate = 24000, numChannels = 1, bitsPerSample = 16) {
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmBuffer.length;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // Audio format 1 = PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBuffer]);
}

// Helper: Edge Neural TTS (Marek / Zofia - naturalny darmowy głos PL z projektu sts)
async function synthesizeWithEdge(text, voice = 'pl-PL-MarekNeural') {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream(text);
  const chunks = [];
  return new Promise((resolve, reject) => {
    audioStream.on('data', chunk => chunks.push(chunk));
    audioStream.on('end', () => resolve(Buffer.concat(chunks)));
    audioStream.on('error', err => reject(err));
  });
}

// Helper: Google Gemini multimodal audio transcription (STT)
async function transcribeWithGemini(audioBuffer, mimeType, apiKey, model = 'gemini-3.5-transcribe') {
  const modelsToTry = [...new Set([
    model,
    'gemini-3.5-transcribe',
    'gemini-3.6-flash',
    'gemini-flash-latest'
  ])];

  const base64Audio = audioBuffer.toString('base64');
  let cleanMime = (mimeType || '').toLowerCase();
  if (cleanMime.includes('wav')) cleanMime = 'audio/wav';
  else if (cleanMime.includes('webm')) cleanMime = 'audio/webm';
  else if (cleanMime.includes('mp4') || cleanMime.includes('m4a')) cleanMime = 'audio/mp4';
  else cleanMime = 'audio/webm';

  let lastError = null;
  for (const currentModel of modelsToTry) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: 'Dokonaj dokładnej transkrypcji tego nagrania audio na tekst w języku polskim. Zwróć wyłącznie transkrybowany tekst bez żadnych komentarzy, dopisków ani cudzysłowów.' },
              { inline_data: { mime_type: cleanMime, data: base64Audio } }
            ]
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 600
          }
        })
      });

      if (response.ok) {
        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        if (text) {
          return text;
        }
      }

      const errText = await response.text().catch(() => '');
      lastError = new Error(`Google STT ${currentModel} (${response.status}): ${errText}`);
      console.warn(`⚠️ Google STT model "${currentModel}" status:`, response.status);
    } catch (e) {
      lastError = e;
      console.warn(`⚠️ Google STT error on "${currentModel}":`, e.message);
    }
  }

  throw lastError || new Error('Błąd transkrypcji mowy Google STT.');
}

// Helper: Groq Whisper transcription (STT) - OpenAI-compatible endpoint, darmowy plan z limitem dziennym
async function transcribeWithGroq(audioBuffer, mimeType, filename, apiKey, model = 'whisper-large-v3-turbo', languageCode = 'pl') {
  const formData = new FormData();
  formData.append('file', new Blob([audioBuffer], { type: mimeType }), filename);
  formData.append('model', model);
  formData.append('response_format', 'json');
  formData.append('temperature', '0');
  if (languageCode && languageCode !== 'auto') {
    formData.append('language', languageCode);
  }

  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    const error = new Error(errData.error?.message || `Groq STT error (${response.status})`);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  return data.text || '';
}

// Helper: OpenAI transcription (STT) - gpt-transcribe, gpt-4o-transcribe, gpt-4o-mini-transcribe, whisper-1
async function transcribeWithOpenAI(audioBuffer, mimeType, filename, apiKey, model = 'gpt-transcribe', languageCode = 'pl') {
  async function request(withLanguage) {
    const formData = new FormData();
    formData.append('file', new Blob([audioBuffer], { type: mimeType }), filename);
    formData.append('model', model);
    formData.append('response_format', 'json');
    if (withLanguage) {
      formData.append('language', languageCode);
    }
    return fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData
    });
  }

  const wantsLanguage = Boolean(languageCode && languageCode !== 'auto');
  let response = await request(wantsLanguage);
  let errData = null;

  // Nie każdy model transkrypcji przyjmuje parametr "language" - wtedy ponawiamy z autodetekcją
  if (!response.ok && wantsLanguage && response.status === 400) {
    errData = await response.json().catch(() => ({}));
    if (/language/i.test(errData.error?.message || '') || errData.error?.param === 'language') {
      response = await request(false);
      errData = null;
    }
  }

  if (!response.ok) {
    errData = errData || await response.json().catch(() => ({}));
    const error = new Error(errData.error?.message || `OpenAI STT error (${response.status})`);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  return data.text || '';
}

// Helper: OpenAI TTS. Endpoint przyjmuje ograniczoną długość tekstu, więc dłuższy tekst dzielimy
// po zdaniach i sklejamy wynikowe pliki MP3 (ramki MP3 można bezpiecznie łączyć).
const OPENAI_TTS_MAX_CHARS = 4000;
const OPENAI_TTS_LEGACY_UNSUPPORTED_VOICES = ['ballad', 'verse', 'marin', 'cedar'];

function splitTextForTts(text, maxChars) {
  if (text.length <= maxChars) return [text];
  const sentences = text.match(/[^.!?…\n]+[.!?…]*\s*/g) || [text];
  const parts = [];
  let current = '';
  for (const sentence of sentences) {
    if (current && (current + sentence).length > maxChars) {
      parts.push(current.trim());
      current = '';
    }
    // Pojedyncze zdanie dłuższe niż limit tniemy na sztywno
    let rest = sentence;
    while (rest.length > maxChars) {
      parts.push(rest.slice(0, maxChars).trim());
      rest = rest.slice(maxChars);
    }
    current += rest;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

async function synthesizeWithOpenAI(text, voiceId, modelId, apiKey) {
  const voice = voiceId.replace(/^openai-/, '');
  // tts-1 / tts-1-hd nie obsługują nowszych głosów - wtedy używamy gpt-4o-mini-tts
  const model = modelId.startsWith('tts-1') && OPENAI_TTS_LEGACY_UNSUPPORTED_VOICES.includes(voice)
    ? 'gpt-4o-mini-tts'
    : modelId;

  const buffers = [];
  for (const part of splitTextForTts(text, OPENAI_TTS_MAX_CHARS)) {
    const body = { model, voice, input: part, response_format: 'mp3' };
    if (model.startsWith('gpt-')) {
      body.instructions = 'Mów po polsku naturalnie, płynnie i wyraźnie, z naturalną intonacją lektora.';
    }

    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error?.message || `OpenAI TTS error (${response.status})`);
    }
    buffers.push(Buffer.from(await response.arrayBuffer()));
  }

  return { audioBuffer: Buffer.concat(buffers), model };
}

// ----------------------------------------------------
// 1. GET /api/status - Check configuration status
// ----------------------------------------------------
app.get('/api/status', (req) => {
  const hasEnvElevenLabs = Boolean(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_API_KEY !== 'twoj_klucz_elevenlabs');
  const hasEnvAnthropic = Boolean(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'twoj_klucz_anthropic');
  const hasEnvGoogle = Boolean(
    (process.env.GOOGLE_API_KEY && process.env.GOOGLE_API_KEY !== 'twoj_klucz_google') ||
    (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'twoj_klucz_gemini')
  );
  const hasEnvGroq = Boolean(process.env.GROQ_API_KEY && process.env.GROQ_API_KEY !== 'twoj_klucz_groq');
  const hasEnvOpenAI = Boolean(getEnvOpenAIKey());

  req.res.json({
    status: 'ok',
    hasEnvElevenLabs,
    hasEnvAnthropic,
    hasEnvGoogle,
    hasEnvGroq,
    hasEnvOpenAI,
    defaults: {
      voiceId: process.env.VOICE_ID || process.env.ELEVENLABS_VOICE_ID || 'google-gemini-neural',
      ttsModel: process.env.TTS_MODEL || process.env.ELEVENLABS_TTS_MODEL || 'gemini-2.5-flash-preview-tts',
      sttModel: process.env.STT_MODEL || process.env.ELEVENLABS_STT_MODEL || 'gemini-3.5-transcribe',
      aiModel: process.env.AI_MODEL || (hasEnvGoogle ? 'gemini-3.6-flash' : 'claude-opus-5')
    }
  });
});

// ----------------------------------------------------
// 2. GET /api/models & /api/claude-models - Models catalog
// ----------------------------------------------------
const defaultGoogleModels = [
  { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash (Szybki & stabilny - Domyślny z sts)', provider: 'google' },
  { id: 'gemini-flash-latest', name: 'Gemini Flash Latest', provider: 'google' },
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash (Najnowsza generacja)', provider: 'google' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro (Głęboka analiza)', provider: 'google' },
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro Preview', provider: 'google' }
];

const defaultClaudeModels = [
  { id: 'claude-opus-5', name: 'Claude Opus 5 (Najpotężniejszy Claude - Domyślny)', provider: 'anthropic' },
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6 (Szybki Opus)', provider: 'anthropic' },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5 (Lekki & szybki)', provider: 'anthropic' },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', provider: 'anthropic' },
  { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', provider: 'anthropic' }
];

const defaultOpenAIModels = [
  { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna (Szybki & tani)', provider: 'openai' },
  { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra (Zbalansowany)', provider: 'openai' },
  { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol (Flagowy)', provider: 'openai' },
  { id: 'gpt-6-astra', name: 'GPT-6 Astra (Najpotężniejszy OpenAI)', provider: 'openai' }
];

async function getAvailableModels(req) {
  let googleModels = [...defaultGoogleModels];
  const googleKey = getGoogleKey(req);
  if (googleKey) {
    try {
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${googleKey}`);
      if (resp.ok) {
        const data = await resp.json();
        const geminiList = (data.models || [])
          .filter(m => m.name && m.name.includes('gemini') && m.supportedGenerationMethods?.includes('generateContent') && !m.name.includes('tts') && !m.name.includes('embedding') && !m.name.includes('image') && !m.name.includes('transcribe'))
          .map(m => {
            const id = m.name.replace('models/', '');
            return {
              id,
              name: m.displayName ? `${m.displayName} (${id})` : id,
              provider: 'google'
            };
          });

        if (geminiList.length > 0) {
          const topIds = ['gemini-3.6-flash', 'gemini-flash-latest', 'gemini-3.8-flash', 'gemini-2.5-pro', 'gemini-3.1-pro-preview'];
          geminiList.sort((a, b) => {
            const idxA = topIds.indexOf(a.id);
            const idxB = topIds.indexOf(b.id);
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            if (idxA !== -1) return -1;
            if (idxB !== -1) return 1;
            return a.name.localeCompare(b.name);
          });
          googleModels = geminiList;
        }
      }
    } catch (err) {
      console.warn('Could not query Google models list:', err.message);
    }
  }

  let claudeModels = [...defaultClaudeModels];
  const anthropicKey = getAnthropicKey(req);
  if (anthropicKey) {
    try {
      const anthropic = new Anthropic({ apiKey: anthropicKey });
      const list = await anthropic.models.list({ limit: 20 });
      const filtered = list.data
        .filter(m => m.id.includes('opus') || m.id.includes('sonnet') || m.id.includes('haiku'))
        .map(m => ({
          id: m.id,
          name: m.display_name ? `${m.display_name} (${m.id})` : m.id,
          provider: 'anthropic'
        }));
      if (filtered.length > 0) {
        claudeModels = filtered;
      }
    } catch (err) {
      console.warn('Could not query Anthropic models list:', err.message);
    }
  }

  // Lista /v1/models OpenAI zawiera setki pozycji (snapshoty, audio, obrazy), więc tylko
  // zawężamy wyselekcjonowaną listę do modeli, do których klucz faktycznie ma dostęp
  let openaiModels = [...defaultOpenAIModels];
  const openaiKey = getOpenAIKey(req);
  if (openaiKey) {
    try {
      const resp = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${openaiKey}` }
      });
      if (resp.ok) {
        const data = await resp.json();
        const availableIds = new Set((data.data || []).map(m => m.id));
        const available = defaultOpenAIModels.filter(m => availableIds.has(m.id));
        if (available.length > 0) {
          openaiModels = available;
        }
      }
    } catch (err) {
      console.warn('Could not query OpenAI models list:', err.message);
    }
  }

  return {
    googleModels,
    claudeModels,
    openaiModels,
    models: [...googleModels, ...claudeModels, ...openaiModels]
  };
}

app.get('/api/models', async (req, res) => {
  const data = await getAvailableModels(req);
  res.json(data);
});

app.get('/api/claude-models', async (req, res) => {
  const data = await getAvailableModels(req);
  res.json(data);
});

// ----------------------------------------------------
// 3. GET /api/voices - Fetch voices list (Google, Edge, ElevenLabs)
// ----------------------------------------------------
const stsVoices = [
  { voice_id: 'google-gemini-neural', name: 'Google Gemini Voice (AI)', category: 'google' },
  { voice_id: 'pl-PL-Wavenet-A', name: 'Google Cloud WaveNet A (Kobieta)', category: 'google' },
  { voice_id: 'pl-PL-Wavenet-B', name: 'Google Cloud WaveNet B (Mężczyzna)', category: 'google' },
  { voice_id: 'pl-PL-Wavenet-D', name: 'Google Cloud WaveNet D (Kobieta)', category: 'google' },
  { voice_id: 'pl-PL-MarekNeural', name: 'Marek (Mężczyzna - Naturalny PL)', category: 'google' },
  { voice_id: 'pl-PL-ZofiaNeural', name: 'Zofia (Kobieta - Naturalna PL)', category: 'google' }
];

const defaultElevenVoices = [
  { voice_id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah (Ciepła, wyrazista - ElevenLabs)', category: 'premade' },
  { voice_id: 'ErXwobaYiN019PkySvjV', name: 'Antoni (Męski, zbalansowany - ElevenLabs)', category: 'premade' },
  { voice_id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George (Ciepły lektor - ElevenLabs)', category: 'premade' },
  { voice_id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam (Głęboki, lektorski - ElevenLabs)', category: 'premade' }
];

// Wbudowane głosy OpenAI TTS (ballad, verse, marin i cedar działają tylko z gpt-4o-mini-tts)
const openaiVoices = [
  { voice_id: 'openai-marin', name: 'Marin (Naturalny, najnowszy - OpenAI)', category: 'openai' },
  { voice_id: 'openai-cedar', name: 'Cedar (Naturalny, najnowszy - OpenAI)', category: 'openai' },
  { voice_id: 'openai-alloy', name: 'Alloy (Neutralny - OpenAI)', category: 'openai' },
  { voice_id: 'openai-ash', name: 'Ash (Męski - OpenAI)', category: 'openai' },
  { voice_id: 'openai-ballad', name: 'Ballad (Męski, ciepły - OpenAI)', category: 'openai' },
  { voice_id: 'openai-coral', name: 'Coral (Kobiecy - OpenAI)', category: 'openai' },
  { voice_id: 'openai-echo', name: 'Echo (Męski - OpenAI)', category: 'openai' },
  { voice_id: 'openai-fable', name: 'Fable (Narracyjny - OpenAI)', category: 'openai' },
  { voice_id: 'openai-nova', name: 'Nova (Kobiecy, energiczny - OpenAI)', category: 'openai' },
  { voice_id: 'openai-onyx', name: 'Onyx (Męski, głęboki - OpenAI)', category: 'openai' },
  { voice_id: 'openai-sage', name: 'Sage (Kobiecy, spokojny - OpenAI)', category: 'openai' },
  { voice_id: 'openai-shimmer', name: 'Shimmer (Kobiecy, jasny - OpenAI)', category: 'openai' },
  { voice_id: 'openai-verse', name: 'Verse (Męski, ekspresyjny - OpenAI)', category: 'openai' }
];

app.get('/api/voices', async (req, res) => {
  const apiKey = getElevenLabsKey(req);
  if (!apiKey) {
    return res.json({ voices: [...stsVoices, ...openaiVoices, ...defaultElevenVoices] });
  }

  try {
    const response = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': apiKey }
    });

    if (!response.ok) {
      return res.json({ voices: [...stsVoices, ...openaiVoices, ...defaultElevenVoices] });
    }

    const data = await response.json();
    const elevenVoices = (data.voices || []).map(v => ({
      voice_id: v.voice_id,
      name: `${v.name} ${v.labels?.accent ? `(${v.labels.accent})` : ''} - ElevenLabs`.trim(),
      category: v.category || 'custom'
    }));

    res.json({ voices: [...stsVoices, ...openaiVoices, ...elevenVoices] });
  } catch (error) {
    res.json({ voices: [...stsVoices, ...openaiVoices, ...defaultElevenVoices] });
  }
});

// ----------------------------------------------------
// 4. POST /api/stt - Speech-to-Text (Google Gemini, Groq Whisper & ElevenLabs) with Timing
// ----------------------------------------------------
app.post('/api/stt', upload.single('audio'), async (req, res) => {
  const startTime = Date.now();

  if (!req.file) {
    return res.status(400).json({ error: 'Nie przesłano pliku audio.' });
  }

  const modelId = req.body.model_id || process.env.STT_MODEL || process.env.ELEVENLABS_STT_MODEL || 'gemini-3.5-transcribe';
  const languageCode = req.body.language_code || 'pl';

  const isGoogleStt = modelId.startsWith('gemini-') || modelId.includes('google') || modelId === 'web_speech';

  // 4A. Google Gemini STT (Modele: gemini-3.5-transcribe, gemini-3.6-flash)
  if (isGoogleStt) {
    const googleKey = getGoogleKey(req);
    if (!googleKey) {
      return res.status(400).json({
        error: 'Brak klucza Google API. Ustaw GOOGLE_API_KEY w .env lub w ustawieniach aplikacji.'
      });
    }

    try {
      const text = await transcribeWithGemini(
        req.file.buffer,
        req.file.mimetype || 'audio/webm',
        googleKey,
        modelId
      );

      const durationMs = Date.now() - startTime;
      const durationSec = +(durationMs / 1000).toFixed(2);
      res.set('X-Duration-Ms', String(durationMs));
      res.set('X-Duration-Sec', String(durationSec));
      console.log(`⏱️ [STT] ${modelId} zakończono w ${durationMs}ms (${durationSec}s)`);

      return res.json({
        text: text.trim(),
        model: modelId,
        provider: 'google',
        language_code: languageCode,
        duration_ms: durationMs,
        duration_sec: durationSec
      });
    } catch (err) {
      console.error('Error during Google STT:', err);
      return res.status(500).json({ error: err.message || 'Błąd transkrypcji Google STT.' });
    }
  }

  // 4B. Groq Whisper STT (Modele: whisper-large-v3-turbo, whisper-large-v3)
  if (isGroqSttModel(modelId)) {
    const groqKey = getGroqKey(req);
    if (!groqKey) {
      return res.status(400).json({
        error: 'Brak klucza Groq API. Ustaw GROQ_API_KEY w .env lub w ustawieniach aplikacji.'
      });
    }

    try {
      const text = await transcribeWithGroq(
        req.file.buffer,
        req.file.mimetype || 'audio/webm',
        req.file.originalname || 'recording.webm',
        groqKey,
        modelId,
        languageCode
      );

      const durationMs = Date.now() - startTime;
      const durationSec = +(durationMs / 1000).toFixed(2);
      res.set('X-Duration-Ms', String(durationMs));
      res.set('X-Duration-Sec', String(durationSec));
      console.log(`⏱️ [STT] Groq ${modelId} zakończono w ${durationMs}ms (${durationSec}s)`);

      return res.json({
        text: text.trim(),
        model: modelId,
        provider: 'groq',
        language_code: languageCode,
        duration_ms: durationMs,
        duration_sec: durationSec
      });
    } catch (err) {
      console.error('Error during Groq STT:', err);
      return res.status(err.status || 500).json({ error: err.message || 'Błąd transkrypcji Groq STT.' });
    }
  }

  // 4C. OpenAI STT (Modele: gpt-transcribe, gpt-4o-transcribe, gpt-4o-mini-transcribe, whisper-1)
  if (isOpenAISttModel(modelId)) {
    const openaiKey = getOpenAIKey(req);
    if (!openaiKey) {
      return res.status(400).json({
        error: 'Brak klucza OpenAI API. Ustaw OPENAI_API_KEY (lub OPEN_API_KEY) w .env albo w ustawieniach aplikacji.'
      });
    }

    try {
      const text = await transcribeWithOpenAI(
        req.file.buffer,
        req.file.mimetype || 'audio/webm',
        req.file.originalname || 'recording.webm',
        openaiKey,
        modelId,
        languageCode
      );

      const durationMs = Date.now() - startTime;
      const durationSec = +(durationMs / 1000).toFixed(2);
      res.set('X-Duration-Ms', String(durationMs));
      res.set('X-Duration-Sec', String(durationSec));
      console.log(`⏱️ [STT] OpenAI ${modelId} zakończono w ${durationMs}ms (${durationSec}s)`);

      return res.json({
        text: text.trim(),
        model: modelId,
        provider: 'openai',
        language_code: languageCode,
        duration_ms: durationMs,
        duration_sec: durationSec
      });
    } catch (err) {
      console.error('Error during OpenAI STT:', err);
      return res.status(err.status || 500).json({ error: err.message || 'Błąd transkrypcji OpenAI STT.' });
    }
  }

  // 4D. ElevenLabs STT (Scribe) z automatycznym fallbackiem do Google Gemini
  const apiKey = getElevenLabsKey(req);
  if (!apiKey) {
    const googleKey = getGoogleKey(req);
    if (googleKey) {
      try {
        console.log('Brak klucza ElevenLabs, fallback do Google Gemini STT...');
        const text = await transcribeWithGemini(
          req.file.buffer,
          req.file.mimetype || 'audio/webm',
          googleKey,
          'gemini-3.5-transcribe'
        );

        const durationMs = Date.now() - startTime;
        const durationSec = +(durationMs / 1000).toFixed(2);
        res.set('X-Duration-Ms', String(durationMs));
        res.set('X-Duration-Sec', String(durationSec));

        return res.json({
          text: text.trim(),
          model: 'gemini-3.5-transcribe',
          provider: 'google',
          language_code: languageCode,
          duration_ms: durationMs,
          duration_sec: durationSec
        });
      } catch (err) {
        console.error('Fallback do Google STT nie powiódł się:', err);
      }
    }

    return res.status(400).json({
      error: 'Brak klucza ElevenLabs API. Ustaw go w pliku .env lub wybierz model Google STT w ustawieniach.'
    });
  }

  try {
    const formData = new FormData();
    const audioBlob = new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/webm' });
    const filename = req.file.originalname || 'recording.webm';

    formData.append('file', audioBlob, filename);
    formData.append('model_id', modelId);
    if (languageCode && languageCode !== 'auto') {
      formData.append('language_code', languageCode);
    }

    const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: formData
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const msg = errData.detail?.message || errData.message || `ElevenLabs STT error (${response.status})`;
      console.error('ElevenLabs STT API error:', msg);
      return res.status(response.status).json({ error: msg });
    }

    const data = await response.json();
    const transcribedText = data.text || '';
    const durationMs = Date.now() - startTime;
    const durationSec = +(durationMs / 1000).toFixed(2);
    res.set('X-Duration-Ms', String(durationMs));
    res.set('X-Duration-Sec', String(durationSec));
    console.log(`⏱️ [STT] ElevenLabs ${modelId} zakończono w ${durationMs}ms (${durationSec}s)`);

    res.json({
      text: transcribedText.trim(),
      language_code: data.language_code,
      words: data.words || [],
      duration_ms: durationMs,
      duration_sec: durationSec
    });
  } catch (error) {
    console.error('Error during STT:', error);
    res.status(500).json({ error: error.message || 'Błąd transkrypcji audio.' });
  }
});

// ----------------------------------------------------
// 5. POST /api/chat - AI Generation (Google Gemini / Claude) with Timing
// ----------------------------------------------------
app.post('/api/chat', async (req, res) => {
  const startTime = Date.now();
  const { messages, systemPrompt, model } = req.body;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Pole "messages" jest wymagane i musi zawierać tablicę wiadomości.' });
  }

  const selectedModel = model || process.env.AI_MODEL || process.env.CLAUDE_MODEL || 'gemini-3.6-flash';
  const defaultSystemPrompt =
    'Jesteś inteligentnym, przyjaznym i naturalnym asystentem głosowym. ' +
    'Odpowiadasz w języku polskim, zwięźle, płynnie i rzeczowo (najlepiej w 1-3 zdaniach, maksymalnie 2-3 zdania, chyba że użytkownik wyraźnie prosi o dłuższą wypowiedź). ' +
    'TWOJA ODPOWIEDŹ ZOSTANIE ODCZYTANA NA GŁOS PRZEZ SYNTEZATOR MOWY: ' +
    'bezwzględnie unikaj formatowania Markdown (pogrubień, gwiazdek, list punktowanych, nagłówków #), linków, emotikonów oraz fragmentów kodu. Pisz wyłącznie czystym, mówionym tekstem.';

  const isGoogle = selectedModel.startsWith('gemini-') || selectedModel.includes('gemini') || selectedModel.includes('gemma');

  // ==========================================
  // 5A. Google Gemini Execution
  // ==========================================
  if (isGoogle) {
    const googleKey = getGoogleKey(req);
    if (!googleKey) {
      return res.status(400).json({
        error: 'Brak klucza Google Gemini API. Ustaw GOOGLE_API_KEY w pliku .env lub w ustawieniach aplikacji.'
      });
    }

    const formattedMessages = messages
      .filter(m => m.content && String(m.content).trim().length > 0)
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: String(m.content).trim() }]
      }));

    if (formattedMessages.length === 0) {
      return res.status(400).json({ error: 'Brak treści wiadomości do przetworzenia.' });
    }

    const payload = {
      system_instruction: {
        parts: [{ text: systemPrompt || defaultSystemPrompt }]
      },
      contents: formattedMessages,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 600
      }
    };

    const modelsToTry = [...new Set([
      selectedModel,
      'gemini-3.6-flash',
      'gemini-flash-latest',
      'gemini-3.8-flash',
      'gemini-2.5-pro'
    ])];

    let lastError = null;
    for (const currentModel of modelsToTry) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${googleKey}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          const data = await response.json();
          const candidates = data.candidates || [];
          if (candidates.length > 0 && candidates[0].content?.parts?.length > 0) {
            const replyText = candidates[0].content.parts
              .map(p => p.text || '')
              .join('\n')
              .trim();

            const durationMs = Date.now() - startTime;
            const durationSec = +(durationMs / 1000).toFixed(2);
            res.set('X-Duration-Ms', String(durationMs));
            res.set('X-Duration-Sec', String(durationSec));
            console.log(`⏱️ [LLM] ${currentModel} zakończono w ${durationMs}ms (${durationSec}s)`);

            if (currentModel !== selectedModel) {
              console.log(`ℹ️ Google Gemini fallback: użyto "${currentModel}" zamiast "${selectedModel}".`);
            }

            return res.json({
              text: replyText,
              model: currentModel,
              provider: 'google',
              fallbackUsed: currentModel !== selectedModel,
              originalModelRequested: selectedModel,
              usage: data.usageMetadata,
              duration_ms: durationMs,
              duration_sec: durationSec
            });
          }
        }

        const errText = await response.text().catch(() => '');
        lastError = new Error(`Gemini ${currentModel} (${response.status}): ${errText}`);
        console.warn(`⚠️ Google Gemini model "${currentModel}" status ${response.status}:`, errText.slice(0, 150));
      } catch (err) {
        lastError = err;
        console.warn(`⚠️ Google Gemini error on "${currentModel}":`, err.message);
      }
    }

    console.error('Google Gemini API error:', lastError);
    return res.status(502).json({
      error: `Błąd podczas komunikacji z Google Gemini: ${lastError?.message || 'Nieznany błąd'}`
    });
  }

  // ==========================================
  // 5B. OpenAI GPT Execution
  // ==========================================
  if (isOpenAIChatModel(selectedModel)) {
    const openaiKey = getOpenAIKey(req);
    if (!openaiKey) {
      return res.status(400).json({
        error: 'Brak klucza OpenAI API. Ustaw OPENAI_API_KEY (lub OPEN_API_KEY) w pliku .env lub w ustawieniach aplikacji.'
      });
    }

    const formattedMessages = messages
      .filter(m => m.content && String(m.content).trim().length > 0)
      .map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: String(m.content).trim()
      }));

    if (formattedMessages.length === 0) {
      return res.status(400).json({ error: 'Brak treści wiadomości do przetworzenia.' });
    }

    const modelsToTry = [...new Set([selectedModel, ...defaultOpenAIModels.map(m => m.id)])];

    let lastError = null;
    for (const currentModel of modelsToTry) {
      // Modele rozumujące (GPT-5+, seria o) nie przyjmują temperature, a limit tokenów
      // obejmuje też rozumowanie - stąd niski reasoning_effort i większy zapas tokenów
      const isReasoningModel = /^(gpt-5|gpt-6|o\d)/.test(currentModel);
      const payload = {
        model: currentModel,
        messages: [
          { role: 'system', content: systemPrompt || defaultSystemPrompt },
          ...formattedMessages
        ],
        ...(isReasoningModel
          ? { reasoning_effort: 'low', max_completion_tokens: 4000 }
          : { temperature: 0.7, max_completion_tokens: 600 })
      };

      try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${openaiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        const data = await response.json().catch(() => ({}));

        if (response.ok) {
          const replyText = (data.choices?.[0]?.message?.content || '').trim();
          const durationMs = Date.now() - startTime;
          const durationSec = +(durationMs / 1000).toFixed(2);
          res.set('X-Duration-Ms', String(durationMs));
          res.set('X-Duration-Sec', String(durationSec));
          console.log(`⏱️ [LLM] OpenAI ${currentModel} zakończono w ${durationMs}ms (${durationSec}s)`);

          if (currentModel !== selectedModel) {
            console.log(`ℹ️ OpenAI model fallback: użyto "${currentModel}" zamiast "${selectedModel}".`);
          }

          return res.json({
            text: replyText,
            model: data.model || currentModel,
            provider: 'openai',
            fallbackUsed: currentModel !== selectedModel,
            originalModelRequested: selectedModel,
            usage: data.usage,
            duration_ms: durationMs,
            duration_sec: durationSec
          });
        }

        const message = data.error?.message || `OpenAI (${response.status})`;
        lastError = Object.assign(new Error(message), { status: response.status });

        // Przechodzimy do kolejnego modelu tylko, gdy ten nie istnieje / jest niedostępny dla klucza
        const isModelUnavailable = response.status === 404 || data.error?.code === 'model_not_found';
        if (!isModelUnavailable) break;
        console.warn(`⚠️ OpenAI model "${currentModel}" niedostępny. Próbuję alternatywny model...`);
      } catch (err) {
        lastError = err;
        break;
      }
    }

    console.error('OpenAI API error:', lastError);
    return res.status(lastError?.status || 502).json({
      error: `Błąd podczas komunikacji z OpenAI: ${lastError?.message || 'Nieznany błąd'}`
    });
  }

  // ==========================================
  // 5C. Anthropic Claude Execution
  // ==========================================
  const apiKey = getAnthropicKey(req);
  if (!apiKey) {
    return res.status(400).json({
      error: 'Brak klucza Anthropic Claude API. Ustaw ANTHROPIC_API_KEY w pliku .env lub w ustawieniach aplikacji.'
    });
  }

  try {
    const anthropic = new Anthropic({ apiKey });

    const formattedMessages = messages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || '')
    })).filter(m => m.content.trim().length > 0);

    const modelsToTry = [...new Set([
      selectedModel,
      'claude-opus-5',
      'claude-opus-4-6',
      'claude-opus-4-5-20251101',
      'claude-sonnet-5',
      'claude-haiku-4-5-20251001'
    ])];

    let lastError = null;
    for (const currentModel of modelsToTry) {
      try {
        const response = await anthropic.messages.create({
          model: currentModel,
          max_tokens: 1200,
          system: systemPrompt || defaultSystemPrompt,
          messages: formattedMessages
        });

        const replyText = response.content
          .filter(block => block.type === 'text')
          .map(block => block.text)
          .join('\n')
          .trim();

        const durationMs = Date.now() - startTime;
        const durationSec = +(durationMs / 1000).toFixed(2);
        res.set('X-Duration-Ms', String(durationMs));
        res.set('X-Duration-Sec', String(durationSec));
        console.log(`⏱️ [LLM] Claude ${currentModel} zakończono w ${durationMs}ms (${durationSec}s)`);

        if (currentModel !== selectedModel) {
          console.log(`ℹ️ Claude model fallback: użyto "${currentModel}" zamiast "${selectedModel}".`);
        }

        return res.json({
          text: replyText,
          model: response.model,
          provider: 'anthropic',
          fallbackUsed: currentModel !== selectedModel,
          originalModelRequested: selectedModel,
          usage: response.usage,
          duration_ms: durationMs,
          duration_sec: durationSec
        });
      } catch (err) {
        lastError = err;
        const isNotFoundError =
          err.status === 404 ||
          err.error?.type === 'not_found_error' ||
          (err.message && (err.message.includes('not_found_error') || err.message.includes('model:')));

        if (isNotFoundError) {
          console.warn(`⚠️ Model "${currentModel}" zwrócił 404 not_found_error. Próbuję alternatywny model...`);
          continue;
        }
        throw err;
      }
    }

    throw lastError;
  } catch (error) {
    console.error('Claude API error:', error);
    res.status(error.status || 500).json({
      error: error.message || 'Błąd podczas komunikacji z Claude API.'
    });
  }
});

// ----------------------------------------------------
// 6. POST /api/tts - Text-to-Speech with Timing
// ----------------------------------------------------
app.post('/api/tts', async (req, res) => {
  const startTime = Date.now();
  const { text, voiceId, modelId } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Pole "text" jest wymagane.' });
  }

  const cleanText = text.trim();

  // Rozpoznanie intencji dostawcy na podstawie głosu i modelu
  const isOpenAIRequested = isOpenAIVoiceId(voiceId);

  const isElevenRequested = Boolean(
    isElevenVoiceId(voiceId) ||
    (modelId && modelId.startsWith('eleven_'))
  ) && !isOpenAIRequested;

  const isWaveNetRequested = Boolean(
    (voiceId && voiceId.startsWith('pl-PL-Wavenet')) ||
    (modelId === 'google-cloud-wavenet')
  );

  const isEdgeRequested = Boolean(
    (voiceId === 'pl-PL-MarekNeural' || voiceId === 'pl-PL-ZofiaNeural' || modelId === 'edge-neural') &&
    !isElevenRequested
  );

  const isGeminiRequested = Boolean(
    (voiceId === 'google-gemini-neural' || (modelId && modelId.includes('gemini'))) &&
    !isElevenRequested && !isWaveNetRequested && !isEdgeRequested
  );

  const targetVoiceId = voiceId || (isElevenRequested ? (process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL') : (process.env.VOICE_ID || 'google-gemini-neural'));
  const targetModelId = modelId || (isElevenRequested ? (process.env.ELEVENLABS_TTS_MODEL || 'eleven_multilingual_v2') : (process.env.TTS_MODEL || 'gemini-2.5-flash-preview-tts'));

  let ttsFallbackReason = null;

  function finalizeAudioResponse(audioBuffer, contentType = 'audio/mpeg', method = 'TTS', fallbackReason = null) {
    const durationMs = Date.now() - startTime;
    const durationSec = +(durationMs / 1000).toFixed(2);
    const reason = fallbackReason || ttsFallbackReason;
    const headers = {
      'Content-Type': contentType,
      'Content-Length': audioBuffer.length,
      'Cache-Control': 'no-cache',
      'X-Duration-Ms': String(durationMs),
      'X-Duration-Sec': String(durationSec),
      'X-TTS-Method': method,
      'Access-Control-Expose-Headers': 'X-Duration-Ms, X-Duration-Sec, X-TTS-Method, X-TTS-Fallback-Reason'
    };
    if (reason) {
      headers['X-TTS-Fallback-Reason'] = encodeURIComponent(reason);
    }
    res.set(headers);
    console.log(`⏱️ [TTS - ${method}] Wygenerowano audio w ${durationMs}ms (${durationSec}s)${reason ? ` (Powód fallbacku: ${reason})` : ''}`);
    return res.send(audioBuffer);
  }

  // 0. OpenAI TTS (gpt-4o-mini-tts, tts-1-hd, tts-1) z fallbackiem do Edge Neural
  if (isOpenAIRequested) {
    const openaiKey = getOpenAIKey(req);
    if (openaiKey) {
      try {
        const openaiModelId = (modelId && (modelId.startsWith('gpt-') || modelId.startsWith('tts-'))) ? modelId : 'gpt-4o-mini-tts';
        const { audioBuffer, model } = await synthesizeWithOpenAI(cleanText, targetVoiceId, openaiModelId, openaiKey);
        return finalizeAudioResponse(audioBuffer, 'audio/mpeg', `OpenAI (${model})`);
      } catch (err) {
        console.warn('OpenAI TTS błąd:', err.message);
        ttsFallbackReason = `OpenAI: ${err.message}`;
      }
    } else {
      console.warn('Wybrano głos OpenAI, ale brak klucza API (OPENAI_API_KEY / OPEN_API_KEY). Fallback do Edge Neural...');
      ttsFallbackReason = 'Brak klucza API OpenAI.';
    }
  }

  // 1. ElevenLabs TTS (Priorytet, gdy wybrano głos lub model ElevenLabs)
  if (!isOpenAIRequested && (isElevenRequested || isElevenVoiceId(targetVoiceId) || (targetModelId && targetModelId.startsWith('eleven_')))) {
    const apiKey = getElevenLabsKey(req);
    if (apiKey) {
      try {
        const elevenVoiceId = isElevenVoiceId(targetVoiceId)
          ? targetVoiceId
          : (process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL');
        const elevenModelId = (targetModelId && targetModelId.startsWith('eleven_'))
          ? targetModelId
          : (process.env.ELEVENLABS_TTS_MODEL || 'eleven_multilingual_v2');

        // Dynamiczne, naturalne nastawy w zależności od modelu
        const isV2 = elevenModelId === 'eleven_multilingual_v2';
        const voiceSettings = isV2 ? {
          stability: 0.38,
          similarity_boost: 0.8,
          style: 0.35,
          use_speaker_boost: true
        } : {
          stability: 0.4,
          similarity_boost: 0.75
        };

        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${elevenVoiceId}`, {
          method: 'POST',
          headers: {
            'xi-api-key': apiKey,
            'Content-Type': 'application/json',
            'Accept': 'audio/mpeg'
          },
          body: JSON.stringify({
            text: cleanText,
            model_id: elevenModelId,
            voice_settings: voiceSettings
          })
        });

        if (response.ok) {
          const audioBuffer = Buffer.from(await response.arrayBuffer());
          return finalizeAudioResponse(audioBuffer, 'audio/mpeg', `ElevenLabs (${elevenModelId})`);
        }
        const errDetails = await response.text().catch(() => '');
        console.warn(`ElevenLabs TTS zwrócił status ${response.status}: ${errDetails}. Przełączanie na fallback...`);
        try {
          const parsed = JSON.parse(errDetails);
          if (parsed.detail?.code === 'quota_exceeded' || parsed.detail?.status === 'quota_exceeded') {
            ttsFallbackReason = 'Wyczerpano limit kredytów ElevenLabs (quota exceeded).';
          } else if (parsed.detail?.message) {
            ttsFallbackReason = `ElevenLabs: ${parsed.detail.message}`;
          }
        } catch {
          ttsFallbackReason = `ElevenLabs zwrócił błąd ${response.status}`;
        }
      } catch (err) {
        console.warn('ElevenLabs TTS błąd:', err.message);
        ttsFallbackReason = `ElevenLabs błąd połączenia: ${err.message}`;
      }
    } else {
      console.warn('Wybrano ElevenLabs, ale brak klucza API (ELEVENLABS_API_KEY). Fallback do Edge Neural...');
      ttsFallbackReason = 'Brak klucza API ElevenLabs.';
    }
  }

  // 2. Google Gemini TTS
  if (!isOpenAIRequested && (isGeminiRequested || targetVoiceId === 'google-gemini-neural' || (targetModelId && targetModelId.includes('gemini')))) {
    const googleKey = getGoogleKey(req);
    if (googleKey) {
      try {
        const ttsUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${googleKey}`;
        const ttsRes = await fetch(ttsUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `Przeczytaj dokładnie i naturalnie po polsku: ${cleanText}` }] }],
            generationConfig: { responseModalities: ['AUDIO'] }
          })
        });

        if (ttsRes.ok) {
          const data = await ttsRes.json();
          const inlineData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData;
          if (inlineData?.data) {
            const rawPcm = Buffer.from(inlineData.data, 'base64');
            const wavBuffer = pcmToWavBuffer(rawPcm, 24000);
            return finalizeAudioResponse(wavBuffer, 'audio/wav', 'Google Gemini TTS');
          }
        }
        console.warn('Google Gemini TTS niedostępne, fallback do Edge Neural TTS...');
      } catch (err) {
        console.warn('Błąd Google Gemini TTS:', err.message);
      }
    }
  }

  // 3. Google Cloud WaveNet (z fallbackiem do Edge Neural)
  if (isWaveNetRequested || targetVoiceId.startsWith('pl-PL-Wavenet') || targetModelId === 'google-cloud-wavenet') {
    const googleKey = getGoogleKey(req);
    if (googleKey) {
      try {
        const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${googleKey}`;
        const gender = (targetVoiceId.endsWith('-A') || targetVoiceId.endsWith('-D')) ? 'FEMALE' : 'MALE';
        const waveVoice = targetVoiceId.startsWith('pl-PL-Wavenet') ? targetVoiceId : 'pl-PL-Wavenet-A';
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            input: { text: cleanText },
            voice: { languageCode: 'pl-PL', name: waveVoice, ssmlGender: gender },
            audioConfig: { audioEncoding: 'MP3', speakingRate: 1.0 }
          })
        });

        if (resp.ok) {
          const data = await resp.json();
          if (data.audioContent) {
            const mp3Buffer = Buffer.from(data.audioContent, 'base64');
            return finalizeAudioResponse(mp3Buffer, 'audio/mpeg', 'Google WaveNet');
          }
        }
        console.warn(`Cloud WaveNet status ${resp.status}, fallback do Edge Neural...`);
      } catch (err) {
        console.warn('Cloud WaveNet error:', err.message);
      }
    }

    const fallbackEdgeVoice = (targetVoiceId.endsWith('-A') || targetVoiceId.endsWith('-D')) ? 'pl-PL-ZofiaNeural' : 'pl-PL-MarekNeural';
    try {
      const audioBuffer = await synthesizeWithEdge(cleanText, fallbackEdgeVoice);
      return finalizeAudioResponse(audioBuffer, 'audio/mpeg', `Edge Neural (${fallbackEdgeVoice})`);
    } catch (edgeErr) {
      console.warn('Edge fallback failed:', edgeErr.message);
    }
  }

  // 4. Głosy Edge Neural (Marek / Zofia z projektu sts)
  if (isEdgeRequested || targetVoiceId === 'pl-PL-MarekNeural' || targetVoiceId === 'pl-PL-ZofiaNeural' || targetModelId === 'edge-neural') {
    const edgeVoice = (targetVoiceId === 'pl-PL-ZofiaNeural') ? 'pl-PL-ZofiaNeural' : 'pl-PL-MarekNeural';
    try {
      const audioBuffer = await synthesizeWithEdge(cleanText, edgeVoice);
      return finalizeAudioResponse(audioBuffer, 'audio/mpeg', `Edge Neural (${edgeVoice})`);
    } catch (err) {
      console.warn('Edge TTS error:', err.message);
    }
  }

  // 5. Ostateczny fallback: Edge Neural (dopasowany płcią do wybranego głosu)
  try {
    const femaleVoiceIds = ['EXAVITQu4vr4xnSDxMaL', 'pl-PL-ZofiaNeural', 'openai-marin', 'openai-coral', 'openai-nova', 'openai-sage', 'openai-shimmer'];
    const isFemaleVoice = femaleVoiceIds.includes(targetVoiceId);
    const fallbackEdgeVoice = isFemaleVoice ? 'pl-PL-ZofiaNeural' : 'pl-PL-MarekNeural';
    const fallbackLabel = fallbackEdgeVoice === 'pl-PL-ZofiaNeural' ? 'Zofia' : 'Marek';
    const audioBuffer = await synthesizeWithEdge(cleanText, fallbackEdgeVoice);
    return finalizeAudioResponse(audioBuffer, 'audio/mpeg', `Edge Neural Fallback (${fallbackLabel})`);
  } catch (err) {
    console.error('All TTS methods failed:', err);
    res.status(500).json({ error: 'Nie udało się wygenerować audio żadną z dostępnych metod.' });
  }
});

// Start server
app.listen(port, () => {
  console.log(`\n🚀 Serwer uruchomiony: http://localhost:${port}`);
  console.log(`🎙️  STT: Google Gemini Transcribe / Web Speech / Groq Whisper / OpenAI Transcribe / ElevenLabs Scribe`);
  console.log(`🧠 LLM: Google Gemini, Anthropic Claude & OpenAI GPT`);
  console.log(`🔊 TTS: Google Gemini Voice / WaveNet / Edge Neural / OpenAI / ElevenLabs\n`);
});
