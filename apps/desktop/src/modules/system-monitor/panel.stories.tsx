import type { SystemMonitorSnapshot } from '@muna/contracts';
import { defaultSystemMonitorSettings, writeSystemMonitorSettings } from '@muna/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { PanelFrame } from '../../storybook/frames';
import type { IpcHandlers, MunaStoryParameters } from '../../storybook/ipc';
import { systemMonitorSnapshot } from '../../storybook/samples';
import { SystemMonitorPanel } from './panel';
import { useSystemMonitorStore } from './system-monitor-store';

/** A fake sampler: watching answers with the sample at once; a `null` sample is still warming up. */
const systemMonitorService = (initial: SystemMonitorSnapshot | null): IpcHandlers => ({
  system_monitor_watch: () => initial,
});

const meta = {
  title: 'Modules/System monitor/Panel',
  component: SystemMonitorPanel,
  // Object literals only: Storybook's CSF indexer cannot read a helper call here.
  parameters: {
    layout: 'centered',
    window: 'notch',
    ipc: systemMonitorService(systemMonitorSnapshot()),
  } satisfies MunaStoryParameters & { layout: string },
  render: () => (
    <PanelFrame title="System">
      <SystemMonitorPanel />
    </PanelFrame>
  ),
  beforeEach: () => {
    useSystemMonitorStore.setState({ snapshot: null, receivedAt: 0, peakNetworkBytesPerS: 0 });
  },
  globals: { backgrounds: { value: 'desktop' } },
} satisfies Meta<typeof SystemMonitorPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A laptop at work: six gauges filling and the three busiest processes. */
export const Default: Story = {};

/** Under load: CPU pegged, memory nearly full, the system disk short on space. */
export const UnderLoad: Story = {
  parameters: {
    ipc: systemMonitorService(
      systemMonitorSnapshot({
        cpuPercent: 96,
        memoryUsedBytes: 30.1 * 1024 ** 3,
        freeDiskBytes: 9 * 1024 ** 3,
        networkDownBytesPerS: 48 * 1024 ** 2,
        networkUpBytesPerS: 3 * 1024 ** 2,
        battery: { percent: 12, charging: false },
      }),
    ),
  } satisfies MunaStoryParameters,
};

/** A desktop: no battery, and the process list switched off in Settings. */
export const DesktopNoProcesses: Story = {
  parameters: {
    ipc: systemMonitorService(systemMonitorSnapshot({ battery: null, processes: [] })),
    settings: (base) =>
      writeSystemMonitorSettings(base, { ...defaultSystemMonitorSettings(), processCount: 0 }),
  } satisfies MunaStoryParameters,
};

/** The first second after opening: every gauge waits for two samples to difference. */
export const WarmingUp: Story = {
  parameters: {
    ipc: systemMonitorService(null),
  } satisfies MunaStoryParameters,
};

/** The mirrored-English pseudo-locale: the gauge grid and the process rows flip. */
export const PseudoRtl: Story = {
  globals: { locale: 'ar-XB' },
};

export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
};
