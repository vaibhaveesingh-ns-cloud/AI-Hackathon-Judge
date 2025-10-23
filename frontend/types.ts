export enum SessionStatus {
  IDLE = 'IDLE',
  CONNECTING = 'CONNECTING',
  LISTENING = 'LISTENING',
  GENERATING_QUESTIONS = 'GENERATING_QUESTIONS',
  Q_AND_A = 'Q_AND_A',
  PROCESSING = 'PROCESSING',
  COMPLETE = 'COMPLETE',
  ERROR = 'ERROR',
}

export interface TranscriptionEntry {
  speaker: 'user' | 'judge';
  text: string;
  context?: 'presentation' | 'q&a'; // Context to differentiate parts of the session
  startMs?: number;
  endMs?: number;
}

export interface ScoreBreakdown {
  clarity: number;
  engagement: number;
  structure: number;
  delivery: number;
  audienceConnection: number;
  slideUsage: number;
}

export interface ScoreReasons {
  clarity: string;
  engagement: string;
  structure: string;
  delivery: string;
  audienceConnection: string;
  slideUsage: string;
}

export interface PresentationFeedback {
  overallScore: number;
  overallSummary: string;
  scoreBreakdown: ScoreBreakdown;
  scoreReasons: ScoreReasons;
  presentationDuration?: string;
  strengths: string[];
  areasForImprovement: string[];
  questionsAsked: string[];
}

export interface VideoTimelineEntry {
  timestamp: number;
  emotion: string;
  engagement: string;
  smileScore: number;
  eyeOpenness: number;
  faceCount: number;
}

export interface VoiceMetrics {
  voiceEnergy: number;
  voiceArousal: number;
  raw: Record<string, number>;
}

export interface VideoAnalysisSummary {
  generatedAt: string;
  presenterDominantEmotion: string;
  audienceDominantEmotion: string;
  averagePresenterSmile: number;
  voiceEnergyLevel: string;
  voiceMetrics: VoiceMetrics;
  keyObservations: string[];
  engagementOverall: string;
}

export interface SessionEngagementAnalysis {
  sessionId: string;
  summary: VideoAnalysisSummary;
  presenterTimeline: VideoTimelineEntry[];
  audienceTimeline: VideoTimelineEntry[];
  voiceTimeline: number[];
}