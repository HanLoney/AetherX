/// <reference types="vite/client" />

declare const __AETHERX_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_AETHERX_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
