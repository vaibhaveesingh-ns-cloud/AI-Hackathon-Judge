from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

import asyncio
import json
import logging
import os
import tempfile
from datetime import datetime

from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    BadRequestError,
    OpenAI,
    RateLimitError,
)
import ffmpeg

from .analysis_service import run_analysis_and_store

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
TRANSCRIPTION_MODEL = os.getenv("OPENAI_TRANSCRIPTION_MODEL", "whisper-1").strip()
openai_client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None

logger = logging.getLogger(__name__)

SUPPORTED_AUDIO_EXTENSIONS = {
    ".flac",
    ".m4a",
    ".mp3",
    ".mp4",
    ".mpeg",
    ".mpga",
    ".oga",
    ".ogg",
    ".wav",
    ".webm",
}

SESSION_DATA_DIR = Path(os.getenv("SESSION_DATA_DIR", "data/sessions"))


def _ensure_session_directory(session_id: str) -> Path:
    session_dir = SESSION_DATA_DIR / session_id
    session_dir.mkdir(parents=True, exist_ok=True)
    return session_dir


async def _persist_upload(upload: UploadFile, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    chunk_size = 1024 * 1024
    with destination.open("wb") as buffer:
        while True:
            chunk = await upload.read(chunk_size)
            if not chunk:
                break
            buffer.write(chunk)


def _write_metadata(session_dir: Path, role: str, start_ms: int, duration_ms: int, filename: str) -> None:
    metadata_path = session_dir / "metadata.json"
    payload = {}
    if metadata_path.exists():
        try:
            payload = json.loads(metadata_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            payload = {}
    payload.setdefault("videos", {})[role] = {
        "filename": filename,
        "startMs": start_ms,
        "durationMs": duration_ms,
        "uploadedAt": datetime.utcnow().isoformat() + "Z",
    }
    metadata_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    # Initialize shared resources here (database connections, queues, etc.)
    # Example: await some_async_init()
    yield
    # Cleanup resources here
    # Example: await some_async_cleanup()


def create_app() -> FastAPI:
    app = FastAPI(title="AI Hackathon Judge API", version="0.1.0", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health", tags=["health"])
    async def health_check() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/transcribe", tags=["transcription"])
    async def transcribe_audio(
        audio: UploadFile = File(...),
        start_ms: int = Form(0),
        duration_ms: int = Form(0),
    ) -> JSONResponse:
        if openai_client is None:
            raise HTTPException(status_code=500, detail="OpenAI API key is not configured on the server.")

        if not TRANSCRIPTION_MODEL:
            raise HTTPException(status_code=500, detail="Transcription model is not configured on the server.")

        if audio.content_type is None or not audio.content_type.startswith("audio"):
            raise HTTPException(status_code=400, detail="Uploaded file must be an audio clip.")

        audio_bytes = await audio.read()
        if not audio_bytes:
            raise HTTPException(status_code=400, detail="Uploaded audio file is empty.")

        original_name = Path(audio.filename).name if audio.filename else "chunk.webm"
        original_suffix = Path(original_name).suffix.lower()
        if original_suffix not in SUPPORTED_AUDIO_EXTENSIONS:
            original_suffix = ".webm"

        with tempfile.NamedTemporaryFile(delete=False, suffix=original_suffix) as src_file:
            src_file.write(audio_bytes)
            src_path = Path(src_file.name)

        processed_path = src_path
        cleanup_paths = [src_path]

        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as dst_file:
                dst_path = Path(dst_file.name)
            cleanup_paths.append(dst_path)
            (
                ffmpeg
                .input(str(src_path))
                .output(
                    str(dst_path),
                    format="wav",
                    acodec="pcm_s16le",
                    ac=1,
                    ar=16000,
                )
                .overwrite_output()
                .run(quiet=True)
            )
            processed_path = dst_path
        except Exception as conversion_error:  # pragma: no cover - diagnostic logging only
            logger.warning("Audio conversion to WAV failed", exc_info=conversion_error)

        def run_transcription() -> object:
            with processed_path.open("rb") as buf:
                return openai_client.audio.transcriptions.create(
                    model=TRANSCRIPTION_MODEL,
                    file=buf,
                    response_format="verbose_json",
                    temperature=0,
                )

        transcription = None
        try:
            transcription = await asyncio.to_thread(run_transcription)
        except BadRequestError as exc:
            message = getattr(exc, "message", str(exc))
            logger.warning("Transcription request rejected: %s", message)
            raise HTTPException(
                status_code=400,
                detail=f"Transcription request was rejected by the speech-to-text service: {message}",
            ) from exc
        except RateLimitError as exc:
            message = getattr(exc, "message", str(exc))
            logger.warning("Transcription rate limited: %s", message)
            raise HTTPException(
                status_code=429,
                detail=f"Speech-to-text rate limit reached. Please retry: {message}",
            ) from exc
        except (APIConnectionError, APITimeoutError) as exc:
            message = getattr(exc, "message", str(exc))
            logger.warning("Transient transcription failure: %s", message)
            raise HTTPException(
                status_code=502,
                detail="Transcription failed while contacting the speech-to-text service. Please retry.",
            ) from exc
        except APIStatusError as exc:
            message = getattr(exc, "message", str(exc))
            logger.exception("Transcription service returned an error: %s", message)
            status_code = exc.status_code or 502
            if status_code < 400 or status_code >= 600:
                status_code = 502
            raise HTTPException(
                status_code=status_code,
                detail=f"Transcription service returned an error response: {message}",
            ) from exc
        except Exception as exc:  # pragma: no cover - surface upstream errors
            logger.exception("Unexpected transcription failure")
            raise HTTPException(
                status_code=502,
                detail="Transcription failed while contacting the speech-to-text service.",
            ) from exc
        finally:
            for path in cleanup_paths:
                path.unlink(missing_ok=True)

        combined_text = (getattr(transcription, "text", "") or "").strip()
        raw_segments = getattr(transcription, "segments", None) or []

        def _segment_value(segment: object, key: str, default: object = 0) -> object:
            if isinstance(segment, dict):
                return segment.get(key, default)
            return getattr(segment, key, default)

        segments: list[dict[str, object]] = []
        for segment in raw_segments:
            seg_start_val = _segment_value(segment, "start", 0)
            seg_end_val = _segment_value(segment, "end", 0)
            seg_text_val = _segment_value(segment, "text", "")

            try:
                seg_start = int(float(seg_start_val) * 1000)
            except (TypeError, ValueError):
                seg_start = 0

            try:
                seg_end = int(float(seg_end_val) * 1000)
            except (TypeError, ValueError):
                seg_end = 0

            segments.append(
                {
                    "startMs": start_ms + seg_start,
                    "endMs": start_ms + (seg_end if seg_end > 0 else duration_ms),
                    "text": (str(seg_text_val) if seg_text_val is not None else "").strip(),
                }
            )

        if not segments and combined_text:
            fallback_duration = duration_ms if duration_ms > 0 else max(len(combined_text.split()) * 350, 1_000)
            segments.append(
                {
                    "startMs": start_ms,
                    "endMs": start_ms + fallback_duration,
                    "text": combined_text,
                }
            )

        return JSONResponse({"text": combined_text, "segments": segments})

    @app.post("/sessions/{session_id}/videos", tags=["sessions"])
    async def upload_session_video(
        session_id: str,
        background_tasks: BackgroundTasks,
        video: UploadFile = File(...),
        role: str = Form(...),
        start_ms: int = Form(0),
        duration_ms: int = Form(0),
    ) -> JSONResponse:
        valid_roles = {"presenter", "audience"}
        if role not in valid_roles:
            raise HTTPException(status_code=400, detail="role must be 'presenter' or 'audience'")

        if not video.content_type or "video" not in video.content_type:
            raise HTTPException(status_code=400, detail="Uploaded file must be a video clip.")

        session_dir = _ensure_session_directory(session_id)

        suffix = Path(video.filename or f"{role}.webm").suffix or ".webm"
        target_path = session_dir / f"{role}{suffix}"

        await _persist_upload(video, target_path)
        _write_metadata(session_dir, role, start_ms, duration_ms, target_path.name)

        analysis_path = session_dir / "analysis.json"
        if analysis_path.exists():
            analysis_path.unlink(missing_ok=True)

        queue_analysis = role == "presenter"
        if queue_analysis:
            background_tasks.add_task(run_analysis_and_store, session_id, session_dir)

        return JSONResponse(
            {
                "status": "stored",
                "analysisQueued": queue_analysis,
            }
        )

    @app.get("/sessions/{session_id}/analysis", tags=["sessions"])
    async def get_session_analysis(session_id: str) -> JSONResponse:
        session_dir = SESSION_DATA_DIR / session_id
        analysis_path = session_dir / "analysis.json"
        if not analysis_path.exists():
            raise HTTPException(status_code=404, detail="Analysis not available yet.")

        try:
            payload = json.loads(analysis_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=500, detail="Stored analysis is corrupted.") from exc

        return JSONResponse(payload)

    return app


app = create_app()
