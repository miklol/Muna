import type * as Contracts from '@muna/contracts';
import { defaultSettings, type Settings, writeMirrorSettings } from '@muna/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { createQueryClient } from '../../lib/query-client';
import { cacheSettings, settingsQueryKey } from '../../lib/settings';
import {
  type FakeMediaDevices,
  fakeStream,
  installFakeMediaDevices,
  namedError,
  setDocumentVisibility,
} from './fake-media-devices';
import { MirrorWidget } from './widget';

const ipc = vi.hoisted(() => ({
  mirrorWatch: vi.fn<(watching: boolean) => Promise<void>>(),
}));

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: { mirrorWatch: ipc.mirrorWatch },
}));

const queryClient = createQueryClient();
queryClient.setQueryDefaults(settingsQueryKey, { gcTime: Number.POSITIVE_INFINITY });

const renderWidget = (settings: Settings) => {
  cacheSettings(queryClient, settings);
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <MirrorWidget span={1} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
};

const enabled = writeMirrorSettings(defaultSettings(), {
  enabled: true,
  flip: false,
  deviceId: null,
  deviceLabel: null,
});

const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

describe('MirrorWidget', () => {
  let media: FakeMediaDevices & { restore: () => void };

  beforeEach(() => {
    media = installFakeMediaDevices();
    setDocumentVisibility('visible');
    ipc.mirrorWatch.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    media.restore();
  });

  it('says the module is off and where to turn it on, without opening the camera', async () => {
    renderWidget(defaultSettings());
    await flush();
    expect(screen.getByText('Mirror is off')).toBeInTheDocument();
    expect(screen.getByText('Turn it on in Settings')).toBeInTheDocument();
    expect(media.getUserMedia).not.toHaveBeenCalled();
  });

  it('shows the picture the way others see it and names the camera', async () => {
    const stream = fakeStream('cam-1', 'Front camera');
    media.getUserMedia.mockResolvedValue(stream);
    const view = renderWidget(enabled);
    expect(screen.getByText('Starting the camera')).toBeInTheDocument();
    await flush();
    expect(screen.getByText('Front camera')).toBeInTheDocument();
    expect(screen.getByLabelText('Camera preview')).toHaveStyle({ transform: 'scale(1)' });
    view.unmount();
    expect(stream.tracks[0]?.stops).toBe(1);
  });

  it('names a failure in one line', async () => {
    media.getUserMedia.mockRejectedValue(namedError('NotReadableError'));
    renderWidget(enabled);
    await flush();
    expect(screen.getByText('The camera did not start')).toBeInTheDocument();
    expect(screen.queryByLabelText('Camera preview')).not.toBeInTheDocument();
  });
});
