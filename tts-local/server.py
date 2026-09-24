"""Lokalny serwis TTS oparty na Chatterbox Multilingual (Resemble AI, licencja MIT).

Uruchomienie:  tts-local/.venv/bin/python tts-local/server.py
Głosy: pliki WAV/MP3/FLAC w tts-local/voices/ (10–30 s czystej mowy) -> identyfikator "local-<nazwa pliku>".
"""
import gc
import io
import os
import re
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path

import soundfile as sf
import torch
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from chatterbox.mtl_tts import ChatterboxMultilingualTTS

VOICES_DIR = Path(__file__).parent / "voices"
AUDIO_EXTENSIONS = {".wav", ".mp3", ".flac", ".ogg", ".m4a"}
DEFAULT_VOICE_ID = "local-default"
# Chatterbox generuje maks. ~40 s mowy na jedno wywołanie, więc dłuższy tekst dzielimy na fragmenty
MAX_CHUNK_CHARS = 280
PAUSE_BETWEEN_CHUNKS_SEC = 0.15


def pick_devices() -> list[str]:
    requested = os.getenv("CHATTERBOX_DEVICES")
    if requested:
        return [d.strip() for d in requested.split(",") if d.strip()]
    if torch.cuda.is_available():
        return ["cuda"]
    return ["cpu", "mps"] if torch.backends.mps.is_available() else ["cpu"]


def free_device_memory(device: str):
    gc.collect()
    if device == "mps":
        torch.mps.empty_cache()
    elif device == "cuda":
        torch.cuda.empty_cache()


class Engine:
    """Jeden model w pamięci naraz. Model zajmuje ~5 GB, więc CPU i MPS jednocześnie
    zapychały 16 GB RAM Maca aż do ~24 GB swapu i błędu "MPS backend out of memory".
    Zapytanie o inne urządzenie zwalnia bieżący model i ładuje nowy (~15 s)."""

    def __init__(self, devices: list[str]):
        self.devices = devices
        self.device = None
        self.model = None
        self.loading = None  # urządzenie, które właśnie się ładuje
        self.error = None
        self.default_conds = None
        self.voice_conds = {}  # voice_id -> (mtime, conds), żeby nie liczyć próbki głosu przy każdym zdaniu
        self.lock = threading.Lock()  # model nie jest bezpieczny wątkowo; chroni też przełączanie urządzeń

    def status(self) -> dict:
        statuses = {}
        for device in self.devices:
            if device == self.loading:
                statuses[device] = "loading"
            elif device == self.device and self.model is not None:
                statuses[device] = "ready"
            else:
                statuses[device] = "unloaded"
        return statuses

    def _load(self, device: str):
        # Wywoływane pod self.lock
        if self.device == device and self.model is not None:
            return
        if self.model is not None:
            previous = self.device
            print(f"♻️  Zwalnianie modelu z {previous}, przełączanie na {device}...")
            self.model = self.default_conds = None
            self.voice_conds = {}
            free_device_memory(previous)

        started = time.time()
        self.loading, self.error = device, None
        print(f"⏳ [{device}] Ładowanie Chatterbox Multilingual V3...")
        try:
            self.model = ChatterboxMultilingualTTS.from_pretrained(device=device, t3_model="v3")
            self.default_conds = self.model.conds
            self.device = device
            print(f"✅ [{device}] Model gotowy w {time.time() - started:.1f}s")
        except Exception as err:
            self.model, self.device, self.error = None, None, str(err)
            free_device_memory(device)
            raise HTTPException(status_code=503, detail=f"Nie udało się załadować modelu na {device}: {err}")
        finally:
            self.loading = None

    def load(self, device: str):
        with self.lock:
            self._load(device)

    def voice_path(self, voice_id: str):
        name = voice_id.removeprefix("local-")
        for file in VOICES_DIR.iterdir():
            if file.stem == name and file.suffix.lower() in AUDIO_EXTENSIONS:
                return file
        return None

    def use_voice(self, voice_id: str, exaggeration: float):
        if voice_id == DEFAULT_VOICE_ID:
            self.model.conds = self.default_conds
            return

        path = self.voice_path(voice_id)
        if path is None:
            raise HTTPException(status_code=404, detail=f"Nie znaleziono głosu {voice_id} w {VOICES_DIR}")

        mtime = path.stat().st_mtime
        cached = self.voice_conds.get(voice_id)
        if cached and cached[0] == mtime:
            self.model.conds = cached[1]
            return

        self.model.prepare_conditionals(str(path), exaggeration=exaggeration)
        self.voice_conds[voice_id] = (mtime, self.model.conds)

    def synthesize(self, device: str, text: str, voice_id: str, language: str, exaggeration: float, cfg_weight: float, temperature: float):
        with self.lock:
            self._load(device)
            self.use_voice(voice_id, exaggeration)
            pause = torch.zeros(1, int(self.model.sr * PAUSE_BETWEEN_CHUNKS_SEC))
            parts = []
            try:
                for chunk in split_text(text):
                    wav = self.model.generate(
                        chunk,
                        language_id=language,
                        exaggeration=exaggeration,
                        cfg_weight=cfg_weight,
                        temperature=temperature,
                    )
                    parts.extend([wav.cpu(), pause])
            except RuntimeError as err:
                if "out of memory" not in str(err):
                    raise
                raise HTTPException(status_code=503, detail=f"Brak pamięci na {device}. Zamknij inne aplikacje albo wybierz Chatterbox CPU.")
            finally:
                # MPS trzyma zwolnione bufory w cache i przy kolejnych zapytaniach rośnie aż do limitu
                free_device_memory(device)
            return torch.cat(parts[:-1], dim=-1), self.model.sr


