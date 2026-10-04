import type { SupportSnapshot } from '@muna/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { PanelFrame } from '../../storybook/frames';
import { type IpcHandlers, type MunaStoryParameters, refuse } from '../../storybook/ipc';
import { SupportPanel } from './panel';
import { sampleSnapshot } from './sample-snapshot';
import { useSupportStore } from './support-store';

const CHANGELOG = `# Changelog

## [0.3.0](https://github.com/miklol/Muna/compare/v0.2.0...v0.3.0) (2026-09-27)

### Features

* **support:** help, diagnostics bundle, repairs and update channel ([cd3fc86](https://github.com/miklol/Muna/commit/cd3fc86))
* **notes:** quick note shortcut ([1234abc](https://github.com/miklol/Muna/commit/1234abc))

### Bug Fixes

* **shell:** re-register app bars after Explorer restarts ([9876fed](https://github.com/miklol/Muna/commit/9876fed))

## [0.2.0](https://github.com/miklol/Muna/compare/v0.1.0...v0.2.0) (2026-08-30)

### Features

* **media:** now playing, with album art and a waveform ([abcdef0](https://github.com/miklol/Muna/commit/abcdef0))
* **calendar:** the month grid and the next event ([0fedcba](https://github.com/miklol/Muna/commit/0fedcba))
`;

/** A fake support service: every link opens nowhere, every command succeeds. */
const supportService = (snapshot: SupportSnapshot, changelog: string | null): IpcHandlers => ({
  get_support_snapshot: () => snapshot,
  support_open: () => null,
  support_changelog: () => changelog,
  support_command: (args) => {
    const { kind } = (args as { command: { kind: string } }).command;
    if (kind === 'diagnostics') {
      return {
        kind: 'bundle',
        path: 'C:\\Users\\sam\\Desktop\\muna-diagnostics-20260927-1030.zip',
        entries: 5,
        atMs: Date.now(),
      };
    }
    return { kind: 'done' };
  },
});

const meta = {
  title: 'Modules/Support/Panel',
  component: SupportPanel,
  // Object literals only: Storybook's CSF indexer cannot read a helper call here.
  parameters: {
    layout: 'centered',
    window: 'notch',
    ipc: supportService(sampleSnapshot(), CHANGELOG),
  } satisfies MunaStoryParameters & { layout: string },
  render: () => (
    <PanelFrame title="Support">
      <SupportPanel />
    </PanelFrame>
  ),
  beforeEach: () => {
    useSupportStore.setState({ snapshot: null });
  },
  globals: { backgrounds: { value: 'desktop' } },
} satisfies Meta<typeof SupportPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The list: help, feedback, diagnostics, what's new, repair, rate, under the version line. */
export const Default: Story = {};

/** *Save diagnostics* names the zip it wrote to the Desktop. */
export const BundleSaved: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: /^Save diagnostics/u }));
    await expect(canvas.findByRole('status')).resolves.toHaveTextContent(
      'muna-diagnostics-20260927-1030.zip',
    );
  },
};

/** The Desktop folder is missing (a redirected profile), so the bundle is refused. */
export const NoDesktop: Story = {
  parameters: {
    ipc: {
      ...supportService(sampleSnapshot(), CHANGELOG),
      support_command: () => refuse('support.noDesktop', 'desktop folder not found'),
    },
  } satisfies MunaStoryParameters,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: /^Save diagnostics/u }));
    await expect(canvas.findByRole('status')).resolves.toHaveTextContent(/Desktop folder/u);
  },
};

/** *What's new* shows the bundled changelog in place: two releases, grouped, no hashes. */
export const WhatsNew: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: /^What's new/u }));
    await canvas.findByText('support: help, diagnostics bundle, repairs and update channel');
  },
};

/** A build without a changelog: the empty state points at GitHub. */
export const WhatsNewEmpty: Story = {
  parameters: {
    ipc: supportService(sampleSnapshot(), '# Changelog\n\nNothing yet.\n'),
  } satisfies MunaStoryParameters,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: /^What's new/u }));
    await canvas.findByText('No release notes in this build');
  },
};

/** The two repairs, each with its own button and a one-line result. */
export const Repair: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: /^Repair/u }));
    await canvas.findByText('Volume and brightness flyouts');
  },
};

export const RTL: Story = {
  globals: { direction: 'rtl' },
};
