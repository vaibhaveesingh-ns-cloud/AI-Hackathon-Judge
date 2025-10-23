import OpenAI from 'openai';
import type {
  Response as OpenAIResponse,
  ResponseInput,
  ResponseInputItem,
  ResponseOutputItem,
  ResponseOutputMessage,
} from 'openai/resources/responses/responses';
import { PresentationFeedback, ScoreBreakdown, ScoreReasons, TranscriptionEntry } from '../types';
import finalFeedbackPromptTemplate from '../prompts/finalFeedbackPrompt.txt?raw';
import { getOpenAIApiKey } from '../utils/getOpenAIApiKey';

const openai = new OpenAI({
  apiKey: getOpenAIApiKey(),
  dangerouslyAllowBrowser: true,
});

const METRIC_WEIGHTS = {
  delivery: 0.4,
  engagement: 0.3,
  slides: 0.3,
} as const;

const clampScore = (value: unknown): number => {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  if (numeric < 0) return 0;
  if (numeric > 10) return 10;
  return numeric;
};

const feedbackSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    overallScore: { type: 'number', description: 'Overall weighted score from 0 to 10.' },
    overallSummary: {
      type: 'string',
      description: 'A brief, encouraging summary of the entire presentation performance.',
    },
    scoreBreakdown: {
      type: 'object',
      additionalProperties: false,
      properties: {
        delivery: { type: 'number' },
        engagement: { type: 'number' },
        slides: { type: 'number' },
      },
      required: ['delivery', 'engagement', 'slides'],
    },
    scoreReasons: {
      type: 'object',
      additionalProperties: false,
      properties: {
        delivery: { type: 'string' },
        engagement: { type: 'string' },
        slides: { type: 'string' },
      },
      required: ['delivery', 'engagement', 'slides'],
    },
    strengths: {
      type: 'array',
      items: { type: 'string' },
    },
    areasForImprovement: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['overallScore', 'overallSummary', 'scoreBreakdown', 'scoreReasons', 'strengths', 'areasForImprovement'],
} as const;

const questionsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    questions: {
      type: 'array',
      items: { type: 'string' },
      description: 'A list of 3-5 insightful questions based on the provided presentation content.',
    },
  },
  required: ['questions'],
} as const;

const isOutputMessage = (item: ResponseOutputItem): item is ResponseOutputMessage =>
  item.type === 'message';

const extractOutputText = (response: OpenAIResponse): string => {
  const text = response.output_text;
  if (text) return text;

  const parts = response.output
    ?.map((item) => {
      if (!isOutputMessage(item)) return '';
      return item.content
        .map((content) => (content.type === 'output_text' ? content.text : ''))
        .join(' ')
        .trim();
    })
    .filter((part) => Boolean(part));
  return parts?.join('\n') ?? '';
};

const normalizeAudioMimeType = (mimeType: string | undefined): { type: string; extension: string } => {
  if (!mimeType) return { type: 'audio/webm', extension: 'webm' };

  const lower = mimeType.toLowerCase();
  if (lower.includes('webm')) return { type: 'audio/webm', extension: 'webm' };
  if (lower.includes('ogg')) return { type: 'audio/ogg', extension: 'ogg' };
  if (lower.includes('mp3') || lower.includes('mpeg')) return { type: 'audio/mpeg', extension: 'mp3' };
  if (lower.includes('wav')) return { type: 'audio/wav', extension: 'wav' };
  if (lower.includes('m4a') || lower.includes('mp4')) return { type: 'audio/mp4', extension: 'm4a' };

  return { type: 'audio/webm', extension: 'webm' };
};

const cleanSegments = (segments: any[]): TranscriptionSegment[] =>
  segments
    .map((segment) => ({
      startMs: typeof segment?.startMs === 'number' ? segment.startMs : Number(segment?.start) * 1000 || 0,
      endMs: typeof segment?.endMs === 'number' ? segment.endMs : Number(segment?.end) * 1000 || 0,
      text: typeof segment?.text === 'string' ? segment.text.trim() : '',
    }))
    .filter((segment) => segment.text.length > 0);

