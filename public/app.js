// ==========================================================================
// Voice Studio AI - Studio Audio Controller
// ==========================================================================

// State initialization
let initialModel = localStorage.getItem('ai_model') || localStorage.getItem('claude_model');
if (!initialModel || initialModel.includes('haiku') || initialModel.includes('claude-3')) {
  initialModel = 'gemini-3.6-flash';
  localStorage.setItem('ai_model', initialModel);
  localStorage.setItem('claude_model', initialModel);
}

let initialVoiceId = localStorage.getItem('voice_id');
if (!initialVoiceId || initialVoiceId === '21m00Tcm4TlvDq8ikWAM') {
  initialVoiceId = 'google-gemini-neural'; // Domyślny z projektu sts
  localStorage.setItem('voice_id', initialVoiceId);
}

let initialSttModel = localStorage.getItem('stt_model') || 'gemini-3.5-transcribe';
let initialTtsModel = localStorage.getItem('tts_model') || 'gemini-2.5-flash-preview-tts';

// Auto-reconciliation if ElevenLabs voice was chosen with non-ElevenLabs model or vice versa
const isElevenInitVoice = initialVoiceId && !initialVoiceId.startsWith('google-') && !initialVoiceId.startsWith('pl-PL-');
if (isElevenInitVoice && !initialTtsModel.startsWith('eleven_')) {
  initialTtsModel = 'eleven_multilingual_v2';
  localStorage.setItem('tts_model', initialTtsModel);
} else if (initialTtsModel.startsWith('eleven_') && (initialVoiceId.startsWith('google-') || initialVoiceId.startsWith('pl-PL-'))) {
  initialVoiceId = 'EXAVITQu4vr4xnSDxMaL';
  localStorage.setItem('voice_id', initialVoiceId);
}

const MAX_READER_HISTORY = 10;

const state = {
  status: 'idle', // 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking'
  messages: [],
  readerHistory: [], // Lista do 10 ostatnich nagrań w bieżącej sesji
  activeHistoryId: null,
  keys: {
    elevenLabs: localStorage.getItem('elevenlabs_api_key') || '',
    anthropic: localStorage.getItem('anthropic_api_key') || '',
    google: localStorage.getItem('google_api_key') || ''
  },
  settings: {
    voiceId: initialVoiceId,
    ttsModel: initialTtsModel,
    sttModel: initialSttModel,
    aiModel: initialModel,
    claudeModel: initialModel,
    systemPrompt: localStorage.getItem('system_prompt') || ''
  },
  serverConfig: {
    hasEnvElevenLabs: false,
    hasEnvAnthropic: false,
    hasEnvGoogle: false
  }
};

// DOM Elements
const voiceStage = document.querySelector('.voice-stage');
const micToggleBtn = document.getElementById('micToggleBtn');
const statusMessage = document.getElementById('statusMessage');
const onAirBadge = document.getElementById('onAirBadge');
const chatContainer = document.getElementById('chatContainer');
const emptyState = document.getElementById('emptyState');
const messageCountEl = document.getElementById('messageCount');
const chatInputForm = document.getElementById('chatInputForm');
const textInput = document.getElementById('textInput');
const clearChatBtn = document.getElementById('clearChatBtn');
const keysStatusBadge = document.getElementById('keysStatusBadge');
const keysStatusText = document.getElementById('keysStatusText');
const ttsAudioPlayer = document.getElementById('ttsAudioPlayer');

// Reader View Elements
const navChatBtn = document.getElementById('navChatBtn');
const navReaderBtn = document.getElementById('navReaderBtn');
const viewChat = document.getElementById('viewChat');
const viewReader = document.getElementById('viewReader');
const brandHomeLink = document.getElementById('brandHomeLink');
const readerBackBtn = document.getElementById('readerBackBtn');
const readerEditSettingsBtn = document.getElementById('readerEditSettingsBtn');
const readerPillVoiceName = document.getElementById('readerPillVoiceName');
const readerPillModelName = document.getElementById('readerPillModelName');

const readerTextInput = document.getElementById('readerTextInput');
const readerPasteBtn = document.getElementById('readerPasteBtn');
const readerSampleBtn = document.getElementById('readerSampleBtn');
const readerClearBtn = document.getElementById('readerClearBtn');
const readerCharCount = document.getElementById('readerCharCount');
const readerWordCount = document.getElementById('readerWordCount');
const readerEstimatedTime = document.getElementById('readerEstimatedTime');
const readerSynthesizeBtn = document.getElementById('readerSynthesizeBtn');
const readerSubmitBtnText = document.getElementById('readerSubmitBtnText');
const readerSpinner = document.getElementById('readerSpinner');
const readerBtnIcon = document.getElementById('readerBtnIcon');
const readerStatusText = document.getElementById('readerStatusText');

const readerPlayerEmpty = document.getElementById('readerPlayerEmpty');
const readerPlayerActive = document.getElementById('readerPlayerActive');
const playerStateBadge = document.getElementById('playerStateBadge');
const playerStateText = document.getElementById('playerStateText');
const readerTrackTitle = document.getElementById('readerTrackTitle');
const readerTrackMeta = document.getElementById('readerTrackMeta');
const readerDownloadLink = document.getElementById('readerDownloadLink');
const readerWaveform = document.getElementById('readerWaveform');
const waveformBars = document.getElementById('waveformBars');
const readerScrubberTrack = document.getElementById('readerScrubberTrack');
const readerScrubberFill = document.getElementById('readerScrubberFill');
const readerScrubberThumb = document.getElementById('readerScrubberThumb');
const readerCurrentTime = document.getElementById('readerCurrentTime');
const readerTotalTime = document.getElementById('readerTotalTime');
const readerPlayPauseBtn = document.getElementById('readerPlayPauseBtn');
const readerPlayIcon = document.getElementById('readerPlayIcon');
const readerPauseIcon = document.getElementById('readerPauseIcon');
const readerRewindBtn = document.getElementById('readerRewindBtn');
const readerForwardBtn = document.getElementById('readerForwardBtn');
const readerStopBtn = document.getElementById('readerStopBtn');
const readerSpeedSelect = document.getElementById('readerSpeedSelect');
const readerAudioElement = document.getElementById('readerAudioElement');

// Reader Session History Elements
const readerHistorySection = document.getElementById('readerHistorySection');
const historyCounterPill = document.getElementById('historyCounterPill');
const readerClearHistoryBtn = document.getElementById('readerClearHistoryBtn');
const historyEmpty = document.getElementById('historyEmpty');
const historyList = document.getElementById('historyList');

// Dynamic Labels
const headerSubtitle = document.getElementById('headerSubtitle');
const deckVoiceTitle = document.getElementById('deckVoiceTitle');
const deckModelFidelity = document.getElementById('deckModelFidelity');
const emptyStateText = document.getElementById('emptyStateText');

// Pipeline Pills, Labels & Live Timers
const stepPillSTT = document.getElementById('stepPillSTT');
const stepPillClaude = document.getElementById('stepPillClaude');
const stepPillTTS = document.getElementById('stepPillTTS');
const stepPillPlay = document.getElementById('stepPillPlay');
const stepLabelSTT = document.getElementById('stepLabelSTT');
const stepLabelClaude = document.getElementById('stepLabelClaude');
const stepLabelTTS = document.getElementById('stepLabelTTS');
const stepLabelPlay = document.getElementById('stepLabelPlay');
const stepTimerSTT = document.getElementById('stepTimerSTT');
const stepTimerLLM = document.getElementById('stepTimerLLM');
const stepTimerTTS = document.getElementById('stepTimerTTS');
const stepTimerPlay = document.getElementById('stepTimerPlay');
const pipelineTotal = document.getElementById('pipelineTotal');
const pipelineTotalTime = document.getElementById('pipelineTotalTime');

// Live Pipeline Tracker (tracks execution in seconds with 0.1s precision)
const pipelineTracker = {
  activeTimer: null,
  activeStep: null,
  stepStart: 0,
  turnStart: 0,
  durations: {
    stt: 0,
    llm: 0,
    tts: 0,
    play: 0
  },

  reset() {
    if (this.activeTimer) {
      clearInterval(this.activeTimer);
      this.activeTimer = null;
    }
    this.activeStep = null;
    this.stepStart = 0;
    this.turnStart = performance.now();
    this.durations = { stt: 0, llm: 0, tts: 0, play: 0 };

    const steps = [
      { pill: stepPillSTT, timer: stepTimerSTT },
      { pill: stepPillClaude, timer: stepTimerLLM },
      { pill: stepPillTTS, timer: stepTimerTTS },
      { pill: stepPillPlay, timer: stepTimerPlay }
    ];
    steps.forEach(({ pill, timer }) => {
      if (pill) pill.className = 'pipeline-step';
      if (timer) timer.textContent = '--';
    });

    if (pipelineTotal) pipelineTotal.classList.remove('highlight');
    if (pipelineTotalTime) pipelineTotalTime.textContent = '0.0s';
  },

  startStep(stepKey) {
    if (this.activeTimer) {
      clearInterval(this.activeTimer);
      this.activeTimer = null;
    }
    this.activeStep = stepKey;
    this.stepStart = performance.now();
    if (!this.turnStart) {
      this.turnStart = this.stepStart;
    }

    const stepMap = {
      stt: { pill: stepPillSTT, timer: stepTimerSTT },
      llm: { pill: stepPillClaude, timer: stepTimerLLM },
      tts: { pill: stepPillTTS, timer: stepTimerTTS },
      play: { pill: stepPillPlay, timer: stepTimerPlay }
    };

    const target = stepMap[stepKey];
    if (target && target.pill) {
      target.pill.className = 'pipeline-step active';
      if (target.timer) target.timer.textContent = '0.0s';
    }

    this.activeTimer = setInterval(() => {
      const elapsedStepSec = (performance.now() - this.stepStart) / 1000;
      const elapsedTotalSec = (performance.now() - this.turnStart) / 1000;

      if (target && target.timer) {
        target.timer.textContent = `${elapsedStepSec.toFixed(1)}s`;
      }
      if (pipelineTotalTime) {
        pipelineTotalTime.textContent = `${elapsedTotalSec.toFixed(1)}s`;
      }
    }, 100);
  },

  finishStep(stepKey, exactDurationSec = null) {
    if (this.activeStep === stepKey && this.activeTimer) {
      clearInterval(this.activeTimer);
      this.activeTimer = null;
    }

    const stepMap = {
      stt: { pill: stepPillSTT, timer: stepTimerSTT },
      llm: { pill: stepPillClaude, timer: stepTimerLLM },
      tts: { pill: stepPillTTS, timer: stepTimerTTS },
      play: { pill: stepPillPlay, timer: stepTimerPlay }
    };

    const elapsed = exactDurationSec !== null && exactDurationSec !== undefined
      ? Number(exactDurationSec)
      : (performance.now() - this.stepStart) / 1000;

    const safeElapsed = Math.max(0, +elapsed.toFixed(1));
    this.durations[stepKey] = safeElapsed;

    const target = stepMap[stepKey];
    if (target && target.pill) {
      target.pill.className = 'pipeline-step done';
      if (target.timer) target.timer.textContent = `✓ ${safeElapsed.toFixed(1)}s`;
    }

    const totalSec = (performance.now() - this.turnStart) / 1000;
    if (pipelineTotalTime) {
      pipelineTotalTime.textContent = `${totalSec.toFixed(1)}s`;
    }
    return safeElapsed;
  },

  completeTurn() {
    if (this.activeTimer) {
      clearInterval(this.activeTimer);
      this.activeTimer = null;
    }
    const totalSec = (performance.now() - this.turnStart) / 1000;
    if (pipelineTotalTime) {
      pipelineTotalTime.textContent = `${totalSec.toFixed(1)}s`;
    }
    if (pipelineTotal) {
      pipelineTotal.classList.add('highlight');
    }
  }
};

