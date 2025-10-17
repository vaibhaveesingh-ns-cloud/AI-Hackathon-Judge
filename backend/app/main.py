from contextlib import asynccontextmanager
from typing import AsyncIterator

import asyncio
import os

from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from openai import OpenAI

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
openai_client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None


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

        if audio.content_type is None or not audio.content_type.startswith("audio"):
            raise HTTPException(status_code=400, detail="Uploaded file must be an audio clip.")

        audio_bytes = await audio.read()
        if not audio_bytes:
            raise HTTPException(status_code=400, detail="Uploaded audio file is empty.")

        filename = audio.filename or "chunk.webm"
        content_type = audio.content_type or "audio/webm"

        async def run_transcription() -> object:
            return openai_client.audio.transcriptions.create(
                model="gpt-4o-mini-transcribe",
                file=(filename, audio_bytes, content_type),
                language="en",
                response_format="verbose_json",
                timestamp_granularities=["segment"],
            )

        try:
            transcription = await asyncio.to_thread(run_transcription)
        except Exception as exc:  # pragma: no cover - surface upstream errors
            raise HTTPException(status_code=502, detail=f"Transcription failed: {exc}") from exc

        combined_text = (getattr(transcription, "text", "") or "").strip()
        raw_segments = getattr(transcription, "segments", None) or []

        segments: list[dict[str, object]] = []
        for segment in raw_segments:
            seg_start = int(float(segment.get("start", 0)) * 1000)
            seg_end = int(float(segment.get("end", 0)) * 1000)
            segments.append(
                {
                    "startMs": start_ms + seg_start,
                    "endMs": start_ms + (seg_end if seg_end > 0 else duration_ms),
                    "text": (segment.get("text") or "").strip(),
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

    return app


app = create_app()
