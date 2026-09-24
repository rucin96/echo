// Dzieli długi tekst na fragmenty do syntezy mowy.
// Pierwszy fragment jest krótki, żeby lektor zaczął mówić jak najszybciej,
// kolejne są dłuższe, żeby ograniczyć liczbę zapytań i przerw między nimi.

const FIRST_CHUNK_MAX = 280;
const CHUNK_MAX = 1000;
// W trybie jednego zdania bardzo długie zdanie i tak tniemy, żeby nie czekać na nie zbyt długo
const SENTENCE_MAX = 300;

export function splitIntoChunks(text, { firstMax = FIRST_CHUNK_MAX, max = CHUNK_MAX } = {}) {
  const pieces = splitIntoSentences(text)
    .flatMap(sentence => splitLongSentence(sentence, max));

  const chunks = [];
  let current = '';

  for (const piece of pieces) {
    const limit = chunks.length === 0 ? firstMax : max;
    const candidate = current ? `${current} ${piece}` : piece;
    if (candidate.length <= limit || !current) {
      current = candidate;
    } else {
      chunks.push(current);
      current = piece;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// Tryb jednego zdania: każde zdanie osobno do TTS
export function splitIntoSentenceChunks(text, max = SENTENCE_MAX) {
  return splitIntoSentences(text).flatMap(sentence => splitLongSentence(sentence, max));
}

function splitIntoSentences(text) {
  const paragraphs = text
    .replace(/\r/g, '')
    .split(/\n\s*\n|\n(?=\s*[-•*\d])/) // akapity i punkty list traktujemy jako granice zdań
    .map(p => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const segmenter = new Intl.Segmenter('pl', { granularity: 'sentence' });
  return paragraphs.flatMap(paragraph =>
    Array.from(segmenter.segment(paragraph), s => s.segment.trim()).filter(Boolean)
  );
}

// Zdanie dłuższe niż limit tniemy najpierw po przecinkach/średnikach, a w ostateczności po słowach
function splitLongSentence(sentence, max) {
  if (sentence.length <= max) return [sentence];

  const parts = sentence.split(/(?<=[,;:–—])\s+/);
  const result = [];
  let current = '';

  for (const part of parts) {
    if (part.length > max) {
      if (current) { result.push(current); current = ''; }
      result.push(...splitByWords(part, max));
      continue;
    }
    const candidate = current ? `${current} ${part}` : part;
    if (candidate.length <= max) {
      current = candidate;
    } else {
      result.push(current);
      current = part;
    }
  }
  if (current) result.push(current);
  return result;
}

function splitByWords(text, max) {
  const result = [];
  let current = '';
  for (const word of text.split(' ')) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= max || !current) {
      current = candidate;
    } else {
      result.push(current);
      current = word;
    }
  }
  if (current) result.push(current);
  return result;
}
