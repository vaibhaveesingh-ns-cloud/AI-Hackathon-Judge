import OpenAI from 'openai';
import type {
  Response as OpenAIResponse,
  ResponseInput,
  ResponseInputItem,
  ResponseOutputItem,
  ResponseOutputMessage,
} from 'openai/resources/responses/responses';
import { PresentationFeedback, TranscriptionEntry } from '../types';
import { getOpenAIApiKey } from '../utils/getOpenAIApiKey';

const openai = new OpenAI({
  apiKey: getOpenAIApiKey(),
  dangerouslyAllowBrowser: true,
});

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
        Clarity: { type: 'number' },
        Engagement: { type: 'number' },
        Structure: { type: 'number' },
        Delivery: { type: 'number' },
        'Slide Usage': { type: 'number' },
      },
      required: ['Clarity', 'Engagement', 'Structure', 'Delivery', 'Slide Usage'],
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
  required: ['overallScore', 'overallSummary', 'scoreBreakdown', 'strengths', 'areasForImprovement'],
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

export const transcribePresentationAudio = async (audioBlob: Blob): Promise<string> => {
  try {
    const { type, extension } = normalizeAudioMimeType(audioBlob.type);
    const file = new File([audioBlob], `presentation.${extension}`, { type });

    const response = await openai.audio.transcriptions.create({
      file,
      model: 'gpt-4o-mini-transcribe',
    });

    return response.text ?? '';
  } catch (error) {
    console.error('Error transcribing audio:', error);
    throw error;
  }
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

  const derivedQuestions = questions.length
    ? questions
    : transcriptionHistory
        .filter((entry) => entry.context === 'q&a' && entry.speaker === 'judge')
        .map((entry) => entry.text);

  const slideContent = slideTexts.length
    ? slideTexts.map((text, i) => `Slide ${i + 1}:\n${text}`).join('\n\n')
    : 'No slides were provided.';

  const prompt = `As an expert presentation coach, analyze the following materials: the main presentation transcript, the list of questions raised during Q&A, periodic video frames, and the text content from the presentation slides.

Ignore any Q&A answers when evaluating performance; only the presentation delivery and slides should influence scores. Still, echo the provided questions in a "questionsAsked" field of your JSON so they can be displayed on the evaluation scorecard.

CRITERIA (scores must be based only on the main presentation delivery and slide content; Q&A responses should not affect scoring):
1. Clarity: Was the message clear and easy to understand?
2. Engagement: Was the speaker energetic and engaging?
3. Structure: Was the presentation well-organized with a logical flow?
4. Delivery: Assess body language, eye contact, and gestures from the video frames.
5. Slide Usage: How effectively were the slides used as a visual aid vs. a script?

Based on these criteria, provide scores from 0-10 for each category in the "scoreBreakdown". Also, calculate a weighted "overallScore". Write a concise "overallSummary", and list the top 3-4 "strengths" and "areasForImprovement".
---
MAIN PRESENTATION TRANSCRIPT:
${presentationTranscript}
---

SLIDE CONTENT:
${slideContent}

QUESTIONS ASKED DURING Q&A (for context only; do not score answers):
${derivedQuestions.length > 0 ? derivedQuestions.join('\n\n') : 'No Q&A session was held.'}
---`;

  const userMessage: ResponseInputItem.Message = {
    role: 'user',
    content: [{ type: 'input_text', text: prompt }],
    type: 'message',
  };

  videoFrames.slice(0, 6).forEach((frame) => {
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
    const feedback = JSON.parse(jsonText) as Omit<PresentationFeedback, 'questionsAsked'>;
    return {
      ...feedback,
      questionsAsked: derivedQuestions,
    };
  } catch (error) {
    console.error('Error getting feedback from OpenAI API:', error);
    return null;
  }
};
