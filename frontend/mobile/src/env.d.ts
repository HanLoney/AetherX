/// <reference types="vite/client" />

declare const __AETHERX_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_AETHERX_SERVER_URL?: string;
  readonly VITE_AETHERX_EDITION?: "local" | "cloud";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
