import asyncio
import logging
import os
from dataclasses import dataclass
from typing import Optional

import numpy as np
import torch
from transformers import Speech2TextForConditionalGeneration, Speech2TextProcessor

logger = logging.getLogger(__name__)


@dataclass
class TranscriptionResult:
    full_text: str
    delta_text: str
    is_final: bool = False


class Speech2TextStream:
    def __init__(self, engine: "Speech2TextEngine") -> None:
        self.engine = engine
        self.sample_rate = engine.sample_rate
        self.min_chunk_samples = engine.min_chunk_samples
        self.max_window_samples = engine.max_window_samples
        self._buffer = np.zeros(0, dtype=np.float32)
        self._last_text: str = ""
        self._lock = asyncio.Lock()

    async def reset(self) -> None:
        async with self._lock:
            self._buffer = np.zeros(0, dtype=np.float32)
            self._last_text = ""

    async def append_pcm16(self, pcm_bytes: bytes) -> Optional[TranscriptionResult]:
        if not pcm_bytes:
            return None

        samples = np.frombuffer(pcm_bytes, dtype="<i2").astype(np.float32) / 32768.0
        if samples.size == 0:
            return None

        async with self._lock:
            self._buffer = np.concatenate((self._buffer, samples))
            if self._buffer.size > self.max_window_samples:
                self._buffer = self._buffer[-self.max_window_samples :]
            pending_samples = self._buffer.size
            last_text = self._last_text
            buffer_copy = None
            if pending_samples >= self.min_chunk_samples:
                buffer_copy = self._buffer.copy()

        if buffer_copy is None:
            return None

        new_text = await self.engine.transcribe_samples(buffer_copy)
        if not new_text:
            return None

        async with self._lock:
            self._last_text = new_text

        delta = new_text[len(last_text) :].lstrip() if new_text.startswith(last_text) else new_text
        if not delta:
            return None
        return TranscriptionResult(full_text=new_text, delta_text=delta, is_final=False)

    async def finalize(self) -> Optional[TranscriptionResult]:
        async with self._lock:
            if self._buffer.size == 0 and not self._last_text:
                return None
            buffer_copy = self._buffer.copy()
            last_text = self._last_text
            self._buffer = np.zeros(0, dtype=np.float32)
            self._last_text = ""

        if last_text:
            return TranscriptionResult(full_text=last_text, delta_text=last_text, is_final=True)

        if buffer_copy.size == 0:
            return None

        final_text = await self.engine.transcribe_samples(buffer_copy)
        if not final_text:
            return None
        return TranscriptionResult(full_text=final_text, delta_text=final_text, is_final=True)


class Speech2TextEngine:
    def __init__(
        self,
        model_name: str,
        sample_rate: int = 16000,
        min_chunk_seconds: float = 1.2,
        max_window_seconds: float = 12.0,
        device: Optional[str] = None,
        num_beams: int = 1,
    ) -> None:
        if not model_name:
            raise ValueError("Speech2TextEngine requires a model name")

        self.model_name = model_name
        self.sample_rate = sample_rate
        self.min_chunk_samples = int(max(min_chunk_seconds, 0.2) * sample_rate)
        self.max_window_samples = int(max(max_window_seconds, min_chunk_seconds) * sample_rate)
        resolved_device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.device = torch.device(resolved_device)
        self.num_beams = max(1, num_beams)

        logger.info("Loading Speech2Text model '%s' on %s", self.model_name, self.device)
        self.processor = Speech2TextProcessor.from_pretrained(self.model_name)
        self.model = Speech2TextForConditionalGeneration.from_pretrained(self.model_name).to(self.device)
        self.model.eval()

        self._generation_lock = asyncio.Lock()

    def create_stream(self) -> Speech2TextStream:
        return Speech2TextStream(self)

    async def transcribe_samples(self, audio_samples: np.ndarray) -> str:
        async with self._generation_lock:
            return await asyncio.to_thread(self._infer_text, audio_samples)

    def _infer_text(self, audio_samples: np.ndarray) -> str:
        try:
            inputs = self.processor(
                audio_samples,
                sampling_rate=self.sample_rate,
                return_tensors="pt",
                padding=True,
            )
            input_features = inputs["input_features"].to(self.device)
            attention_mask = inputs.get("attention_mask")
            if attention_mask is not None:
                attention_mask = attention_mask.to(self.device)

            with torch.no_grad():
                generated_ids = self.model.generate(
                    input_features,
                    attention_mask=attention_mask,
                    max_length=512,
                    num_beams=self.num_beams,
                    early_stopping=True,
                )

            transcription = self.processor.batch_decode(generated_ids, skip_special_tokens=True)
            text = transcription[0].strip() if transcription else ""
            return text
        except Exception:  # pragma: no cover - diagnostic path
            logger.exception("Speech2Text inference failed")
            return ""
