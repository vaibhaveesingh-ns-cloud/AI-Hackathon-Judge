const env =
  (typeof import.meta !== 'undefined' && (import.meta as Record<string, any>).env) ||
  ({} as Record<string, string | undefined>);

const processEnvApiKey =
  typeof process !== 'undefined' && process.env ? process.env.OPENAI_API_KEY || process.env.API_KEY : undefined;

export const getOpenAIApiKey = (): string => {
  const apiKey =
    processEnvApiKey || env.OPENAI_API_KEY || env.VITE_OPENAI_API_KEY || env.VITE_CHATGPT_API_KEY;

  if (!apiKey) {
    throw new Error(
      'Missing OpenAI API key. Set OPENAI_API_KEY or VITE_OPENAI_API_KEY in your environment (see README).'
    );
  }

  return apiKey;
};
