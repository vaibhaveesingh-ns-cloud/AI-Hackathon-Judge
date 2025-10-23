import { GoogleGenAI, Type } from '@google/genai';
import { PresentationFeedback, ScoreBreakdown, ScoreReasons, TranscriptionEntry } from '../types';
import { getGeminiApiKey } from '../utils/getGeminiApiKey';

const ai = new GoogleGenAI({ apiKey: getGeminiApiKey() });

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
  type: Type.OBJECT,
  properties: {
    overallScore: {
      type: Type.NUMBER,
      description: 'Overall weighted score from 0 to 10 based on presentation delivery and slides only.'
    },
    overallSummary: {
      type: Type.STRING,
      description: 'A brief, encouraging summary of the presentation performance.'
    },
    scoreBreakdown: {
      type: Type.OBJECT,
      properties: {
        delivery: { type: Type.NUMBER, description: 'Score (0-10) for delivery quality (presentation presence, body language, voice).' },
        engagement: { type: Type.NUMBER, description: 'Score (0-10) for sustaining audience engagement and energy.' },
        slides: { type: Type.NUMBER, description: 'Score (0-10) for slide craftsmanship and narrative support.' }
      },
      required: ['delivery', 'engagement', 'slides']
    },
    scoreReasons: {
      type: Type.OBJECT,
      properties: {
        delivery: { type: Type.STRING, description: 'Reasoning behind the delivery score backed by presentation evidence.' },
        engagement: { type: Type.STRING, description: 'Reasoning behind the engagement score backed by presentation evidence.' },
        slides: { type: Type.STRING, description: 'Reasoning behind the slides score backed by presentation evidence.' }
      },
      required: ['delivery', 'engagement', 'slides']
    },
    strengths: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Top strengths observed during the presentation.'
    },
    areasForImprovement: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Actionable improvement suggestions.'
    }
  },
  required: ['overallScore', 'overallSummary', 'scoreBreakdown', 'scoreReasons', 'strengths', 'areasForImprovement']
};

const questionsSchema = {
  type: Type.OBJECT,
  properties: {
    questions: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'A list of 3-5 insightful questions based on the presentation content.'
    }
  },
  required: ['questions']
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

  const prompt = `
    Based on the following presentation transcript and slide content, act as an insightful audience member and
    generate 3 to 5 thought-provoking questions to ask the presenter. The questions should be concise and clear.
    Return the questions in the specified JSON format.

    Transcript:
    ---
    ${fullTranscript}
    ---

    Slide Content:
    ---
    ${slideContent}
    ---
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: questionsSchema
      }
    });

    const jsonText = response.text;
    const result = JSON.parse(jsonText);
    return result.questions || [];
  } catch (error) {
    console.error('Error generating questions:', error);
    return [
      "I'm sorry, I couldn't think of a question right now. Please tell me more about your final thoughts."
    ];
  }
};

export const getFinalPresentationFeedback = async (
  transcriptionHistory: TranscriptionEntry[],
  videoFrames: string[],
  slideTexts: string[],
  questions: string[] = []
): Promise<PresentationFeedback | null> => {
  const presentationTranscript = transcriptionHistory
    .filter((entry) => entry.context === 'presentation')
    .map((entry) => entry.text)
    .join(' ');

  if (!presentationTranscript.trim()) {
    return null;
  }

  const derivedQuestions =
    questions.length > 0
      ? questions
      : transcriptionHistory
          .filter((entry) => entry.context === 'q&a' && entry.speaker === 'judge')
          .map((entry) => entry.text);

  const slideContent = slideTexts.length
    ? slideTexts.map((text, i) => `Slide ${i + 1}:\n${text}`).join('\n\n')
    : 'No slides were provided.';

  const prompt = `
    As an expert presentation coach, analyze the following materials: the main presentation transcript, the list of
    questions raised during Q&A, periodic video frames, and the text content from the presentation slides.

    Ignore any Q&A answers when evaluating performance; only the presentation delivery and slides should influence
    scores. Still, echo the provided questions in a 'questionsAsked' field of your JSON so they can be displayed on the
    evaluation scorecard.

    Evaluate strictly against three criteria (ignore Q&A responses when scoring):
    1. Delivery (40% weight): vocal presence plus PRESENTERCAM evidence such as body language, confidence, gestures, eye contact.
    2. Engagement (30% weight): ability to sustain audience interest, inferred from transcript energy and AUDIENCECAM reactions.
    3. Slides (30% weight): slide design quality, clarity, and alignment with the spoken narrative.

    Provide 0-10 scores for each criterion in "scoreBreakdown", apply the weights above for "overallScore", and supply
    evidence-backed explanations in "scoreReasons". Summarize the overall performance and outline strengths and areas for improvement.

    ---
    MAIN PRESENTATION TRANSCRIPT:
    ${presentationTranscript}
    ---

    SLIDE CONTENT:
    ${slideContent}
    ---

    QUESTIONS ASKED DURING Q&A (for context only; do not score answers):
    ${derivedQuestions.length > 0 ? derivedQuestions.join('\n\n') : 'No Q&A session was held.'}
    ---
  `;

  const textPart = { text: prompt };
  const imageParts = videoFrames.slice(0, 6).map((frameData) => ({
    inlineData: {
      mimeType: 'image/jpeg',
      data: frameData
    }
  }));

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: { parts: [textPart, ...imageParts] },
      config: {
        responseMimeType: 'application/json',
        responseSchema: feedbackSchema
      }
    });

    const jsonText = response.text;
    const rawFeedback = JSON.parse(jsonText) as Partial<Omit<PresentationFeedback, 'questionsAsked'>>;

    const normalizedBreakdown: ScoreBreakdown = {
      delivery: clampScore(rawFeedback.scoreBreakdown?.delivery),
      engagement: clampScore(rawFeedback.scoreBreakdown?.engagement),
      slides: clampScore(rawFeedback.scoreBreakdown?.slides)
    };

    const normalizedReasons: ScoreReasons = {
      delivery: rawFeedback.scoreReasons?.delivery ?? 'Delivery insights were not provided.',
      engagement: rawFeedback.scoreReasons?.engagement ?? 'Engagement insights were not provided.',
      slides: rawFeedback.scoreReasons?.slides ?? 'Slide insights were not provided.'
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
      questionsAsked: derivedQuestions
    };
  } catch (error) {
    console.error('Error getting feedback from Gemini API:', error);
    return null;
  }
};