import json
import math
import os
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

import cv2
import ffmpeg
import mediapipe as mp
import numpy as np
import opensmile
import pandas as pd


def _ensure_directory(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def _distance(point_a, point_b, width: int, height: int) -> float:
    ax = point_a.x * width
    ay = point_a.y * height
    bx = point_b.x * width
    by = point_b.y * height
    return math.hypot(ax - bx, ay - by)


def _categorize_engagement(smile_score: float, eye_openness: float) -> str:
    if smile_score >= 0.32 and eye_openness >= 0.22:
        return "High"
    if smile_score >= 0.24 and eye_openness >= 0.18:
        return "Medium"
    return "Low"


def _categorize_emotion(smile_score: float, eye_openness: float) -> str:
    if smile_score >= 0.35:
        return "Joyful"
    if smile_score >= 0.27 and eye_openness >= 0.2:
        return "Attentive"
    if eye_openness < 0.15:
        return "Tired"
    return "Neutral"


def _extract_frames(video_path: Path, fps: int = 1) -> List[Path]:
    frame_dir = Path(tempfile.mkdtemp(prefix="frames_"))
    output_pattern = str(frame_dir / "frame_%05d.png")
    (
        ffmpeg
        .input(str(video_path))
        .output(output_pattern, vf=f"fps={fps}", format="image2", vcodec="png")
        .run(quiet=True, overwrite_output=True)
    )
    return sorted(frame_dir.glob("*.png"))


def _extract_audio(video_path: Path) -> Path:
    audio_path = Path(tempfile.mkstemp(prefix="audio_", suffix=".wav")[1])
    (
        ffmpeg
        .input(str(video_path))
        .output(str(audio_path), acodec="pcm_s16le", ac=1, ar=16000)
        .overwrite_output()
        .run(quiet=True)
    )
    return audio_path


def _audio_energy_series(video_path: Path, sample_rate: int = 16000) -> List[float]:
    process = (
        ffmpeg
        .input(str(video_path))
        .output("pipe:", format="s16le", acodec="pcm_s16le", ac=1, ar=sample_rate)
        .run_async(pipe_stdout=True, pipe_stderr=True)
    )
    stdout, _ = process.communicate()
    if not stdout:
        return []
    audio = np.frombuffer(stdout, dtype=np.int16).astype(np.float32)
    if audio.size == 0:
        return []
    audio /= np.max(np.abs(audio)) or 1.0
    window = sample_rate
    energies: List[float] = []
    for start_idx in range(0, audio.size, window):
        segment = audio[start_idx : start_idx + window]
        if segment.size == 0:
            continue
        rms = float(np.sqrt(np.mean(np.square(segment))))
        energies.append(rms)
    return energies


def _analyze_audio_features(audio_path: Path) -> Dict[str, Any]:
    smile = opensmile.Smile(
        feature_set=opensmile.FeatureSet.eGeMAPSv02,
        feature_level=opensmile.FeatureLevel.Functionals,
    )
    features: pd.DataFrame = smile.process_file(str(audio_path))
    record = features.iloc[0].to_dict()
    voice_energy = float(record.get("loudness_sma3_amean", 0.0))
    voice_arousal = float(record.get("F0semitoneFrom27.5Hz_sma3nz_amean", 0.0))
    return {
        "voiceEnergy": voice_energy,
        "voiceArousal": voice_arousal,
        "raw": {k: float(v) for k, v in record.items() if isinstance(v, (int, float, np.floating))},
    }


def _analyze_video_frames(video_path: Path, fps: int = 1) -> List[Dict[str, Any]]:
    frames = _extract_frames(video_path, fps=fps)
    if not frames:
        return []
    timeline: List[Dict[str, Any]] = []
    face_mesh = mp.solutions.face_mesh.FaceMesh(
        static_image_mode=True,
        max_num_faces=5,
        refine_landmarks=True,
        min_detection_confidence=0.4,
    )
    try:
        for index, frame_path in enumerate(frames):
            image_bgr = cv2.imread(str(frame_path))
            if image_bgr is None:
                continue
            height, width, _ = image_bgr.shape
            image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
            results = face_mesh.process(image_rgb)
            faces = results.multi_face_landmarks or []
            if not faces:
                timeline.append(
                    {
                        "timestamp": float(index) / float(fps),
                        "emotion": "No Face Detected",
                        "engagement": "Low",
                        "smileScore": 0.0,
                        "eyeOpenness": 0.0,
                        "faceCount": 0,
                    }
                )
                continue
            smile_scores: List[float] = []
            eye_open_scores: List[float] = []
            for landmarks in faces:
                mouth_width = _distance(landmarks.landmark[61], landmarks.landmark[291], width, height)
                mouth_height = _distance(landmarks.landmark[13], landmarks.landmark[14], width, height)
                left_eye = _distance(landmarks.landmark[159], landmarks.landmark[145], width, height)
                right_eye = _distance(landmarks.landmark[386], landmarks.landmark[374], width, height)
                eye_width = _distance(landmarks.landmark[33], landmarks.landmark[263], width, height)
                mouth_width = max(mouth_width, 1e-5)
                eye_width = max(eye_width, 1e-5)
                smile_ratio = mouth_height / mouth_width
                eye_ratio = ((left_eye + right_eye) / 2.0) / eye_width
                smile_scores.append(smile_ratio)
                eye_open_scores.append(eye_ratio)
            mean_smile = float(np.mean(smile_scores)) if smile_scores else 0.0
            mean_eye = float(np.mean(eye_open_scores)) if eye_open_scores else 0.0
            timeline.append(
                {
                    "timestamp": float(index) / float(fps),
                    "emotion": _categorize_emotion(mean_smile, mean_eye),
                    "engagement": _categorize_engagement(mean_smile, mean_eye),
                    "smileScore": round(mean_smile, 4),
                    "eyeOpenness": round(mean_eye, 4),
                    "faceCount": len(faces),
                }
            )
    finally:
        face_mesh.close()
    return timeline


def _prepare_summary(presenter_timeline: List[Dict[str, Any]], audience_timeline: List[Dict[str, Any]], voice_energy_series: List[float], audio_metrics: Dict[str, Any]) -> Dict[str, Any]:
    presenter_emotions = [item["emotion"] for item in presenter_timeline if item["emotion"] != "No Face Detected"]
    audience_emotions = [item["emotion"] for item in audience_timeline if item["emotion"] != "No Face Detected"]
    presenter_dominant = max(set(presenter_emotions), key=presenter_emotions.count) if presenter_emotions else "Unknown"
    audience_dominant = max(set(audience_emotions), key=audience_emotions.count) if audience_emotions else "Unknown"
    smile_avg = np.mean([item["smileScore"] for item in presenter_timeline]) if presenter_timeline else 0.0
    voice_energy_mean = float(np.mean(voice_energy_series)) if voice_energy_series else 0.0
    voice_energy_level = "High" if voice_energy_mean >= 0.35 else "Medium" if voice_energy_mean >= 0.2 else "Low"
    engagement_values = [item["engagement"] for item in presenter_timeline]
    engagement_level = max(set(engagement_values), key=engagement_values.count) if engagement_values else "Unknown"
    observations: List[str] = []
    if smile_avg > 0.3:
        observations.append("Presenter frequently smiling, suggesting positive affect.")
    if voice_energy_level == "High":
        observations.append("Voice energy sustained at a high level across the session.")
    if audience_dominant in {"Neutral", "Tired"}:
        observations.append("Audience shows limited expressive response; consider adding variety to maintain interest.")
    if not observations:
        observations.append("Limited expressive cues detected; review raw footage for finer insights.")
    return {
        "generatedAt": datetime.utcnow().isoformat() + "Z",
        "presenterDominantEmotion": presenter_dominant,
        "audienceDominantEmotion": audience_dominant,
        "averagePresenterSmile": round(float(smile_avg), 4),
        "voiceEnergyLevel": voice_energy_level,
        "voiceMetrics": audio_metrics,
        "keyObservations": observations,
        "engagementOverall": engagement_level,
    }


def analyze_session(session_id: str, session_dir: Path) -> Dict[str, Any]:
    presenter_path = session_dir / "presenter.webm"
    audience_path = session_dir / "audience.webm"
    if not presenter_path.exists():
        raise FileNotFoundError("Presenter video missing")
    voice_audio_path = _extract_audio(presenter_path)
    presenter_timeline = _analyze_video_frames(presenter_path, fps=1)
    audience_timeline = _analyze_video_frames(audience_path, fps=1) if audience_path.exists() else []
    voice_energy_series = _audio_energy_series(presenter_path)
    audio_metrics = _analyze_audio_features(voice_audio_path)
    summary = _prepare_summary(presenter_timeline, audience_timeline, voice_energy_series, audio_metrics)
    analysis_payload: Dict[str, Any] = {
        "sessionId": session_id,
        "summary": summary,
        "presenterTimeline": presenter_timeline,
        "audienceTimeline": audience_timeline,
        "voiceTimeline": [round(value, 4) for value in voice_energy_series],
    }
    voice_audio_path.unlink(missing_ok=True)
    return analysis_payload


def run_analysis_and_store(session_id: str, session_dir: Path) -> Path:
    _ensure_directory(session_dir)
    analysis = analyze_session(session_id, session_dir)
    output_path = session_dir / "analysis.json"
    with output_path.open("w", encoding="utf-8") as fp:
        json.dump(analysis, fp, ensure_ascii=False, indent=2)
    return output_path
