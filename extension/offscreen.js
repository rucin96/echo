import { splitIntoChunks, splitIntoSentenceChunks } from './chunker.js';
import { normalizeServerUrl } from './shared.js';

const audio = new Audio();
let session = null;
let loadingTicker = null;

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

  const chunks = settings.sentenceMode ? splitIntoSentenceChunks(text) : splitIntoChunks(text);
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
    ready: new Set(), // indeksy, których audio już przyszło
    nextFetch: 0,
    inFlight: 0,
    ...fetchPolicy(settings),
    finishPlayback: null,
    preview: text.trim().slice(0, 120),
    loadingSince: null
  };
  session = s;

  try {
    for (let i = 0; i < chunks.length; i++) {
      s.index = i;
      pump(s);
      if (!s.ready.has(i)) report({ status: 'loading' });

      const url = await s.audioUrls.get(i);
      if (s.cancelled) return;

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

// Ile fragmentów generować z wyprzedzeniem i ile zapytań naraz.
// Tryb zdań wysyła kolejne zdania od razu, nie czekając na odtworzenie, zawsze w kolejności
// (bieżące, następne, reszta). Lokalny Chatterbox liczy po jednym, więc trzymamy tylko jedno
// zdanie w kolejce za generowanym, żeby serwer nie pomieszał kolejności; chmurę ograniczamy do 3.
function fetchPolicy(settings) {
  if (!settings.sentenceMode) return { lookahead: 1, concurrency: 2 };
  return { lookahead: Infinity, concurrency: settings.voiceId?.startsWith('local-') ? 2 : 3 };
}

// Uruchamia zapytania TTS w kolejności fragmentów, aż do wyczerpania limitów
function pump(s) {
  while (!s.cancelled && s.nextFetch < s.chunks.length && s.inFlight < s.concurrency && s.nextFetch <= s.index + s.lookahead) {
    const index = s.nextFetch++;
    s.inFlight++;
    const pending = fetchAudio(s, s.chunks[index]);
    s.audioUrls.set(index, pending);
    pending
      .then(() => s.ready.add(index), () => {})
      .finally(() => { s.inFlight--; pump(s); });
  }
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

  // Lokalny model potrafi generować fragment ponad minutę, więc co sekundę odświeżamy licznik
  if (state.status === 'loading') {
    if (s && !s.loadingSince) s.loadingSince = Date.now();
    state.loadingSince = s?.loadingSince || Date.now();
    loadingTicker ??= setInterval(() => report({ status: 'loading' }), 1000);
  } else {
    if (s) s.loadingSince = null;
    clearInterval(loadingTicker);
    loadingTicker = null;
  }

  chrome.runtime.sendMessage({ target: 'background', type: 'state', state }).catch(() => {});
}
