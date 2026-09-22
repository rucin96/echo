import { splitIntoChunks } from './chunker.js';
import { normalizeServerUrl } from './shared.js';

const audio = new Audio();
let session = null;

chrome.runtime.onMessage.addListener(msg => {
  if (msg?.target !== 'offscreen') return;

  switch (msg.type) {
    case 'speak':
      start(msg.text, msg.settings);
      break;
    case 'pause':
      if (session && !audio.paused) {
        audio.pause();
        report({ status: 'paused' });
      }
      break;
    case 'resume':
      if (session && audio.paused && audio.src) {
        audio.play();
        report({ status: 'playing' });
      }
      break;
    case 'stop':
      stop();
      report({ status: 'idle' });
      break;
    case 'set-speed':
      if (session) session.settings.speed = msg.speed;
      audio.playbackRate = msg.speed;
      break;
  }
});

async function start(text, settings) {
  stop();

  const chunks = splitIntoChunks(text);
  if (!chunks.length) {
    report({ status: 'error', error: 'Brak tekstu do przeczytania.' });
    return;
  }

  const s = {
    chunks,
    settings,
    index: 0,
    cancelled: false,
    controller: new AbortController(),
    audioUrls: new Map(), // index -> Promise<objectURL>
    finishPlayback: null,
    preview: text.trim().slice(0, 120)
  };
  session = s;

  try {
    for (let i = 0; i < chunks.length; i++) {
      s.index = i;
      if (!s.audioUrls.has(i)) report({ status: 'loading' });

      const url = await synthesize(s, i);
      if (s.cancelled) return;

      // Pobieramy kolejny fragment, zanim skończy się bieżący, żeby nie było przerwy
      if (i + 1 < chunks.length) synthesize(s, i + 1).catch(() => {});

      report({ status: 'playing' });
      await play(s, url);
      URL.revokeObjectURL(url);
      s.audioUrls.delete(i);
      if (s.cancelled) return;
    }
    session = null;
    report({ status: 'idle', finished: true });
  } catch (error) {
    if (s.cancelled) return;
    stop();
    report({ status: 'error', error: error.message || String(error) });
  }
}

function synthesize(s, index) {
  if (!s.audioUrls.has(index)) {
    s.audioUrls.set(index, fetchAudio(s, s.chunks[index]));
  }
  return s.audioUrls.get(index);
}

async function fetchAudio(s, text) {
  const { serverUrl, voiceId, ttsModel, elevenLabsKey, googleKey, openaiKey } = s.settings;
  const headers = { 'Content-Type': 'application/json' };
  if (elevenLabsKey) headers['x-elevenlabs-key'] = elevenLabsKey;
  if (googleKey) headers['x-google-key'] = googleKey;
  if (openaiKey) headers['x-openai-key'] = openaiKey;

  let res;
  try {
    res = await fetch(`${normalizeServerUrl(serverUrl)}/api/tts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text, voiceId, modelId: ttsModel }),
      signal: s.controller.signal
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error(`Brak połączenia z serwerem Echo (${normalizeServerUrl(serverUrl)}). Uruchom go poleceniem npm start.`);
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Serwer zwrócił błąd ${res.status}.`);
  }
  return URL.createObjectURL(await res.blob());
}

function play(s, url) {
  return new Promise((resolve, reject) => {
    s.finishPlayback = resolve;
    audio.onended = () => resolve();
    audio.onerror = () => reject(new Error('Nie udało się odtworzyć audio.'));
    audio.src = url;
    // Zmiana src resetuje prędkość do defaultPlaybackRate, więc ustawiamy obie
    audio.defaultPlaybackRate = s.settings.speed;
    audio.playbackRate = s.settings.speed;
    audio.play().catch(reject);
  });
}

function stop() {
  const s = session;
  if (!s) return;
  session = null;
  s.cancelled = true;
  s.controller.abort();
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  s.finishPlayback?.();
  for (const pending of s.audioUrls.values()) {
    pending.then(url => URL.revokeObjectURL(url)).catch(() => {});
  }
  s.audioUrls.clear();
}

function report(partial) {
  const s = session;
  const state = {
    status: 'idle',
    index: s ? s.index : 0,
    total: s ? s.chunks.length : 0,
    preview: s ? s.preview : '',
    error: null,
    ...partial
  };
  chrome.runtime.sendMessage({ target: 'background', type: 'state', state }).catch(() => {});
}
