import { DEFAULT_SETTINGS, DEFAULT_KEYS, FALLBACK_VOICES, modelsForVoice, normalizeServerUrl } from './shared.js';

const $ = id => document.getElementById(id);
const voiceSelect = $('voiceSelect');
const modelSelect = $('modelSelect');
const speedSelect = $('speedSelect');
const serverInput = $('serverInput');
const elevenKeyInput = $('elevenKeyInput');
const googleKeyInput = $('googleKeyInput');
const openaiKeyInput = $('openaiKeyInput');
const readBtn = $('readBtn');
const pauseBtn = $('pauseBtn');
const stopBtn = $('stopBtn');

const STATUS_LABELS = {
  idle: 'Gotowy',
  loading: 'Generuję mowę…',
  playing: 'Czytam',
  paused: 'Wstrzymano',
  error: 'Błąd'
};

let settings = { ...DEFAULT_SETTINGS };
let keys = { ...DEFAULT_KEYS };
let currentState = { status: 'idle' };

init();

async function init() {
  settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  keys = await chrome.storage.local.get(DEFAULT_KEYS);

  serverInput.value = settings.serverUrl;
  elevenKeyInput.value = keys.elevenLabsKey;
  googleKeyInput.value = keys.googleKey;
  openaiKeyInput.value = keys.openaiKey;
  speedSelect.value = String(settings.speed);

  showShortcut();
  await loadVoices();

  const { echoState } = await chrome.storage.session.get('echoState');
  renderState(echoState || { status: 'idle' });
}

chrome.storage.session.onChanged.addListener(changes => {
  if (changes.echoState) renderState(changes.echoState.newValue || { status: 'idle' });
});

async function showShortcut() {
  const commands = await chrome.commands.getAll();
  const read = commands.find(c => c.name === 'read-selection');
  if (read?.shortcut) $('shortcutHint').textContent = read.shortcut;
}

async function loadVoices() {
  const dot = $('serverDot');
  let voices = FALLBACK_VOICES;
  try {
    const headers = {};
    if (keys.elevenLabsKey) headers['x-elevenlabs-key'] = keys.elevenLabsKey;
    const res = await fetch(`${normalizeServerUrl(settings.serverUrl)}/api/voices`, { headers });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    if (data.voices?.length) voices = data.voices;
    dot.className = 'server-dot ok';
    dot.title = `Serwer Echo działa (${normalizeServerUrl(settings.serverUrl)})`;
  } catch {
    dot.className = 'server-dot down';
    dot.title = `Serwer Echo niedostępny (${normalizeServerUrl(settings.serverUrl)})`;
  }

  renderVoices(voices);
  renderModels();
}

function renderVoices(voices) {
  const groups = [
    { label: 'Google / Edge', items: voices.filter(v => v.category === 'google') },
    { label: 'OpenAI', items: voices.filter(v => v.category === 'openai') },
    { label: 'Chatterbox (lokalny)', items: voices.filter(v => v.category === 'local') },
    { label: 'ElevenLabs', items: voices.filter(v => !['google', 'openai', 'local'].includes(v.category)) }
  ];

  voiceSelect.innerHTML = '';
  for (const group of groups) {
    if (!group.items.length) continue;
    const optgroup = document.createElement('optgroup');
    optgroup.label = group.label;
    for (const voice of group.items) {
      optgroup.append(new Option(voice.name, voice.voice_id));
    }
    voiceSelect.append(optgroup);
  }

  const known = voices.some(v => v.voice_id === settings.voiceId);
  voiceSelect.value = known ? settings.voiceId : DEFAULT_SETTINGS.voiceId;
}

function renderModels() {
  const models = modelsForVoice(voiceSelect.value);
  modelSelect.innerHTML = '';
  for (const model of models) modelSelect.append(new Option(model.name, model.id));

  const valid = models.some(m => m.id === settings.ttsModel);
  modelSelect.value = valid ? settings.ttsModel : models[0].id;
  modelSelect.disabled = models.length === 1;
  saveVoiceSettings();
}

function saveVoiceSettings() {
  settings.voiceId = voiceSelect.value;
  settings.ttsModel = modelSelect.value;
  chrome.storage.sync.set({ voiceId: settings.voiceId, ttsModel: settings.ttsModel });
}

voiceSelect.addEventListener('change', renderModels);
modelSelect.addEventListener('change', saveVoiceSettings);

speedSelect.addEventListener('change', () => {
  settings.speed = parseFloat(speedSelect.value);
  chrome.storage.sync.set({ speed: settings.speed });
  sendToBackground({ type: 'set-speed', speed: settings.speed });
});

$('saveServerBtn').addEventListener('click', async () => {
  const serverUrl = normalizeServerUrl(serverInput.value);

  // Dla adresów innych niż localhost prosimy o uprawnienie (musi się wydarzyć w obsłudze kliknięcia)
  let permissionRequest = Promise.resolve(true);
  try {
    const { hostname, origin } = new URL(serverUrl);
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
      permissionRequest = chrome.permissions.request({ origins: [`${origin}/*`] });
    }
  } catch {
    serverInput.setCustomValidity('Nieprawidłowy adres URL');
    serverInput.reportValidity();
    return;
  }
  serverInput.setCustomValidity('');
  await permissionRequest.catch(() => false);

  settings.serverUrl = serverUrl;
  keys = {
    elevenLabsKey: elevenKeyInput.value.trim(),
    googleKey: googleKeyInput.value.trim(),
    openaiKey: openaiKeyInput.value.trim()
  };
  serverInput.value = serverUrl;
  await chrome.storage.sync.set({ serverUrl });
  await chrome.storage.local.set(keys);
  await loadVoices();
});

readBtn.addEventListener('click', () => sendToBackground({ type: 'read-selection' }));
stopBtn.addEventListener('click', () => sendToBackground({ type: 'stop' }));
pauseBtn.addEventListener('click', () => {
  sendToBackground({ type: currentState.status === 'paused' ? 'resume' : 'pause' });
});

function sendToBackground(msg) {
  return chrome.runtime.sendMessage({ ...msg, target: 'background' }).catch(() => {});
}

function renderState(state) {
  currentState = state;
  const { status, index = 0, total = 0, preview, error } = state;
  const active = status === 'loading' || status === 'playing' || status === 'paused';

  $('statusBox').classList.toggle('error', status === 'error');
  $('statusLabel').textContent = STATUS_LABELS[status] || status;
  $('statusProgress').textContent = active && total ? `fragment ${index + 1} / ${total}` : '';
  $('barFill').style.width = active && total ? `${((index + (status === 'loading' ? 0 : 0.5)) / total) * 100}%` : '0';

  if (status === 'error') {
    $('statusPreview').textContent = error;
  } else if (active && preview) {
    $('statusPreview').textContent = `„${preview}${preview.length >= 120 ? '…' : ''}”`;
  } else if (state.finished) {
    $('statusPreview').textContent = 'Skończyłem czytać. Zaznacz kolejny fragment, żeby kontynuować.';
  }

  pauseBtn.disabled = !(status === 'playing' || status === 'paused');
  pauseBtn.textContent = status === 'paused' ? 'Wznów' : 'Pauza';
  pauseBtn.dataset.paused = String(status === 'paused');
  stopBtn.disabled = !active;
}
