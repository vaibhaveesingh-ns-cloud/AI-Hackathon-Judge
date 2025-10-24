declare module '*.txt?raw' {
  const content: string;
  export default content;
}

declare module '*.js?url' {
  const url: string;
  export default url;
}

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_BACKEND_URL?: string;
  readonly VITE_API_URL?: string;
  readonly DEV: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
