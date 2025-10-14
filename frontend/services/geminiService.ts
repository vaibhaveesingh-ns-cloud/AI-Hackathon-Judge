import { GoogleGenAI, Type } from '@google/genai';
import { PresentationFeedback, TranscriptionEntry } from '../types';
import { getGeminiApiKey } from '../utils/getGeminiApiKey';

const ai = new GoogleGenAI({ apiKey: getGeminiApiKey() });

const feedbackSchema = {
  type: Type.OBJECT,
  properties: {
    overallScore: { type: Type.NUMBER, description: 'Overall weighted score from 0 to 10.' },
    overallSummary: { type: Type.STRING, description: 'A brief, encouraging summary of the entire presentation performance.' },
    scoreBreakdown: {
        type: Type.OBJECT,
        properties: {
            Clarity: { type: Type.NUMBER, description: 'Score (0-10) for clarity of speech and message.' },
            Engagement: { type: Type.NUMBER, description: 'Score (0-10) for audience engagement, vocal tone, and energy.' },
            Structure: { type: Type.NUMBER, description: 'Score (0-10) for logical flow and organization.' },
            Delivery: { type: Type.NUMBER, description: 'Score (0-10) for visual delivery (body language, gestures, eye contact) based on images.' },
            'Slide Usage': { type: Type.NUMBER, description: 'Score (0-10) for how well slides were integrated as a visual aid.' },
            'Q&A': { type: Type.NUMBER, description: 'Score (0-10) for quality and clarity of answers in the Q&A session.' },
        },
        required: ['Clarity', 'Engagement', 'Structure', 'Delivery', 'Slide Usage', 'Q&A']
    },
    strengths: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'A list of 3-4 key strengths of the presentation.'
    },
    areasForImprovement: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'A list of 3-4 actionable areas for improvement.'
    },
  },
  required: ['overallScore', 'overallSummary', 'scoreBreakdown', 'strengths', 'areasForImprovement']
};

const questionsSchema = {
    type: Type.OBJECT,
    properties: {
        questions: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'A list of 3-5 insightful questions based on the provided presentation content.'
        }
    },
    required: ['questions']
};

export const generateQuestions = async (
  transcriptionHistory: TranscriptionEntry[],
  slideTexts: string[]
): Promise<string[]> => {
    const fullTranscript = transcriptionHistory
        .filter(entry => entry.context === 'presentation')
        .map(entry => entry.text)
        .join(' ');
    
    const slideContent = slideTexts.map((text, i) => `Slide ${i + 1}:\n${text}`).join('\n\n');

    if (!fullTranscript.trim()) return [];

    const prompt = `
        Based on the following presentation transcript and slide content, act as an insightful audience member and generate 3 to 5 thought-provoking questions to ask the presenter. The questions should be concise and clear. Return the questions in the specified JSON format.

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
                responseSchema: questionsSchema,
            },
        });
        const jsonText = response.text;
        const result = JSON.parse(jsonText);
        return result.questions || [];
    } catch (error) {
        console.error("Error generating questions:", error);
        return ["I'm sorry, I couldn't think of a question right now. Please tell me more about your final thoughts."];
    }
}


export const getFinalPresentationFeedback = async (
  transcriptionHistory: TranscriptionEntry[],
  videoFrames: string[],
  slideTexts: string[]
): Promise<PresentationFeedback | null> => {
  const presentationTranscript = transcriptionHistory
    .filter(entry => entry.context === 'presentation')
    .map(entry => entry.text)
    .join(' ');

  const qAndATranscript = transcriptionHistory
    .filter(entry => entry.context === 'q&a')
    .map(entry => `Question was: "${entry.speaker === 'judge' ? entry.text : ''}"\nAnswer was: "${entry.speaker === 'user' ? entry.text : ''}"`)
    .join('\n\n');

  if (!presentationTranscript.trim()) {
    return null;
  }

  const slideContent = slideTexts.length > 0
    ? slideTexts.map((text, i) => `Slide ${i + 1}:\n${text}`).join('\n\n')
    : 'No slides were provided.';

  const prompt = `
    As an expert presentation coach, analyze the following materials: the main presentation transcript, a transcript of the follow-up Q&A session, periodic video frames, and the text content from the presentation slides.
    
    Provide a detailed, constructive, and encouraging critique. Your analysis must be in the specified JSON format.
    
    CRITERIA:
    1.  Clarity: Was the message clear and easy to understand?
    2.  Engagement: Was the speaker energetic and engaging?
    3.  Structure: Was the presentation well-organized with a logical flow?
    4.  Delivery: Assess body language, eye contact, and gestures from the video frames.
    5.  Slide Usage: How effectively were the slides used as a visual aid vs. a script?
    6.  Q&A Performance: How clear, confident, and accurate were the answers?

    Based on these criteria, provide scores from 0-10 for each category in the 'scoreBreakdown'. Also, calculate a weighted 'overallScore'. Write a concise 'overallSummary', and list the top 3-4 'strengths' and 'areasForImprovement'.

    ---
    MAIN PRESENTATION TRANSCRIPT:
    ${presentationTranscript}
    ---
    
    SLIDE CONTENT:
    ${slideContent}
    ---

    Q&A SESSION TRANSCRIPT:
    ${qAndATranscript.length > 0 ? qAndATranscript : "No Q&A session was held."}
    ---
  `;

  const textPart = { text: prompt };
  const imageParts = videoFrames.map((frameData) => ({
    inlineData: {
      mimeType: 'image/jpeg',
      data: frameData,
    },
  }));

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: { parts: [textPart, ...imageParts] },
      config: {
        responseMimeType: 'application/json',
        responseSchema: feedbackSchema,
      },
    });

    const jsonText = response.text;
    const feedback = JSON.parse(jsonText) as PresentationFeedback;
    return feedback;
  } catch (error) {
    console.error("Error getting feedback from Gemini API:", error);
    return null;
  }
};