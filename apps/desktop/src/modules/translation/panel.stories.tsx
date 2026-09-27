import { writeTranslationSettings } from '@muna/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { PanelFrame } from '../../storybook/frames';
import type { MunaStoryParameters } from '../../storybook/ipc';
import { TranslationPanel } from './panel';
import { translationService } from './story-service';
import { idleResult, useTranslationStore } from './translation-store';

const on = (source = 'auto', target = 'de') =>
  ((base) =>
    writeTranslationSettings(base, {
      enabled: true,
      provider: 'openai',
      endpoint: '',
      model: '',
      source,
      target,
    })) satisfies MunaStoryParameters['settings'];

const meta = {
  title: 'Modules/Translation/Panel',
  component: TranslationPanel,
  // Object literals only: Storybook's CSF indexer cannot read a helper call here.
  parameters: {
    layout: 'centered',
    window: 'notch',
    ipc: translationService(),
    settings: on(),
  } satisfies MunaStoryParameters & { layout: string },
  render: () => (
    <PanelFrame title="Translation">
      <TranslationPanel />
    </PanelFrame>
  ),
  // Every story starts with an empty source box; the draft outlives the panel in the store.
  beforeEach: () => {
    useTranslationStore.setState({
      snapshot: null,
      draft: '',
      result: idleResult(),
      focusRequested: false,
    });
  },
  globals: { backgrounds: { value: 'desktop' } },
} satisfies Meta<typeof TranslationPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Ready: detect the language, translate into German, the consent line naming the host. */
export const Default: Story = {};

/** Typed text streams back piece by piece; *Stop* stands in for *Translate* while it does. */
export const Streaming: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(
      await canvas.findByRole('textbox', { name: 'Text to translate' }),
      'Hello world, good to see you.',
    );
    await userEvent.click(canvas.getByRole('button', { name: 'Translate' }));
    // Six pieces at the story's pace take longer than waitFor's default second.
    await waitFor(
      async () => {
        await expect(canvas.getByRole('region', { name: 'Translation' })).toHaveTextContent(
          'Hallo Welt, schön dich zu sehen.',
        );
      },
      { timeout: 4000 },
    );
    // The `done` chunk follows the last piece; *Copy* appears with it.
    await expect(await canvas.findByRole('button', { name: 'Copy translation' })).toBeVisible();
  },
};

/** A finished translation with *Copy* beside the note. */
export const Finished: Story = {
  beforeEach: () => {
    useTranslationStore.setState({
      draft: 'Hello world, good to see you.',
      result: { phase: 'done', output: 'Hallo Welt, schön dich zu sehen.', failure: null },
      focusRequested: false,
    });
  },
};

/** The provider refused the key: one sentence under the output says so and where to look. */
export const KeyRefused: Story = {
  parameters: {
    ipc: translationService({ refuseWith: 'translation.unauthorized' }),
  } satisfies MunaStoryParameters,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(await canvas.findByRole('textbox', { name: 'Text to translate' }), 'Hi');
    await userEvent.click(canvas.getByRole('button', { name: 'Translate' }));
    await waitFor(async () => {
      await expect(canvas.getByRole('status')).toHaveTextContent('refused the API key');
    });
  },
};

/** No key saved for a provider that needs one: *Translate* waits and the note says why. */
export const NoKey: Story = {
  parameters: {
    ipc: translationService({ snapshot: { hasKey: false } }),
  } satisfies MunaStoryParameters,
  beforeEach: () => {
    useTranslationStore.setState({ draft: 'Hello', result: idleResult(), focusRequested: false });
  },
};

/** A local Ollama pair with a fixed source language, so *Swap languages* is live. */
export const Ollama: Story = {
  parameters: {
    ipc: translationService({
      snapshot: {
        provider: 'ollama',
        endpoint: 'http://127.0.0.1:11434',
        model: 'llama3.2',
        hasKey: false,
        needsKey: false,
      },
      pieces: ['Bonjour', ' le', ' monde.'],
    }),
    settings: (base) =>
      writeTranslationSettings(base, {
        enabled: true,
        provider: 'ollama',
        endpoint: '',
        model: '',
        source: 'en',
        target: 'fr',
      }),
  } satisfies MunaStoryParameters,
};

/** Pressing a language opens the searchable list; the current choice is checked. */
export const PickingALanguage: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Translate to: German' }));
    await expect(canvas.getByRole('heading', { name: 'Translate to' })).toBeVisible();
    await userEvent.type(canvas.getByRole('searchbox', { name: 'Search languages' }), 'ja');
    await expect(canvas.getByRole('button', { name: 'Japanese' })).toBeVisible();
  },
};

/** The module is off: the panel says where to turn it on and sends nothing. */
export const Off: Story = {
  parameters: {
    settings: (base) => base,
  } satisfies MunaStoryParameters,
};

/** A long paragraph: both boxes scroll inside the panel; the pair buttons keep to one line. */
export const LongText: Story = {
  beforeEach: () => {
    const sentence = 'The quick brown fox jumps over the lazy dog while the band plays on. ';
    useTranslationStore.setState({
      draft: sentence.repeat(6),
      result: {
        phase: 'done',
        output:
          'Der schnelle braune Fuchs springt über den faulen Hund, während die Band weiterspielt. '.repeat(
            6,
          ),
        failure: null,
      },
      focusRequested: false,
    });
  },
  parameters: {
    settings: on('pt-BR', 'zh-Hant'),
  } satisfies MunaStoryParameters,
};

export const RTL: Story = {
  ...Finished,
  globals: { direction: 'rtl' },
};

export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
};
