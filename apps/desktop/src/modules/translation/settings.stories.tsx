import { writeTranslationSettings } from '@muna/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { SettingsPaneFrame } from '../../storybook/frames';
import type { MunaStoryParameters } from '../../storybook/ipc';
import { TranslationSettingsPane } from './settings';
import { translationService } from './story-service';
import { idleResult, useTranslationStore } from './translation-store';

const meta = {
  title: 'Modules/Translation/Settings pane',
  component: TranslationSettingsPane,
  // Object literals only: Storybook's CSF indexer cannot read a helper call here.
  parameters: {
    layout: 'fullscreen',
    window: 'settings',
    ipc: translationService({ snapshot: { enabled: false, hasKey: false } }),
  } satisfies MunaStoryParameters & { layout: string },
  render: () => (
    <SettingsPaneFrame titleKey="translation.title">
      <TranslationSettingsPane />
    </SettingsPaneFrame>
  ),
  beforeEach: () => {
    useTranslationStore.setState({
      snapshot: null,
      draft: '',
      result: idleResult(),
      focusRequested: false,
    });
  },
} satisfies Meta<typeof TranslationSettingsPane>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The defaults: off with the privacy note, OpenAI-compatible, blank fields, no key yet. */
export const Default: Story = {};

/** On, with a key saved: the key row shows the fact and *Remove*. */
export const KeySaved: Story = {
  parameters: {
    ipc: translationService({ snapshot: { enabled: true, hasKey: true } }),
    settings: (base) =>
      writeTranslationSettings(base, {
        enabled: true,
        provider: 'openai',
        endpoint: '',
        model: '',
        source: 'auto',
        target: 'de',
      }),
  } satisfies MunaStoryParameters,
};

/** A local Ollama server on the LAN with its own model; the key is optional. */
export const Ollama: Story = {
  parameters: {
    ipc: translationService({
      snapshot: {
        enabled: true,
        provider: 'ollama',
        endpoint: 'http://studio.local:11434',
        model: 'qwen2.5:7b',
        hasKey: false,
        needsKey: false,
      },
    }),
    settings: (base) =>
      writeTranslationSettings(base, {
        enabled: true,
        provider: 'ollama',
        endpoint: 'http://studio.local:11434',
        model: 'qwen2.5:7b',
        source: 'en',
        target: 'ja',
      }),
  } satisfies MunaStoryParameters,
};

/** Saving a key goes through the fake IPC; the field clears and the row shows *Remove*. */
export const SavingAKey: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(
      await canvas.findByLabelText('API key', { selector: 'input' }),
      'sk-story-example',
    );
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }));
    await expect(await canvas.findByRole('button', { name: 'Remove' })).toBeVisible();
  },
};

/** *Change* under a language row opens the same list the panel uses, inline. */
export const ChangingTheTarget: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const [, target] = await canvas.findAllByRole('button', { name: 'Change' });
    if (target !== undefined) await userEvent.click(target);
    await expect(canvas.getByRole('searchbox', { name: 'Search languages' })).toBeVisible();
  },
};

export const RTL: Story = {
  globals: { direction: 'rtl' },
};

/** The mirrored-English pseudo-locale (ar-XB): longer strings, right-to-left layout. */
export const PseudoRtl: Story = {
  globals: { locale: 'ar-XB' },
};
