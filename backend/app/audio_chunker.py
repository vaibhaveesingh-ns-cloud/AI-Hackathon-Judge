"""
Audio chunking utilities for handling large audio files with Whisper API
"""
import io
import logging
import tempfile
from pathlib import Path
from typing import List, Tuple
import ffmpeg

logger = logging.getLogger(__name__)

class AudioChunker:
    """
    Splits large audio files into chunks for Whisper API processing
    """
    
    # Whisper API limit is 25MB, we'll use 20MB to be safe
    MAX_CHUNK_SIZE = 20 * 1024 * 1024  # 20MB in bytes
    DEFAULT_SEGMENT_DURATION = 120  # seconds
    MIN_SEGMENT_DURATION = 45  # seconds
    MAX_SEGMENT_DURATION = 600
    
    @staticmethod
    def estimate_chunk_duration(file_size: int, total_duration: float) -> float:
        """
        Estimate the duration of each chunk based on file size
        """
        if file_size <= AudioChunker.MAX_CHUNK_SIZE:
            return total_duration
        
        # Calculate how many chunks we need
        num_chunks = (file_size // AudioChunker.MAX_CHUNK_SIZE) + 1
        
        # Calculate duration per chunk
        chunk_duration = total_duration / num_chunks
        
        # Cap at configured maximum segment duration
        return min(chunk_duration, AudioChunker.MAX_SEGMENT_DURATION)
    
    @staticmethod
    def get_audio_duration(audio_path: Path) -> float:
        """
        Get the duration of an audio file
        """
        try:
            probe = ffmpeg.probe(str(audio_path))
            duration = float(probe['streams'][0]['duration'])
            return duration
        except Exception as e:
            logger.warning(f"Could not get audio duration: {e}")
            # Estimate based on file size (rough estimate: 1MB = 1 minute for 16kHz mono)
            file_size_mb = audio_path.stat().st_size / (1024 * 1024)
            return file_size_mb * 60
    
    @staticmethod
    def split_audio(audio_path: Path, requested_duration: float | None = None) -> List[Tuple[bytes, float, float]]:
        """
        Split audio file into chunks using ffmpeg segment muxer.
        Returns list of (chunk_bytes, start_time, end_time) tuples.
        """
        total_duration = AudioChunker.get_audio_duration(audio_path)

        if audio_path.stat().st_size <= AudioChunker.MAX_CHUNK_SIZE:
            with open(audio_path, "rb") as f:
                return [(f.read(), 0.0, total_duration)]

        segment_duration = AudioChunker.estimate_chunk_duration(
            audio_path.stat().st_size, total_duration
        )
        if requested_duration:
            segment_duration = min(segment_duration, requested_duration)
        segment_duration = max(
            AudioChunker.MIN_SEGMENT_DURATION,
            min(segment_duration, AudioChunker.DEFAULT_SEGMENT_DURATION, AudioChunker.MAX_SEGMENT_DURATION),
        )

        logger.info(
            "[AudioChunker] Preparing segmented extraction: size=%.2fMB duration=%.1fs segment=%.1fs",
            audio_path.stat().st_size / (1024 * 1024),
            total_duration,
            segment_duration,
        )

        attempt_duration = segment_duration
        while True:
            with tempfile.TemporaryDirectory(prefix="audio_segments_") as tmp_dir:
                segment_pattern = Path(tmp_dir) / "chunk_%03d.wav"
                (
                    ffmpeg.input(str(audio_path))
                    .output(
                        str(segment_pattern),
                        f="segment",
                        segment_time=float(attempt_duration),
                        ac=1,
                        ar=16000,
                        acodec="pcm_s16le",
                        reset_timestamps="1",
                        loglevel="error",
                    )
                    .overwrite_output()
                    .run(capture_stdout=True, capture_stderr=True)
                )

                chunk_paths = sorted(Path(tmp_dir).glob("chunk_*.wav"))
                if not chunk_paths:
                    raise RuntimeError("ffmpeg failed to produce segmented audio chunks")

                largest_chunk = 0
                chunks: List[Tuple[bytes, float, float]] = []
                for index, chunk_path in enumerate(chunk_paths):
                    data = chunk_path.read_bytes()
                    largest_chunk = max(largest_chunk, len(data))
                    start_time = index * attempt_duration
                    end_time = min(start_time + attempt_duration, total_duration)
                    chunks.append((data, start_time, end_time))

                if largest_chunk > AudioChunker.MAX_CHUNK_SIZE and attempt_duration > AudioChunker.MIN_SEGMENT_DURATION:
                    attempt_duration = max(AudioChunker.MIN_SEGMENT_DURATION, attempt_duration * 0.75)
                    logger.warning(
                        "[AudioChunker] Chunk exceeded max size (%.2fMB). Retrying with shorter duration %.1fs",
                        largest_chunk / (1024 * 1024),
                        attempt_duration,
                    )
                    continue

                logger.info(
                    "[AudioChunker] Created %d chunks (segment %.1fs, max %.2fMB)",
                    len(chunks),
                    attempt_duration,
                    largest_chunk / (1024 * 1024),
                )
                return chunks
    
    @staticmethod
    def merge_transcriptions(transcriptions: List[dict], chunk_times: List[Tuple[float, float]]) -> dict:
        """
        Merge multiple transcription results into a single result
        """
        combined_text = []
        combined_segments = []
        
        for i, (transcription, (start_time, end_time)) in enumerate(zip(transcriptions, chunk_times)):
            # Add text
            text = transcription.get('text', '').strip()
            if text:
                combined_text.append(text)
            
            # Add segments with adjusted timestamps
            segments = transcription.get('segments', [])
            for segment in segments:
                adjusted_segment = segment.copy()
                # Adjust segment timestamps relative to the chunk start
                if 'start' in adjusted_segment:
                    adjusted_segment['start'] = segment['start'] + start_time
                if 'end' in adjusted_segment:
                    adjusted_segment['end'] = segment['end'] + start_time
                if 'startMs' in adjusted_segment:
                    adjusted_segment['startMs'] = segment['startMs'] + (start_time * 1000)
                if 'endMs' in adjusted_segment:
                    adjusted_segment['endMs'] = segment['endMs'] + (start_time * 1000)
                
                combined_segments.append(adjusted_segment)
        
        return {
            'text': ' '.join(combined_text),
            'segments': combined_segments
        }
