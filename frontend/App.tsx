import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  SessionStatus,
  TranscriptionEntry,
  PresentationFeedback,
  SessionEngagementAnalysis,
} from './types';
import PitchPerfectIcon from './components/PitchPerfectIcon';
import ControlButton from './components/ControlButton';
import FeedbackCard from './components/FeedbackCard';
import EngagementDashboard from './components/EngagementDashboard';
import { getFinalPresentationFeedback, generateQuestions, transcribeAudioChunk } from './services/openaiService';
import { uploadSessionVideo, pollSessionAnalysis } from './services/sessionService';
import { parsePptx } from './utils/pptxParser';

const getFrameAsBase64 = (videoEl: HTMLVideoElement, canvasEl: HTMLCanvasElement): string | null => {
    if (videoEl.readyState >= 2) {
        const ctx = canvasEl.getContext('2d');
        if (!ctx) return null;
        canvasEl.width = videoEl.videoWidth;
        canvasEl.height = videoEl.videoHeight;
        ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
        const dataUrl = canvasEl.toDataURL('image/jpeg', 0.8);
        return dataUrl.split(',')[1];
    }
    return null;
};

const getMediaErrorMessage = (err: unknown): string => {
    let msg = 'Could not access microphone or camera. Please ensure permissions are granted.';
    if (err instanceof Error) {
        const domError = err as DOMException;
        const name = domError.name || err.name;
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
            msg = 'Permission for camera/microphone was denied. Please enable them in browser settings.';
        } else if (name === 'NotFoundError') {
            msg = 'No camera or microphone found. Please connect them and try again.';
        } else if (err.message) {
            msg = err.message;
        }
    }
    return msg;
};

const FRAME_CAPTURE_INTERVAL = 5000; // Capture a frame every 5 seconds
const AUDIO_CHUNK_DURATION_MS = 5000;
const HUNK_DURATION_MS = 5000;

