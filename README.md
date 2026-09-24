# echo

Rozmawiaj z AI głosem — po polsku, naturalnie, bez klikania. Mówisz, echo słucha, myśli i odpowiada na głos.

echo to lokalna aplikacja webowa, która łączy trzy klocki: **rozpoznawanie mowy**, **model językowy** i **syntezę głosu**. Każdy z nich możesz wybrać osobno spośród kilku dostawców (Google, OpenAI, Anthropic, ElevenLabs, Groq, Microsoft Edge). Głos może też powstawać w całości na Twoim komputerze dzięki otwartemu modelowi Chatterbox.

```
 🎙️ Twój głos ──► STT (mowa → tekst) ──► LLM (odpowiedź) ──► TTS (tekst → mowa) ──► 🔊 głos AI
```

---

## Spis treści

**Dla użytkowników**
- [Co potrafi](#co-potrafi)
- [Uruchomienie w 5 minut](#uruchomienie-w-5-minut)
- [Jakie klucze API są potrzebne](#jakie-klucze-api-są-potrzebne)
- [Jak korzystać](#jak-korzystać)
- [Wtyczka Chrome](#wtyczka-chrome)
- [Lokalny głos (Chatterbox)](#lokalny-głos-chatterbox)
- [Gdy coś nie działa](#gdy-coś-nie-działa)

**Dla deweloperów**
- [Architektura](#architektura)
- [Struktura projektu](#struktura-projektu)
- [API serwera](#api-serwera)
- [Rozpoznawanie dostawcy](#rozpoznawanie-dostawcy)
- [Fallbacki](#fallbacki)
- [Konfiguracja (.env)](#konfiguracja-env)
- [Dodawanie nowego dostawcy](#dodawanie-nowego-dostawcy)

---

# Dla użytkowników

## Co potrafi

- **Rozmowa głosowa** — naciśnij spację, powiedz coś, naciśnij ponownie. echo odpowie głosem. Możesz też pisać z klawiatury. Animowana sfera reaguje na Twój głos i głos asystenta, a wskaźnik pokazuje, na którym etapie jest odpowiedź (słuchanie → myślenie → mówienie).
- **Historia rozmowy** — pełna transkrypcja z informacją, który model odpowiedział, i przyciskiem ponownego odsłuchania.
- **Lektor** — wklej dowolny tekst (artykuł, notatkę), a echo przeczyta go na głos. Nagranie odtworzysz, przewiniesz i pobierzesz jako MP3. Ostatnie 10 nagrań zostaje w historii sesji.
- **Wtyczka Chrome** — zaznacz tekst na dowolnej stronie i posłuchaj go jednym skrótem.
- **Lokalny głos** — synteza mowy na Twoim Macu (Chatterbox), bez klucza API i bez limitów, z możliwością sklonowania głosu z krótkiego nagrania.
- **Wybór modeli** — w ustawieniach (⚙️) wybierasz osobno model rozpoznawania mowy, model AI, głos i silnik syntezy.
- **Odporność na awarie** — gdy wybrany głos jest niedostępny (np. brak kredytów), echo przełącza się na darmowy głos Edge zamiast milknąć.

## Uruchomienie w 5 minut

Potrzebujesz **Node.js 18 lub nowszego** i przeglądarki opartej na Chromium (Chrome, Edge, Arc, Brave).

```bash
# 1. Zainstaluj zależności
npm install

# 2. Utwórz plik z konfiguracją
cp .env.example .env

# 3. Wpisz w .env co najmniej jeden klucz (patrz niżej), np. GOOGLE_API_KEY

# 4. Uruchom
npm start
```

Otwórz **http://localhost:3000** i pozwól przeglądarce na dostęp do mikrofonu.

> Klucze możesz też wpisać w ustawieniach aplikacji (⚙️) zamiast w `.env`. Zostaną zapamiętane tylko w Twojej przeglądarce.

## Jakie klucze API są potrzebne

**Najprostszy start: jeden klucz Google.** Wystarcza do wszystkich trzech etapów (Gemini rozpoznaje mowę, odpowiada i mówi). Darmowy klucz wygenerujesz w [Google AI Studio](https://aistudio.google.com/apikey).

Pozostałe klucze są opcjonalne — dodaj je, jeśli chcesz korzystać z konkretnych modeli:

| Dostawca | Rozpoznawanie mowy | Model AI | Głos | Skąd wziąć klucz | Zmienna w `.env` |
|---|:---:|:---:|:---:|---|---|
| Google | ✅ Gemini | ✅ Gemini | ✅ Gemini, WaveNet | [aistudio.google.com](https://aistudio.google.com/apikey) | `GOOGLE_API_KEY` |
| OpenAI | ✅ GPT Transcribe, Whisper | ✅ GPT | ✅ 13 głosów | [platform.openai.com](https://platform.openai.com/api-keys) | `OPEN_API_KEY` |
| Anthropic | — | ✅ Claude | — | [console.anthropic.com](https://console.anthropic.com/settings/keys) | `ANTHROPIC_API_KEY` |
| ElevenLabs | ✅ Scribe | — | ✅ głosy studyjne | [elevenlabs.io](https://elevenlabs.io/app/settings/api-keys) | `ELEVENLABS_API_KEY` |
| Groq | ✅ Whisper (darmowy plan) | — | — | [console.groq.com](https://console.groq.com/keys) | `GROQ_API_KEY` |
| Przeglądarka / Edge | ✅ Web Speech | — | ✅ Marek, Zofia | **bez klucza** | — |
| Chatterbox (lokalnie) | — | — | ✅ własne głosy z próbki | **bez klucza** | `LOCAL_TTS_URL` |

Rozmowa zawsze wymaga klucza do **modelu AI** (Google, OpenAI lub Anthropic). Rozpoznawanie mowy (Web Speech) i głos (Edge: Marek, Zofia albo [lokalny Chatterbox](#lokalny-głos-chatterbox)) działają bez żadnego klucza.

## Jak korzystać

### Rozmowa

| Akcja | Jak |
|---|---|
| Zacznij / skończ mówić | **Spacja** albo przycisk mikrofonu |
| Napisz zamiast mówić | Pole tekstowe + **Enter** |
| Zmień modele i głos | ⚙️ w prawym górnym rogu |
| Zamknij ustawienia | **Esc** |

W ustawieniach możesz też zmienić **prompt systemowy**, czyli instrukcję, jak asystent ma się zachowywać. Domyślnie odpowiada krótko, w 1–3 zdaniach, i bez formatowania, bo wszystko jest czytane na głos.

**Głos a silnik syntezy:** *głos* to barwa i tożsamość (Marek, Nova, Sarah), *silnik* to model, który go generuje (Edge, gpt-4o-mini-tts, Eleven Multilingual, Chatterbox CPU/MPS). Po wybraniu głosu echo samo dobiera pasujący silnik.

### Lektor

Przejdź do zakładki **„Przeczytaj tekst”**, wklej tekst i kliknij przycisk syntezy. Licznik pokazuje liczbę znaków, słów i szacowany czas czytania.

| Akcja | Skrót |
|---|---|
| Odtwórz / pauza | **Spacja** |
| Przewiń o 5 s | **←** / **→** |

Prędkość odtwarzania ustawisz od 0,75× do 2×.

## Wtyczka Chrome

Wtyczka czyta na głos tekst zaznaczony na dowolnej stronie. Korzysta z Twojego serwera echo, więc musi on być uruchomiony.

**Instalacja**

1. Uruchom serwer: `npm start`.
2. Wejdź na `chrome://extensions` i włącz **Tryb dewelopera** (prawy górny róg).
3. Kliknij **Załaduj rozpakowane** i wskaż folder `extension/`.

**Użycie**

- zaznacz tekst → prawy przycisk myszy → **Przeczytaj z Echo**,
- albo skrót **Alt+Shift+R** (zatrzymanie: **Alt+Shift+S**),
- albo ikona wtyczki → **Przeczytaj zaznaczenie**.

W okienku wtyczki wybierzesz głos, silnik i prędkość, wstrzymasz lub zatrzymasz czytanie. Kropka w rogu pokazuje, czy serwer odpowiada (zielona) czy nie (czerwona). Skróty zmienisz w `chrome://extensions/shortcuts`.

Długie teksty są czytane kawałkami: pierwszy fragment jest krótki, żeby lektor zaczął od razu, a kolejne generują się w tle, zanim skończy się bieżący.

## Lokalny głos (Chatterbox)

echo może mówić głosem generowanym w całości na Twoim komputerze, bez klucza API i bez limitów. Używa otwartego modelu [Chatterbox Multilingual V3](https://github.com/resemble-ai/chatterbox) (licencja MIT), który obsługuje polski i potrafi sklonować głos z krótkiej próbki. Model działa w osobnym serwisie w Pythonie (`tts-local/`), obok serwera echo.

**Wymagania:** Python 3.11, około 5 GB miejsca na dysku (środowisko i model) oraz około 5 GB wolnego RAM.

### Uruchomienie

```bash
npm run tts-local:setup   # jednorazowo: venv + instalacja (kilka minut)
npm run tts-local         # w osobnym terminalu, obok npm start
```

Pierwszy start pobiera model z Hugging Face (około 3 GB). Serwis nasłuchuje na `http://127.0.0.1:8001`. Jego stan sprawdzisz tak:

```bash
curl localhost:8001/health
# {"status":"ok","devices":{"cpu":"ready","mps":"unloaded"},"model":"chatterbox-multilingual-v3"}
```

Gdy serwis działa, odśwież stronę echo. W ustawieniach (⚙️) pojawi się grupa **Głosy lokalne (Chatterbox)**. Lista głosów jest pobierana przy ładowaniu strony, więc serwis uruchomiony później wymaga odświeżenia.

### CPU czy MPS

W polu **Model syntezy** są dwa warianty tego samego modelu:

| Silnik | Gdzie liczy | Szybkość na M4 (czas generowania / długość nagrania) |
|---|---|---|
| **Chatterbox CPU** | procesor | około 2,8× |
| **Chatterbox MPS** | GPU Apple | około 4–5× |

Na M4 CPU jest szybszy, więc to on jest domyślny. Zdanie na 4 s to około 12 s czekania na CPU. Do Lektora wystarcza, w rozmowie odpowiedź jest wyraźnie opóźniona.

W pamięci jest zawsze **tylko jeden wariant** (około 5 GB). Po starcie serwis ładuje CPU. Wybranie drugiego wariantu zwalnia pierwszy i ładuje nowy, co dodaje około 10 s do pierwszego zdania po zmianie. Dwa modele naraz nie mieszczą się w 16 GB RAM: system zaczyna intensywnie używać swapu, a MPS zgłasza „out of memory”. `/health` pokazuje, który wariant jest załadowany (`ready`), a który zwolniony (`unloaded`).

Żeby ograniczyć serwis do jednego wariantu:

```bash
CHATTERBOX_DEVICES=cpu npm run tts-local
```

Na komputerze z kartą NVIDIA serwis używa tylko CUDA.

### Własny głos

Wrzuć nagranie do `tts-local/voices/`. Nazwa pliku staje się nazwą głosu: `jan_kowalski.wav` pojawi się jako „Jan Kowalski” (identyfikator `local-jan_kowalski`). Wystarczy odświeżyć stronę, restart serwisu nie jest potrzebny. Podmieniony plik zostanie przeliczony automatycznie.

Jakość próbki wpływa na wynik bardziej niż cokolwiek innego:

- 10–30 s mowy jednej osoby, po polsku, w stylu, jakiego oczekujesz (model odtwarza też tempo i emocje);
- bez muzyki, szumu i pogłosu, mikrofon blisko ust;
- najpewniej WAV; MP3, FLAC, OGG i M4A też działają.

```bash
# Nagranie z QuickTime (Plik → Nowe nagranie audio) do WAV
afconvert -f WAVE -d LEI16@24000 -c 1 nagranie.m4a tts-local/voices/lektor.wav

# Wycięcie 20 s od 5. sekundy z dłuższego nagrania (wymaga ffmpeg)
ffmpeg -i wywiad.mp3 -ss 5 -t 20 -ac 1 -ar 24000 tts-local/voices/lektor.wav
```

Próbki nie trafiają do repozytorium (`.gitignore`). Klonuj tylko swój głos albo głos osoby, która się na to zgodziła. Nie używaj nagrań z komercyjnych serwisów TTS (np. ElevenLabs) — ich regulaminy tego zabraniają.

## Gdy coś nie działa

| Objaw | Co zrobić |
|---|---|
| Przeglądarka nie pyta o mikrofon | Otwórz aplikację przez `http://localhost:3000` — mikrofon działa tylko na `localhost` lub `https`. |
| „Wymaga klucza API” w nagłówku | Brakuje klucza do wybranego modelu. Sprawdź tabelę kluczy i ustawienia (⚙️). Klucz z `.env` jest oznaczony jako „Aktywny w .env”. |
| Słychać inny głos niż wybrany | Wybrany dostawca zwrócił błąd (np. brak kredytów), więc echo użyło głosu Edge. Powód jest w konsoli serwera. |
| „You have no credits remaining” | Konto OpenAI nie ma środków. Doładuj je albo wybierz innego dostawcę. |
| Wtyczka: „Brak połączenia z serwerem Echo” | Uruchom `npm start`. Jeśli serwer działa pod innym adresem, zmień go w wtyczce w sekcji **Serwer i klucze API**. |
| Wtyczka: „Nie zaznaczono tekstu” | Na stronach `chrome://` i w Chrome Web Store wtyczki nie mają dostępu do treści — to ograniczenie przeglądarki. |
| Puste pole „Głos lektora” po wybraniu Chatterboxa | Serwis `tts-local` nie działał, gdy strona się ładowała. Uruchom `npm run tts-local` i odśwież stronę. |
| Zamiast Chatterboxa słychać Marka (Edge) | Serwis `tts-local` nie działa albo wybrany wariant (np. MPS) nie jest włączony. Powód jest w konsoli serwera echo; stan wariantów pokazuje `curl localhost:8001/health`. |
| Pierwsze zdanie po zmianie CPU ↔ MPS trwa dłużej | Serwis zwalnia jeden wariant i ładuje drugi (około 10 s). Kolejne zdania mają już normalną szybkość. |
| „MPS backend out of memory” albo Mac mocno zwalnia | Za mało wolnej pamięci. Zamknij inne aplikacje albo zostań przy Chatterbox CPU. Pamięć GPU pokazuje `mps_allocated_gb` w `/health`. |
| Web Speech nie rozpoznaje mowy | Web Speech API działa tylko w przeglądarkach opartych na Chromium i wymaga internetu. |

---

# Dla deweloperów

## Architektura

```
┌──────────────────────┐      ┌───────────────────────────────┐      ┌──────────────────────┐
│  public/ (SPA)       │      │  server.js (Express)          │      │  Dostawcy            │
│  index.html, app.js  │─────►│  /api/stt   → routing modelu  │─────►│  Google, OpenAI,     │
│                      │      │  /api/chat  → routing modelu  │      │  Anthropic, Groq,    │
│  extension/ (MV3)    │─────►│  /api/tts   → routing głosu   │      │  ElevenLabs, Edge    │
└──────────────────────┘      └───────────────┬───────────────┘      └──────────────────────┘
                                              │ głosy local-*
                                              ▼
                              ┌───────────────────────────────┐
                              │  tts-local/server.py (FastAPI)│
                              │  Chatterbox na CPU / MPS      │
                              │  http://127.0.0.1:8001        │
                              └───────────────────────────────┘
```

- **Serwer** (`server.js`) to cienkie proxy: przyjmuje zapytanie, na podstawie identyfikatora modelu lub głosu wybiera dostawcę, wywołuje jego API i zwraca wynik w ujednoliconym formacie. Klucze z `.env` nigdy nie trafiają do przeglądarki.
- **Frontend** (`public/`) to jedna strona bez frameworka i bez kroku budowania. Ustawienia i klucze wpisane przez użytkownika trzyma w `localStorage`.
- **Wtyczka** (`extension/`) korzysta z tego samego `/api/tts` co lektor.
- **Lokalny TTS** (`tts-local/`) to osobny, opcjonalny serwis w Pythonie. Serwer echo odpytuje go przez HTTP tylko dla głosów `local-*`. Gdy serwis nie działa, lista głosów po prostu go pomija, a synteza przechodzi na Edge.

Aplikacja to zwykły JavaScript (ES modules), bez TypeScriptu, bundlera i testów automatycznych. Jedynym kodem w Pythonie jest opcjonalny `tts-local/`.

```bash
npm start      # node server.js
npm run dev    # node --watch server.js (restart po zmianach)
npm run tts-local:setup   # venv Pythona 3.11 + zależności z tts-local/requirements.txt
npm run tts-local         # lokalny serwis Chatterbox na porcie 8001
```

## Struktura projektu

```
server.js              # cały backend: endpointy, integracje z dostawcami, fallbacki
public/
  index.html           # widoki: rozmowa, lektor, panel ustawień
  app.js               # logika UI: nagrywanie, pipeline, lektor, historia, ustawienia
  style.css
extension/             # wtyczka Chrome (Manifest V3)
  manifest.json
  background.js        # service worker: menu kontekstowe, skróty, pobranie zaznaczenia
  offscreen.js         # odtwarzanie audio + kolejka fragmentów z prefetchem
  chunker.js           # dzielenie tekstu na fragmenty (Intl.Segmenter)
  popup.html/.js/.css  # okienko: głos, silnik, prędkość, sterowanie
  shared.js            # domyślne ustawienia, dopasowanie głos → silnik
tts-local/             # lokalny serwis TTS (Python, FastAPI + Chatterbox)
  server.py            # /health, /voices, /tts; jeden model w pamięci, przełączany CPU ↔ MPS
  requirements.txt     # Chatterbox przypięty do commita z GitHuba (PyPI nie ma jeszcze V3)
  voices/              # próbki głosów do klonowania (poza gitem)
.env.example           # wzorzec konfiguracji (ta sama struktura co .env)
```

## API serwera

Każdy endpoint przyjmuje klucze w nagłówkach, które mają pierwszeństwo przed `.env`:

| Nagłówek | Dostawca |
|---|---|
| `x-google-key` (alias `x-gemini-key`) | Google |
| `x-openai-key` | OpenAI |
| `x-anthropic-key` | Anthropic |
| `x-elevenlabs-key` | ElevenLabs |
| `x-groq-key` | Groq |

Odpowiedzi STT, czatu i TTS zawierają nagłówki `X-Duration-Ms` i `X-Duration-Sec` z czasem przetwarzania.

### `GET /api/status`

Informuje, które klucze są ustawione w `.env` (bez ich wartości), oraz zwraca domyślne modele.

```json
{ "status": "ok", "hasEnvGoogle": true, "hasEnvOpenAI": false, "hasEnvAnthropic": true,
  "hasEnvElevenLabs": false, "hasEnvGroq": true,
  "defaults": { "voiceId": "...", "ttsModel": "...", "sttModel": "...", "aiModel": "..." } }
```

### `GET /api/models`

Lista modeli AI pogrupowana według dostawców. Jeśli jest klucz, listy Google i Anthropic są pobierane na żywo z API, a lista OpenAI jest zawężana do modeli dostępnych dla klucza. Bez klucza zwracane są listy domyślne. `/api/claude-models` to alias zachowany dla zgodności.

```json
{ "googleModels": [...], "claudeModels": [...], "openaiModels": [...], "models": [...] }
```

### `GET /api/voices`

Głosy Google/Edge, OpenAI, lokalne (`category: "local"`, tylko gdy działa `tts-local`) i ElevenLabs. Z kluczem ElevenLabs zwraca też własne głosy z konta.

```json
{ "voices": [{ "voice_id": "openai-marin", "name": "Marin (...)", "category": "openai" }] }
```

### `POST /api/stt` — mowa na tekst

`multipart/form-data`:

| Pole | Opis |
|---|---|
| `audio` | plik audio (webm, mp3, wav, m4a; maks. 25 MB) |
| `model_id` | np. `gemini-3.5-transcribe`, `gpt-transcribe`, `whisper-1`, `whisper-large-v3-turbo`, `scribe_v2` |
| `language_code` | domyślnie `pl`; `auto` włącza autodetekcję |

```json
{ "text": "Dzień dobry", "model": "gpt-transcribe", "provider": "openai", "language_code": "pl", "duration_ms": 812 }
```

### `POST /api/chat` — odpowiedź modelu

```json
{ "model": "gpt-5.6-luna",
  "messages": [{ "role": "user", "content": "Cześć!" }],
  "systemPrompt": "opcjonalnie — nadpisuje domyślny prompt" }
```

```json
{ "text": "Cześć! W czym mogę pomóc?", "model": "gpt-5.6-luna", "provider": "openai",
  "fallbackUsed": false, "originalModelRequested": "gpt-5.6-luna", "usage": {...}, "duration_ms": 1830 }
```

Domyślny prompt systemowy każe odpowiadać krótko i bez Markdownu, bo odpowiedź jest czytana przez syntezator.

### `POST /api/tts` — tekst na mowę

```json
{ "text": "Tekst do przeczytania", "voiceId": "openai-marin", "modelId": "gpt-4o-mini-tts" }
```

Dla lokalnego Chatterboxa: `"voiceId": "local-default"` (albo `local-<nazwa pliku>`) i `"modelId": "chatterbox-cpu"` lub `"chatterbox-mps"`.

Zwraca plik audio (`audio/mpeg`, a dla Gemini TTS i Chatterboxa `audio/wav`) oraz nagłówki:

| Nagłówek | Znaczenie |
|---|---|
| `X-TTS-Method` | dostawca i model, który faktycznie wygenerował audio |
| `X-TTS-Fallback-Reason` | powód fallbacku (URL-encoded); brak nagłówka = bez fallbacku |

### Serwis `tts-local` (port 8001)

Wywoływany przez `server.js`, ale można go odpytywać bezpośrednio.

| Endpoint | Opis |
|---|---|
| `GET /health` | stan każdego wariantu: `ready`, `loading` albo `unloaded`; przy MPS także `mps_allocated_gb` |
| `GET /voices` | `local-default` (wbudowany głos modelu) i pliki z `tts-local/voices/` |
| `POST /tts` | zwraca `audio/wav` (24 kHz, mono) i nagłówek `X-Chatterbox-Device` |

```json
{ "text": "Dzień dobry", "voice": "local-default", "device": "cpu", "language": "pl",
  "exaggeration": 0.5, "cfg_weight": 0.5, "temperature": 0.8 }
```

Tylko `text` jest wymagany. `exaggeration` wzmacnia ekspresję, `cfg_weight` wierność próbce i tempo. echo wysyła na razie tylko `text`, `voice`, `device` i `language`. Tekst dłuższy niż około 280 znaków jest dzielony po zdaniach, a fragmenty sklejane z krótką pauzą.

## Rozpoznawanie dostawcy

Serwer nie przyjmuje osobnego pola „provider” — wybiera dostawcę na podstawie konwencji w identyfikatorach. **To najważniejsza rzecz do zapamiętania przy dodawaniu modeli.**

| Etap | Identyfikator | Dostawca |
|---|---|---|
| STT | `gemini-*`, `web_speech` | Google |
| STT | `whisper-large*` | Groq |
| STT | `whisper-1`, `gpt-*transcribe*` | OpenAI |
| STT | pozostałe (`scribe_*`) | ElevenLabs |
| Czat | zawiera `gemini` lub `gemma` | Google |
| Czat | `gpt-*`, `chatgpt-*`, `o<cyfra>*` | OpenAI |
| Czat | pozostałe | Anthropic |
| Głos | `google-gemini-*` | Gemini TTS |
| Głos | `pl-PL-Wavenet-*` | Google Cloud WaveNet |
| Głos | `pl-PL-MarekNeural`, `pl-PL-ZofiaNeural` | Edge Neural (bez klucza) |
| Głos | `openai-<nazwa>` | OpenAI TTS |
| Głos | `local-<nazwa pliku>` | lokalny Chatterbox (`tts-local/`) |
| Silnik | `chatterbox-cpu`, `chatterbox-mps` | urządzenie, na którym liczy Chatterbox (tylko dla głosów `local-*`) |
| Głos | pozostałe | ElevenLabs (ID głosu) |

Te same reguły są zaimplementowane w trzech miejscach, które trzeba zmieniać razem: funkcje pomocnicze na początku `server.js`, na początku `public/app.js` oraz `modelsForVoice()` w `extension/shared.js`.

## Fallbacki

| Etap | Zachowanie przy błędzie |
|---|---|
| Czat — Gemini | przy każdym błędzie próbuje kolejno `gemini-3.6-flash` → `gemini-flash-latest` → `gemini-3.8-flash` → `gemini-2.5-pro` |
| Czat — Claude | przy 404 (brak modelu) przechodzi na kolejny model Claude |
| Czat — OpenAI | przy `model_not_found` przechodzi na kolejny model z listy domyślnej |
| STT — ElevenLabs | bez klucza ElevenLabs używa Gemini (jeśli jest klucz Google) |
| STT — OpenAI | jeśli model odrzuci parametr `language`, ponawia z autodetekcją |
| TTS — Chatterbox | serwis wyłączony, wariant niewłączony, brak pamięci albo błąd modelu → Edge Neural; powód trafia do `X-TTS-Fallback-Reason` |
| TTS — dowolny | przy błędzie generuje audio głosem Edge Neural dopasowanym płcią; powód trafia do `X-TTS-Fallback-Reason` |

Modele OpenAI z rodziny rozumującej (`gpt-5*`, `gpt-6*`, `o*`) dostają `reasoning_effort: low` i nie dostają `temperature`, której nie obsługują. Tekst dla OpenAI TTS dłuższy niż 4000 znaków jest dzielony po zdaniach, a pliki MP3 są sklejane.

## Konfiguracja (.env)

`.env` i `.env.example` mają tę samą strukturę — przy dodawaniu zmiennej aktualizuj oba pliki. Wartości zaczynające się od `twoj_klucz` są traktowane jak brak klucza.

| Zmienna | Domyślnie | Opis |
|---|---|---|
| `PORT` | `3000` | port serwera |
| `GOOGLE_API_KEY` / `GEMINI_API_KEY` | — | klucz Google (wystarczy jeden z nich) |
| `OPEN_API_KEY` / `OPENAI_API_KEY` | — | klucz OpenAI (obie nazwy działają) |
| `ANTHROPIC_API_KEY` | — | klucz Anthropic |
| `ELEVENLABS_API_KEY` | — | klucz ElevenLabs |
| `GROQ_API_KEY` | — | klucz Groq |
| `AI_MODEL` | `gemini-3.6-flash` | model czatu, gdy zapytanie go nie podaje (`CLAUDE_MODEL` to starszy alias) |
| `STT_MODEL` | `gemini-3.5-transcribe` | model rozpoznawania mowy, gdy zapytanie go nie podaje |
| `VOICE_ID` | `google-gemini-neural` | domyślny głos |
| `TTS_MODEL` | `gemini-2.5-flash-preview-tts` | domyślny silnik syntezy |
| `ELEVENLABS_VOICE_ID` | `EXAVITQu4vr4xnSDxMaL` | głos ElevenLabs, gdy wybrano model `eleven_*` bez głosu ElevenLabs |
| `ELEVENLABS_TTS_MODEL` | `eleven_multilingual_v2` | model ElevenLabs, gdy wybrano głos ElevenLabs bez modelu |
| `ELEVENLABS_STT_MODEL` | `scribe_v2` | starszy alias dla `STT_MODEL` |
| `LOCAL_TTS_URL` | `http://127.0.0.1:8001` | adres serwisu `tts-local` |

Serwis `tts-local` nie czyta `.env`. Jego zmienne ustawiasz przy uruchomieniu, np. `CHATTERBOX_DEVICES=cpu npm run tts-local`:

| Zmienna | Domyślnie | Opis |
|---|---|---|
| `CHATTERBOX_DEVICES` | `cpu,mps` na Macu, `cuda` z kartą NVIDIA | dozwolone warianty, oddzielone przecinkami; pierwszy ładuje się na starcie, w pamięci jest zawsze jeden |
| `LOCAL_TTS_HOST` | `127.0.0.1` | adres nasłuchu serwisu |
| `LOCAL_TTS_PORT` | `8001` | port serwisu |

Pełna lista dostępnych wartości jest w komentarzach w `.env.example`.

## Dodawanie nowego dostawcy

Na przykładzie integracji OpenAI (dostawca z własnym serwisem lokalnym, bez klucza, jest opisany w `tts-local/` i funkcjach `fetchLocalVoices()` / `synthesizeWithLocal()` w `server.js`):

1. **Klucz** — dodaj funkcję `get<Dostawca>Key(req)` w `server.js` (nagłówek `x-<dostawca>-key` → `.env`) i flagę `hasEnv<Dostawca>` w `/api/status`.
2. **Konwencja nazw** — wybierz identyfikatory, które nie kolidują z istniejącymi regułami (patrz [Rozpoznawanie dostawcy](#rozpoznawanie-dostawcy)). Głosy ElevenLabs to „wszystko inne”, więc nowe głosy potrzebują własnego prefiksu.
3. **Endpointy** — dodaj gałąź w `/api/stt`, `/api/chat` lub `/api/tts` *przed* gałęzią domyślną i zwracaj ten sam format odpowiedzi co pozostali dostawcy.
4. **Listy** — dopisz modele do `/api/models` lub głosy do `/api/voices` oraz statyczne `<option>` w `public/index.html` (widoczne, zanim lista załaduje się z API).
5. **Frontend** — w `public/app.js`: stan klucza (`state.keys`, `localStorage`), pole w ustawieniach, nagłówek w każdym `fetch`, sprawdzanie klucza w `updateApiStatusBadge()` i `startRecording()`, nazwy w `get*Name()` i dopasowanie w `syncVoiceAndTtsModel()`.
6. **Wtyczka** — przy nowych głosach zaktualizuj `extension/shared.js` (głosy zapasowe i `modelsForVoice()`) oraz pole klucza w `popup.html`/`popup.js`.
7. **Konfiguracja** — dodaj zmienną do `.env.example` i `.env` oraz do tabeli w tym README.