// Settings Elements
const settingsModal = document.getElementById('settingsModal');
const openSettingsBtn = document.getElementById('openSettingsBtn');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const refreshVoicesBtn = document.getElementById('refreshVoicesBtn');
const elevenLabsKeyInput = document.getElementById('elevenLabsKeyInput');
const anthropicKeyInput = document.getElementById('anthropicKeyInput');
const googleKeyInput = document.getElementById('googleKeyInput');
const elevenLabsEnvFlag = document.getElementById('elevenLabsEnvFlag');
const anthropicEnvFlag = document.getElementById('anthropicEnvFlag');
const googleEnvFlag = document.getElementById('googleEnvFlag');
const voiceSelect = document.getElementById('voiceSelect');
const ttsModelSelect = document.getElementById('ttsModelSelect');
const sttModelSelect = document.getElementById('sttModelSelect');
const claudeModelSelect = document.getElementById('claudeModelSelect');
const systemPromptInput = document.getElementById('systemPromptInput');

// Canvas & Web Audio
const canvas = document.getElementById('visualizerCanvas');
const ctx = canvas.getContext('2d');
let audioContext = null;
let mediaStream = null;
let mediaRecorder = null;
let audioChunks = [];
let micAnalyser = null;
let micSource = null;
let ttsAnalyser = null;
let ttsSource = null;
let animFrameId = null;
let webSpeechRecognition = null;

// Audio smoothing & phase variables for visualizer
let smoothedLevel = 0;
let phase = 0;

// ==========================================
// Helper Functions for Dynamic Names
// ==========================================
function getVoiceName(voiceId) {
  if (voiceSelect && voiceSelect.options.length > 0) {
    const opt = Array.from(voiceSelect.querySelectorAll('option')).find(o => o.value === voiceId);
    if (opt) {
      return opt.textContent.split('(')[0].trim();
    }
  }
  const defaultMap = {
    'google-gemini-neural': 'Gemini Voice',
    'pl-PL-Wavenet-A': 'WaveNet A',
    'pl-PL-Wavenet-B': 'WaveNet B',
    'pl-PL-Wavenet-D': 'WaveNet D',
    'pl-PL-MarekNeural': 'Marek',
    'pl-PL-ZofiaNeural': 'Zofia',
    'EXAVITQu4vr4xnSDxMaL': 'Sarah',
    'ErXwobaYiN019PkySvjV': 'Antoni',
    'JBFqnCBsd6RMkjVDRZzb': 'George',
    'pNInz6obpgDQGcFmaJgB': 'Adam'
  };
  return defaultMap[voiceId] || 'Głos AI';
}

function getAiModelName(modelId) {
  if (claudeModelSelect && claudeModelSelect.options.length > 0) {
    const opt = Array.from(claudeModelSelect.querySelectorAll('option')).find(o => o.value === modelId);
    if (opt) {
      return opt.textContent.split('(')[0].trim();
    }
  }
  const modelMap = {
    'gemini-3.6-flash': 'Gemini 3.6 Flash',
    'gemini-flash-latest': 'Gemini Flash Latest',
    'gemini-3.8-flash': 'Gemini 3.8 Flash',
    'gemini-2.5-pro': 'Gemini 2.5 Pro',
    'gemini-3.1-pro-preview': 'Gemini 3.1 Pro',
    'claude-opus-5': 'Claude Opus 5',
    'claude-opus-4-6': 'Claude Opus 4.6',
    'claude-haiku-4-5-20251001': 'Claude Haiku 4.5',
    'claude-sonnet-5': 'Claude Sonnet 5',
    'claude-sonnet-4-5-20250929': 'Claude Sonnet 4.5'
  };
  return modelMap[modelId] || modelId;
}

function getClaudeModelName(modelId) {
  return getAiModelName(modelId);
}

function getSttModelName(modelId) {
  if (sttModelSelect && sttModelSelect.options.length > 0) {
    const opt = Array.from(sttModelSelect.querySelectorAll('option')).find(o => o.value === modelId);
    if (opt) {
      return opt.textContent.split('(')[0].trim();
    }
  }
  const map = {
    'gemini-3.5-transcribe': 'Gemini Transcribe',
    'gemini-3.6-flash': 'Gemini 3.6 Flash STT',
    'web_speech': 'Web Speech API',
    'scribe_v2': 'Scribe v2',
    'scribe_v1': 'Scribe v1'
  };
  return map[modelId] || modelId || 'STT';
}

function getTtsModelName(modelId) {
  if (ttsModelSelect && ttsModelSelect.options.length > 0) {
    const opt = Array.from(ttsModelSelect.querySelectorAll('option')).find(o => o.value === modelId);
    if (opt) {
      return opt.textContent.split('(')[0].trim();
    }
  }
  const map = {
    'gemini-2.5-flash-preview-tts': 'Gemini Flash TTS',
    'gemini-3.1-flash-tts-preview': 'Gemini 3.1 Flash TTS',
    'google-cloud-wavenet': 'Google WaveNet',
    'edge-neural': 'Edge Neural',
    'eleven_flash_v2_5': 'Eleven Flash v2.5',
    'eleven_turbo_v2_5': 'Turbo v2.5',
    'eleven_multilingual_v2': 'Multilingual v2'
  };
  return map[modelId] || modelId || 'TTS';
}

// Auto-synchronize Voice and TTS Model (solves UX distinction between voice timbre and AI engine)
function syncVoiceAndTtsModel(source) {
  if (!voiceSelect || !ttsModelSelect) return;
  const currentVoice = voiceSelect.value;
  const currentTts = ttsModelSelect.value;

  if (source === 'voice') {
    if (currentVoice.startsWith('google-gemini')) {
      ttsModelSelect.value = 'gemini-2.5-flash-preview-tts';
    } else if (currentVoice.startsWith('pl-PL-Wavenet')) {
      ttsModelSelect.value = 'google-cloud-wavenet';
    } else if (currentVoice === 'pl-PL-MarekNeural' || currentVoice === 'pl-PL-ZofiaNeural') {
      ttsModelSelect.value = 'edge-neural';
    } else if (currentVoice && (!currentVoice.startsWith('google-') && !currentVoice.startsWith('pl-PL-'))) {
      // ElevenLabs voice ID
      if (!currentTts.startsWith('eleven_')) {
        ttsModelSelect.value = 'eleven_multilingual_v2';
      }
    }
  } else if (source === 'model') {
    if (currentTts.includes('gemini')) {
      if (!currentVoice.startsWith('google-gemini')) {
        voiceSelect.value = 'google-gemini-neural';
      }
    } else if (currentTts === 'google-cloud-wavenet') {
      if (!currentVoice.startsWith('pl-PL-Wavenet')) {
        voiceSelect.value = 'pl-PL-Wavenet-A';
      }
    } else if (currentTts === 'edge-neural') {
      if (currentVoice !== 'pl-PL-MarekNeural' && currentVoice !== 'pl-PL-ZofiaNeural') {
        voiceSelect.value = 'pl-PL-MarekNeural';
      }
    } else if (currentTts.startsWith('eleven_')) {
      if (currentVoice.startsWith('google-') || currentVoice.startsWith('pl-PL-')) {
        voiceSelect.value = 'EXAVITQu4vr4xnSDxMaL'; // Sarah
      }
    }
  }
}

// Update UI labels across header, pipeline, and deck to match current settings
function updateDynamicLabels() {
  const currentModel = state.settings.aiModel || state.settings.claudeModel;
  const voiceName = getVoiceName(state.settings.voiceId);
  const modelName = getAiModelName(currentModel);
  const sttName = getSttModelName(state.settings.sttModel);
  const ttsModelName = getTtsModelName(state.settings.ttsModel);

  // 1. Header Subtitle
  if (headerSubtitle) {
    headerSubtitle.innerHTML = `${sttName} &bull; ${modelName} &bull; ${voiceName}`;
  }

  // 2. Pipeline Pills
  if (stepLabelSTT) stepLabelSTT.textContent = `Mowa (${sttName})`;
  if (stepLabelClaude) stepLabelClaude.textContent = `Myśl (${modelName})`;
  if (stepLabelTTS) stepLabelTTS.textContent = `Synteza (${ttsModelName})`;
  if (stepLabelPlay) stepLabelPlay.textContent = `Na głos (${voiceName})`;

  // 3. Deck Topbar
  if (deckModelFidelity) deckModelFidelity.textContent = `${voiceName.toUpperCase()} • ${modelName.toUpperCase()}`;

  // 4. Empty State
  if (emptyStateText) {
    emptyStateText.innerHTML = `Użyj mikrofonu po lewej stronie, aby zadać pytanie głosowo.<br>
      <strong>${sttName}</strong> dokona transkrypcji, <strong>${modelName}</strong> sformułuje odpowiedź, 
      a syntezator odczyta ją głosem <strong>${voiceName}</strong>.`;
  }

  // 5. Reader Screen System Pill
  updateReaderSystemPill();
}

// ==========================================
// Initialization
// ==========================================
async function init() {
  setupCanvas();
  loadSavedSettings();
  initReaderModule();
  updateDynamicLabels();
  setupEventListeners();
  startVisualizerLoop();
  await checkServerStatus();
  await Promise.all([loadVoices(), loadClaudeModels()]);
  updateDynamicLabels();
}

function setupCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  const size = Math.min(rect.width || 320, rect.height || 320);
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  ctx.resetTransform();
  ctx.scale(dpr, dpr);
}

function loadSavedSettings() {
  if (elevenLabsKeyInput) elevenLabsKeyInput.value = state.keys.elevenLabs;
  if (anthropicKeyInput) anthropicKeyInput.value = state.keys.anthropic;
  if (googleKeyInput) googleKeyInput.value = state.keys.google;
  if (voiceSelect) voiceSelect.value = state.settings.voiceId;
  if (ttsModelSelect) ttsModelSelect.value = state.settings.ttsModel;
  if (sttModelSelect) sttModelSelect.value = state.settings.sttModel;
  if (claudeModelSelect) claudeModelSelect.value = state.settings.aiModel || state.settings.claudeModel;
  if (systemPromptInput) systemPromptInput.value = state.settings.systemPrompt;
}

