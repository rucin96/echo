# 🎙️ Voice AI Chat (Google Gemini & Claude + ElevenLabs / Web Speech)

Prosta i nowoczesna aplikacja webowa do prowadzenia naturalnej, płynnej rozmowy głosowej człowieka ze sztuczną inteligencją, obsługująca modele **Google Gemini** oraz **Anthropic Claude**.

---

## 🔄 Przepływ konwersacji (Pipeline)

```
[ Głos użytkownika ]
        │
        ▼ (Mikrofon / Web Audio API)
1. [ STT: ElevenLabs Scribe / Web Speech API ] ──► Transkrypcja mowy na tekst
        │
        ▼
2. [ Google Gemini / Claude API ]              ──► Generowanie zwięzłej, naturalnej odpowiedzi głosowej
        │
        ▼
3. [ TTS: ElevenLabs / Google Gemini Voice ]   ──► Synteza realistycznego głosu w języku polskim
        │
        ▼
[ Odtwarzanie głosu AI w przeglądarce + sferyczny wizualizer audio ]
```

---

## ✨ Kluczowe funkcje

- **Modele Google Gemini (na podstawie projektu `sts`)**:
  - **Gemini 3.6 Flash** (`gemini-3.6-flash`) – domyślny, szybki i stabilny model konwersacyjny.
  - **Gemini 3.8 Flash** (`gemini-3.8-flash`) – najnowsza generacja modeli Flash.
  - **Gemini Flash Latest** (`gemini-flash-latest`) – zawsze aktualna wersja Flash.
  - **Gemini 2.5 Pro** (`gemini-2.5-pro`) & **Gemini 3.1 Pro Preview** (`gemini-3.1-pro-preview`) – głęboka analiza.
  - **Automatyczny mechanizm Fallback**: Jeśli wybrany model Google zwróci błąd przeciążenia (503/429), zapytanie automatycznie próbuje kolejnych modeli (`gemini-3.6-flash` ➔ `gemini-flash-latest` ➔ `gemini-3.8-flash`).
- **Modele Anthropic Claude**:
  - Pełne wsparcie dla Claude Opus 5, Claude Opus 4.6, Claude Sonnet 5 i Claude Haiku 4.5.
- **Krok 1: STT (Speech-to-Text)**:
  - **ElevenLabs Scribe** (`scribe_v2` / `scribe_v1`) – wysoka precyzja.
  - **Web Speech API** – darmowe, wbudowane w przeglądarkę rozpoznawanie mowy w języku polskim (bez wymogu klucza ElevenLabs).
- **Krok 3: TTS (Text-to-Speech)**:
  - Głosy **ElevenLabs** (Sarah, Antoni, George, Adam).
  - Głos **Google Gemini Voice** (`google-gemini-neural`).
- **Wizualizer Canvas**: Płynnie animowana sfera audio reagująca w czasie rzeczywistym na poziom głośności mikrofonu i mowę asystenta.
- **Wskaźnik postępu (Pipeline Tracker)**: Wizualne podświetlanie aktualnego etapu (`1. Głos` ➔ `2. Model AI` ➔ `3. Odpowiedź`).
- **Historia czatu**: Wgląd w pełną transkrypcję rozmowy, informację który model odpowiedział oraz przycisk ponownego odsłuchania głosu.
- **Wygodne sterowanie**:
  - Kliknięcie przycisku mikrofonu lub naciśnięcie **Spacji**.
  - Wpisywanie wiadomości z klawiatury (klawisz Enter).

---

## 🚀 Szybki start

### 1. Wymagania
- Node.js (wersja 18+ lub nowsza)

### 2. Instalacja zależności
```bash
npm install
```

### 3. Konfiguracja kluczy API
Skopiuj plik `.env.example` do `.env`:
```bash
cp .env.example .env
```
Następnie uzupełnij klucze w `.env`:
```env
GOOGLE_API_KEY=twoj_klucz_google_gemini
GEMINI_API_KEY=twoj_klucz_google_gemini
ELEVENLABS_API_KEY=twoj_klucz_elevenlabs
ANTHROPIC_API_KEY=twoj_klucz_anthropic
```
*(Uwaga: Możesz również uruchomić aplikację i wpisać klucze bezpośrednio w panelu ustawień ⚙️ w przeglądarce — zostaną zapisane w `localStorage`).*

### 4. Uruchomienie serwera
```bash
npm start
```
lub w trybie deweloperskim (auto-restart przy zmianach w kodzie):
```bash
npm run dev
```

Aplikacja będzie dostępna pod adresem:
👉 **http://localhost:3000**

---

## ⚙️ Dostępne parametry konfiguracyjne

W pliku `.env` lub w panelu ustawień aplikacji (ikona ⚙️ w prawym górnym rogu):

| Zmienna | Domyślna wartość | Opis |
|---------|------------------|------|
| `PORT` | `3000` | Port serwera HTTP |
| `GOOGLE_API_KEY` | - | Klucz API Google AI Studio / Gemini |
| `GEMINI_API_KEY` | - | Alias dla klucza Google Gemini API |
| `AI_MODEL` | `gemini-3.6-flash` | Domyślny model AI (`gemini-3.6-flash`, `gemini-3.8-flash`, `claude-opus-5`) |
| `ANTHROPIC_API_KEY` | - | Klucz API z platformy Anthropic Claude |
| `ELEVENLABS_API_KEY` | - | Klucz API z platformy ElevenLabs |
| `ELEVENLABS_VOICE_ID` | `EXAVITQu4vr4xnSDxMaL` | ID głosu (Sarah - darmowy premade) |
| `ELEVENLABS_TTS_MODEL`| `eleven_multilingual_v2` | Model TTS (`eleven_multilingual_v2` lub `eleven_turbo_v2_5`) |
| `ELEVENLABS_STT_MODEL`| `scribe_v2` | Model transkrypcji mowy (`scribe_v2`, `scribe_v1`, `web_speech`) |