const App: React.FC = () => {
  const [status, setStatus] = useState<SessionStatus>(SessionStatus.IDLE);
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const [transcriptionHistory, setTranscriptionHistory] = useState<TranscriptionEntry[]>([]);
  const [liveTranscript, setLiveTranscript] = useState<string>('');
  const [feedback, setFeedback] = useState<PresentationFeedback | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasMediaPermissions, setHasMediaPermissions] = useState(false);
  const [permissionInfo, setPermissionInfo] = useState<string | null>(null);
  const [elapsedTime, setElapsedTime] = useState<string>('00:00:00');
  const [listeningStartTime, setListeningStartTime] = useState<number | null>(null);
  const [isMicrophoneMuted, setIsMicrophoneMuted] = useState<boolean>(false);
  const [isVideoPaused, setIsVideoPaused] = useState<boolean>(false);

  const [slides, setSlides] = useState<string[]>([]);
  const [currentSlide, setCurrentSlide] = useState<number>(0);
  const [pptxFile, setPptxFile] = useState<File | null>(null);
  const [isParsing, setIsParsing] = useState<boolean>(false);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);

  const [questions, setQuestions] = useState<string[]>([]);
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedSpeakerCamera, setSelectedSpeakerCamera] = useState<string>('');
  const [selectedListenerCamera, setSelectedListenerCamera] = useState<string>('');

  const speakerStreamRef = useRef<MediaStream | null>(null);
  const listenerStreamRef = useRef<MediaStream | null>(null);
  const speakerVideoRef = useRef<HTMLVideoElement>(null);
  const listenerVideoRef = useRef<HTMLVideoElement>(null);
  const speakerCanvasRef = useRef<HTMLCanvasElement>(null);
  const listenerCanvasRef = useRef<HTMLCanvasElement>(null);
  const speakerVideoFramesRef = useRef<string[]>([]);
  const listenerVideoFramesRef = useRef<string[]>([]);
  const speakerFrameIntervalRef = useRef<number | null>(null);
  const listenerFrameIntervalRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const transcriptionHistoryRef = useRef<TranscriptionEntry[]>([]);
  const pendingTranscriptionsRef = useRef<Set<Promise<void>>>(new Set());
  const recordingStartRef = useRef<number>(0);
  const lastChunkTimestampRef = useRef<number>(0);
  const presenterRecorderRef = useRef<MediaRecorder | null>(null);
  const audienceRecorderRef = useRef<MediaRecorder | null>(null);
  const presenterChunksRef = useRef<Blob[]>([]);
  const audienceChunksRef = useRef<Blob[]>([]);
  const [engagementAnalysis, setEngagementAnalysis] = useState<SessionEngagementAnalysis | null>(null);
  const [isAnalysisPending, setIsAnalysisPending] = useState<boolean>(false);
  const [sessionId] = useState<string>(() => crypto.randomUUID());

  useEffect(() => {
    transcriptionHistoryRef.current = transcriptionHistory;
  }, [transcriptionHistory]);

  const flushPendingTranscriptions = useCallback(async () => {
    while (pendingTranscriptionsRef.current.size > 0) {
      const pending = Array.from(pendingTranscriptionsRef.current);
      await Promise.allSettled(pending);
    }
  }, []);

  const formatCameraLabel = (device: MediaDeviceInfo, index: number) =>
    device.label || `Camera ${index + 1}`;

  const attachStreamToVideo = useCallback((videoElement: HTMLVideoElement | null, stream: MediaStream | null) => {
    if (!videoElement || !stream) return;
    if (videoElement.srcObject !== stream) {
      videoElement.srcObject = stream;
      videoElement
        .play()
        .catch((e) => console.error('Video play failed:', e));
    }
  }, []);

  const toggleMicrophone = useCallback(() => {
    const stream = speakerStreamRef.current;
    if (!stream) return;

    setIsMicrophoneMuted((prevMuted) => {
      const nextMuted = !prevMuted;
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !nextMuted;
      });
      return nextMuted;
    });
  }, []);

  const toggleVideo = useCallback(() => {
    const streams: MediaStream[] = [];
    const addUniqueStream = (candidate: MediaStream | null) => {
      if (candidate && !streams.includes(candidate)) {
        streams.push(candidate);
      }
    };

    addUniqueStream(speakerStreamRef.current);
    addUniqueStream(listenerStreamRef.current);

    if (streams.length === 0) return;

    setIsVideoPaused((prevPaused) => {
      const nextPaused = !prevPaused;
      streams.forEach((stream) => {
        stream.getVideoTracks().forEach((track) => {
          track.enabled = !nextPaused;
        });
      });
      return nextPaused;
    });
  }, []);

  const startFrameCapture = useCallback((
    videoElementRef: React.MutableRefObject<HTMLVideoElement | null>,
    canvasElementRef: React.MutableRefObject<HTMLCanvasElement | null>,
    framesRef: React.MutableRefObject<string[]>,
    intervalRef: React.MutableRefObject<number | null>
  ) => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    intervalRef.current = window.setInterval(() => {
      const videoEl = videoElementRef.current;
      const canvasEl = canvasElementRef.current;
      if (!videoEl || !canvasEl) return;
      const frame = getFrameAsBase64(videoEl, canvasEl);
      if (frame) framesRef.current.push(frame);
    }, FRAME_CAPTURE_INTERVAL);
  }, []);

  const stopStream = useCallback((
    streamRef: React.MutableRefObject<MediaStream | null>,
    intervalRef: React.MutableRefObject<number | null>,
    videoElementRef: React.MutableRefObject<HTMLVideoElement | null>
  ) => {
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (videoElementRef.current) {
      videoElementRef.current.srcObject = null;
    }
  }, []);

  useEffect(() => {
    if (status !== SessionStatus.LISTENING) return;
    attachStreamToVideo(speakerVideoRef.current, speakerStreamRef.current);
    attachStreamToVideo(listenerVideoRef.current, listenerStreamRef.current);
  }, [status, attachStreamToVideo]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return;

    const updateDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter((device) => device.kind === 'videoinput');
        setCameraDevices(videoDevices);

        if (!selectedSpeakerCamera && videoDevices[0]) {
          setSelectedSpeakerCamera(videoDevices[0].deviceId);
        }

        if (!selectedListenerCamera) {
          const fallback = videoDevices.find((device) => device.deviceId !== selectedSpeakerCamera);
          setSelectedListenerCamera((fallback ?? videoDevices[1] ?? videoDevices[0])?.deviceId ?? '');
        }
      } catch (deviceError) {
        console.error('Device enumeration failed:', deviceError);
      }
    };

    if (hasMediaPermissions) {
      updateDevices();
      const handler = () => updateDevices();

      if ((navigator.mediaDevices as any).addEventListener) {
        (navigator.mediaDevices as any).addEventListener('devicechange', handler);
        return () => {
          (navigator.mediaDevices as any).removeEventListener('devicechange', handler);
        };
      }

      const mediaDevices = navigator.mediaDevices as any;
      const prevHandler = mediaDevices.ondevicechange;
      mediaDevices.ondevicechange = handler;
      return () => {
        mediaDevices.ondevicechange = prevHandler ?? null;
      };
    }
  }, [hasMediaPermissions, selectedSpeakerCamera, selectedListenerCamera]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return;

    const handlePermissionState = (state: PermissionState) => {
      if (state === 'granted') {
        setHasMediaPermissions(true);
        setPermissionInfo((prev) => prev ?? 'Camera and microphone access granted. You can start the evaluation anytime.');
      } else if (state === 'denied') {
        setHasMediaPermissions(false);
      }
    };

    const permissionNames = ['microphone', 'camera'] as const;

    permissionNames.forEach(async (permissionName) => {
      try {
        const statusResult = await navigator.permissions!.query({ name: permissionName as PermissionName });
        handlePermissionState(statusResult.state);
        statusResult.onchange = () => handlePermissionState(statusResult.state);
      } catch (err) {
        // Some browsers (e.g., Safari) do not support querying these permissions; ignore.
      }
    });
  }, []);

  useEffect(() => {
    if (status === SessionStatus.IDLE && hasMediaPermissions) {
      setPermissionInfo('Camera and microphone access granted. You can start the evaluation anytime.');
    }
  }, [status, hasMediaPermissions]);

  useEffect(() => {
    if (status !== SessionStatus.LISTENING || listeningStartTime === null) {
      setElapsedTime('00:00:00');
      return;
    }

    const updateElapsed = () => {
      const diff = Math.max(0, Date.now() - listeningStartTime);
      const hours = Math.floor(diff / 3_600_000);
      const minutes = Math.floor((diff % 3_600_000) / 60_000);
      const seconds = Math.floor((diff % 60_000) / 1_000);
      setElapsedTime(
        `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      );
    };

    updateElapsed();
    const intervalId = window.setInterval(updateElapsed, 1_000);
    return () => clearInterval(intervalId);
  }, [status, listeningStartTime]);

  const stopMediaProcessing = useCallback(() => {
    stopStream(speakerStreamRef, speakerFrameIntervalRef, speakerVideoRef);
    stopStream(listenerStreamRef, listenerFrameIntervalRef, listenerVideoRef);

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    mediaRecorderRef.current = null;

    const presenterRecorder = presenterRecorderRef.current;
    if (presenterRecorder && presenterRecorder.state !== 'inactive') {
      presenterRecorder.stop();
    }
    presenterRecorderRef.current = null;

    const audienceRecorder = audienceRecorderRef.current;
    if (audienceRecorder && audienceRecorder.state !== 'inactive') {
      audienceRecorder.stop();
    }
    audienceRecorderRef.current = null;

    setListeningStartTime(null);
    setElapsedTime('00:00:00');
    recordingStartRef.current = 0;
    lastChunkTimestampRef.current = 0;
  }, [stopStream]);

  const stopRecordingAndCollectAudio = useCallback(async (): Promise<Blob | null> => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) {
      return null;
    }

    if (recorder.state === 'inactive') {
      mediaRecorderRef.current = null;
      return null;
    }

    return new Promise((resolve) => {
      recorder.onstop = () => {
        mediaRecorderRef.current = null;
        resolve(null);
      };
      recorder.stop();
    });
  }, []);

  const requestMediaStream = useCallback(async (constraints: MediaStreamConstraints = { audio: true, video: true }) => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('Media devices API is not supported in this browser.');
    }
    return navigator.mediaDevices.getUserMedia(constraints);
  }, []);

  const handleRequestPermissions = useCallback(async () => {
    setPermissionInfo(null);
    try {
      const stream = await requestMediaStream();
      stream.getTracks().forEach(track => track.stop());
      setHasMediaPermissions(true);
      setPermissionInfo('Camera and microphone access granted. You can start the evaluation anytime.');
      setError(null);
    } catch (err) {
      const msg = getMediaErrorMessage(err);
      setHasMediaPermissions(false);
      setPermissionInfo(null);
      setError(msg);
    }
  }, [requestMediaStream]);

  const resetState = () => {
    stopMediaProcessing();
    setStatus(SessionStatus.IDLE);
    setError(null);
    setFeedback(null);
    setTranscriptionHistory([]);
    setLiveTranscript('');
    speakerVideoFramesRef.current = [];
    listenerVideoFramesRef.current = [];
    presenterChunksRef.current = [];
    audienceChunksRef.current = [];
    setCurrentSlide(0);
    setQuestions([]);
    setPptxFile(null);
    setSlides([]);
    setListeningStartTime(null);
    setElapsedTime('00:00:00');
    recordingStartRef.current = 0;
    lastChunkTimestampRef.current = 0;
    setEngagementAnalysis(null);
    setIsAnalysisPending(false);
  };

  const handleStart = useCallback(async () => {
    setStatus(SessionStatus.CONNECTING);
    setError(null);
    setFeedback(null);
    setTranscriptionHistory([]);
    setLiveTranscript('');
    speakerVideoFramesRef.current = [];
    listenerVideoFramesRef.current = [];
    setCurrentSlide(0);
    setQuestions([]);

    try {
        const speakerConstraints: MediaStreamConstraints = {
            audio: true,
            video: selectedSpeakerCamera
                ? { deviceId: { exact: selectedSpeakerCamera } }
                : true,
        };

        const listenerConstraints: MediaStreamConstraints = {
            audio: false,
            video: selectedListenerCamera
                ? { deviceId: { exact: selectedListenerCamera } }
                : true,
        };

        const speakerStream = await requestMediaStream(speakerConstraints);
        let listenerStream: MediaStream | null = null;

        if (selectedListenerCamera && selectedListenerCamera === selectedSpeakerCamera) {
            listenerStream = speakerStream;
        } else {
            try {
                listenerStream = await requestMediaStream(listenerConstraints);
            } catch (listenerError) {
                console.warn('Unable to start audience camera stream, falling back to presenter stream.', listenerError);
                listenerStream = speakerStream;
            }
        }

        speakerStreamRef.current = speakerStream;
        listenerStreamRef.current = listenerStream;

        attachStreamToVideo(speakerVideoRef.current, speakerStreamRef.current);
        if (listenerStreamRef.current) {
            attachStreamToVideo(listenerVideoRef.current, listenerStreamRef.current);
        }

        startFrameCapture(speakerVideoRef, speakerCanvasRef, speakerVideoFramesRef, speakerFrameIntervalRef);
        if (listenerStreamRef.current) {
            startFrameCapture(listenerVideoRef, listenerCanvasRef, listenerVideoFramesRef, listenerFrameIntervalRef);
        }

        if (typeof MediaRecorder === 'undefined') {
            throw new Error('Audio recording is not supported in this browser.');
        }

        const audioTracks = speakerStream.getAudioTracks();
        if (audioTracks.length === 0) {
            throw new Error('No audio track detected. Please verify your microphone.');
        }

        const audioStream = new MediaStream(audioTracks);
        try {
            const recorder = new MediaRecorder(audioStream, { mimeType: 'audio/webm' });
            recordingStartRef.current = Date.now();
            lastChunkTimestampRef.current = recordingStartRef.current;
            recorder.ondataavailable = (event) => {
                if (!event.data || event.data.size === 0) return;
                const chunkStart = lastChunkTimestampRef.current;
                const chunkEnd = Date.now();
                const durationMs = chunkEnd - chunkStart;
                lastChunkTimestampRef.current = chunkEnd;

                const transcriptionPromise = transcribeAudioChunk(
                    event.data,
                    chunkStart - recordingStartRef.current,
                    durationMs
                )
                    .then(({ text, segments }) => {
                        if (text) {
                            setLiveTranscript((prev) => `${prev}\n${text}`.trim());
                        }

                        if (segments.length > 0) {
                            setTranscriptionHistory((prev) => {
                                const updated = [...prev];
                                segments.forEach((segment) => {
                                    updated.push({
                                        speaker: 'user',
                                        text: segment.text,
                                        context: 'presentation',
                                        startMs: segment.startMs,
                                        endMs: segment.endMs,
                                    });
                                });
                                return updated;
                            });
                        }
                    })
                    .catch((err) => {
                        console.error('Chunk transcription failed:', err);
                    });

                pendingTranscriptionsRef.current.add(transcriptionPromise);
                transcriptionPromise.finally(() => {
                    pendingTranscriptionsRef.current.delete(transcriptionPromise);
                });
            };
            recorder.start(AUDIO_CHUNK_DURATION_MS);
            mediaRecorderRef.current = recorder;
        } catch (recorderError) {
            console.error('MediaRecorder error:', recorderError);
            throw new Error('Could not start audio recording. Please check browser compatibility.');
        }
        presenterChunksRef.current = [];
        audienceChunksRef.current = [];

        if (speakerStream) {
            try {
                const presenterRecorder = new MediaRecorder(speakerStream, { mimeType: 'video/webm;codecs=vp9,opus' });
                presenterRecorder.ondataavailable = (event) => {
                    if (event.data && event.data.size > 0) presenterChunksRef.current.push(event.data);
                };
                presenterRecorder.start();
                presenterRecorderRef.current = presenterRecorder;
            } catch (presenterError) {
                console.error('Presenter recorder init failed:', presenterError);
            }
        }

        if (listenerStream && listenerStream !== speakerStream) {
            try {
                const audienceRecorder = new MediaRecorder(listenerStream, { mimeType: 'video/webm;codecs=vp9,opus' });
                audienceRecorder.ondataavailable = (event) => {
                    if (event.data && event.data.size > 0) audienceChunksRef.current.push(event.data);
                };
                audienceRecorder.start();
                audienceRecorderRef.current = audienceRecorder;
            } catch (audienceError) {
                console.error('Audience recorder init failed:', audienceError);
            }
        }

        setLiveTranscript('Recording in progress...');

        setListeningStartTime(Date.now());
        setElapsedTime('00:00:00');
        setStatus(SessionStatus.LISTENING);
    } catch (err) {
        const msg = getMediaErrorMessage(err);
        setHasMediaPermissions(false);
        setError(msg);
        setStatus(SessionStatus.ERROR);
        stopMediaProcessing();
    }
  }, [requestMediaStream, stopMediaProcessing, attachStreamToVideo, startFrameCapture, selectedSpeakerCamera, selectedListenerCamera]);

  const handleFinishQAndA = useCallback(async (
    providedQuestions?: string[],
    historyOverride?: TranscriptionEntry[]
  ) => {
    setStatus(SessionStatus.PROCESSING);
    stopMediaProcessing();
    await flushPendingTranscriptions();

    const finalHistory = historyOverride ?? transcriptionHistory;
    const questionSet = providedQuestions ?? questions;

    const finalFeedback = await getFinalPresentationFeedback(
      finalHistory,
      speakerVideoFramesRef.current,
      listenerVideoFramesRef.current,
      slides,
      questionSet
    );
    if (finalFeedback) {
      setFeedback(finalFeedback);
      setStatus(SessionStatus.COMPLETE);
    } else {
      setError('Could not generate feedback. The presentation may have been too short.');
      setStatus(SessionStatus.ERROR);
    }
  }, [transcriptionHistory, stopMediaProcessing, slides, questions]);
  
  const uploadVideoIfAvailable = useCallback(
    async (role: 'presenter' | 'audience', chunks: Blob[], startMs: number, durationMs: number) => {
      if (chunks.length === 0) {
        return;
      }
      const videoBlob = new Blob(chunks, { type: 'video/webm' });
      await uploadSessionVideo(sessionId, role, videoBlob, startMs, durationMs);
    },
    [sessionId]
  );

  const handleStopPresentation = useCallback(async () => {
    const sessionStart = recordingStartRef.current;
    const durationMs = sessionStart > 0 ? Date.now() - sessionStart : 0;

    setStatus(SessionStatus.PROCESSING);
    stopMediaProcessing();
    await flushPendingTranscriptions();

    const cleanedHistory = transcriptionHistoryRef.current.filter((entry) => entry.context === 'presentation');

    if (cleanedHistory.length === 0) {
      setError('No transcript was captured. Please ensure your microphone is working.');
      setStatus(SessionStatus.ERROR);
      return;
    }

    try {
      await uploadVideoIfAvailable('presenter', presenterChunksRef.current, 0, durationMs);
      await uploadVideoIfAvailable('audience', audienceChunksRef.current, 0, durationMs);
      setIsAnalysisPending(true);
      pollSessionAnalysis(sessionId)
        .then((analysis) => {
          setEngagementAnalysis(analysis);
        })
        .catch((analysisError) => {
          console.error('Analysis polling failed:', analysisError);
          setError(analysisError instanceof Error ? analysisError.message : 'Engagement analysis unavailable.');
        })
        .finally(() => {
          setIsAnalysisPending(false);
        });
    } catch (uploadError) {
      console.error('Video upload failed:', uploadError);
      setError(uploadError instanceof Error ? uploadError.message : 'Unable to upload session videos.');
    }

    setTranscriptionHistory(cleanedHistory);
    setLiveTranscript(cleanedHistory.map((entry) => entry.text).join('\n'));

    setStatus(SessionStatus.GENERATING_QUESTIONS);
    const generatedQuestions = await generateQuestions(cleanedHistory, slides);
    setQuestions(generatedQuestions);

    await handleFinishQAndA(generatedQuestions, cleanedHistory);
  }, [stopMediaProcessing, flushPendingTranscriptions, generateQuestions, slides, handleFinishQAndA, uploadVideoIfAvailable, sessionId]);
  
  const processFile = async (file: File) => {
    if (file && file.type === "application/vnd.openxmlformats-officedocument.presentationml.presentation") {
      setPptxFile(file);
      setIsParsing(true);
      setError(null);
      setSlides([]);
      try {
        const slideTexts = await parsePptx(file);
        setSlides(slideTexts);
        setCurrentSlide(0);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not parse presentation.");
        setPptxFile(null);
      } finally {
        setIsParsing(false);
      }
    } else {
      setError("Invalid file type. Please upload a .pptx file.");
    }
  };
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files?.[0]) processFile(event.target.files[0]);
  };
  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);
    if (event.dataTransfer.files?.[0]) processFile(event.dataTransfer.files[0]);
  };
  const handleDragEvents = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.type === 'dragover') setIsDragOver(true);
    if (event.type === 'dragleave' || event.type === 'dragend') setIsDragOver(false);
  };
  const handleNextSlide = () => setCurrentSlide(prev => Math.min(prev + 1, slides.length - 1));
  const handlePrevSlide = () => setCurrentSlide(prev => Math.max(prev - 1, 0));

  const renderContent = () => {
    switch (status) {
      case SessionStatus.COMPLETE:
        return (
          <div className="w-full grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <FeedbackCard feedback={feedback} />
            <EngagementDashboard analysis={engagementAnalysis} isPending={isAnalysisPending} />
          </div>
        );
      case SessionStatus.LISTENING: {
        const [hours = '00', minutes = '00', seconds = '00'] = elapsedTime.split(':');

        return (
          <div className="w-full grid gap-6 xl:grid-cols-[minmax(0,2.1fr)_minmax(0,1fr)]">
            <div className="space-y-6">
              <section className="bg-slate-900/80 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl">
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800/60">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-100">Presenter View</h2>
                    <p className="text-xs uppercase tracking-wide text-slate-500">Primary camera feed</p>
                  </div>
                  <select
                    className="bg-slate-900 border border-slate-700/80 rounded-xl text-sm text-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    value={selectedSpeakerCamera}
                    onChange={(event) => setSelectedSpeakerCamera(event.target.value)}
                  >
                    {cameraDevices.map((device, index) => (
                      <option key={device.deviceId || index} value={device.deviceId}>
                        {formatCameraLabel(device, index)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="relative bg-slate-950 aspect-video">
                  {speakerStreamRef.current ? (
                    <video ref={speakerVideoRef} muted playsInline className="w-full h-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-slate-500 text-sm">Camera loading...</div>
                  )}
                  <div className="absolute top-4 left-4 flex items-center gap-2 bg-slate-900/70 backdrop-blur-sm px-3 py-1.5 rounded-full text-xs uppercase tracking-wide text-slate-200">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    Presenter
                  </div>
                </div>
              </section>

              <section className="bg-slate-900/80 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl">
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800/60">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-100">Audience View</h2>
                    <p className="text-xs uppercase tracking-wide text-slate-500">Secondary camera feed</p>
                  </div>
                  <select
                    className="bg-slate-900 border border-slate-700/80 rounded-xl text-sm text-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    value={selectedListenerCamera}
                    onChange={(event) => setSelectedListenerCamera(event.target.value)}
                  >
                    {cameraDevices.map((device, index) => (
                      <option key={device.deviceId || index} value={device.deviceId}>
                        {formatCameraLabel(device, index)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="relative bg-slate-950 aspect-video">
                  {listenerStreamRef.current ? (
                    <video ref={listenerVideoRef} muted playsInline className="w-full h-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-slate-500 text-sm">Camera loading...</div>
                  )}
                  <div className="absolute top-4 left-4 flex items-center gap-2 bg-slate-900/70 backdrop-blur-sm px-3 py-1.5 rounded-full text-xs uppercase tracking-wide text-slate-200">
                    <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse"></span>
                    Audience
                  </div>
                </div>
              </section>

              <section className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 shadow-2xl">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-100">Slides &amp; Notes</h3>
                    <p className="text-xs uppercase tracking-wide text-slate-500">Reference content</p>
                  </div>
                  <div className="flex gap-2">
                    <ControlButton onClick={handlePrevSlide} disabled={currentSlide === 0} variant="secondary">
                      <i className="fas fa-chevron-left"></i>
                    </ControlButton>
                    <ControlButton onClick={handleNextSlide} disabled={currentSlide === slides.length - 1} variant="secondary">
                      <i className="fas fa-chevron-right"></i>
                    </ControlButton>
                  </div>
                </div>
                <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 h-64 overflow-y-auto text-left">
                  <h4 className="text-sm font-semibold text-indigo-300 mb-2">
                    Slide {currentSlide + 1} of {slides.length}
                  </h4>
                  <p className="text-slate-200 whitespace-pre-wrap leading-relaxed">
                    {slides[currentSlide] || 'This slide has no text content.'}
                  </p>
                </div>
              </section>
            </div>

            <div className="space-y-6">
              <section className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 shadow-2xl">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-100">Controls &amp; Status</h3>
                    <p className="text-xs uppercase tracking-wide text-slate-500">Session management</p>
                  </div>
                  <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-rose-400">
                    <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>
                    REC
                  </span>
                </div>

                <div className="mt-6 grid grid-cols-3 gap-4">
                  <button
                    type="button"
                    onClick={toggleMicrophone}
                    className={`flex flex-col items-center justify-center gap-2 rounded-2xl py-4 transition-all border ${
                      isMicrophoneMuted
                        ? 'bg-slate-900 text-slate-400 border-slate-700'
                        : 'bg-indigo-500/20 text-indigo-200 border-indigo-500/40 shadow-lg shadow-indigo-900/40'
                    }`}
                  >
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-500 text-white text-lg">
                      <i className={`fas ${isMicrophoneMuted ? 'fa-microphone-slash' : 'fa-microphone'}`}></i>
                    </span>
                    <span className="text-xs uppercase tracking-wide">Microphone</span>
                    <span className="text-sm font-medium">{isMicrophoneMuted ? 'Muted' : 'Active'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={toggleVideo}
                    className={`flex flex-col items-center justify-center gap-2 rounded-2xl py-4 transition-all border ${
                      isVideoPaused
                        ? 'bg-slate-900 text-slate-400 border-slate-700'
                        : 'bg-slate-900 text-slate-200 border-slate-700'
                    }`}
                  >
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-800 text-slate-200 text-lg">
                      <i className={`fas ${isVideoPaused ? 'fa-video-slash' : 'fa-video'}`}></i>
                    </span>
                    <span className="text-xs uppercase tracking-wide">Video</span>
                    <span className="text-sm font-medium">{isVideoPaused ? 'Paused' : 'Streaming'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleStopPresentation}
                    className="flex flex-col items-center justify-center gap-2 rounded-2xl py-4 transition-all border bg-rose-500/10 text-rose-200 border-rose-500/40 hover:bg-rose-500/20"
                  >
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-500 text-white text-lg">
                      <i className="fas fa-stop"></i>
                    </span>
                    <span className="text-xs uppercase tracking-wide">Finish</span>
                    <span className="text-sm font-medium">End &amp; Review</span>
                  </button>
                </div>

                <div className="mt-6 grid grid-cols-3 gap-4 text-center">
                  <div className="bg-slate-950/60 border border-slate-800 rounded-2xl py-4 shadow-inner">
                    <span className="text-xs uppercase tracking-wide text-slate-500">Hours</span>
                    <p className="mt-2 text-2xl font-semibold text-slate-200">{hours}</p>
                  </div>
                  <div className="bg-slate-950/60 border border-slate-800 rounded-2xl py-4 shadow-inner">
                    <span className="text-xs uppercase tracking-wide text-slate-500">Minutes</span>
                    <p className="mt-2 text-2xl font-semibold text-slate-200">{minutes}</p>
                  </div>
                  <div className="bg-slate-950/60 border border-slate-800 rounded-2xl py-4 shadow-inner">
                    <span className="text-xs uppercase tracking-wide text-slate-500">Seconds</span>
                    <p className="mt-2 text-2xl font-semibold text-slate-200">{seconds}</p>
                  </div>
                </div>
              </section>

              <section className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 shadow-2xl h-full flex flex-col">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-100">Live Transcription</h3>
                    <p className="text-xs uppercase tracking-wide text-slate-500">Automated captions</p>
                  </div>
                  <i className="fas fa-wave-square text-indigo-400 text-xl"></i>
                </div>
                <div className="flex-1 overflow-y-auto pr-2 space-y-3 text-left">
                  {transcriptionHistory
                    .filter((entry) => entry.context === 'presentation')
                    .slice(-20)
                    .map((entry, index) => (
                      <div key={index} className="text-sm leading-relaxed text-slate-300">
                        <span className="text-indigo-300/90 font-mono text-xs mr-2">{String(index + 1).padStart(2, '0')}</span>
                        {entry.text}
                      </div>
                    ))}
                  <p className="text-indigo-200/80 text-sm leading-relaxed font-medium">
                    {liveTranscript || 'Recording in progress...'}
                  </p>
                </div>
              </section>
            </div>
          </div>
        );
      }
      case SessionStatus.PROCESSING:
        return (
          <div className="flex flex-col items-center gap-6">
            <i className="fas fa-spinner fa-spin fa-3x text-indigo-400"></i>
            <p className="mt-4 text-xl font-medium text-slate-300">
              {status === SessionStatus.CONNECTING ? "Connecting to Judge..." :
               status === SessionStatus.GENERATING_QUESTIONS ? "Preparing Questions..." :
               "Analyzing Your Performance..."}
            </p>
          </div>
        );
      case SessionStatus.GENERATING_QUESTIONS:
      case SessionStatus.CONNECTING:
        return (
          <div className="flex flex-col items-center justify-center text-center">
            <i className="fas fa-spinner fa-spin fa-3x text-indigo-400"></i>
            <p className="mt-4 text-xl font-medium text-slate-300">
              {status === SessionStatus.CONNECTING ? "Connecting to Judge..." :
               status === SessionStatus.GENERATING_QUESTIONS ? "Preparing Questions..." :
               "Analyzing Your Performance..."}
            </p>
          </div>
        );
      default: // IDLE or ERROR
        return (
             <div className="w-full max-w-3xl text-center">
                <h1 className="text-5xl font-extrabold text-slate-100">Welcome to <span className="text-indigo-400">AI Hackathon Judge</span></h1>
                <p className="mt-4 text-lg text-slate-400 max-w-2xl mx-auto">Ready to ace your hackathon pitch? Upload your presentation to get started.</p>
                <div 
                    className={`mt-10 p-8 border-2 border-dashed rounded-2xl transition-colors duration-300 ${isDragOver ? 'border-indigo-400 bg-slate-800/50' : 'border-slate-700'}`}
                    onDrop={handleDrop} onDragOver={handleDragEvents} onDragLeave={handleDragEvents} onDragEnd={handleDragEvents}
                >
                    {!pptxFile && !isParsing && (
                        <>
                            <div className="flex flex-col items-center justify-center">
                                <i className="fas fa-cloud-upload-alt fa-3x mb-4 text-slate-500"></i>
                                <h2 className="text-2xl font-semibold text-slate-300">Drag & Drop Your Presentation</h2>
                                <p className="mt-2 text-slate-500">or</p>
                                <input type="file" id="file-upload" className="hidden" accept=".pptx" onChange={handleFileChange} disabled={isParsing} />
                                <label htmlFor="file-upload" className="mt-4 cursor-pointer bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-4 rounded-full transition-colors duration-300">
                                    Browse Files
                                </label>
                                <p className="mt-4 text-xs text-slate-600">Supported format: .pptx</p>
                            </div>
                        </>
                    )}
                    {isParsing && (
                        <div className="flex items-center justify-center text-lg text-yellow-400">
                            <i className="fas fa-spinner fa-spin mr-3"></i>
                            Parsing your presentation...
                        </div>
                    )}
                    {pptxFile && !isParsing && slides.length > 0 && (
                        <div className="flex flex-col items-center justify-center">
                            <i className="fas fa-check-circle fa-3x mb-4 text-green-400"></i>
                            <h2 className="text-2xl font-semibold text-slate-300">Presentation Ready</h2>
                            <p className="mt-2 text-slate-400">"{pptxFile.name}" is loaded with {slides.length} slides.</p>
                        </div>
                    )}
                </div>
            </div>
        );
    }
  };

  return (
    <div className="min-h-screen flex flex-col p-4 sm:p-6 lg:p-8 font-sans">
      <header className="w-full max-w-7xl mx-auto flex justify-between items-center pb-4">
        <div className="flex items-center gap-3">
          <PitchPerfectIcon className="w-8 h-8" />
          <h1 className="text-2xl font-bold text-slate-200 tracking-tight">AI Hackathon Judge</h1>
        </div>
        <div className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
            <a href="#" className="hover:text-indigo-400 transition-colors">Dashboard</a>
            <a href="#" className="hover:text-indigo-400 transition-colors">Evaluations</a>
            <a href="#" className="hover:text-indigo-400 transition-colors">Resources</a>
        </div>
      </header>
      
      <main className="w-full max-w-7xl mx-auto flex-grow flex flex-col items-center justify-center text-center space-y-4">
        {error && <p className="bg-red-900/50 text-red-300 border border-red-700 rounded-lg p-4 mb-2 max-w-2xl w-full">{error}</p>}
        {permissionInfo && !error && (
          <p className="bg-emerald-900/40 text-emerald-300 border border-emerald-700 rounded-lg p-3 max-w-2xl w-full">
            {permissionInfo}
          </p>
        )}
        {!hasMediaPermissions && (
          <ControlButton onClick={handleRequestPermissions} variant="secondary" className="self-center">
            <i className="fas fa-video mr-2"></i>
            Enable Camera &amp; Microphone
          </ControlButton>
        )}
        {renderContent()}
      </main>

      <div className="hidden">
        <canvas ref={speakerCanvasRef} className="hidden" />
        <canvas ref={listenerCanvasRef} className="hidden" />
      </div>
      
      <footer className="w-full max-w-7xl mx-auto mt-8 h-16 flex items-center justify-center">
        {status === SessionStatus.IDLE || status === SessionStatus.COMPLETE || status === SessionStatus.ERROR ? (
          <ControlButton
            onClick={status === SessionStatus.IDLE ? handleStart : resetState}
            disabled={slides.length === 0 || isParsing || (!hasMediaPermissions && status === SessionStatus.IDLE)}
          >
            <i className={`fas ${status === SessionStatus.IDLE ? 'fa-play' : 'fa-redo'} mr-2`}></i>
            {status === SessionStatus.IDLE ? 'Start Judging' : 'Start New Evaluation'}
          </ControlButton>
        ) : status === SessionStatus.LISTENING ? (
          <ControlButton onClick={handleStopPresentation} variant="danger">
            <i className="fas fa-stop mr-2"></i> Finish Presentation & Start Q&A
          </ControlButton>
        ) : null}
      </footer>
    </div>
  );
};

export default App;
