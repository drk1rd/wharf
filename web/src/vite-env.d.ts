/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WHARF_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
