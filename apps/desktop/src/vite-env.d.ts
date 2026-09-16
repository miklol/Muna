/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" turns on the hit-test overlay in dev builds (scripts/dev.ps1 -HitTest). */
  readonly VITE_MUNA_HIT_TEST?: string;
}
