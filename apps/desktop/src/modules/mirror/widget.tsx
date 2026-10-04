import { defaultSettings, readMirrorSettings } from '@muna/contracts';
import { Text } from '@muna/ui';
import { CameraOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useSettings } from '../../lib/settings';
import type { WidgetProps } from '../registry';
import { CameraView } from './camera-view';
import './mirror.css';
import { useCameraStream } from './use-camera-stream';

/** Lucide icons in the card body use stroke 1.75 (docs/05-design-system.md). */
const ICON_STROKE = 1.75;

/**
 * The mirror card on the dashboard (docs/modules/dashboard.md "Widgets"): a small live picture
 * with the camera's name beside it. The camera runs only while the card is mounted — the
 * dashboard unmounts widgets when it leaves the screen, so the light goes off with it. Off,
 * the card says so and points at Settings; an error names it in one line.
 */
export function MirrorWidget(_props: WidgetProps) {
  const { t } = useTranslation();
  const mirror = readMirrorSettings(useSettings() ?? defaultSettings());
  const { status } = useCameraStream({ enabled: mirror.enabled, deviceId: mirror.deviceId });

  let title: string;
  let caption: string;
  switch (status.kind) {
    case 'off':
      title = t('mirror.widget.off');
      caption = t('mirror.widget.offBody');
      break;
    case 'starting':
      title = t('mirror.title');
      caption = t('mirror.head.starting');
      break;
    case 'live':
      title = t('mirror.title');
      caption =
        status.device === null || status.device.label === ''
          ? t('mirror.head.defaultCamera')
          : status.device.label;
      break;
    case 'error':
      title = t('mirror.title');
      caption = t('mirror.widget.error');
      break;
  }

  return (
    <div className="mirror-widget" data-status={status.kind}>
      {status.kind === 'live' ? (
        <div className="mirror-widget__frame">
          <CameraView stream={status.stream} flip={mirror.flip} label={t('mirror.preview.label')} />
        </div>
      ) : (
        <span className="mirror-widget__frame mirror-widget__frame--placeholder" aria-hidden="true">
          <CameraOff size={16} strokeWidth={ICON_STROKE} />
        </span>
      )}
      <div className="mirror-widget__text">
        <Text as="span" variant="footnote" weight={600} truncate={1}>
          {title}
        </Text>
        <Text as="span" variant="caption" tone="secondary" truncate={1}>
          {caption}
        </Text>
      </div>
    </div>
  );
}
