"""
Audio chunking utilities for handling large audio files with Whisper API
"""
import io
import logging
import tempfile
from pathlib import Path
from typing import List, Tuple
import ffmpeg
import numpy as np

logger = logging.getLogger(__name__)

class AudioChunker:
    """
    Splits large audio files into chunks for Whisper API processing
    """
    
    # Whisper API limit is 25MB, we'll use 20MB to be safe
    MAX_CHUNK_SIZE = 20 * 1024 * 1024  # 20MB in bytes
    
    # Maximum chunk duration in seconds (10 minutes)
    MAX_CHUNK_DURATION = 600  
    
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
        
        # Cap at maximum duration
        return min(chunk_duration, AudioChunker.MAX_CHUNK_DURATION)
    
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
    def split_audio(audio_path: Path, chunk_duration: float) -> List[Tuple[bytes, float, float]]:
        """
        Split audio file into chunks
        Returns list of (chunk_bytes, start_time, end_time) tuples
        """
        chunks = []
        total_duration = AudioChunker.get_audio_duration(audio_path)
        
        if audio_path.stat().st_size <= AudioChunker.MAX_CHUNK_SIZE:
            # File is small enough, no need to split
            with open(audio_path, 'rb') as f:
                chunks.append((f.read(), 0, total_duration))
            return chunks
        
        # Calculate optimal chunk duration
        chunk_duration = AudioChunker.estimate_chunk_duration(
            audio_path.stat().st_size, 
            total_duration
        )
        
        logger.info(f"Splitting audio into chunks of {chunk_duration:.1f} seconds")
        
        current_time = 0
        chunk_index = 0
        
        while current_time < total_duration:
            end_time = min(current_time + chunk_duration, total_duration)
            
            # Extract chunk using ffmpeg
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
                try:
                    (
                        ffmpeg
                        .input(str(audio_path), ss=current_time, t=chunk_duration)
                        .output(
                            tmp_file.name,
                            ac=1,  # mono
                            ar=16000,  # 16kHz
                            acodec='pcm_s16le',
                            format='wav',
                            loglevel='error'
                        )
                        .overwrite_output()
                        .run(capture_stdout=True, capture_stderr=True)
                    )
                    
                    # Read the chunk
                    with open(tmp_file.name, 'rb') as f:
                        chunk_data = f.read()
                    
                    # Check chunk size
                    if len(chunk_data) > AudioChunker.MAX_CHUNK_SIZE:
                        # Chunk is still too large, reduce duration
                        logger.warning(f"Chunk {chunk_index} too large ({len(chunk_data)} bytes), reducing duration")
                        chunk_duration = chunk_duration * 0.8
                        continue
                    
                    chunks.append((chunk_data, current_time, end_time))
                    logger.info(f"Created chunk {chunk_index}: {current_time:.1f}s - {end_time:.1f}s ({len(chunk_data) / 1024 / 1024:.1f}MB)")
                    
                    current_time = end_time
                    chunk_index += 1
                    
                finally:
                    # Clean up temp file
                    Path(tmp_file.name).unlink(missing_ok=True)
        
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