export const resolveBackendUrl = (path: string): string => {
  const base =
    import.meta.env.VITE_API_BASE_URL ||
    import.meta.env.VITE_BACKEND_URL ||
    import.meta.env.VITE_API_URL ||
    '';

  if (!base) return path;
  if (base.endsWith('/') && path.startsWith('/')) return `${base.slice(0, -1)}${path}`;
  if (!base.endsWith('/') && !path.startsWith('/')) return `${base}/${path}`;
  return `${base}${path}`;
};

export interface TranscriptionSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface TranscriptionResponse {
  text: string;
  segments: TranscriptionSegment[];
}

export const transcribeAudioChunk = async (
  audioBlob: Blob,
  startMs = 0,
  durationMs = 0,
  preferredExtension?: string
): Promise<TranscriptionResponse> => {
  const { extension } = normalizeAudioMimeType(audioBlob.type);
  const effectiveExtension = preferredExtension || extension;
  const formData = new FormData();
  formData.append('file', audioBlob, `chunk.${effectiveExtension}`);
  formData.append('start_ms', String(startMs));
  formData.append('duration_ms', String(durationMs));

  const response = await fetch(resolveBackendUrl('/transcribe'), {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Transcription request failed (${response.status}): ${detail}`);
  }

  const data: any = await response.json();
  const text = typeof data?.text === 'string' ? data.text.trim() : '';
  const segmentsArray = Array.isArray(data?.segments) ? data.segments : [];

  return {
    text,
    segments: cleanSegments(segmentsArray),
  };
};

export const generateQuestions = async (
  transcriptionHistory: TranscriptionEntry[],
  slideTexts: string[]
): Promise<string[]> => {
  const fullTranscript = transcriptionHistory
    .filter((entry) => entry.context === 'presentation')
    .map((entry) => entry.text)
    .join(' ');

  if (!fullTranscript.trim()) return [];

  const slideContent = slideTexts.map((text, i) => `Slide ${i + 1}:\n${text}`).join('\n\n');

  const prompt = `Based on the following presentation transcript and slide content, act as an insightful audience member and generate 3 to 5 thought-provoking questions to ask the presenter. The questions should be concise and clear. Return the questions in the specified JSON format.\n\nTranscript:\n---\n${fullTranscript}\n---\n\nSlide Content:\n---\n${slideContent}\n---`;

  try {
    const response = await openai.responses.create({
      model: 'gpt-4o-mini',
      input: prompt,
      text: {
        format: {
          type: 'json_schema',
          name: 'questions_schema',
          schema: questionsSchema,
          strict: true,
        },
      },
    });

    const jsonText = extractOutputText(response);
    const parsed = JSON.parse(jsonText);
    return parsed.questions || [];
  } catch (error) {
    console.error('Error generating questions:', error);
    return [
      "I'm sorry, I couldn't think of a question right now. Please tell me more about your final thoughts.",
    ];
  }
};

export const getFinalPresentationFeedback = async (
  transcriptionHistory: TranscriptionEntry[],
  presenterFrames: string[],
  audienceFrames: string[],
  slideTexts: string[],
  questions: string[] = []
): Promise<PresentationFeedback | null> => {
  const presentationTranscript = transcriptionHistory
    .filter((entry) => entry.context === 'presentation')
    .map((entry) => entry.text)
    .join(' ');

  const transcriptWordCount = presentationTranscript.trim()
    ? presentationTranscript.trim().split(/\s+/).length
    : 0;

  const presenterEvidenceFrames = presenterFrames.filter(
    (frame) => typeof frame === 'string' && frame.trim().length > 0
  );
  const audienceEvidenceFrames = audienceFrames.filter(
    (frame) => typeof frame === 'string' && frame.trim().length > 0
  );

  const MAX_TOKENS = 6_000;
  const MIN_TRANSCRIPT_WORDS = 30;
  const MIN_PRESENTER_FRAMES = 1;
  const MIN_AUDIENCE_FRAMES = 1;

  if (transcriptWordCount === 0) {
    console.warn('No spoken transcript detected. Proceeding with slide and video evidence only.');
  } else if (transcriptWordCount < MIN_TRANSCRIPT_WORDS) {
    console.warn(`Transcript is shorter than recommended (${transcriptWordCount} words). Feedback quality may be limited.`);
  }

  if (presenterEvidenceFrames.length < MIN_PRESENTER_FRAMES) {
    throw new Error('Presenter camera feed was not captured. Ensure the presenter remains visible during recording.');
  }

  if (audienceEvidenceFrames.length < MIN_AUDIENCE_FRAMES) {
    console.warn('Audience camera feed was not captured. Engagement scoring will rely on available cues.');
  }

  const derivedQuestions = questions.length
    ? questions
    : transcriptionHistory
        .filter((entry) => entry.context === 'q&a' && entry.speaker === 'judge')
        .map((entry) => entry.text);

  const slideContent = slideTexts.length
    ? slideTexts.map((text, i) => `Slide ${i + 1}:\n${text}`).join('\n\n')
    : 'No slides were provided.';

  const prompt = finalFeedbackPromptTemplate
    .replace('{{PRESENTATION_TRANSCRIPT}}', presentationTranscript)
    .replace('{{SLIDE_CONTENT}}', slideContent)
    .replace('{{QUESTIONS_SECTION}}', derivedQuestions.length > 0 ? derivedQuestions.join('\n\n') : 'No Q&A session was held.');

  const userMessage: ResponseInputItem.Message = {
    role: 'user',
    content: [{ type: 'input_text', text: prompt }],
    type: 'message',
  };

  presenterEvidenceFrames.slice(0, 4).forEach((frame, index) => {
    userMessage.content.push({ type: 'input_text', text: `PRESENTERCAM frame ${index + 1}` });
    userMessage.content.push({
      type: 'input_image',
      image_url: frame.startsWith('data:') ? frame : `data:image/jpeg;base64,${frame}`,
      detail: 'auto',
    });
  });

  audienceEvidenceFrames.slice(0, 4).forEach((frame, index) => {
    userMessage.content.push({ type: 'input_text', text: `AUDIENCECAM frame ${index + 1}` });
    userMessage.content.push({
      type: 'input_image',
      image_url: frame.startsWith('data:') ? frame : `data:image/jpeg;base64,${frame}`,
      detail: 'auto',
    });
  });

  const inputs: ResponseInput = [userMessage];

  try {
    const response = await openai.responses.create({
      model: 'gpt-4o-mini',
      input: inputs,
      text: {
        format: {
          type: 'json_schema',
          name: 'feedback_schema',
          schema: feedbackSchema,
          strict: true,
        },
      },
    });

    const jsonText = extractOutputText(response);
    const rawFeedback = JSON.parse(jsonText) as Partial<Omit<PresentationFeedback, 'questionsAsked'>>;

    const normalizedBreakdown: ScoreBreakdown = {
      delivery: clampScore(rawFeedback.scoreBreakdown?.delivery),
      engagement: clampScore(rawFeedback.scoreBreakdown?.engagement),
      slides: clampScore(rawFeedback.scoreBreakdown?.slides),
    };

    const normalizedReasons: ScoreReasons = {
      delivery: rawFeedback.scoreReasons?.delivery ?? 'Delivery insights were not provided.',
      engagement: rawFeedback.scoreReasons?.engagement ?? 'Engagement insights were not provided.',
      slides: rawFeedback.scoreReasons?.slides ?? 'Slide insights were not provided.',
    };

    const computedOverall = Number(
      (
        normalizedBreakdown.delivery * METRIC_WEIGHTS.delivery +
        normalizedBreakdown.engagement * METRIC_WEIGHTS.engagement +
        normalizedBreakdown.slides * METRIC_WEIGHTS.slides
      ).toFixed(2)
    );

    const strengths = Array.isArray(rawFeedback.strengths) ? rawFeedback.strengths : [];
    const areasForImprovement = Array.isArray(rawFeedback.areasForImprovement)
      ? rawFeedback.areasForImprovement
      : [];
    const overallSummary = typeof rawFeedback.overallSummary === 'string' ? rawFeedback.overallSummary : '';

    return {
      overallScore: computedOverall,
      overallSummary,
      scoreBreakdown: normalizedBreakdown,
      scoreReasons: normalizedReasons,
      strengths,
      areasForImprovement,
      questionsAsked: derivedQuestions,
    };
  } catch (error) {
    console.error('Error getting feedback from OpenAI API:', error);
    return null;
  }
};