// Check server .env status
async function checkServerStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    state.serverConfig = data;

    if (data.hasEnvGoogle) {
      googleEnvFlag.textContent = 'Aktywny w .env';
      googleEnvFlag.style.display = 'inline-block';
      if (!googleKeyInput.value) {
        googleKeyInput.placeholder = 'Klucz aktywny z pliku .env serwera';
      }
    } else {
      googleEnvFlag.textContent = '';
      googleEnvFlag.style.display = 'none';
    }

    if (data.hasEnvAnthropic) {
      anthropicEnvFlag.textContent = 'Aktywny w .env';
      anthropicEnvFlag.style.display = 'inline-block';
      if (!anthropicKeyInput.value) {
        anthropicKeyInput.placeholder = 'Klucz aktywny z pliku .env serwera';
      }
    } else {
      anthropicEnvFlag.textContent = '';
      anthropicEnvFlag.style.display = 'none';
    }

    if (data.hasEnvElevenLabs) {
      elevenLabsEnvFlag.textContent = 'Aktywny w .env';
      elevenLabsEnvFlag.style.display = 'inline-block';
      if (!elevenLabsKeyInput.value) {
        elevenLabsKeyInput.placeholder = 'Klucz aktywny z pliku .env serwera';
      }
    } else {
      elevenLabsEnvFlag.textContent = '';
      elevenLabsEnvFlag.style.display = 'none';
    }

    updateApiStatusBadge();
  } catch (err) {
    console.warn('Could not check server status:', err);
    updateApiStatusBadge();
  }
}

function updateApiStatusBadge() {
  const currentModel = state.settings.aiModel || state.settings.claudeModel || 'gemini-3.6-flash';
  const isGoogleLlm = currentModel.startsWith('gemini-') || currentModel.includes('gemini');
  const hasGoogleKey = Boolean(state.keys.google || state.serverConfig.hasEnvGoogle);
  const hasClaudeKey = Boolean(state.keys.anthropic || state.serverConfig.hasEnvAnthropic);
  const hasLlm = isGoogleLlm ? hasGoogleKey : hasClaudeKey;

  const isGoogleStt = state.settings.sttModel.startsWith('gemini-') || state.settings.sttModel === 'web_speech';
  const hasStt = isGoogleStt
    ? (state.settings.sttModel === 'web_speech' || hasGoogleKey)
    : Boolean(state.keys.elevenLabs || state.serverConfig.hasEnvElevenLabs || hasGoogleKey);

  const isGoogleTts = state.settings.voiceId.startsWith('google-') || state.settings.voiceId.startsWith('pl-PL-') || state.settings.ttsModel.includes('gemini') || state.settings.ttsModel.includes('edge') || state.settings.ttsModel.includes('wavenet');
  const hasTts = isGoogleTts
    ? true // Edge Neural jest darmowy, a Gemini używa Google Key
    : Boolean(state.keys.elevenLabs || state.serverConfig.hasEnvElevenLabs);

  if (hasLlm && hasStt && hasTts) {
    keysStatusBadge.className = 'keys-status-badge ready';
    const providerTag = isGoogleLlm ? 'Google Gemini' : 'Claude';
    keysStatusText.textContent = `Studio aktywne (${providerTag})`;
  } else if (hasLlm || hasStt || hasTts) {
    keysStatusBadge.className = 'keys-status-badge';
    keysStatusText.textContent = 'Częściowo gotowe';
  } else {
    keysStatusBadge.className = 'keys-status-badge missing';
    keysStatusText.textContent = 'Wymaga klucza API';
  }
}

// Load voices from API with Optgroups
async function loadVoices() {
  const headers = {};
  if (state.keys.elevenLabs) headers['x-elevenlabs-key'] = state.keys.elevenLabs;
  if (state.keys.google) headers['x-google-key'] = state.keys.google;

  try {
    const res = await fetch('/api/voices', { headers });
    if (!res.ok) return;
    const data = await res.json();
    if (data.voices && Array.isArray(data.voices)) {
      const currentVal = voiceSelect.value || state.settings.voiceId;
      voiceSelect.innerHTML = '';

      const googleVoices = data.voices.filter(v => v.category === 'google');
      const elevenVoices = data.voices.filter(v => v.category !== 'google');

      if (googleVoices.length > 0) {
        const groupGoogle = document.createElement('optgroup');
        groupGoogle.label = 'Głosy Google & Naturalne (z projektu sts)';
        googleVoices.forEach(v => {
          const opt = document.createElement('option');
          opt.value = v.voice_id;
          opt.textContent = v.name;
          groupGoogle.appendChild(opt);
        });
        voiceSelect.appendChild(groupGoogle);
      }

      if (elevenVoices.length > 0) {
        const groupEleven = document.createElement('optgroup');
        groupEleven.label = 'Głosy ElevenLabs';
        elevenVoices.forEach(v => {
          const opt = document.createElement('option');
          opt.value = v.voice_id;
          opt.textContent = v.name;
          groupEleven.appendChild(opt);
        });
        voiceSelect.appendChild(groupEleven);
      }

      const allOptions = Array.from(voiceSelect.querySelectorAll('option'));
      if (allOptions.some(o => o.value === currentVal)) {
        voiceSelect.value = currentVal;
      } else if (voiceSelect.options.length > 0) {
        voiceSelect.selectedIndex = 0;
      }
      syncVoiceAndTtsModel('voice');
      state.settings.voiceId = voiceSelect.value;
      state.settings.ttsModel = ttsModelSelect.value;
      localStorage.setItem('voice_id', state.settings.voiceId);
      localStorage.setItem('tts_model', state.settings.ttsModel);
      updateDynamicLabels();
    }
  } catch (err) {
    console.warn('Could not load voices:', err);
  }
}

// Load AI models (Google Gemini + Claude) from API
async function loadClaudeModels() {
  const headers = {};
  if (state.keys.anthropic) headers['x-anthropic-key'] = state.keys.anthropic;
  if (state.keys.google) headers['x-google-key'] = state.keys.google;

  try {
    const res = await fetch('/api/models', { headers });
    if (!res.ok) return;
    const data = await res.json();

    if (data && (data.googleModels || data.claudeModels || data.models)) {
      const currentVal = state.settings.aiModel || state.settings.claudeModel;
      claudeModelSelect.innerHTML = '';

      // Optgroup 1: Google Gemini (based on sts)
      if (data.googleModels && data.googleModels.length > 0) {
        const groupGoogle = document.createElement('optgroup');
        groupGoogle.label = 'Google Gemini (Szybkie & naturalne)';
        data.googleModels.forEach(m => {
          const opt = document.createElement('option');
          opt.value = m.id;
          opt.textContent = m.name;
          groupGoogle.appendChild(opt);
        });
        claudeModelSelect.appendChild(groupGoogle);
      }

      // Optgroup 2: Anthropic Claude
      if (data.claudeModels && data.claudeModels.length > 0) {
        const groupClaude = document.createElement('optgroup');
        groupClaude.label = 'Anthropic Claude (Głębokie rozumowanie)';
        data.claudeModels.forEach(m => {
          const opt = document.createElement('option');
          opt.value = m.id;
          opt.textContent = m.name;
          groupClaude.appendChild(opt);
        });
        claudeModelSelect.appendChild(groupClaude);
      }

      const allOptions = Array.from(claudeModelSelect.querySelectorAll('option'));
      if (allOptions.some(o => o.value === currentVal)) {
        claudeModelSelect.value = currentVal;
      } else {
        claudeModelSelect.selectedIndex = 0;
        state.settings.aiModel = claudeModelSelect.value;
        state.settings.claudeModel = claudeModelSelect.value;
        localStorage.setItem('ai_model', state.settings.aiModel);
        localStorage.setItem('claude_model', state.settings.aiModel);
      }
      updateDynamicLabels();
      updateApiStatusBadge();
    }
  } catch (err) {
    console.warn('Could not load models list:', err);
  }
}

// ==========================================
// Event Listeners
// ==========================================
function setupEventListeners() {
  // Mic Button Toggle
  micToggleBtn.addEventListener('click', toggleRecording);

  // Keyboard shortcuts: Spacebar, Arrows, Escape
  window.addEventListener('keydown', (e) => {
    if (settingsModal && settingsModal.classList.contains('open')) {
      if (e.key === 'Escape') {
        closeSettingsPanel();
      }
      return;
    }

    const isTyping = Boolean(document.activeElement && document.activeElement.closest('input, textarea, [contenteditable]'));

    // Reader Screen Shortcuts
    if (currentView === 'reader') {
      if (!isTyping) {
        if (e.code === 'Space' && !e.repeat) {
          e.preventDefault();
          toggleReaderPlayPause();
        } else if (e.code === 'ArrowLeft') {
          e.preventDefault();
          seekReader(-5);
        } else if (e.code === 'ArrowRight') {
          e.preventDefault();
          seekReader(5);
        }
      }
      return;
    }

    // Chat Screen Shortcuts: Spacebar to toggle record
    if (e.code === 'Space' && !e.repeat && !document.activeElement.closest('input, textarea, select, button, a, [contenteditable]')) {
      e.preventDefault();
      toggleRecording();
    }
  });

  // Manual Text Submit
  chatInputForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = textInput.value.trim();
    if (text && state.status === 'idle') {
      textInput.value = '';
      handleUserTextSubmit(text);
    }
  });

  // Clear Chat
  clearChatBtn.addEventListener('click', () => {
    if (state.status !== 'idle' || state.messages.length === 0) return;
    if (confirm('Czy na pewno chcesz wyczyścić zapis rozmowy?')) {
      state.messages.forEach(message => { if (message.audioUrl) URL.revokeObjectURL(message.audioUrl); });
      state.messages = [];
      renderMessages();
      stopAudioPlayback();
      setStatus('idle', 'Gotowy. Kliknij mikrofon lub naciśnij <strong>Spację</strong>, aby rozpocząć rozmowę');
    }
  });

  document.querySelectorAll('[data-prompt]').forEach(button => {
    button.addEventListener('click', () => {
      textInput.value = button.dataset.prompt;
      textInput.focus();
    });
  });

  settingsModal.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const elements = [...settingsModal.querySelectorAll('button, input, select, textarea')].filter(el => !el.disabled && el.getClientRects().length);
    const first = elements[0], last = elements[elements.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  // Modal / Drawer handlers
  openSettingsBtn.addEventListener('click', openSettingsPanel);
  closeSettingsBtn.addEventListener('click', closeSettingsPanel);

  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      closeSettingsPanel();
    }
  });

  saveSettingsBtn.addEventListener('click', () => {
    syncVoiceAndTtsModel('voice');
    state.keys.elevenLabs = elevenLabsKeyInput.value.trim();
    state.keys.anthropic = anthropicKeyInput.value.trim();
    state.keys.google = googleKeyInput ? googleKeyInput.value.trim() : '';
    state.settings.voiceId = voiceSelect.value;
    state.settings.ttsModel = ttsModelSelect.value;
    state.settings.sttModel = sttModelSelect.value;
    state.settings.aiModel = claudeModelSelect.value;
    state.settings.claudeModel = claudeModelSelect.value;
    state.settings.systemPrompt = systemPromptInput.value.trim();

    localStorage.setItem('elevenlabs_api_key', state.keys.elevenLabs);
    localStorage.setItem('anthropic_api_key', state.keys.anthropic);
    localStorage.setItem('google_api_key', state.keys.google);
    localStorage.setItem('voice_id', state.settings.voiceId);
    localStorage.setItem('tts_model', state.settings.ttsModel);
    localStorage.setItem('stt_model', state.settings.sttModel);
    localStorage.setItem('ai_model', state.settings.aiModel);
    localStorage.setItem('claude_model', state.settings.claudeModel);
    localStorage.setItem('system_prompt', state.settings.systemPrompt);

    updateApiStatusBadge();
    updateDynamicLabels();
    renderMessages();
    closeSettingsPanel();
  });

  refreshVoicesBtn.addEventListener('click', async () => {
    refreshVoicesBtn.textContent = 'Pobieranie...';
    await Promise.all([loadVoices(), loadClaudeModels()]);
    refreshVoicesBtn.textContent = 'Odśwież listę głosów';
  });

  voiceSelect.addEventListener('change', () => {
    syncVoiceAndTtsModel('voice');
  });

  ttsModelSelect.addEventListener('change', () => {
    syncVoiceAndTtsModel('model');
  });

  // Password visibility toggle
  document.querySelectorAll('.toggle-password').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const input = document.getElementById(targetId);
      if (!input) return;
      if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🔒';
      } else {
        input.type = 'password';
        btn.textContent = '👁';
      }
    });
  });

  // Window resize for canvas
  window.addEventListener('resize', setupCanvas);

  // Audio player events with live playback duration tracking
  ttsAudioPlayer.addEventListener('timeupdate', () => {
    if (state.status === 'speaking' && ttsAudioPlayer.duration) {
      const cur = ttsAudioPlayer.currentTime.toFixed(1);
      const total = ttsAudioPlayer.duration.toFixed(1);
      if (stepTimerPlay) stepTimerPlay.textContent = `${cur}s / ${total}s`;
      const sub = document.getElementById('statusSubtext');
      if (sub) sub.textContent = `Odtwarzanie na głos: ${cur}s z ${total}s`;
    }
  });

  ttsAudioPlayer.addEventListener('ended', () => {
    const playDur = ttsAudioPlayer.duration || ((performance.now() - pipelineTracker.stepStart) / 1000);
    pipelineTracker.finishStep('play', playDur);
    pipelineTracker.completeTurn();

    // Update message timings in state so that the chat badge includes the playback time
    if (state.messages.length > 0) {
      const lastMsg = state.messages[state.messages.length - 1];
      if (lastMsg && lastMsg.role === 'assistant' && lastMsg.timings) {
        lastMsg.timings.play = Number(playDur.toFixed(1));
        lastMsg.timings.total = +( (lastMsg.timings.stt || 0) + (lastMsg.timings.llm || 0) + (lastMsg.timings.tts || 0) + lastMsg.timings.play ).toFixed(1);
        renderMessages();
      }
    }

    if (state.status === 'speaking') {
      const totalTurnSec = pipelineTotalTime ? pipelineTotalTime.textContent : '0.0s';
      setStatus('idle', `Gotowe! Rozmowa zajęła ${totalTurnSec} (STT: ${pipelineTracker.durations.stt.toFixed(1)}s • Myśl: ${pipelineTracker.durations.llm.toFixed(1)}s • Synteza: ${pipelineTracker.durations.tts.toFixed(1)}s • Na głos: ${pipelineTracker.durations.play.toFixed(1)}s)`);
    }
  });
}

