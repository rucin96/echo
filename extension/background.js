import { DEFAULT_SETTINGS, DEFAULT_KEYS } from './shared.js';

const MENU_ID = 'echo-read-selection';
const OFFSCREEN_URL = 'offscreen.html';
const SELECTION_TIMEOUT_MS = 1500;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Przeczytaj z Echo',
    contexts: ['selection']
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  // selectionText gubi znaki nowej linii, więc preferujemy odczyt ze strony
  const text = (await getSelectionFromTab(tab?.id)) || info.selectionText || '';
  await speak(text);
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === 'read-selection') {
    await speak(await getSelectionFromTab(tab?.id));
  } else if (command === 'stop-reading') {
    await forwardToOffscreen({ type: 'stop' });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target !== 'background') return;

  if (msg.type === 'state') {
    setState(msg.state);
    return;
  }

  (async () => {
    if (msg.type === 'read-selection') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await speak(await getSelectionFromTab(tab?.id));
    } else if (['pause', 'resume', 'stop', 'set-speed'].includes(msg.type)) {
      await forwardToOffscreen(msg);
    }
  })().finally(() => sendResponse({ ok: true }));
  return true;
});

async function getSelectionFromTab(tabId) {
  if (!tabId) return '';
  try {
    // allFrames potrafi nigdy się nie skończyć, gdy któraś ramka (np. reklama) nie odpowiada,
    // więc po limicie czasu czytamy tylko z głównej ramki
    const results = await withTimeout(readSelection({ tabId, allFrames: true }), SELECTION_TIMEOUT_MS)
      .catch(() => withTimeout(readSelection({ tabId }), SELECTION_TIMEOUT_MS));
    return results
      .map(r => r.result || '')
      .reduce((longest, t) => (t.length > longest.length ? t : longest), '');
  } catch {
    // Strony typu chrome:// lub Chrome Web Store nie pozwalają na wstrzykiwanie skryptów
    return '';
  }
}

function readSelection(target) {
  return chrome.scripting.executeScript({
    target,
    func: () => {
      const el = document.activeElement;
      if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') && typeof el.selectionStart === 'number') {
        const value = el.value.substring(el.selectionStart, el.selectionEnd);
        if (value) return value;
      }
      return window.getSelection()?.toString() || '';
    }
  });
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function speak(text) {
  if (!text || !text.trim()) {
    await setState({ status: 'error', error: 'Nie zaznaczono tekstu na stronie.' });
    return;
  }
  // Od razu pokazujemy, że coś się dzieje; offscreen przejmie raportowanie, gdy wystartuje
  await setState({ status: 'loading', index: 0, total: 0, preview: text.trim().slice(0, 120), loadingSince: Date.now() });
  try {
    const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    const keys = await chrome.storage.local.get(DEFAULT_KEYS);
    await ensureOffscreen();
    await chrome.runtime.sendMessage({ target: 'offscreen', type: 'speak', text, settings: { ...settings, ...keys } });
  } catch (error) {
    // Bez tego wyjątek ginie w service workerze, a popup dalej pokazuje "Gotowy"
    await setState({ status: 'error', error: `Nie udało się uruchomić lektora: ${error.message || error}` });
  }
}

async function forwardToOffscreen(msg) {
  if (!(await hasOffscreen())) return;
  await chrome.runtime.sendMessage({ ...msg, target: 'offscreen' });
}

function setState(state) {
  updateBadge(state);
  return chrome.storage.session.set({ echoState: state });
}

const BADGES = {
  playing: { text: '▶', color: '#3f7d58' },
  paused: { text: '❚❚', color: '#6b6f76' },
  error: { text: '!', color: '#c0392b' }
};

// Ikona rozszerzenia pokazuje stan także wtedy, gdy popup jest zamknięty (PPM, skrót klawiszowy)
function updateBadge(state) {
  let badge = BADGES[state?.status];
  if (state?.status === 'loading') {
    const elapsed = state.loadingSince ? Math.floor((Date.now() - state.loadingSince) / 1000) : 0;
    badge = { text: elapsed >= 1 ? `${elapsed}s` : '…', color: '#ba523b' };
  }
  chrome.action.setBadgeText({ text: badge?.text || '' });
  if (badge) {
    chrome.action.setBadgeBackgroundColor({ color: badge.color });
    chrome.action.setBadgeTextColor({ color: '#ffffff' });
  }
}

async function hasOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)]
  });
  return contexts.length > 0;
}

let creatingOffscreen = null;

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      // Sam AUDIO_PLAYBACK zamyka dokument po 30 s ciszy, a lokalny Chatterbox generuje
      // pierwszy fragment dłużej. BLOBS (audio z URL.createObjectURL) nie ma limitu czasu życia.
      reasons: ['AUDIO_PLAYBACK', 'BLOBS'],
      justification: 'Odtwarzanie mowy wygenerowanej przez serwer Echo'
    }).finally(() => { creatingOffscreen = null; });
  }
  await creatingOffscreen;
}
