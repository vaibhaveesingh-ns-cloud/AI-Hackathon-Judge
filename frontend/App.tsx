import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { SessionStatus, TranscriptionEntry, PresentationFeedback } from './types';
import PitchPerfectIcon from './components/PitchPerfectIcon';
import ControlButton from './components/ControlButton';
import FeedbackCard from './components/FeedbackCard';
import { getFinalPresentationFeedback, generateQuestions } from './services/geminiService';
import { parsePptx } from './utils/pptxParser';
import { getGeminiApiKey } from './utils/getGeminiApiKey';

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

const bufferToBase64 = (buffer: ArrayBuffer): string => {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    if (typeof window === 'undefined' || typeof window.btoa !== 'function') {
        throw new Error('Base64 encoding is not available in this environment.');
    }
    return window.btoa(binary);
};

const getSpeechRecognitionConstructor = (): (new () => any) | null => {
    if (typeof window === 'undefined') return null;
    return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
};

const ai = new GoogleGenAI({ apiKey: getGeminiApiKey() });

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
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const currentQuestionIndexRef = useRef(currentQuestionIndex);
  useEffect(() => {
    currentQuestionIndexRef.current = currentQuestionIndex;
  }, [currentQuestionIndex]);


  const sessionRef = useRef<Awaited<ReturnType<typeof ai.live.connect>> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const recognitionRef = useRef<any>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const currentTranscriptionRef = useRef<string>("");
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoFramesRef = useRef<string[]>([]);
  const frameIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (status === SessionStatus.LISTENING && videoRef.current && mediaStreamRef.current) {
        if (videoRef.current.srcObject !== mediaStreamRef.current) {
            videoRef.current.srcObject = mediaStreamRef.current;
            videoRef.current.play().catch(e => console.error("Video play failed:", e));
        }
    }
  }, [status]);

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

  const stopMediaProcessing = useCallback(() => {
    if (scriptProcessorRef.current) scriptProcessorRef.current.onaudioprocess = null;
    if (mediaStreamSourceRef.current) mediaStreamSourceRef.current.disconnect();
    if (scriptProcessorRef.current) scriptProcessorRef.current.disconnect();
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') audioContextRef.current.close().catch(console.error);
    if (mediaStreamRef.current) mediaStreamRef.current.getTracks().forEach(track => track.stop());
    if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
    if (videoRef.current) videoRef.current.srcObject = null;
    
    mediaStreamRef.current = null;
    audioContextRef.current = null;
    scriptProcessorRef.current = null;
    mediaStreamSourceRef.current = null;
    frameIntervalRef.current = null;
  }, []);

  const requestMediaStream = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('Media devices API is not supported in this browser.');
    }
    return navigator.mediaDevices.getUserMedia({ audio: true, video: true });
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
    setStatus(SessionStatus.IDLE);
    setError(null);
    setFeedback(null);
    setTranscriptionHistory([]);
    setLiveTranscript("");
    currentTranscriptionRef.current = "";
    videoFramesRef.current = [];
    setCurrentSlide(0);
    setQuestions([]);
    setCurrentQuestionIndex(0);
    setPptxFile(null);
    setSlides([]);
  }

  const handleStart = useCallback(async () => {
    setStatus(SessionStatus.CONNECTING);
    setError(null);
    setFeedback(null);
    setTranscriptionHistory([]);
    setLiveTranscript("");
    currentTranscriptionRef.current = "";
    videoFramesRef.current = [];
    setCurrentSlide(0);
    setQuestions([]);
    setCurrentQuestionIndex(0);

    try {
        const stream = await requestMediaStream();
        setHasMediaPermissions(true);
        setPermissionInfo(null);
        mediaStreamRef.current = stream;

        frameIntervalRef.current = window.setInterval(() => {
            if (videoRef.current && canvasRef.current) {
                const frame = getFrameAsBase64(videoRef.current, canvasRef.current);
                if (frame) videoFramesRef.current.push(frame);
            }
        }, FRAME_CAPTURE_INTERVAL);

        const sessionPromise = ai.live.connect({
            model: 'gemini-2.5-flash-native-audio-preview-09-2025',
            callbacks: {
                onopen: () => {
                    setStatus(SessionStatus.LISTENING);
                    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
                    audioContextRef.current = new AudioContext({ sampleRate: 16000 });
                    
                    mediaStreamSourceRef.current = audioContextRef.current.createMediaStreamSource(stream);
                    scriptProcessorRef.current = audioContextRef.current.createScriptProcessor(4096, 1, 1);
                    
                    scriptProcessorRef.current.onaudioprocess = (audioProcessingEvent) => {
                        const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                        const int16 = new Int16Array(inputData.length);
                        for (let i = 0; i < inputData.length; i++) int16[i] = inputData[i] * 32767;
                        const audioData = bufferToBase64(int16.buffer);
                        sessionPromise.then((session) => session.sendRealtimeInput({
                            media: {
                                mimeType: 'audio/pcm;rate=16000',
                                data: audioData,
                            }
                        }));
                    };

                    mediaStreamSourceRef.current.connect(scriptProcessorRef.current);
                    scriptProcessorRef.current.connect(audioContextRef.current.destination);
                },
                onmessage: (message: LiveServerMessage) => {
                    if (message.serverContent?.inputTranscription) {
                        const transcription = message.serverContent.inputTranscription;
                        currentTranscriptionRef.current += transcription.text;
                        setLiveTranscript(currentTranscriptionRef.current);
                        if((transcription as any).isFinal) {
                            const context = statusRef.current === SessionStatus.Q_AND_A ? 'q&a' : 'presentation';
                            const text = currentTranscriptionRef.current.trim();
                            if (text) {
                                if (context === 'q&a') {
                                    setTranscriptionHistory(prev => [
                                        ...prev, 
                                        { speaker: 'judge', text: questions[currentQuestionIndexRef.current], context: 'q&a' },
                                        { speaker: 'user', text, context: 'q&a' }
                                    ]);
                                } else {
                                    setTranscriptionHistory(prev => [...prev, { speaker: 'user', text, context }]);
                                }
                            }
                            currentTranscriptionRef.current = "";
                            setLiveTranscript("");
                        }
                    }
                },
                onerror: (e: ErrorEvent) => {
                    console.error('Session error:', e);
                    setError('A network connection error occurred. Please check your internet and firewall settings.');
                    setStatus(SessionStatus.ERROR);
                    stopMediaProcessing();
                },
                onclose: (e: CloseEvent) => {
                    if ([SessionStatus.LISTENING, SessionStatus.Q_AND_A].includes(statusRef.current)) {
                        setError('The connection to the judge was lost unexpectedly. Please try again.');
                        setStatus(SessionStatus.ERROR);
                        stopMediaProcessing();
                    }
                },
            },
            config: {
                responseModalities: [Modality.AUDIO],
                inputAudioTranscription: {},
                systemInstruction: 'You are a silent presentation judge. Your role is only to transcribe the user\'s speech. Do not generate any spoken response.',
            },
        });
        sessionRef.current = await sessionPromise;
    } catch (err) {
        const msg = getMediaErrorMessage(err);
        setHasMediaPermissions(false);
        setError(msg);
        setStatus(SessionStatus.ERROR);
    }
  }, [stopMediaProcessing, questions, requestMediaStream]);

  const handleStopPresentation = useCallback(async () => {
    setStatus(SessionStatus.GENERATING_QUESTIONS);
    let currentHistory = [...transcriptionHistory];
    if (currentTranscriptionRef.current.trim()) {
        currentHistory.push({ speaker: 'user', text: currentTranscriptionRef.current.trim(), context: 'presentation' });
        currentTranscriptionRef.current = "";
        setLiveTranscript("");
    }
    setTranscriptionHistory(currentHistory);

    const generatedQuestions = await generateQuestions(currentHistory, slides);
    if (generatedQuestions.length > 0) {
        setQuestions(generatedQuestions);
        setCurrentQuestionIndex(0);
        setStatus(SessionStatus.Q_AND_A);
    } else {
        await handleFinishQAndA();
    }
  }, [transcriptionHistory, slides]);

  const handleNextQuestion = useCallback(() => {
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
      currentTranscriptionRef.current = "";
      setLiveTranscript("");
    } else {
      handleFinishQAndA();
    }
  }, [currentQuestionIndex, questions]);
  
  const handleFinishQAndA = useCallback(async () => {
    setStatus(SessionStatus.PROCESSING);
    if (sessionRef.current) {
        sessionRef.current.close();
        sessionRef.current = null;
    }
    stopMediaProcessing();

    let finalHistory = [...transcriptionHistory];
    const lastAnswer = currentTranscriptionRef.current.trim();
    if (lastAnswer && questions.length > 0) {
        finalHistory.push({ speaker: 'judge', text: questions[currentQuestionIndex], context: 'q&a' });
        finalHistory.push({ speaker: 'user', text: lastAnswer, context: 'q&a' });
    }

    const finalFeedback = await getFinalPresentationFeedback(finalHistory, videoFramesRef.current, slides);
    if (finalFeedback) {
      setFeedback(finalFeedback);
      setStatus(SessionStatus.COMPLETE);
    } else {
      setError('Could not generate feedback. The presentation may have been too short.');
      setStatus(SessionStatus.ERROR);
    }
  }, [transcriptionHistory, stopMediaProcessing, slides, questions, currentQuestionIndex]);
  
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
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 w-full h-[75vh]">
            <div className="lg:col-span-2 bg-slate-900/50 backdrop-blur-sm border border-slate-800 rounded-2xl p-6 flex flex-col justify-between">
              <div className="flex-grow overflow-y-auto pr-2">
                <h3 className="text-xl font-bold text-indigo-400 mb-4 sticky top-0 bg-slate-900 pb-2">Slide {currentSlide + 1} of {slides.length}</h3>
                <p className="text-slate-300 whitespace-pre-wrap text-lg leading-relaxed">{slides[currentSlide] || "This slide has no text content."}</p>
              </div>
              <div className="flex justify-center items-center gap-4 mt-4 flex-shrink-0">
                <ControlButton onClick={handlePrevSlide} disabled={currentSlide === 0} variant="secondary"><i className="fas fa-arrow-left"></i></ControlButton>
                <ControlButton onClick={handleNextSlide} disabled={currentSlide === slides.length - 1} variant="secondary"><i className="fas fa-arrow-right"></i></ControlButton>
              </div>
            </div>
            <div className="flex flex-col gap-6 h-full">
              <div className="flex-1 bg-slate-900 rounded-2xl overflow-hidden border border-slate-800 shadow-lg min-h-[250px]">
                <video ref={videoRef} muted playsInline className="w-full h-full object-cover" />
              </div>
              <div className="flex-1 bg-slate-900/50 backdrop-blur-sm border border-slate-800 rounded-2xl p-4 flex flex-col shadow-lg min-h-[250px]">
                <h3 className="text-lg font-semibold text-indigo-400 mb-2 flex-shrink-0">Live Transcript</h3>
                <div className="overflow-y-auto flex-grow text-slate-300">
                  {transcriptionHistory.filter(e => e.context === 'presentation').map((e,i)=><p key={i}>{e.text}</p>)}
                  <p className="text-slate-400/80">{liveTranscript}</p>
                </div>
              </div>
            </div>
          </div>
        );
      case SessionStatus.Q_AND_A:
        return (
            <div className="w-full max-w-4xl flex flex-col items-center animate-fade-in">
                <div className="w-full bg-slate-900/50 backdrop-blur-sm border border-slate-800 rounded-2xl p-8 mb-6 text-center">
                    <p className="text-lg font-semibold text-indigo-400 mb-2">Question {currentQuestionIndex + 1} / {questions.length}</p>
                    <p className="text-3xl font-bold text-slate-100">{questions[currentQuestionIndex]}</p>
                </div>
                <div className="w-full bg-slate-900/50 rounded-2xl p-4 border border-slate-800 min-h-[8rem]">
                    <h3 className="text-lg font-semibold text-indigo-400 mb-2">Your Answer</h3>
                    <p className="text-left text-slate-300">{liveTranscript}</p>
                </div>
            </div>
        );
      case SessionStatus.PROCESSING:
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

      <canvas ref={canvasRef} className="hidden"></canvas>
      
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
        ) : status === SessionStatus.Q_AND_A ? (
           <ControlButton onClick={handleNextQuestion} variant="primary">
            <i className={`fas ${currentQuestionIndex < questions.length - 1 ? 'fa-arrow-right' : 'fa-check'} mr-2`}></i>
            {currentQuestionIndex < questions.length - 1 ? 'Next Question' : 'Finish Q&A'}
          </ControlButton>
        ) : null}
      </footer>
    </div>
  );
};

export default App;
