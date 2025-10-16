import { GoogleGenAI, Type } from '@google/genai';
import { PresentationFeedback, TranscriptionEntry } from '../types';
import { getGeminiApiKey } from '../utils/getGeminiApiKey';

const ai = new GoogleGenAI({ apiKey: getGeminiApiKey() });

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
        clarity: { type: Type.NUMBER, description: 'Score (0-10) for clarity of speech and messaging.' },
        engagement: { type: Type.NUMBER, description: 'Score (0-10) for audience engagement and energy.' },
        structure: { type: Type.NUMBER, description: 'Score (0-10) for logical flow and organization.' },
        delivery: { type: Type.NUMBER, description: 'Score (0-10) for visual delivery from provided frames.' },
        audienceConnection: { type: Type.NUMBER, description: 'Score (0-10) for audience attentiveness and reactions.' },
        slideUsage: { type: Type.NUMBER, description: 'Score (0-10) for how effectively slides supported the story.' }
      },
      required: ['clarity', 'engagement', 'structure', 'delivery', 'audienceConnection', 'slideUsage']
    },
    scoreReasons: {
      type: Type.OBJECT,
      properties: {
        clarity: { type: Type.STRING, description: 'Reasoning behind the clarity score backed by presentation evidence.' },
        engagement: { type: Type.STRING, description: 'Reasoning behind the engagement score backed by presentation evidence.' },
        structure: { type: Type.STRING, description: 'Reasoning behind the structure score backed by presentation evidence.' },
        delivery: { type: Type.STRING, description: 'Reasoning behind the delivery score backed by presentation evidence.' },
        audienceConnection: { type: Type.STRING, description: 'Reasoning behind the audience connection score backed by presentation evidence.' },
        slideUsage: { type: Type.STRING, description: 'Reasoning behind the slide usage score backed by presentation evidence.' }
      },
      required: ['clarity', 'engagement', 'structure', 'delivery', 'audienceConnection', 'slideUsage']
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

    CRITERIA (scores must be based only on the main presentation delivery and slide content; Q&A responses should not
    affect scoring):
    1. Clarity: Was the message clear and easy to understand?
    2. Engagement: Was the speaker energetic and engaging?
    3. Structure: Was the presentation well-organized with a logical flow?
    4. Delivery: Assess body language, eye contact, and gestures from the video frames.
    5. Audience Connection: Gauge attentiveness and reactions from the frames.
    6. Slide Usage: How effectively were the slides used as a visual aid vs. a script?

    Based on these criteria, provide scores from 0-10 for each category in the 'scoreBreakdown'. Also, calculate a weighted
    'overallScore'. Write a concise 'overallSummary', list the top 3-4 'strengths' and 'areasForImprovement', and supply a
    "scoreReasons" object with clear, evidence-grounded explanations (one per criterion) describing why each score was
    assigned.

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
    const feedback = JSON.parse(jsonText) as Omit<PresentationFeedback, 'questionsAsked'>;
    return {
      ...feedback,
      questionsAsked: derivedQuestions
    };
  } catch (error) {
    console.error('Error getting feedback from Gemini API:', error);
    return null;
  }
};