let settingsReturnFocus = null;
function openSettingsPanel() {
  settingsReturnFocus = document.activeElement;
  settingsModal.classList.add('open');
  settingsModal.setAttribute('aria-hidden', 'false');
  document.querySelector('main').inert = true;
  document.querySelector('.app-header').inert = true;
  document.body.style.overflow = 'hidden';
  closeSettingsBtn.focus();
}

function closeSettingsPanel() {
  settingsModal.classList.remove('open');
  document.querySelector('main').inert = false;
  document.querySelector('.app-header').inert = false;
  document.body.style.overflow = '';
  settingsReturnFocus?.focus();
  settingsModal.setAttribute('aria-hidden', 'true');
}

// ==========================================
// Status & Pipeline State
// ==========================================
function setStatus(status, message) {
  state.status = status;
  voiceStage.className = `voice-stage state-${status}`;
  statusMessage.textContent = message.replace(/<[^>]*>/g, '').replace(/[🎙️📝🧠🔊⚠️]/gu, '').trim();
  const presentation = {
    idle: ['Myśl na głos.', 'Jest tu miejsce na każdą Twoją myśl.', 'Rozpocznij rozmowę', 'Gotowe na Twój głos'],
    listening: ['Słucham Cię.', 'Mów swobodnie. Zatrzymaj, kiedy skończysz.', 'Zakończ nagrywanie', 'Słucham'],
    transcribing: ['Łapię każde słowo.', 'Zamieniam Twój głos w tekst.', 'Zapisuję Twoje słowa…', 'Zapisuję słowa'],
    thinking: ['Chwila na dobrą myśl.', 'Przygotowuję odpowiedź dla Ciebie.', 'Myślę…', 'Przygotowuję odpowiedź'],
    speaking: ['Posłuchajmy.', 'Możesz przerwać i dodać coś od siebie.', 'Przerwij i mów', 'Odpowiadam']
  }[status];
  document.getElementById('statusHeadline').textContent = presentation[0];
  document.getElementById('statusSubtext').textContent = presentation[1];
  document.getElementById('micButtonLabel').textContent = presentation[2];
  onAirBadge.textContent = presentation[3];
  micToggleBtn.setAttribute('aria-label', presentation[2]);
  micToggleBtn.setAttribute('aria-pressed', String(status === 'listening'));
  micToggleBtn.disabled = status === 'transcribing' || status === 'thinking';
  textInput.disabled = status !== 'idle';
  document.getElementById('sendTextBtn').disabled = status !== 'idle';
  clearChatBtn.disabled = status !== 'idle';
}

// ==========================================
// Recording & Audio Processing Flow
// ==========================================
async function toggleRecording() {
  if (state.status === 'listening') {
    if (webSpeechRecognition) {
      webSpeechRecognition.stop();
    } else {
      stopRecording();
    }
  } else if (state.status === 'idle') {
    startRecording();
  } else if (state.status === 'speaking') {
    stopAudioPlayback();
    startRecording();
  }
}

// Web Speech API recognition (Zero-key STT fallback based on sts project)
function runWebSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    alert('Twoja przeglądarka nie obsługuje Web Speech API. Użyj Google Chrome/Edge lub wybierz ElevenLabs Scribe / Gemini STT w ustawieniach.');
    setStatus('idle', 'Gotowy. Wybierz inny model STT lub inną przeglądarkę.');
    return;
  }

  try {
    webSpeechRecognition = new SpeechRecognition();
    webSpeechRecognition.lang = 'pl-PL';
    webSpeechRecognition.continuous = false;
    webSpeechRecognition.interimResults = true;

    let finalSpeech = '';

    webSpeechRecognition.onstart = () => {
      finalSpeech = '';
      pipelineTracker.reset();
      pipelineTracker.startStep('stt');
      setStatus('listening', '🔴 <strong>Słucham Cię...</strong> Mów teraz do mikrofonu.');
    };

    webSpeechRecognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalSpeech += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      if (interim) {
        statusMessage.textContent = interim;
      }
    };

    webSpeechRecognition.onerror = (event) => {
      console.warn('Speech recognition error:', event.error);
      if (event.error !== 'no-speech') {
        setStatus('idle', `Błąd mikrofonu: ${event.error}`);
      }
    };

    webSpeechRecognition.onend = () => {
      const userText = finalSpeech.trim();
      webSpeechRecognition = null;
      if (userText) {
        pipelineTracker.finishStep('stt');
        handleUserTextSubmit(userText);
      } else {
        pipelineTracker.reset();
        setStatus('idle', 'Gotowy. Kliknij mikrofon lub naciśnij Spację, aby mówić.');
      }
    };

    webSpeechRecognition.start();
  } catch (err) {
    console.error('Failed to start speech recognition:', err);
    setStatus('idle', 'Nie udało się uruchomić rozpoznawania mowy.');
  }
}

async function startRecording() {
  const currentModel = state.settings.aiModel || state.settings.claudeModel || 'gemini-3.6-flash';
  const isGoogle = currentModel.startsWith('gemini-') || currentModel.includes('gemini');
  const hasLlmKey = isGoogle
    ? Boolean(state.keys.google || state.serverConfig.hasEnvGoogle)
    : Boolean(state.keys.anthropic || state.serverConfig.hasEnvAnthropic);

  const isGoogleStt = state.settings.sttModel.startsWith('gemini-') || state.settings.sttModel === 'web_speech';
  const hasGoogleKey = Boolean(state.keys.google || state.serverConfig.hasEnvGoogle);
  const hasElevenKey = Boolean(state.keys.elevenLabs || state.serverConfig.hasEnvElevenLabs);
  const hasSttKey = state.settings.sttModel === 'web_speech' || (isGoogleStt ? hasGoogleKey : (hasElevenKey || hasGoogleKey));

  if (!hasLlmKey) {
    openSettingsPanel();
    const providerName = isGoogle ? 'Google AI (Gemini)' : 'Anthropic Claude';
    alert(`Przed rozpoczęciem rozmowy skonfiguruj klucz API dla ${providerName} w panelu ustawień lub w pliku .env.`);
    return;
  }

  if (!hasSttKey) {
    openSettingsPanel();
    alert('Do nagrywania głosu wymagany jest klucz API (Google dla modeli Gemini STT lub ElevenLabs dla Scribe).');
    return;
  }

  // If using Web Speech API STT, start browser recognition
  if (state.settings.sttModel === 'web_speech') {
    runWebSpeechRecognition();
    return;
  }

  // MediaRecorder -> Server STT (Google Gemini Transcribe / ElevenLabs Scribe)
  try {
    initAudioContext();
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // Setup Web Audio analyser for microphone visualizer
    micSource = audioContext.createMediaStreamSource(mediaStream);
    micAnalyser = audioContext.createAnalyser();
    micAnalyser.fftSize = 256;
    micAnalyser.smoothingTimeConstant = 0.8;
    micSource.connect(micAnalyser);

    let mimeType = 'audio/webm;codecs=opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      if (MediaRecorder.isTypeSupported('audio/mp4')) {
        mimeType = 'audio/mp4';
      } else if (MediaRecorder.isTypeSupported('audio/webm')) {
        mimeType = 'audio/webm';
      } else {
        mimeType = '';
      }
    }

    const options = mimeType ? { mimeType } : {};
    mediaRecorder = new MediaRecorder(mediaStream, options);
    audioChunks = [];

    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      const audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      processRecordedAudio(audioBlob);
    };

    mediaRecorder.start(100);
    pipelineTracker.reset();
    pipelineTracker.startStep('stt');
    setStatus('listening', '🔴 <strong>Rejestracja głosu...</strong> Mów teraz, kliknij ponownie, aby zakończyć.');
  } catch (err) {
    console.error('Microphone error:', err);
    alert('Nie udało się uzyskać dostępu do mikrofonu: ' + err.message);
    setStatus('idle', 'Błąd mikrofonu. Kliknij, aby spróbować ponownie.');
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach(t => t.stop());
    mediaStream = null;
  }

  micAnalyser = null;
}

