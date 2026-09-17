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

const state = {
  status: 'idle', // 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking'
  messages: [],
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
    'eleven_turbo_v2_5': 'Turbo v2.5',
    'eleven_multilingual_v2': 'Multilingual v2'
  };
  return map[modelId] || modelId || 'TTS';
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
}

// ==========================================
// Initialization
// ==========================================
async function init() {
  setupCanvas();
  loadSavedSettings();
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
        state.settings.voiceId = voiceSelect.value;
      }
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

  // Keyboard shortcut: Spacebar to toggle record (when not typing in an input)
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !e.repeat && !settingsModal.classList.contains('open') && !document.activeElement.closest('input, textarea, select, button, a, [contenteditable]')) {
      e.preventDefault();
      toggleRecording();
    }
    if (e.key === 'Escape' && settingsModal.classList.contains('open')) {
      closeSettingsPanel();
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

  // Auto-synchronize Voice and TTS Model (solves UX distinction between voice timbre and AI engine)
  function syncVoiceAndTtsModel(source) {
    const currentVoice = voiceSelect.value;
    const currentTts = ttsModelSelect.value;

    if (source === 'voice') {
      if (currentVoice.startsWith('google-gemini')) {
        ttsModelSelect.value = 'gemini-2.5-flash-preview-tts';
      } else if (currentVoice.startsWith('pl-PL-Wavenet')) {
        ttsModelSelect.value = 'google-cloud-wavenet';
      } else if (currentVoice === 'pl-PL-MarekNeural' || currentVoice === 'pl-PL-ZofiaNeural') {
        ttsModelSelect.value = 'edge-neural';
      } else if (currentVoice.length > 15) { // ElevenLabs voice ID
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

    const ttsRes = await fetch('/api/tts', {
      method: 'POST',
      headers: ttsHeaders,
      body: JSON.stringify({
        text: aiText,
        voiceId: state.settings.voiceId,
        modelId: state.settings.ttsModel
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

window.addEventListener('DOMContentLoaded', init);
