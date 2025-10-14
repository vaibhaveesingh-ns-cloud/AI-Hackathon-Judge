import OpenAI from 'openai';
import { PresentationFeedback, TranscriptionEntry } from '../types';
import { getOpenAIApiKey } from '../utils/getOpenAIApiKey';

const openai = new OpenAI({
  apiKey: getOpenAIApiKey(),
  dangerouslyAllowBrowser: true,
});

const feedbackSchema = {
  type: 'object',
  properties: {
    overallScore: { type: 'number', description: 'Overall weighted score from 0 to 10.' },
    overallSummary: {
      type: 'string',
      description: 'A brief, encouraging summary of the entire presentation performance.',
    },
    scoreBreakdown: {
      type: 'object',
      properties: {
        Clarity: { type: 'number' },
        Engagement: { type: 'number' },
        Structure: { type: 'number' },
        Delivery: { type: 'number' },
        'Slide Usage': { type: 'number' },
        'Q&A': { type: 'number' },
      },
      required: ['Clarity', 'Engagement', 'Structure', 'Delivery', 'Slide Usage', 'Q&A'],
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
  properties: {
    questions: {
      type: 'array',
      items: { type: 'string' },
      description: 'A list of 3-5 insightful questions based on the provided presentation content.',
    },
  },
  required: ['questions'],
} as const;

const extractOutputText = (response: OpenAI.Beta.Responses.Response): string => {
  const text = response.output_text;
  if (text) return text;

  const parts = response.output
    ?.map((item) =>
      item.content
        .map((content) => ('text' in content ? content.text : ''))
        .join(' ')
        .trim()
    )
    .filter(Boolean);
  return parts?.join('\n') ?? '';
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
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'questions_schema',
          schema: questionsSchema,
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
  slideTexts: string[]
): Promise<PresentationFeedback | null> => {
  const presentationTranscript = transcriptionHistory
    .filter((entry) => entry.context === 'presentation')
    .map((entry) => entry.text)
    .join(' ');

  if (!presentationTranscript.trim()) {
    return null;
  }

  const qAndATranscript = transcriptionHistory
    .filter((entry) => entry.context === 'q&a')
    .map((entry) =>
      entry.speaker === 'judge'
        ? `Question was: "${entry.text}"`
        : `Answer was: "${entry.text}"`
    )
    .join('\n\n');

  const slideContent = slideTexts.length
    ? slideTexts.map((text, i) => `Slide ${i + 1}:\n${text}`).join('\n\n')
    : 'No slides were provided.';

  const prompt = `As an expert presentation coach, analyze the following materials: the main presentation transcript, a transcript of the follow-up Q&A session, periodic video frames, and the text content from the presentation slides.\n\nProvide a detailed, constructive, and encouraging critique. Your analysis must be in the specified JSON format.\n\nCRITERIA:\n1. Clarity: Was the message clear and easy to understand?\n2. Engagement: Was the speaker energetic and engaging?\n3. Structure: Was the presentation well-organized with a logical flow?\n4. Delivery: Assess body language, eye contact, and gestures from the video frames.\n5. Slide Usage: How effectively were the slides used as a visual aid vs. a script?\n6. Q&A Performance: How clear, confident, and accurate were the answers?\n\nBased on these criteria, provide scores from 0-10 for each category in the 'scoreBreakdown'. Also, calculate a weighted 'overallScore'. Write a concise 'overallSummary', and list the top 3-4 'strengths' and 'areasForImprovement'.\n---\nMAIN PRESENTATION TRANSCRIPT:\n${presentationTranscript}\n---\n\nSLIDE CONTENT:\n${slideContent}\n---\n\nQ&A SESSION TRANSCRIPT:\n${qAndATranscript.length > 0 ? qAndATranscript : 'No Q&A session was held.'}\n---`;

  const inputs: OpenAI.Input[] = [{ role: 'user', content: [{ type: 'text', text: prompt }] }];

  videoFrames.slice(0, 6).forEach((frame) => {
    inputs[0].content.push({
      type: 'input_image',
      image_base64: frame,
    });
  });

  try {
    const response = await openai.responses.create({
      model: 'gpt-4o-mini',
      input: inputs,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'feedback_schema',
          schema: feedbackSchema,
        },
      },
    });

    const jsonText = extractOutputText(response);
    const feedback = JSON.parse(jsonText) as PresentationFeedback;
    return feedback;
  } catch (error) {
    console.error('Error getting feedback from OpenAI API:', error);
    return null;
  }
};
