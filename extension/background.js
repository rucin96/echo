import { DEFAULT_SETTINGS, DEFAULT_KEYS } from './shared.js';

const MENU_ID = 'echo-read-selection';
const OFFSCREEN_URL = 'offscreen.html';

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
    chrome.storage.session.set({ echoState: msg.state });
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
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const el = document.activeElement;
        if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') && typeof el.selectionStart === 'number') {
          const value = el.value.substring(el.selectionStart, el.selectionEnd);
          if (value) return value;
        }
        return window.getSelection()?.toString() || '';
      }
    });
    return results
      .map(r => r.result || '')
      .reduce((longest, t) => (t.length > longest.length ? t : longest), '');
  } catch {
    // Strony typu chrome:// lub Chrome Web Store nie pozwalają na wstrzykiwanie skryptów
    return '';
  }
}

async function speak(text) {
  if (!text || !text.trim()) {
    await setState({ status: 'error', error: 'Nie zaznaczono tekstu na stronie.' });
    return;
  }
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const keys = await chrome.storage.local.get(DEFAULT_KEYS);
  await ensureOffscreen();
  await chrome.runtime.sendMessage({ target: 'offscreen', type: 'speak', text, settings: { ...settings, ...keys } });
}

async function forwardToOffscreen(msg) {
  if (!(await hasOffscreen())) return;
  await chrome.runtime.sendMessage({ ...msg, target: 'offscreen' });
}

function setState(state) {
  return chrome.storage.session.set({ echoState: state });
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
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Odtwarzanie mowy wygenerowanej przez serwer Echo'
    }).finally(() => { creatingOffscreen = null; });
  }
  await creatingOffscreen;
}
