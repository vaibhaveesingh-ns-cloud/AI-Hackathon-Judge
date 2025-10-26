from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

import asyncio
import io
import json
import logging
import os
import tempfile
from datetime import datetime

import httpx
import websockets
from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, UploadFile, File, Form, HTTPException, WebSocket, WebSocketDisconnect
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
from starlette.websockets import WebSocketState
from websockets.exceptions import ConnectionClosed, InvalidStatusCode

from .analysis_service import run_analysis_and_store

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
TRANSCRIPTION_MODEL = os.getenv("OPENAI_TRANSCRIPTION_MODEL", "whisper-1").strip()
REALTIME_MODEL = os.getenv("OPENAI_REALTIME_TRANSCRIBE_MODEL", "gpt-4o-mini-transcribe").strip()
REALTIME_SESSION_ENDPOINT = "https://api.openai.com/v1/realtime/sessions"
REALTIME_WS_URL = "wss://api.openai.com/v1/realtime?intent=transcription"
REALTIME_SESSION_MAX_ATTEMPTS = 3
REALTIME_CONNECTIVITY_TEST_URL = "https://api.openai.com/v1/models?limit=1"
REALTIME_LANGUAGE = os.getenv("OPENAI_REALTIME_LANGUAGE", "").strip()
openai_client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None

logger = logging.getLogger(__name__)

SESSION_DATA_DIR = Path(os.getenv("SESSION_DATA_DIR", "data/sessions"))
SUPPORTED_AUDIO_EXTENSIONS = {
    ".webm",
    ".wav",
    ".mp3",
    ".mpeg",
    ".mpga",
    ".m4a",
    ".mp4",
}


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

    async def _create_realtime_session_token() -> dict[str, object]:
        if openai_client is None:
            raise HTTPException(status_code=500, detail="OpenAI API key is not configured on the server.")
        if not REALTIME_MODEL:
            raise HTTPException(status_code=500, detail="Realtime transcription model is not configured on the server.")

        headers = {
            "Authorization": f"Bearer {OPENAI_API_KEY}",
            "Content-Type": "application/json",
            "OpenAI-Beta": "realtime=v1",
        }
        payload = {
            "model": REALTIME_MODEL,
            "input_audio_format": "pcm16",
            "turn_detection": {
                "type": "server_vad",
                "threshold": 0.5,
                "prefix_padding_ms": 300,
                "silence_duration_ms": 500,
            },
            "input_audio_transcription": {
                "model": REALTIME_MODEL,
                "prompt": "",
            },
        }

        if REALTIME_LANGUAGE:
            payload["input_audio_transcription"]["language"] = REALTIME_LANGUAGE

        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(REALTIME_SESSION_ENDPOINT, headers=headers, json=payload)

        if response.status_code != 200:
            logger.error("Realtime session creation failed: %s", response.text)
            raise HTTPException(status_code=502, detail="Failed to create realtime transcription session.")

        body = response.json()
        client_secret = body.get("client_secret")
        expires_at = body.get("expires_at")
        session_id = body.get("id")
        if not client_secret:
            logger.error("Realtime session response missing client_secret: %s", body)
            raise HTTPException(status_code=502, detail="Realtime session response missing client secret.")

        return {
            "token": client_secret,
            "expires_at": expires_at,
            "session_id": session_id,
        }

    @app.post("/realtime/token", tags=["transcription"])
    async def get_realtime_token() -> JSONResponse:
        payload = await _create_realtime_session_token()
        return JSONResponse(payload)

    @app.websocket("/realtime/ws")
    async def realtime_proxy(websocket: WebSocket) -> None:
        token = websocket.query_params.get("token")
        if not token:
            await websocket.close(code=1008)
            return

        await websocket.accept()

        headers = {
            "Authorization": f"Bearer {token}",
            "OpenAI-Beta": "realtime=v1",
        }

        try:
            async with websockets.connect(REALTIME_WS_URL, additional_headers=headers, max_size=None) as upstream:
                async def _forward_client_to_openai() -> None:
                    while True:
                        try:
                            message = await websocket.receive()
                        except WebSocketDisconnect:
                            await upstream.close()
                            break

                        msg_type = message["type"]
                        if msg_type == "websocket.disconnect":
                            await upstream.close()
                            break
                        if msg_type == "websocket.receive":
                            if "text" in message and message["text"] is not None:
                                await upstream.send(message["text"])
                            elif "bytes" in message and message["bytes"] is not None:
                                await upstream.send(message["bytes"])
                        else:
                            logger.debug("Unhandled websocket message type: %s", msg_type)

                async def _forward_openai_to_client() -> None:
                    while True:
                        try:
                            payload = await upstream.recv()
                        except ConnectionClosed:
                            if websocket.application_state == WebSocketState.CONNECTED:
                                await websocket.close()
                            break
                        if isinstance(payload, bytes):
                            await websocket.send_bytes(payload)
                        else:
                            await websocket.send_text(payload)

                await asyncio.gather(_forward_client_to_openai(), _forward_openai_to_client())
        except InvalidStatusCode as exc:
            logger.error("Realtime proxy handshake failed: %s", exc)
            if websocket.application_state == WebSocketState.CONNECTED:
                await websocket.close(code=1011)
        except Exception as exc:  # pragma: no cover - unexpected proxy failure
            logger.exception("Realtime proxy encountered an error")
            if websocket.application_state == WebSocketState.CONNECTED:
                await websocket.close(code=1011)

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
        filename = Path(audio.filename).name if audio.filename else "chunk.webm"

        processed_bytes: bytes
        processed_filename: str

        with tempfile.NamedTemporaryFile(delete=False, suffix=original_suffix) as src_file:
            src_file.write(audio_bytes)
            src_path = Path(src_file.name)

        cleanup_paths = [src_path]

        if original_suffix != ".webm":
            try:
                with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as dst_file:
                    dst_path = Path(dst_file.name)
                cleanup_paths.append(dst_path)

                (
                    ffmpeg
                    .input(str(src_path))
                    .output(
                        str(dst_path),
                        ac=1,
                        ar=16000,
                        acodec="pcm_s16le",
                        format="wav",
                    )
                    .overwrite_output()
                    .run(cmd="ffmpeg", quiet=True)
                )

                if dst_path.exists() and dst_path.stat().st_size > 0:
                    processed_bytes = dst_path.read_bytes()
                    processed_filename = Path(filename).with_suffix(".wav").name
                else:
                    raise RuntimeError("ffmpeg produced empty wav output")
            except Exception as conversion_error:  # pragma: no cover - diagnostic logging only
                logger.warning("[transcribe] audio conversion failed: %s", conversion_error)
                processed_bytes = audio_bytes
                processed_filename = filename
            else:
                src_path.unlink(missing_ok=True)
                cleanup_paths = cleanup_paths[1:]
            finally:
                for path in cleanup_paths:
                    path.unlink(missing_ok=True)
        else:
            processed_bytes = audio_bytes
            processed_filename = filename

        if not processed_bytes:
            raise HTTPException(status_code=400, detail="Converted audio clip is empty.")

        def run_transcription() -> object:
            buf = io.BytesIO(processed_bytes)
            setattr(buf, "name", processed_filename)
            try:
                buf.seek(0)
                return openai_client.audio.transcriptions.create(
                    model=TRANSCRIPTION_MODEL,
                    file=buf,
                    response_format="verbose_json",
                    temperature=0,
                )
            finally:
                buf.close()

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
            logger.exception("Transcription request failed")
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
