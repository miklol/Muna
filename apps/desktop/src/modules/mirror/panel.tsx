import type { MessageKey } from '@muna/i18n';
import {
  commands,
  defaultSettings,
  MIRROR_ZOOM_STEPS,
  type MirrorSettings,
  readMirrorSettings,
  writeMirrorSettings,
} from '@muna/contracts';
import {
  Button,
  Chip,
  contentRecipe,
  EmptyState,
  ErrorState,
  IconButton,
  Text,
  useMotionPreset,
  useReduceMotion,
} from '@muna/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Camera, CameraOff, FlipHorizontal2, Settings2, SwitchCamera, ZoomIn } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { persistSettings, useSettings } from '../../lib/settings';
import { CameraView } from './camera-view';
import './mirror.css';
import { type CameraDevice, type CameraFailure, useCameraStream } from './use-camera-stream';

/** Lucide icons in the panel body use stroke 1.75 (docs/05-design-system.md). */
const ICON_STROKE = 1.75;
/** Chip and text-button glyphs are 12 px. */
const SMALL_ICON = {
  size: 12,
  strokeWidth: ICON_STROKE,
  'aria-hidden': true,
  focusable: false,
} as const;

const failureTitle: Readonly<Record<CameraFailure, MessageKey>> = {
  denied: 'mirror.state.denied.title',
  notFound: 'mirror.state.notFound.title',
  busy: 'mirror.state.busy.title',
  unsupported: 'mirror.state.unsupported.title',
  failed: 'mirror.state.failed.title',
};

const failureBody: Readonly<Record<CameraFailure, MessageKey>> = {
  denied: 'mirror.state.denied.body',
  notFound: 'mirror.state.notFound.body',
  busy: 'mirror.state.busy.body',
  unsupported: 'mirror.state.unsupported.body',
  failed: 'mirror.state.failed.body',
};

const openSettings = () => {
  void commands.openSettings().catch(() => {
    // Outside Tauri (tests, Storybook) there is no settings window.
  });
};

/** The zoom after `zoom` in the chip's cycle, wrapping to 1×. */
export const nextZoom = (zoom: number): number => {
  const index = MIRROR_ZOOM_STEPS.indexOf(zoom as (typeof MIRROR_ZOOM_STEPS)[number]);
  return MIRROR_ZOOM_STEPS[(index + 1) % MIRROR_ZOOM_STEPS.length] ?? MIRROR_ZOOM_STEPS[0];
};

/** The camera after `current` in `devices`, wrapping; `null` when there is nothing to switch to. */
export const nextCamera = (
  devices: readonly CameraDevice[],
  current: string | null,
): CameraDevice | null => {
  if (devices.length < 2) return null;
  const index = devices.findIndex((device) => device.deviceId === current);
  return devices[(index + 1) % devices.length] ?? null;
};

/** A zoom as the chip prints it: `1×`, `1.5×`, `2×`, in the user's digits. */
export const formatZoom = (zoom: number, locale: string): string =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(zoom);

/**
 * The mirror panel (docs/modules/mirror.md): a quick camera check before a call. The head names
 * the camera (or why there is no picture) and carries the controls — mirror the image, zoom,
 * switch camera, Settings; the body is the live picture, or the state that stands in for it.
 * The camera opens when the panel mounts and stops when it unmounts (collapse, module switch)
 * or the window hides; while the module is off nothing is asked of the browser.
 */
