import { SHELL_ACTION_IDS, shellOpenModuleActionId } from '@muna/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useTranslation } from 'react-i18next';
import { expect, fn, userEvent, within } from 'storybook/test';

import { modules } from '../modules/registry';
import { PanelFrame } from '../storybook/frames';
import { listActions } from './actions';
import { CommandPalette } from './palette';

const actions = listActions(modules).filter((action) => action.runnable);

const bindings: ReadonlyMap<string, string> = new Map([
  [SHELL_ACTION_IDS.togglePanel, 'ctrl+alt+space'],
  [SHELL_ACTION_IDS.palette, 'ctrl+shift+space'],
  [shellOpenModuleActionId(1), 'ctrl+alt+1'],
  ['todo.quickAdd', 'ctrl+alt+t'],
  ['media.playPause', 'ctrl+alt+p'],
]);

function Framed(props: { bindings: ReadonlyMap<string, string>; onRun: (id: string) => void }) {
  const { t } = useTranslation();
  return (
    <PanelFrame title={t('shortcuts.palette.title')}>
      <CommandPalette actions={actions} bindings={props.bindings} onRun={props.onRun} />
    </PanelFrame>
  );
}

const meta = {
  title: 'Shell/Command palette',
  component: CommandPalette,
  parameters: {
    layout: 'centered',
    a11y: {
      config: {
        rules: [
          // The list scrolls, but on purpose it is not focusable: inside `Autocomplete` the
          // search field keeps DOM focus and ArrowUp/Down move a virtual focus that scrolls the
          // highlighted row into view (the combobox pattern), so keyboard users reach every row
          // through the field. axe cannot see that relationship and reports the region.
          { id: 'scrollable-region-focusable', enabled: false },
        ],
      },
    },
  },
  args: { actions, bindings, onRun: fn() },
  // The island floats over the desktop, not over another panel.
  globals: { backgrounds: { value: 'desktop' } },
  render: (args) => <Framed bindings={args.bindings} onRun={args.onRun} />,
} satisfies Meta<typeof CommandPalette>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Every runnable action grouped by owner, with the chords the shortcuts pane has bound. */
export const Default: Story = {};

/** Nothing bound yet: the rows read without caps until the user records shortcuts. */
export const NoShortcuts: Story = {
  args: { bindings: new Map() },
};

/** Typing filters across every group; Enter runs the highlighted row. */
export const Filtered: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole('searchbox'), 'play');
    await expect(canvas.getByRole('menuitem', { name: /play/i })).toBeVisible();
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await expect(args.onRun).toHaveBeenCalledWith('media.playPause');
  },
};

/** No action matches the query: the palette says so instead of showing an empty list. */
export const NoMatches: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole('searchbox'), 'zzzz');
    await expect(canvas.getByText('No matching commands')).toBeVisible();
    await expect(canvas.queryByRole('menuitem', { name: /notch|module|play/i })).toBeNull();
  },
};

export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
};

export const RightToLeft: Story = {
  globals: { direction: 'rtl' },
};