// ==========================================
// Pipeline: STT (Google/ElevenLabs) -> LLM -> TTS
// ==========================================
async function processRecordedAudio(audioBlob) {
  if (audioBlob.size < 1000) {
    pipelineTracker.reset();
    setStatus('idle', 'Nagranie było zbyt krótkie. Spróbuj mówić odrobinę dłużej.');
    return;
  }

  try {
    const sttName = getSttModelName(state.settings.sttModel);
    setStatus('transcribing', `📝 <strong>${sttName}:</strong> Rozpoznawanie mowy w toku...`);

    const formData = new FormData();
    const extension = audioBlob.type.includes('mp4') ? 'm4a' : 'webm';
    formData.append('audio', audioBlob, `recording.${extension}`);
    formData.append('model_id', state.settings.sttModel);
    formData.append('language_code', 'pl');

    const sttHeaders = {};
    if (state.keys.elevenLabs) sttHeaders['x-elevenlabs-key'] = state.keys.elevenLabs;
    if (state.keys.google) sttHeaders['x-google-key'] = state.keys.google;

    const sttRes = await fetch('/api/stt', {
      method: 'POST',
      headers: sttHeaders,
      body: formData
    });

    if (!sttRes.ok) {
      const err = await sttRes.json().catch(() => ({}));
      throw new Error(err.error || `Błąd transkrypcji (${sttRes.status})`);
    }

    const sttData = await sttRes.json();
    const userText = sttData.text?.trim();

    if (!userText) {
      pipelineTracker.reset();
      setStatus('idle', 'Nie rozpoznano mowy w nagraniu. Spróbuj mówić wyraźniej do mikrofonu.');
      return;
    }

    const sttDuration = sttData.duration_sec || ((performance.now() - pipelineTracker.stepStart) / 1000).toFixed(1);
    pipelineTracker.finishStep('stt', sttDuration);

    addMessage('user', userText);
    await handleConversationTurn();
  } catch (error) {
    console.error('Pipeline error:', error);
    pipelineTracker.reset();
    setStatus('idle', `⚠️ Błąd: ${error.message}`);
    alert(`Wystąpił błąd w przetwarzaniu STT: ${error.message}`);
  }
}

async function handleUserTextSubmit(text) {
  if (!pipelineTracker.activeStep) {
    pipelineTracker.reset();
    if (stepTimerSTT) stepTimerSTT.textContent = 'pominięto';
  }
  addMessage('user', text);
  await handleConversationTurn();
}

async function handleConversationTurn() {
  try {
    const selectedModel = state.settings.aiModel || state.settings.claudeModel || 'gemini-3.6-flash';
    const modelName = getAiModelName(selectedModel);
    pipelineTracker.startStep('llm');
    setStatus('thinking', `🧠 <strong>${modelName}:</strong> Generowanie odpowiedzi studyjnej...`);

    const chatHeaders = { 'Content-Type': 'application/json' };
    if (state.keys.anthropic) chatHeaders['x-anthropic-key'] = state.keys.anthropic;
    if (state.keys.google) chatHeaders['x-google-key'] = state.keys.google;

    const payload = {
      messages: state.messages.map(m => ({ role: m.role, content: m.content })),
      model: selectedModel,
      systemPrompt: state.settings.systemPrompt || undefined
    };

    const chatRes = await fetch('/api/chat', {
      method: 'POST',
      headers: chatHeaders,
      body: JSON.stringify(payload)
    });

    if (!chatRes.ok) {
      const err = await chatRes.json().catch(() => ({}));
      throw new Error(err.error || `Błąd AI API (${chatRes.status})`);
    }

    const chatData = await chatRes.json();
    const aiText = chatData.text?.trim();

    if (chatData.fallbackUsed && chatData.model) {
      console.log(`Automatycznie przełączono model na: ${chatData.model}`);
      state.settings.aiModel = chatData.model;
      state.settings.claudeModel = chatData.model;
      localStorage.setItem('ai_model', chatData.model);
      localStorage.setItem('claude_model', chatData.model);
      if (claudeModelSelect) {
        claudeModelSelect.value = chatData.model;
      }
      updateDynamicLabels();
    }

    if (!aiText) {
      throw new Error('Otrzymano pustą odpowiedź od asystenta AI.');
    }

    const llmDuration = chatData.duration_sec || ((performance.now() - pipelineTracker.stepStart) / 1000).toFixed(1);
    pipelineTracker.finishStep('llm', llmDuration);

    // ----------------------------------------
    // Step 3: Text-to-Speech (Google Gemini TTS, WaveNet, Edge Neural, ElevenLabs)
    // ----------------------------------------
    const voiceName = getVoiceName(state.settings.voiceId);
    pipelineTracker.startStep('tts');
    setStatus('speaking', `🔊 <strong>${voiceName}:</strong> Synteza mowy w toku...`);

    const ttsHeaders = { 'Content-Type': 'application/json' };
    if (state.keys.elevenLabs) ttsHeaders['x-elevenlabs-key'] = state.keys.elevenLabs;
    if (state.keys.google) ttsHeaders['x-google-key'] = state.keys.google;

    // Upewnij się, że model TTS odpowiada wybranemu głosowi
    let effectiveTtsModel = state.settings.ttsModel;
    const isElevenVoice = state.settings.voiceId && !state.settings.voiceId.startsWith('google-') && !state.settings.voiceId.startsWith('pl-PL-');
    if (isElevenVoice && !effectiveTtsModel.startsWith('eleven_')) {
      effectiveTtsModel = 'eleven_multilingual_v2';
      state.settings.ttsModel = effectiveTtsModel;
      localStorage.setItem('tts_model', effectiveTtsModel);
      if (ttsModelSelect) ttsModelSelect.value = effectiveTtsModel;
    }

    const ttsRes = await fetch('/api/tts', {
      method: 'POST',
      headers: ttsHeaders,
      body: JSON.stringify({
        text: aiText,
        voiceId: state.settings.voiceId,
        modelId: effectiveTtsModel
      })
    });

    if (!ttsRes.ok) {
      const err = await ttsRes.json().catch(() => ({}));
      throw new Error(err.error || `Błąd syntezy mowy TTS (${ttsRes.status})`);
    }

    const ttsHeaderSec = ttsRes.headers.get('X-Duration-Sec');
    const ttsDuration = ttsHeaderSec ? Number(ttsHeaderSec) : ((performance.now() - pipelineTracker.stepStart) / 1000).toFixed(1);
    pipelineTracker.finishStep('tts', ttsDuration);

    const audioBlob = await ttsRes.blob();
    const audioUrl = URL.createObjectURL(audioBlob);

    const finalModelName = getAiModelName(chatData.model || selectedModel);
    const timings = {
      stt: pipelineTracker.durations.stt,
      llm: pipelineTracker.durations.llm,
      tts: pipelineTracker.durations.tts,
      total: +(pipelineTracker.durations.stt + pipelineTracker.durations.llm + pipelineTracker.durations.tts).toFixed(1)
    };
    const assistantMsgIndex = addMessage('assistant', aiText, finalModelName, timings);

    state.messages[assistantMsgIndex].audioUrl = audioUrl;
    renderMessages();

    playAudio(audioUrl);
  } catch (error) {
    console.error('Error in conversation turn:', error);
    pipelineTracker.reset();
    setStatus('idle', `⚠️ Błąd: ${error.message}`);
    alert(`Wystąpił błąd: ${error.message}`);
  }
}

// ==========================================
// Audio Playback & Visualizer Sync
// ==========================================
function initAudioContext() {
  if (!audioContext) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioCtx();
  }
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
}

function playAudio(audioUrl) {
  initAudioContext();
  pipelineTracker.startStep('play');

  ttsAudioPlayer.src = audioUrl;

  if (!ttsSource) {
    ttsSource = audioContext.createMediaElementSource(ttsAudioPlayer);
    ttsAnalyser = audioContext.createAnalyser();
    ttsAnalyser.fftSize = 256;
    ttsAnalyser.smoothingTimeConstant = 0.85;
    ttsSource.connect(ttsAnalyser);
    ttsAnalyser.connect(audioContext.destination);
  }

  const voiceName = getVoiceName(state.settings.voiceId);
  setStatus('speaking', `🔊 <strong>${voiceName}:</strong> AI odpowiada naturalnym głosem...`);

  ttsAudioPlayer.play().catch(e => {
    console.warn('Auto-play blocked, user interaction needed:', e);
    pipelineTracker.finishStep('play');
    pipelineTracker.completeTurn();
    setStatus('idle', 'Kliknij przycisk odtwarzania przy wiadomości, aby odsłuchać.');
  });
}

function stopAudioPlayback() {
  if (ttsAudioPlayer) {
    ttsAudioPlayer.pause();
    ttsAudioPlayer.currentTime = 0;
  }
}

// ==========================================
// Conversation UI Management
// ==========================================
function addMessage(role, content, modelName = null, timings = null) {
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const msgObj = {
    role,
    content,
    modelName: modelName || getAiModelName(state.settings.aiModel || state.settings.claudeModel),
    time: timeStr,
    audioUrl: null,
    timings: timings || null
  };
  state.messages.push(msgObj);
  renderMessages();
  return state.messages.length - 1;
}