export function MirrorPanel() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const queryClient = useQueryClient();
  const document = useSettings() ?? defaultSettings();
  const mirror = readMirrorSettings(document);
  const { status, devices, retry } = useCameraStream({
    enabled: mirror.enabled,
    deviceId: mirror.deviceId,
  });
  const [zoom, setZoom] = useState<number>(MIRROR_ZOOM_STEPS[0]);
  const reduceMotion = useReduceMotion();
  const enterSpring = useMotionPreset('content');

  const write = (recipe: (current: MirrorSettings) => MirrorSettings) => {
    persistSettings(queryClient, writeMirrorSettings(document, recipe(mirror)));
  };

  const live = status.kind === 'live';
  const currentId = live ? (status.device?.deviceId ?? mirror.deviceId) : mirror.deviceId;
  const following = nextCamera(devices, currentId);

  let headline: string;
  switch (status.kind) {
    case 'off':
      headline = t('mirror.head.off');
      break;
    case 'starting':
      headline = t('mirror.head.starting');
      break;
    case 'live':
      headline =
        status.device === null || status.device.label === ''
          ? t('mirror.head.defaultCamera')
          : status.device.label;
      break;
    case 'error':
      headline = t(failureTitle[status.failure]);
      break;
  }

  let body;
  switch (status.kind) {
    case 'off':
      body = (
        <EmptyState
          className="mirror-state"
          icon={<CameraOff size={24} strokeWidth={1.5} />}
          title={t('mirror.state.offTitle')}
          description={t('mirror.state.offBody')}
          action={
            <Button variant="secondary" onPress={openSettings}>
              {t('mirror.state.openSettings')}
            </Button>
          }
        />
      );
      break;
    case 'starting':
      body = (
        <div className="mirror-frame mirror-frame--placeholder" role="status">
          <Text as="span" variant="footnote" tone="secondary">
            {t('mirror.preview.starting')}
          </Text>
        </div>
      );
      break;
    case 'error':
      body = (
        <ErrorState
          className="mirror-state"
          icon={<CameraOff size={24} strokeWidth={1.5} />}
          title={t(failureTitle[status.failure])}
          description={t(failureBody[status.failure])}
          retryLabel={t('mirror.state.retry')}
          onRetry={retry}
        />
      );
      break;
    case 'live':
      body = (
        <div className="mirror-frame">
          <CameraView
            stream={status.stream}
            flip={mirror.flip}
            zoom={zoom}
            label={t('mirror.preview.label')}
          />
        </div>
      );
      break;
  }

  return (
    <motion.div
      className="mirror-panel"
      data-status={status.kind}
      initial={reduceMotion ? contentRecipe.reducedEnterFrom : contentRecipe.enterFromLarge}
      animate={reduceMotion ? contentRecipe.reducedVisible : contentRecipe.visible}
      transition={enterSpring}
    >
      <div className="mirror-head">
        <span className="mirror-head__glyph" aria-hidden="true">
          <Camera size={16} strokeWidth={ICON_STROKE} />
        </span>
        <Text as="h2" variant="footnote" weight={600} truncate={1} className="mirror-head__title">
          {headline}
        </Text>
        <span className="mirror-head__spacer" />
        {live && (
          <>
            <Chip
              icon={<FlipHorizontal2 {...SMALL_ICON} />}
              isSelected={mirror.flip}
              onChange={(flip) => {
                write((current) => ({ ...current, flip }));
              }}
            >
              {t('mirror.preview.flip')}
            </Chip>
            <Button
              variant="secondary"
              className="mirror-zoom"
              icon={<ZoomIn {...SMALL_ICON} />}
              aria-label={t('mirror.preview.zoom', { zoom: formatZoom(zoom, locale) })}
              onPress={() => {
                setZoom(nextZoom(zoom));
              }}
            >
              <span className="tabular-nums">
                {t('mirror.preview.zoomLevel', { zoom: formatZoom(zoom, locale) })}
              </span>
            </Button>
            {following !== null && (
              <IconButton
                aria-label={t('mirror.preview.switchCamera')}
                onPress={() => {
                  write((current) => ({
                    ...current,
                    deviceId: following.deviceId,
                    deviceLabel: following.label === '' ? null : following.label,
                  }));
                }}
              >
                <SwitchCamera strokeWidth={ICON_STROKE} />
              </IconButton>
            )}
          </>
        )}
        <IconButton aria-label={t('mirror.head.settings')} onPress={openSettings}>
          <Settings2 strokeWidth={ICON_STROKE} />
        </IconButton>
      </div>
      {body}
    </motion.div>
  );
}