def split_text(text: str):
    sentences = re.split(r"(?<=[.!?…])\s+", text.strip())
    chunks, current = [], ""
    for sentence in sentences:
        # Pojedyncze bardzo długie zdanie tniemy po przecinkach
        pieces = re.split(r"(?<=[,;:])\s+", sentence) if len(sentence) > MAX_CHUNK_CHARS else [sentence]
        for piece in pieces:
            if current and len(current) + len(piece) + 1 > MAX_CHUNK_CHARS:
                chunks.append(current)
                current = piece
            else:
                current = f"{current} {piece}".strip()
    if current:
        chunks.append(current)
    return chunks


engine = Engine(pick_devices())
DEFAULT_DEVICE = engine.devices[0]


@asynccontextmanager
async def lifespan(_app):
    VOICES_DIR.mkdir(exist_ok=True)
    # Domyślne urządzenie ładujemy od razu w tle, żeby pierwsze zdanie nie czekało na model
    threading.Thread(target=lambda: engine.load(DEFAULT_DEVICE), daemon=True).start()
    yield


app = FastAPI(title="Echo local TTS (Chatterbox)", lifespan=lifespan)


class TtsRequest(BaseModel):
    text: str
    voice: str = DEFAULT_VOICE_ID
    device: str | None = None
    language: str = "pl"
    exaggeration: float = Field(0.5, ge=0.0, le=2.0)
    cfg_weight: float = Field(0.5, ge=0.0, le=1.0)
    temperature: float = Field(0.8, ge=0.05, le=2.0)


@app.get("/health")
def health():
    statuses = engine.status()
    overall = "ok" if "ready" in statuses.values() else ("error" if engine.error else "loading")
    health = {"status": overall, "devices": statuses, "model": "chatterbox-multilingual-v3"}
    if engine.error:
        health["error"] = engine.error
    if engine.device == "mps":
        health["mps_allocated_gb"] = round(torch.mps.current_allocated_memory() / 1e9, 2)
    return health


@app.get("/voices")
def voices():
    result = [{"voice_id": DEFAULT_VOICE_ID, "name": "Domyślny"}]
    for file in sorted(VOICES_DIR.iterdir()):
        if file.suffix.lower() in AUDIO_EXTENSIONS:
            result.append({"voice_id": f"local-{file.stem}", "name": file.stem.replace("_", " ").replace("-", " ").title()})
    return {"voices": result}


@app.post("/tts")
def tts(req: TtsRequest):
    if not req.text.strip():
        raise HTTPException(status_code=400, detail='Pole "text" jest wymagane.')

    device = req.device or DEFAULT_DEVICE
    if device not in engine.devices:
        raise HTTPException(status_code=400, detail=f"Urządzenie {device} nie jest włączone (dostępne: {', '.join(engine.devices)})")

    started = time.time()
    wav, sr = engine.synthesize(device, req.text, req.voice, req.language, req.exaggeration, req.cfg_weight, req.temperature)
    buffer = io.BytesIO()
    sf.write(buffer, wav.squeeze(0).numpy(), sr, format="WAV", subtype="PCM_16")

    audio_sec = wav.shape[-1] / sr
    elapsed = time.time() - started
    print(f"🔊 [{device}] [{req.voice}] {len(req.text)} znaków -> {audio_sec:.1f}s audio w {elapsed:.1f}s (RTF {elapsed / max(audio_sec, 0.01):.2f})")
    return Response(content=buffer.getvalue(), media_type="audio/wav", headers={"X-Chatterbox-Device": device})


if __name__ == "__main__":
    uvicorn.run(app, host=os.getenv("LOCAL_TTS_HOST", "127.0.0.1"), port=int(os.getenv("LOCAL_TTS_PORT", "8001")))