function renderMessages() {
  if (state.messages.length === 0) {
    emptyState.style.display = 'flex';
    messageCountEl.textContent = '0 wiadomości';
    chatContainer.innerHTML = '';
    chatContainer.appendChild(emptyState);
    return;
  }

  emptyState.style.display = 'none';
  const count = state.messages.length;
  messageCountEl.textContent = `${count} ${count === 1 ? 'wiadomość' : 'wiadomości'}`;

  const shouldScroll = chatContainer.scrollTop + chatContainer.clientHeight >= chatContainer.scrollHeight - 60;
  chatContainer.innerHTML = '';

  const activeModelName = getAiModelName(state.settings.aiModel || state.settings.claudeModel);
  const activeVoiceName = getVoiceName(state.settings.voiceId);

  state.messages.forEach((msg) => {
    const msgEl = document.createElement('div');
    msgEl.className = `chat-message ${msg.role}`;

    const metaEl = document.createElement('div');
    metaEl.className = 'message-meta';
    
    if (msg.role === 'user') {
      metaEl.innerHTML = `
        <span class="message-sender">Ty</span>
        <span>&bull;</span>
        <span>${msg.time}</span>
      `;
    } else {
      metaEl.innerHTML = `
        <span class="message-sender">${msg.modelName || activeModelName}</span>
        <span>&bull;</span>
        <span>${msg.time}</span>
      `;
    }

    const bodyEl = document.createElement('div');
    bodyEl.className = 'message-body';
    bodyEl.textContent = msg.content;

    msgEl.appendChild(metaEl);
    msgEl.appendChild(bodyEl);

    // Render timing badge breakdown if available
    if (msg.role === 'assistant' && msg.timings) {
      const timingEl = document.createElement('div');
      timingEl.className = 'message-timing-breakdown';

      const totalSec = msg.timings.total || +( (msg.timings.stt || 0) + (msg.timings.llm || 0) + (msg.timings.tts || 0) + (msg.timings.play || 0) ).toFixed(1);
      let breakdownHtml = `<span class="timing-badge total" title="Łączny czas tury (STT + Myśl + Synteza + Na głos)">⏱️ ${totalSec.toFixed(1)}s</span>`;

      if (msg.timings.stt && msg.timings.stt > 0) {
        breakdownHtml += `<span class="timing-badge" title="Czas rozpoznawania mowy (STT)">STT: ${Number(msg.timings.stt).toFixed(1)}s</span>`;
      }
      if (msg.timings.llm && msg.timings.llm > 0) {
        breakdownHtml += `<span class="timing-badge" title="Czas generowania tekstu przez model AI">Myśl: ${Number(msg.timings.llm).toFixed(1)}s</span>`;
      }
      if (msg.timings.tts && msg.timings.tts > 0) {
        breakdownHtml += `<span class="timing-badge" title="Czas syntezy audio przez silnik AI">Synteza: ${Number(msg.timings.tts).toFixed(1)}s</span>`;
      }
      if (msg.timings.play && msg.timings.play > 0) {
        breakdownHtml += `<span class="timing-badge" title="Czas odtwarzania głosu przez głośniki">Na głos: ${Number(msg.timings.play).toFixed(1)}s</span>`;
      }

      timingEl.innerHTML = breakdownHtml;
      msgEl.appendChild(timingEl);
    }

    // If assistant has audio, add replay button
    if (msg.role === 'assistant' && msg.audioUrl) {
      const actionsEl = document.createElement('div');
      actionsEl.className = 'message-actions';

      const replayBtn = document.createElement('button');
      replayBtn.className = 'bubble-btn';
      replayBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5v14l11-7z"/>
        </svg>
        Odsłuchaj (${activeVoiceName})
      `;
      replayBtn.addEventListener('click', () => {
        if (state.status !== 'idle' && state.status !== 'speaking') return;
        playAudio(msg.audioUrl);
      });

      actionsEl.appendChild(replayBtn);
      msgEl.appendChild(actionsEl);
    }

    chatContainer.appendChild(msgEl);
  });

  if (shouldScroll) {
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }
}

// ==========================================
// Canvas Audio Studio Visualizer Loop
// ==========================================
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let lastVisualFrame = 0;
function startVisualizerLoop() {
  function draw(time = 0) {
    animFrameId = requestAnimationFrame(draw);
    if (document.hidden || time - lastVisualFrame < (reducedMotion.matches ? 180 : 32)) return;
    lastVisualFrame = time;
    const width = canvas.width / (window.devicePixelRatio || 1);
    const height = canvas.height / (window.devicePixelRatio || 1);
    const cx = width / 2, cy = height / 2;
    ctx.clearRect(0, 0, width, height);
    if (!reducedMotion.matches) phase += 0.012;
    const analyser = state.status === 'listening' ? micAnalyser : state.status === 'speaking' ? ttsAnalyser : null;
    let level = 0;
    if (analyser) {
      const frequencies = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(frequencies);
      level = frequencies.reduce((a, b) => a + b, 0) / frequencies.length / 255;
    }
    smoothedLevel += (level - smoothedLevel) * 0.16;
    const radius = width * (0.31 + smoothedLevel * 0.09);
    const busy = state.status === 'thinking' || state.status === 'transcribing';
    const rotation = phase * (busy ? 1.4 : 0.4);
    const pulse = reducedMotion.matches ? 0 : Math.sin(phase * 1.2) * 0.035;
    const fill = ctx.createRadialGradient(cx - radius * 0.4, cy - radius * 0.45, 0, cx, cy, radius * 1.1);
    fill.addColorStop(0, '#f3c8ab');
    fill.addColorStop(0.5, '#e7a383');
    fill.addColorStop(0.85, '#ce7357');
    fill.addColorStop(1, '#b9543e');
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.30);
    ctx.scale(1 + pulse, 1 - pulse);
    ctx.translate(-cx, -cy);
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.save();
    ctx.clip();
    // Flowing latitude lines form an audio-reactive sphere
    for (let row = -34; row <= 34; row++) {
      const latitude = row / 35 * Math.PI / 2;
      const ringRadius = radius * Math.cos(latitude);
      const ringY = radius * Math.sin(latitude);
      ctx.beginPath();
      for (let step = 0; step <= 150; step++) {
        const angle = step / 150 * Math.PI * 2;
        const ripple = Math.sin(angle * 5 + latitude * 9 + rotation * 2) * (2 + smoothedLevel * 10);
        const x = Math.cos(angle) * (ringRadius + ripple);
        const z = Math.sin(angle) * ringRadius;
        const y = ringY * 0.84 - z * 0.54;
        if (step === 0) ctx.moveTo(cx + x, cy + y); else ctx.lineTo(cx + x, cy + y);
      }
      ctx.strokeStyle = row % 3 === 0 ? 'rgba(118,53,36,.34)' : 'rgba(255,239,217,.55)';
      ctx.lineWidth = row % 3 === 0 ? 0.65 : 0.8;
      ctx.stroke();
    }
    for (let col = 0; col < 44; col++) {
      const longitude = col / 44 * Math.PI * 2 + rotation;
      ctx.beginPath();
      for (let step = 0; step <= 90; step++) {
        const latitude = -Math.PI / 2 + step / 90 * Math.PI;
        const x = radius * Math.cos(latitude) * Math.cos(longitude);
        const z = radius * Math.cos(latitude) * Math.sin(longitude);
        const y = radius * Math.sin(latitude) * 0.84 - z * 0.54;
        if (step === 0) ctx.moveTo(cx + x, cy + y); else ctx.lineTo(cx + x, cy + y);
      }
      ctx.strokeStyle = 'rgba(133,58,35,.13)';
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
    const sheen = ctx.createRadialGradient(cx - radius * 0.5, cy - radius * 0.5, 0, cx, cy, radius);
    sheen.addColorStop(0, 'rgba(255,249,225,.34)');
    sheen.addColorStop(1, 'rgba(255,249,225,0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    ctx.restore();
    ctx.restore();
  }
  draw();
}

// ==========================================================================
// Przeczytaj Tekst (Reader Screen) Controller
// ==========================================================================
let currentView = 'chat'; // 'chat' | 'reader'
let currentReaderAudioUrl = null;

const SAMPLE_TEXT = `Sztuczna inteligencja rozwija się w zawrotnym tempie, a technologie syntezy głosu pozwalają dziś na tworzenie niezwykle naturalnych, ekspresyjnych wypowiedzi. Możesz wkleić tutaj dowolny artykuł, rozdział książki lub osobiste notatki. Wygodny odtwarzacz pozwala Ci swobodnie odtwarzać, pauzować oraz cofać i przewijać nagranie o 5 sekund, aby nie umknął Ci żaden szczegół. Miłego słuchania!`;

function switchView(target) {
  if (target === 'reader') {
    currentView = 'reader';
    if (viewChat) viewChat.hidden = true;
    if (viewReader) viewReader.hidden = false;
    if (navChatBtn) {
      navChatBtn.classList.remove('active');
      navChatBtn.removeAttribute('aria-current');
    }
    if (navReaderBtn) {
      navReaderBtn.classList.add('active');
      navReaderBtn.setAttribute('aria-current', 'page');
    }
    updateReaderSystemPill();
    window.location.hash = '#tekst';
  } else {
    currentView = 'chat';
    if (viewChat) viewChat.hidden = false;
    if (viewReader) viewReader.hidden = true;
    if (navChatBtn) {
      navChatBtn.classList.add('active');
      navChatBtn.setAttribute('aria-current', 'page');
    }
    if (navReaderBtn) {
      navReaderBtn.classList.remove('active');
      navReaderBtn.removeAttribute('aria-current');
    }
    if (readerAudioElement && !readerAudioElement.paused) {
      readerAudioElement.pause();
    }
    if (window.location.hash === '#tekst' || window.location.hash === '#przeczytaj-tekst') {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }
}

function updateReaderSystemPill() {
  if (readerPillVoiceName) {
    readerPillVoiceName.textContent = getVoiceName(state.settings.voiceId);
  }
  if (readerPillModelName) {
    readerPillModelName.textContent = getTtsModelName(state.settings.ttsModel);
  }
}

function updateReaderStats() {
  if (!readerTextInput) return;
  const text = readerTextInput.value;
  const charCount = text.length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  if (readerCharCount) readerCharCount.textContent = `${charCount.toLocaleString('pl-PL')} znaków`;
  if (readerWordCount) readerWordCount.textContent = `${words.toLocaleString('pl-PL')} słów`;

  if (readerEstimatedTime) {
    if (words === 0) {
      readerEstimatedTime.textContent = 'Czas czytania: ~0s';
    } else {
      const totalSec = Math.round((words / 130) * 60);
      if (totalSec < 60) {
        readerEstimatedTime.textContent = `Czas czytania: ~${totalSec}s`;
      } else {
        const mins = Math.floor(totalSec / 60);
        const remSec = totalSec % 60;
        readerEstimatedTime.textContent = `Czas czytania: ~${mins}m ${remSec > 0 ? remSec + 's' : ''}`;
      }
    }
  }
}

function initWaveformBars() {
  if (!waveformBars) return;
  waveformBars.innerHTML = '';
  const barCount = 38;
  for (let i = 0; i < barCount; i++) {
    const bar = document.createElement('div');
    bar.className = 'waveform-bar';
    const h = 6 + Math.sin(i / 2.3) * 16 + ((i * 7) % 18);
    bar.style.height = `${Math.max(6, Math.min(46, Math.round(h)))}px`;
    bar.style.animationDelay = `${(i * 0.04).toFixed(2)}s`;
    waveformBars.appendChild(bar);
  }
}

function formatReaderTime(seconds) {
  if (!seconds || isNaN(seconds)) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function updateReaderProgress(current, duration) {
  if (readerCurrentTime) readerCurrentTime.textContent = formatReaderTime(current);
  if (readerTotalTime) readerTotalTime.textContent = formatReaderTime(duration);
  const percent = duration > 0 ? (current / duration) * 100 : 0;
  if (readerScrubberFill) readerScrubberFill.style.width = `${percent}%`;
  if (readerScrubberThumb) readerScrubberThumb.style.left = `${percent}%`;
  if (readerScrubberTrack) {
    readerScrubberTrack.setAttribute('aria-valuenow', Math.round(percent));
  }
}

function toggleReaderPlayPause() {
  if (!readerAudioElement || !readerAudioElement.src) return;
  if (readerAudioElement.paused) {
    stopAudioPlayback(); // zatrzymaj audio z czatu jeśli gra
    readerAudioElement.play().catch(e => {
      console.warn('Odtwarzanie zablokowane przez przeglądarkę:', e);
    });
  } else {
    readerAudioElement.pause();
  }
}

function seekReader(secondsDelta) {
  if (!readerAudioElement || !readerAudioElement.src) return;
  const dur = readerAudioElement.duration || 0;
  const current = readerAudioElement.currentTime || 0;
  const target = Math.max(0, Math.min(dur, current + secondsDelta));
  readerAudioElement.currentTime = target;
  updateReaderProgress(target, dur);
}

function stopReaderAudio() {
  if (!readerAudioElement) return;
  readerAudioElement.pause();
  readerAudioElement.currentTime = 0;
  updateReaderProgress(0, readerAudioElement.duration || 0);
}

async function handleReaderSynthesize() {
  const text = (readerTextInput ? readerTextInput.value : '').trim();
  if (!text) {
    alert('Wpisz lub wklej tekst, który lektor ma przeczytać.');
    if (readerTextInput) readerTextInput.focus();
    return;
  }

  // Zatrzymaj poprzednie odtwarzanie lektora oraz audio czatu
  if (readerAudioElement) {
    readerAudioElement.pause();
    readerAudioElement.currentTime = 0;
  }
  stopAudioPlayback();

  // Upewnij się, że model TTS odpowiada wybranemu głosowi
  let effectiveTtsModel = state.settings.ttsModel;
  const isElevenVoice = state.settings.voiceId && !state.settings.voiceId.startsWith('google-') && !state.settings.voiceId.startsWith('pl-PL-');
  if (isElevenVoice && !effectiveTtsModel.startsWith('eleven_')) {
    effectiveTtsModel = 'eleven_multilingual_v2';
    state.settings.ttsModel = effectiveTtsModel;
    localStorage.setItem('tts_model', effectiveTtsModel);
    if (ttsModelSelect) ttsModelSelect.value = effectiveTtsModel;
  }

  // Ustawienie stanu ładowania UI
  if (readerSynthesizeBtn) readerSynthesizeBtn.disabled = true;
  if (readerSpinner) readerSpinner.hidden = false;
  if (readerBtnIcon) readerBtnIcon.hidden = true;
  if (readerSubmitBtnText) readerSubmitBtnText.textContent = 'Trwa synteza...';
  const voiceName = getVoiceName(state.settings.voiceId);
  const modelName = getTtsModelName(effectiveTtsModel);
  if (readerStatusText) {
    readerStatusText.textContent = `Generowanie nagrania lektora (${voiceName} • ${modelName})...`;
  }
  if (playerStateBadge) playerStateBadge.className = 'player-live-badge busy';
  if (playerStateText) playerStateText.textContent = 'Generowanie audio...';

  const startTime = performance.now();

  try {
    const ttsHeaders = { 'Content-Type': 'application/json' };
    if (state.keys.elevenLabs) ttsHeaders['x-elevenlabs-key'] = state.keys.elevenLabs;
    if (state.keys.google) ttsHeaders['x-google-key'] = state.keys.google;

    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: ttsHeaders,
      body: JSON.stringify({
        text: text,
        voiceId: state.settings.voiceId,
        modelId: effectiveTtsModel
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Błąd syntezy (${res.status})`);
    }

    const durationHeader = res.headers.get('X-Duration-Sec');
    const ttsMethod = res.headers.get('X-TTS-Method') || modelName;
    const rawFallbackReason = res.headers.get('X-TTS-Fallback-Reason');
    const fallbackReason = rawFallbackReason ? decodeURIComponent(rawFallbackReason) : null;
    const durationSec = durationHeader ? `${Number(durationHeader).toFixed(1)}s` : `${((performance.now() - startTime) / 1000).toFixed(1)}s`;

    const blob = await res.blob();
    const audioUrl = URL.createObjectURL(blob);
    currentReaderAudioUrl = audioUrl;

    // Aktywacja karty odtwarzacza
    if (readerPlayerEmpty) readerPlayerEmpty.hidden = true;
    if (readerPlayerActive) readerPlayerActive.hidden = false;

    if (readerAudioElement) {
      readerAudioElement.src = audioUrl;
      readerAudioElement.playbackRate = parseFloat(readerSpeedSelect ? readerSpeedSelect.value : 1);
    }

    if (readerDownloadLink) {
      readerDownloadLink.href = audioUrl;
      readerDownloadLink.download = `lektor-${Date.now()}.mp3`;
    }

    if (readerTrackTitle) {
      const snippet = text.slice(0, 48).replace(/[\r\n]+/g, ' ');
      readerTrackTitle.textContent = snippet.length < text.length ? `${snippet}...` : snippet;
    }
    if (readerTrackMeta) {
      if (ttsMethod.includes('Fallback')) {
        readerTrackMeta.innerHTML = `Głos: <strong>${voiceName}</strong> • Silnik: <span style="color:#d97706; font-weight:600;">⚠️ ${ttsMethod}</span> • Czas: ${durationSec}`;
      } else {
        readerTrackMeta.textContent = `Głos: ${voiceName} • Silnik: ${ttsMethod} • Wygenerowano w: ${durationSec}`;
      }
    }

    updateReaderProgress(0, 0);

    if (readerStatusText) {
      if (fallbackReason) {
        readerStatusText.innerHTML = `⚠️ <strong>Awaryjny silnik:</strong> ${fallbackReason} Zastosowano bezpłatny lektor zastępczy (${ttsMethod}). Aby odblokować pełną jakość ElevenLabs, wklej własny klucz API w <a href="#" id="openSettingsFromWarning" style="color:var(--accent); font-weight:600; text-decoration:underline;">Ustawieniach</a>.`;
        const link = document.getElementById('openSettingsFromWarning');
        if (link) {
          link.addEventListener('click', (e) => {
            e.preventDefault();
            openSettingsPanel();
          });
        }
      } else {
        readerStatusText.textContent = `✅ Gotowe! Nagranie przygotowane w ${durationSec}.`;
      }
    }

    // Dodaj nagranie do historii sesji (maks. 10 ostatnich)
    const recId = `rec-${Date.now()}`;
    const historyItem = {
      id: recId,
      text: text,
      voiceId: state.settings.voiceId,
      voiceName: voiceName,
      modelName: modelName,
      ttsMethod: ttsMethod,
      isFallback: ttsMethod.includes('Fallback') || Boolean(fallbackReason),
      fallbackReason: fallbackReason || null,
      blob: blob,
      audioUrl: audioUrl,
      durationSec: durationSec,
      createdAt: new Date(),
      formattedTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    };
    addReaderHistoryItem(historyItem);

    // Auto-odtworzenie
    try {
      await readerAudioElement.play();
    } catch (e) {
      console.warn('Auto-play zablokowany przez przeglądarkę:', e);
      if (playerStateBadge) playerStateBadge.className = 'player-live-badge ready';
      if (playerStateText) playerStateText.textContent = 'Kliknij Odtwórz, aby posłuchać';
    }
  } catch (error) {
    console.error('Błąd syntezy czytnika:', error);
    if (readerStatusText) {
      readerStatusText.textContent = `⚠️ Błąd: ${error.message}`;
    }
    if (playerStateBadge) playerStateBadge.className = 'player-live-badge';
    if (playerStateText) playerStateText.textContent = 'Błąd generowania';
    alert(`Nie udało się wygenerować mowy lektora: ${error.message}`);
  } finally {
    if (readerSynthesizeBtn) readerSynthesizeBtn.disabled = false;
    if (readerSpinner) readerSpinner.hidden = true;
    if (readerBtnIcon) readerBtnIcon.hidden = false;
    if (readerSubmitBtnText) readerSubmitBtnText.textContent = 'Generuj nagranie lektora';
  }
}

