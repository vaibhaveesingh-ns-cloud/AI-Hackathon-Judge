import React, { useState, useRef, useCallback, useEffect } from 'react';
import { SessionStatus, TranscriptionEntry, PresentationFeedback } from './types';
import PitchPerfectIcon from './components/PitchPerfectIcon';
import ControlButton from './components/ControlButton';
import FeedbackCard from './components/FeedbackCard';
import { getFinalPresentationFeedback, generateQuestions, transcribePresentationAudio } from './services/openaiService';
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

type SpeechRecognitionConstructor = new () => any;

const getSpeechRecognitionConstructor = (): SpeechRecognitionConstructor | null => {
    if (typeof window === 'undefined') return null;
    return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
};

const FRAME_CAPTURE_INTERVAL = 5000; // Capture a frame every 5 seconds

const App: React.FC = () => {
  const [status, setStatus] = useState<SessionStatus>(SessionStatus.IDLE);
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const [transcriptionHistory, setTranscriptionHistory] = useState<TranscriptionEntry[]>([]);
  const [liveTranscript, setLiveTranscript] = useState<string>("");
  const [feedback, setFeedback] = useState<PresentationFeedback | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasMediaPermissions, setHasMediaPermissions] = useState(false);
  const [permissionInfo, setPermissionInfo] = useState<string | null>(null);

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
  const recordedAudioChunksRef = useRef<Blob[]>([]);
  const speechRecognitionRef = useRef<any>(null);
  const shouldRestartRecognitionRef = useRef<boolean>(false);

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

  const stopSpeechRecognition = useCallback(() => {
    shouldRestartRecognitionRef.current = false;
    const recognition = speechRecognitionRef.current;
    if (recognition) {
      try {
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        recognition.stop();
      } catch (stopError) {
        console.debug('Speech recognition stop error:', stopError);
      }
    }
    speechRecognitionRef.current = null;
    setLiveTranscript('');
  }, []);

  const stopMediaProcessing = useCallback(() => {
    stopStream(speakerStreamRef, speakerFrameIntervalRef, speakerVideoRef);
    stopStream(listenerStreamRef, listenerFrameIntervalRef, listenerVideoRef);

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    mediaRecorderRef.current = null;
    stopSpeechRecognition();
  }, [stopStream, stopSpeechRecognition]);

  const stopRecordingAndCollectAudio = useCallback(async (): Promise<Blob | null> => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) {
      if (recordedAudioChunksRef.current.length > 0) {
        const fallbackBlob = new Blob(recordedAudioChunksRef.current, { type: 'audio/webm' });
        recordedAudioChunksRef.current = [];
        return fallbackBlob;
      }
      return null;
    }

    if (recorder.state === 'inactive') {
      mediaRecorderRef.current = null;
      const existingBlob = recordedAudioChunksRef.current.length > 0
        ? new Blob(recordedAudioChunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        : null;
      recordedAudioChunksRef.current = [];
      return existingBlob;
    }

    return new Promise((resolve) => {
      recorder.onstop = () => {
        const blob = recordedAudioChunksRef.current.length > 0
          ? new Blob(recordedAudioChunksRef.current, { type: recorder.mimeType || 'audio/webm' })
          : null;
        mediaRecorderRef.current = null;
        recordedAudioChunksRef.current = [];
        resolve(blob);
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
    setLiveTranscript("");
    speakerVideoFramesRef.current = [];
    listenerVideoFramesRef.current = [];
    setCurrentSlide(0);
    setQuestions([]);
    setPptxFile(null);
    setSlides([]);
    recordedAudioChunksRef.current = [];
  }

  const startSpeechRecognition = useCallback(() => {
    const SpeechRecognitionCtor = getSpeechRecognitionConstructor();
    if (!SpeechRecognitionCtor) {
      setPermissionInfo((prev) => prev ?? 'Live transcription is not supported in this browser. Recording will still be analyzed.');
      return;
    }

    try {
      const recognition = new SpeechRecognitionCtor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      speechRecognitionRef.current = recognition;
      shouldRestartRecognitionRef.current = true;

      recognition.onresult = (event: any) => {
        let interimAggregate = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const transcript: string = result[0]?.transcript?.trim() ?? '';
          if (!transcript) continue;

          if (result.isFinal) {
            setTranscriptionHistory((prev) => [
              ...prev,
              { speaker: 'user', text: transcript, context: 'presentation' },
            ]);
            setLiveTranscript('');
          } else {
            interimAggregate = `${interimAggregate} ${transcript}`.trim();
          }
        }

        if (interimAggregate) {
          setLiveTranscript(interimAggregate);
        }
      };

      recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event);
      };

      recognition.onend = () => {
        if (shouldRestartRecognitionRef.current && recognition) {
          try {
            recognition.start();
          } catch (restartError) {
            console.error('Speech recognition restart failed:', restartError);
          }
        }
      };

      recognition.start();
    } catch (recognitionError) {
      console.error('Speech recognition initialization failed:', recognitionError);
      setPermissionInfo((prev) => prev ?? 'Live transcription could not be started. Recording will still be analyzed.');
      speechRecognitionRef.current = null;
      shouldRestartRecognitionRef.current = false;
    }
  }, [setTranscriptionHistory, setLiveTranscript, setPermissionInfo]);

  const handleStart = useCallback(async () => {
    setStatus(SessionStatus.CONNECTING);
    setError(null);
    setFeedback(null);
    setTranscriptionHistory([]);
    setLiveTranscript("");
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
        recordedAudioChunksRef.current = [];
        try {
            const recorder = new MediaRecorder(audioStream, { mimeType: 'audio/webm' });
            recorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) recordedAudioChunksRef.current.push(event.data);
            };
            recorder.start();
            mediaRecorderRef.current = recorder;
        } catch (recorderError) {
            console.error('MediaRecorder error:', recorderError);
            throw new Error('Could not start audio recording. Please check browser compatibility.');
        }

        setLiveTranscript('Recording in progress...');

        startSpeechRecognition();

        setStatus(SessionStatus.LISTENING);
    } catch (err) {
        const msg = getMediaErrorMessage(err);
        setHasMediaPermissions(false);
        setError(msg);
        setStatus(SessionStatus.ERROR);
        stopMediaProcessing();
    }
  }, [requestMediaStream, stopMediaProcessing, startSpeechRecognition, attachStreamToVideo, startFrameCapture, selectedSpeakerCamera, selectedListenerCamera]);

  const handleFinishQAndA = useCallback(async (
    providedQuestions?: string[],
    historyOverride?: TranscriptionEntry[]
  ) => {
    setStatus(SessionStatus.PROCESSING);
    stopMediaProcessing();

    const finalHistory = historyOverride ?? transcriptionHistory;
    const questionSet = providedQuestions ?? questions;

    const combinedFrames = [...speakerVideoFramesRef.current, ...listenerVideoFramesRef.current];
    const finalFeedback = await getFinalPresentationFeedback(finalHistory, combinedFrames, slides, questionSet);
    if (finalFeedback) {
      setFeedback(finalFeedback);
      setStatus(SessionStatus.COMPLETE);
    } else {
      setError('Could not generate feedback. The presentation may have been too short.');
      setStatus(SessionStatus.ERROR);
    }
  }, [transcriptionHistory, stopMediaProcessing, slides, questions]);
  
  const handleStopPresentation = useCallback(async () => {
    setStatus(SessionStatus.PROCESSING);

    const audioBlob = await stopRecordingAndCollectAudio();
    stopMediaProcessing();

    if (!audioBlob) {
      setError('No audio was captured. Please ensure your microphone is working.');
      setStatus(SessionStatus.ERROR);
      return;
    }

    let presentationTranscript = '';
    try {
      presentationTranscript = await transcribePresentationAudio(audioBlob);
    } catch (transcriptionError) {
      console.error('Transcription failed:', transcriptionError);
    }

    if (!presentationTranscript.trim()) {
      setError('Could not transcribe the presentation audio. Please try again.');
      setStatus(SessionStatus.ERROR);
      return;
    }

    const updatedHistory: TranscriptionEntry[] = [
      { speaker: 'user', text: presentationTranscript, context: 'presentation' },
    ];
    setTranscriptionHistory(updatedHistory);
    setLiveTranscript(presentationTranscript);

    setStatus(SessionStatus.GENERATING_QUESTIONS);
    const generatedQuestions = await generateQuestions(updatedHistory, slides);
    setQuestions(generatedQuestions);

    await handleFinishQAndA(generatedQuestions, updatedHistory);
  }, [stopRecordingAndCollectAudio, stopMediaProcessing, transcribePresentationAudio, generateQuestions, slides, handleFinishQAndA]);
  
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
        return <FeedbackCard feedback={feedback} />;
      case SessionStatus.LISTENING:
        return (
          <div className="grid grid-cols-1 xl:grid-cols-4 gap-6 w-full h-[75vh]">
            <div className="xl:col-span-2 bg-slate-900/50 backdrop-blur-sm border border-slate-800 rounded-2xl p-6 flex flex-col justify-between">
              <div className="flex-grow overflow-y-auto pr-2">
                <h3 className="text-xl font-bold text-indigo-400 mb-4 sticky top-0 bg-slate-900 pb-2">Slide {currentSlide + 1} of {slides.length}</h3>
                <p className="text-slate-300 whitespace-pre-wrap text-lg leading-relaxed">{slides[currentSlide] || "This slide has no text content."}</p>
              </div>
              <div className="flex justify-center items-center gap-4 mt-4 flex-shrink-0">
                <ControlButton onClick={handlePrevSlide} disabled={currentSlide === 0} variant="secondary"><i className="fas fa-arrow-left"></i></ControlButton>
                <ControlButton onClick={handleNextSlide} disabled={currentSlide === slides.length - 1} variant="secondary"><i className="fas fa-arrow-right"></i></ControlButton>
              </div>
            </div>
            <div className="xl:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4 flex flex-col shadow-lg">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-lg font-semibold text-indigo-400">Speaker Camera</h3>
                    <p className="text-xs text-slate-400">Presenter point of view</p>
                  </div>
                  <select
                    className="bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 px-3 py-1"
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
                <div className="relative overflow-hidden rounded-xl border border-slate-800 bg-slate-950 flex-1 min-h-[220px]">
                  {speakerStreamRef.current ? (
                    <video ref={speakerVideoRef} muted playsInline className="w-full h-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-slate-500 text-sm">
                      Camera loading...
                    </div>
                  )}
                  <div className="absolute bottom-3 right-3 flex items-center gap-2 bg-slate-900/70 backdrop-blur-sm px-3 py-1.5 rounded-full text-xs uppercase tracking-wide text-slate-200">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    Speaker
                  </div>
                </div>
              </div>

              <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4 flex flex-col shadow-lg">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-lg font-semibold text-indigo-400">Audience Camera</h3>
                    <p className="text-xs text-slate-400">Judge perspective</p>
                  </div>
                  <select
                    className="bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 px-3 py-1"
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
                <div className="relative overflow-hidden rounded-xl border border-slate-800 bg-slate-950 flex-1 min-h-[220px]">
                  {listenerStreamRef.current ? (
                    <video ref={listenerVideoRef} muted playsInline className="w-full h-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-slate-500 text-sm">
                      Camera loading...
                    </div>
                  )}
                  <div className="absolute bottom-3 right-3 flex items-center gap-2 bg-slate-900/70 backdrop-blur-sm px-3 py-1.5 rounded-full text-xs uppercase tracking-wide text-slate-200">
                    <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse"></span>
                    Audience
                  </div>
                </div>
              </div>

              <div className="md:col-span-2 bg-slate-900/50 backdrop-blur-sm border border-slate-800 rounded-2xl p-4 flex flex-col shadow-lg min-h-[180px]">
                <h3 className="text-lg font-semibold text-indigo-400 mb-2 flex-shrink-0">Live Transcript</h3>
                <div className="overflow-y-auto flex-grow text-slate-300">
                  {transcriptionHistory.filter((entry) => entry.context === 'presentation').map((entry, index) => (
                    <p key={index}>{entry.text}</p>
                  ))}
                  <p className="text-slate-400/80">{liveTranscript}</p>
                </div>
              </div>
            </div>
          </div>
        );
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
