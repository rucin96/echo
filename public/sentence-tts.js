// Tryb jednego zdania: tekst idzie do TTS zdanie po zdaniu, a kolejne zdania są wysyłane
// od razu (nie po przeczytaniu poprzedniego), zawsze w kolejności: bieżące, następne, reszta.
// Podział na zdania jest lustrzanym odbiciem extension/chunker.js.

const SENTENCE_MAX_CHARS = 300;
const SENTENCE_GAP_SEC = 0.12;

function splitTextIntoSentences(text, max = SENTENCE_MAX_CHARS) {
  const paragraphs = text
    .replace(/\r/g, '')
    .split(/\n\s*\n|\n(?=\s*[-•*\d])/) // akapity i punkty list traktujemy jako granice zdań
    .map(p => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const segmenter = new Intl.Segmenter('pl', { granularity: 'sentence' });
  return paragraphs
    .flatMap(paragraph => Array.from(segmenter.segment(paragraph), s => s.segment.trim()).filter(Boolean))
    .flatMap(sentence => splitLongSentence(sentence, max));
}

// Zdanie dłuższe niż limit tniemy najpierw po przecinkach/średnikach, a w ostateczności po słowach
function splitLongSentence(sentence, max) {
  if (sentence.length <= max) return [sentence];
  const pieces = sentence.split(/(?<=[,;:–—])\s+/).flatMap(part => (part.length > max ? part.split(' ') : [part]));
  const result = [];
  let current = '';
  for (const piece of pieces) {
    const candidate = current ? `${current} ${piece}` : piece;
    if (candidate.length <= max || !current) {
      current = candidate;
    } else {
      result.push(current);
      current = piece;
    }
  }
  if (current) result.push(current);
  return result;
}

// Lokalny Chatterbox liczy po jednym zdaniu, więc w kolejce trzymamy tylko jedno zdanie za generowanym
// (więcej oczekujących mogłoby zostać obsłużonych w innej kolejności); chmurę ograniczamy do 3 zapytań naraz
function sentenceConcurrency(voiceId) {
  return voiceId && voiceId.startsWith('local-') ? 2 : 3;
}

class SentenceTtsQueue {
  // fetchSentence(text, signal) -> Promise<{ blob, ... }>
  constructor(sentences, fetchSentence, { concurrency = 3 } = {}) {
    this.sentences = sentences;
    this.fetchSentence = fetchSentence;
    this.concurrency = concurrency;
    this.controller = new AbortController();
    // Każde zdanie ma swój promise od początku, także zanim wyślemy po nie zapytanie
    this.slots = sentences.map(() => {
      const slot = {};
      slot.promise = new Promise((resolve, reject) => Object.assign(slot, { resolve, reject }));
      slot.promise.catch(() => {});
      return slot;
    });
    this.ready = new Set();
    this.nextFetch = 0;
    this.inFlight = 0;
    this.pump();
  }

  pump() {
    while (!this.controller.signal.aborted && this.nextFetch < this.sentences.length && this.inFlight < this.concurrency) {
      const index = this.nextFetch++;
      const slot = this.slots[index];
      this.inFlight++;
      this.fetchSentence(this.sentences[index], this.controller.signal)
        .then(result => { this.ready.add(index); slot.resolve(result); }, slot.reject)
        .finally(() => { this.inFlight--; this.pump(); });
    }
  }

  get(index) {
    return this.slots[index].promise;
  }

  isReady(index) {
    return this.ready.has(index);
  }

  all() {
    return Promise.all(this.slots.map(slot => slot.promise));
  }

  abort() {
    this.controller.abort();
    // Zdania, po które jeszcze nie poszło zapytanie, też kończymy, żeby nikt na nie nie czekał
    const error = new DOMException('Przerwano', 'AbortError');
    this.slots.forEach(slot => slot.reject(error));
  }
}

// Skleja nagrania zdań (MP3/WAV, różne częstotliwości) w jeden plik WAV.
// offsets[i] to moment startu zdania i w sklejonym pliku (do płynnego przełączenia odtwarzacza).
async function mergeAudioBlobs(blobs, gapSec = SENTENCE_GAP_SEC) {
  const sampleRate = 24000;
  const decoder = new OfflineAudioContext(1, 1, sampleRate);
  const buffers = [];
  for (const blob of blobs) {
    buffers.push(await decoder.decodeAudioData(await blob.arrayBuffer()));
  }

  const gap = Math.round(gapSec * sampleRate);
  const total = buffers.reduce((sum, b) => sum + b.length, 0) + gap * Math.max(0, buffers.length - 1);
  const samples = new Float32Array(total);
  const offsets = [];
  let position = 0;
  buffers.forEach((buffer, i) => {
    offsets.push(position / sampleRate);
    samples.set(buffer.getChannelData(0), position);
    position += buffer.length + (i < buffers.length - 1 ? gap : 0);
  });

  return { blob: encodeWav(samples, sampleRate), offsets };
}

function encodeWav(samples, sampleRate) {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const writeString = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([view], { type: 'audio/wav' });
}

// Odtwarza jedno nagranie w elemencie audio; kończy się po "ended" albo po anulowaniu (cancel())
function playOnElement(audioEl, url, playbackRate = 1) {
  let cancel;
  const done = new Promise((resolve, reject) => {
    cancel = resolve;
    audioEl.onended = () => resolve();
    audioEl.onerror = () => reject(new Error('Nie udało się odtworzyć audio.'));
    audioEl.src = url;
    // Zmiana src resetuje prędkość do defaultPlaybackRate, więc ustawiamy obie
    audioEl.defaultPlaybackRate = playbackRate;
    audioEl.playbackRate = playbackRate;
    audioEl.play().catch(reject);
  }).finally(() => {
    audioEl.onended = null;
    audioEl.onerror = null;
  });
  return { done, cancel: () => cancel() };
}
