const env =
  (typeof import.meta !== 'undefined' && (import.meta as Record<string, any>).env) ||
  ({} as Record<string, string | undefined>);

const processEnvApiKey =
  typeof process !== 'undefined' && process.env ? process.env.API_KEY : undefined;

export const getGeminiApiKey = (): string => {
  const apiKey = processEnvApiKey || env.GEMINI_API_KEY || env.VITE_GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error(
      'Missing Gemini API key. Set GEMINI_API_KEY or VITE_GEMINI_API_KEY in your environment (see README).'
    );
  }

  return apiKey;
};
