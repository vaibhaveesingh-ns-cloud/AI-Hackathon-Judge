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
}

export interface ScoreBreakdown {
  Clarity: number;
  Engagement: number;
  Structure: number;
  Delivery: number;
  'Slide Usage': number;
}

export interface DetailedFeedback {
  category: keyof ScoreBreakdown;
  feedback: string;
}

export interface PresentationFeedback {
  overallScore: number;
  overallSummary: string;
  scoreBreakdown: ScoreBreakdown;
  strengths: string[];
  areasForImprovement: string[];
  questionsAsked: string[];
}