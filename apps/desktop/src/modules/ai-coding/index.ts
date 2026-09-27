import { lazy } from 'react';

import type { ModuleDefinition } from '../registry';
import { AiCodingIcon } from './ai-coding-icon';
import { AiCodingPanel } from './panel';
import { AiCodingWidget } from './widget';

/** Settings → AI coding loads on first visit so the notch bundle stays small. */
const AiCodingSettings = lazy(() =>
  import('./settings').then((module) => ({ default: module.AiCodingSettingsPane })),
);

/**
 * The AI coding module's frontend half (docs/modules/ai-coding.md; ADR-0004). Its Rust half is
 * `src-tauri/src/modules/ai_coding`; the id is the settings namespace both sides read.
 * Everything shown is a snapshot Rust publishes while a window watches; the UI keeps no timer
 * of its own, and the strip's *Allow* / *Deny* pair is the shell's, driven by the same command.
 */
export const aiCodingModule: ModuleDefinition = {
  id: 'ai-coding',
  titleKey: 'aiCoding.title',
  icon: AiCodingIcon,
  panel: AiCodingPanel,
  widget: AiCodingWidget,
  settings: AiCodingSettings,
};