// ==========================================
// Reader Session History Management (Max 10 Recordings)
// ==========================================
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function addReaderHistoryItem(item) {
  if (!state.readerHistory) state.readerHistory = [];

  // Jeśli przekroczono limit 10 nagrań, usuwamy najstarsze nagranie i zwalniamy URL
  if (state.readerHistory.length >= MAX_READER_HISTORY) {
    const oldest = state.readerHistory.pop();
    if (oldest && oldest.audioUrl && oldest.audioUrl !== currentReaderAudioUrl) {
      URL.revokeObjectURL(oldest.audioUrl);
    }
  }

  state.readerHistory.unshift(item);
  state.activeHistoryId = item.id;
  renderReaderHistory();
}

function renderReaderHistory() {
  if (!historyList || !historyEmpty) return;

  const count = state.readerHistory ? state.readerHistory.length : 0;
  if (historyCounterPill) {
    historyCounterPill.textContent = `${count} / ${MAX_READER_HISTORY}`;
  }

  if (count === 0) {
    historyEmpty.hidden = false;
    historyList.hidden = true;
    historyList.innerHTML = '';
    return;
  }

  historyEmpty.hidden = true;
  historyList.hidden = false;
  historyList.innerHTML = '';

  const isAudioPlaying = readerAudioElement && !readerAudioElement.paused && !readerAudioElement.ended;

  state.readerHistory.forEach(item => {
    const isCurrent = state.activeHistoryId === item.id;
    const isThisPlaying = isCurrent && isAudioPlaying;

    const el = document.createElement('div');
    el.className = `history-item${isCurrent ? ' active' : ''}`;
    el.dataset.id = item.id;

    const cleanText = (item.text || '').replace(/[\r\n]+/g, ' ').trim();
    const shortText = cleanText.length > 95 ? `${cleanText.slice(0, 95)}...` : cleanText;

    el.innerHTML = `
      <div class="history-item-left">
        <button type="button" class="history-play-btn" data-action="toggle-play" title="${isThisPlaying ? 'Wstrzymaj odtwarzanie' : 'Odtwórz to nagranie'}" aria-label="${isThisPlaying ? 'Wstrzymaj' : 'Odtwórz'}">
          <svg class="h-icon-play" viewBox="0 0 24 24" fill="currentColor" ${isThisPlaying ? 'hidden' : ''}>
            <polygon points="6 4 20 12 6 20 6 4"></polygon>
          </svg>
          <svg class="h-icon-pause" viewBox="0 0 24 24" fill="currentColor" ${isThisPlaying ? '' : 'hidden'}>
            <rect x="6" y="4" width="4" height="16" rx="1"></rect>
            <rect x="14" y="4" width="4" height="16" rx="1"></rect>
          </svg>
        </button>
        <div class="history-item-content">
          <div class="history-item-meta">
            <span class="history-voice-tag">${escapeHtml(item.voiceName || 'Lektor')}</span>
            <span class="history-meta-divider">•</span>
            <span class="history-method-tag ${item.isFallback ? 'fallback' : ''}">${escapeHtml(item.ttsMethod || 'TTS')}</span>
            <span class="history-meta-divider">•</span>
            <span class="history-time-tag">${escapeHtml(item.formattedTime || '')}</span>
            ${item.durationSec ? `<span class="history-meta-divider">•</span><span class="history-duration-tag">⏱️ ${escapeHtml(item.durationSec)}</span>` : ''}
          </div>
          <p class="history-text-snippet" title="${escapeHtml(cleanText)}">${escapeHtml(shortText)}</p>
        </div>
      </div>
      <div class="history-item-actions">
        <button type="button" class="history-action-btn primary" data-action="load-editor" title="Wczytaj tekst i przygotuj odtwarzacz">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
          <span>Wczytaj tekst</span>
        </button>
        <a href="${item.audioUrl}" download="nagranie-${item.id}.mp3" class="history-action-btn" title="Pobierz plik audio MP3">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          <span>MP3</span>
        </a>
        <button type="button" class="history-action-btn danger" data-action="delete" title="Usuń z historii">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
    `;

    // Obsługa zdarzeń dla karty nagrania
    const togglePlayBtn = el.querySelector('[data-action="toggle-play"]');
    if (togglePlayBtn) {
      togglePlayBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        playOrPauseHistoryItem(item);
      });
    }

    const loadEditorBtn = el.querySelector('[data-action="load-editor"]');
    if (loadEditorBtn) {
      loadEditorBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        loadHistoryItemIntoPlayer(item, false);
      });
    }

    const deleteBtn = el.querySelector('[data-action="delete"]');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeHistoryItem(item.id);
      });
    }

    // Kliknięcie w dowolną część wiersza wczytuje i odtwarza nagranie
    el.addEventListener('click', (e) => {
      if (e.target.closest('button, a')) return;
      playOrPauseHistoryItem(item);
    });

    historyList.appendChild(el);
  });
}

function loadHistoryItemIntoPlayer(item, shouldPlay = false) {
  state.activeHistoryId = item.id;
  currentReaderAudioUrl = item.audioUrl;

  if (readerTextInput) {
    readerTextInput.value = item.text;
    updateReaderStats();
  }

  if (readerPlayerEmpty) readerPlayerEmpty.hidden = true;
  if (readerPlayerActive) readerPlayerActive.hidden = false;

  if (readerAudioElement) {
    readerAudioElement.src = item.audioUrl;
    readerAudioElement.playbackRate = parseFloat(readerSpeedSelect ? readerSpeedSelect.value : 1);
  }

  if (readerDownloadLink) {
    readerDownloadLink.href = item.audioUrl;
    readerDownloadLink.download = `nagranie-${item.id}.mp3`;
  }

  if (readerTrackTitle) {
    const snippet = item.text.slice(0, 48).replace(/[\r\n]+/g, ' ');
    readerTrackTitle.textContent = snippet.length < item.text.length ? `${snippet}...` : snippet;
  }

  if (readerTrackMeta) {
    if (item.isFallback) {
      readerTrackMeta.innerHTML = `Głos: <strong>${escapeHtml(item.voiceName)}</strong> • Silnik: <span style="color:#d97706; font-weight:600;">⚠️ ${escapeHtml(item.ttsMethod)}</span> • Wygenerowano: ${escapeHtml(item.formattedTime)}`;
    } else {
      readerTrackMeta.textContent = `Głos: ${item.voiceName} • Silnik: ${item.ttsMethod} • Wygenerowano: ${item.formattedTime}`;
    }
  }

  if (readerStatusText) {
    if (item.fallbackReason) {
      readerStatusText.innerHTML = `⚠️ <strong>Nagranie z sesji:</strong> ${escapeHtml(item.fallbackReason)} (${escapeHtml(item.ttsMethod)}).`;
    } else {
      readerStatusText.textContent = `Wczytano nagranie z sesji (${item.voiceName} • ${item.formattedTime}).`;
    }
  }

  updateReaderProgress(0, 0);

  if (shouldPlay && readerAudioElement) {
    readerAudioElement.play().catch(e => console.warn('Auto-play blocked:', e));
  }

  renderReaderHistory();
}

function playOrPauseHistoryItem(item) {
  if (state.activeHistoryId === item.id && readerAudioElement && readerAudioElement.src === item.audioUrl) {
    if (readerAudioElement.paused || readerAudioElement.ended) {
      readerAudioElement.play().catch(e => console.warn(e));
    } else {
      readerAudioElement.pause();
    }
  } else {
    loadHistoryItemIntoPlayer(item, true);
  }
}

function removeHistoryItem(id) {
  const index = state.readerHistory.findIndex(it => it.id === id);
  if (index !== -1) {
    const [removed] = state.readerHistory.splice(index, 1);
    if (removed && removed.audioUrl && removed.audioUrl !== currentReaderAudioUrl) {
      URL.revokeObjectURL(removed.audioUrl);
    }
    if (state.activeHistoryId === id) {
      state.activeHistoryId = state.readerHistory[0]?.id || null;
    }
    renderReaderHistory();
  }
}

function clearReaderHistory() {
  if (!state.readerHistory || state.readerHistory.length === 0) return;
  if (!confirm('Czy na pewno chcesz wyczyścić historię ostatnich nagrań z bieżącej sesji?')) return;

  state.readerHistory.forEach(item => {
    if (item.audioUrl && item.audioUrl !== currentReaderAudioUrl) {
      URL.revokeObjectURL(item.audioUrl);
    }
  });
  state.readerHistory = [];
  state.activeHistoryId = null;
  renderReaderHistory();
}

function updateHistoryPlayIcons(isPlaying) {
  if (!historyList) return;
  const items = historyList.querySelectorAll('.history-item');
  items.forEach(el => {
    const id = el.dataset.id;
    const isCurrent = state.activeHistoryId === id;
    const playIcon = el.querySelector('.h-icon-play');
    const pauseIcon = el.querySelector('.h-icon-pause');
    const playBtn = el.querySelector('.history-play-btn');

    if (isCurrent) {
      el.classList.add('active');
      if (isPlaying) {
        if (playIcon) playIcon.hidden = true;
        if (pauseIcon) pauseIcon.hidden = false;
        if (playBtn) playBtn.setAttribute('title', 'Wstrzymaj odtwarzanie');
      } else {
        if (playIcon) playIcon.hidden = false;
        if (pauseIcon) pauseIcon.hidden = true;
        if (playBtn) playBtn.setAttribute('title', 'Odtwórz to nagranie');
      }
    } else {
      el.classList.remove('active');
      if (playIcon) playIcon.hidden = false;
      if (pauseIcon) pauseIcon.hidden = true;
      if (playBtn) playBtn.setAttribute('title', 'Odtwórz to nagranie');
    }
  });
}

function setupScrubberEvents() {
  if (!readerScrubberTrack) return;

  function seekFromEvent(e) {
    if (!readerAudioElement || !readerAudioElement.duration) return;
    const rect = readerScrubberTrack.getBoundingClientRect();
    const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const target = fraction * readerAudioElement.duration;
    readerAudioElement.currentTime = target;
    updateReaderProgress(target, readerAudioElement.duration);
  }

  readerScrubberTrack.addEventListener('click', (e) => {
    seekFromEvent(e);
  });

  let isDragging = false;
  readerScrubberTrack.addEventListener('mousedown', (e) => {
    isDragging = true;
    seekFromEvent(e);
  });

  window.addEventListener('mousemove', (e) => {
    if (isDragging) {
      seekFromEvent(e);
    }
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
  });

  readerScrubberTrack.addEventListener('touchstart', (e) => {
    isDragging = true;
    seekFromEvent(e);
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (isDragging) {
      seekFromEvent(e);
    }
  }, { passive: true });

  window.addEventListener('touchend', () => {
    isDragging = false;
  });
}

function setupReaderAudioListeners() {
  if (!readerAudioElement) return;

  readerAudioElement.addEventListener('loadedmetadata', () => {
    if (readerTotalTime) {
      readerTotalTime.textContent = formatReaderTime(readerAudioElement.duration);
    }
  });

  readerAudioElement.addEventListener('timeupdate', () => {
    updateReaderProgress(readerAudioElement.currentTime, readerAudioElement.duration || 0);
  });

  readerAudioElement.addEventListener('play', () => {
    if (readerPlayIcon) readerPlayIcon.hidden = true;
    if (readerPauseIcon) readerPauseIcon.hidden = false;
    if (readerPlayPauseBtn) readerPlayPauseBtn.setAttribute('aria-label', 'Wstrzymaj');
    if (readerWaveform) readerWaveform.classList.add('playing');
    if (playerStateBadge) playerStateBadge.className = 'player-live-badge playing';
    if (playerStateText) playerStateText.textContent = 'Odtwarzanie...';
    updateHistoryPlayIcons(true);
  });

  readerAudioElement.addEventListener('pause', () => {
    if (readerPlayIcon) readerPlayIcon.hidden = false;
    if (readerPauseIcon) readerPauseIcon.hidden = true;
    if (readerPlayPauseBtn) readerPlayPauseBtn.setAttribute('aria-label', 'Odtwórz');
    if (readerWaveform) readerWaveform.classList.remove('playing');
    if (playerStateBadge) playerStateBadge.className = 'player-live-badge ready';
    if (playerStateText) playerStateText.textContent = 'Wstrzymano';
    updateHistoryPlayIcons(false);
  });

  readerAudioElement.addEventListener('ended', () => {
    if (readerPlayIcon) readerPlayIcon.hidden = false;
    if (readerPauseIcon) readerPauseIcon.hidden = true;
    if (readerPlayPauseBtn) readerPlayPauseBtn.setAttribute('aria-label', 'Odtwórz');
    if (readerWaveform) readerWaveform.classList.remove('playing');
    if (playerStateBadge) playerStateBadge.className = 'player-live-badge ready';
    if (playerStateText) playerStateText.textContent = 'Zakończono';
    updateReaderProgress(readerAudioElement.duration || 0, readerAudioElement.duration || 0);
    updateHistoryPlayIcons(false);
  });
}

function initReaderModule() {
  initWaveformBars();
  updateReaderStats();
  updateReaderSystemPill();
  setupScrubberEvents();
  setupReaderAudioListeners();
  renderReaderHistory();

  // Nawigacja
  if (navChatBtn) navChatBtn.addEventListener('click', () => switchView('chat'));
  if (navReaderBtn) navReaderBtn.addEventListener('click', () => switchView('reader'));
  if (brandHomeLink) {
    brandHomeLink.addEventListener('click', (e) => {
      e.preventDefault();
      switchView('chat');
    });
  }
  if (readerBackBtn) readerBackBtn.addEventListener('click', () => switchView('chat'));
  if (readerEditSettingsBtn) readerEditSettingsBtn.addEventListener('click', openSettingsPanel);

  // Czyszczenie historii nagrań sesji
  if (readerClearHistoryBtn) {
    readerClearHistoryBtn.addEventListener('click', clearReaderHistory);
  }

  // Zmiana hasha w URL
  window.addEventListener('hashchange', () => {
    if (window.location.hash === '#tekst' || window.location.hash === '#przeczytaj-tekst') {
      switchView('reader');
    } else if (!window.location.hash || window.location.hash === '#chat') {
      switchView('chat');
    }
  });

  // Wstępne sprawdzenie hasha przy starcie
  if (window.location.hash === '#tekst' || window.location.hash === '#przeczytaj-tekst') {
    switchView('reader');
  }

  // Obsługa pola tekstowego
  if (readerTextInput) {
    readerTextInput.addEventListener('input', updateReaderStats);
  }

  if (readerPasteBtn) {
    readerPasteBtn.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          readerTextInput.value = text;
          updateReaderStats();
          readerTextInput.focus();
        }
      } catch (err) {
        alert('Nie udało się automatycznie odczytać schowka. Użyj skrótu Ctrl+V / Cmd+V, aby wkleić tekst.');
      }
    });
  }

  if (readerSampleBtn) {
    readerSampleBtn.addEventListener('click', () => {
      if (readerTextInput) {
        readerTextInput.value = SAMPLE_TEXT;
        updateReaderStats();
        readerTextInput.focus();
      }
    });
  }

  if (readerClearBtn) {
    readerClearBtn.addEventListener('click', () => {
      if (!readerTextInput.value || confirm('Czy na pewno chcesz wyczyścić wpisany tekst?')) {
        readerTextInput.value = '';
        updateReaderStats();
        readerTextInput.focus();
      }
    });
  }

  if (readerSynthesizeBtn) {
    readerSynthesizeBtn.addEventListener('click', handleReaderSynthesize);
  }

  // Kontrolki odtwarzacza
  if (readerPlayPauseBtn) {
    readerPlayPauseBtn.addEventListener('click', toggleReaderPlayPause);
  }

  if (readerRewindBtn) {
    readerRewindBtn.addEventListener('click', () => seekReader(-5));
  }

  if (readerForwardBtn) {
    readerForwardBtn.addEventListener('click', () => seekReader(5));
  }

  if (readerStopBtn) {
    readerStopBtn.addEventListener('click', stopReaderAudio);
  }

  if (readerSpeedSelect) {
    readerSpeedSelect.addEventListener('change', () => {
      if (readerAudioElement) {
        readerAudioElement.playbackRate = parseFloat(readerSpeedSelect.value);
      }
    });
  }
}

window.addEventListener('DOMContentLoaded', init);
