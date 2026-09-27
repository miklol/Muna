import type { AiCodingSnapshot } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { useAiCodingStore } from './ai-coding-store';
import { emptySnapshot, offSnapshot, sampleSnapshot } from './sample-snapshot';
import { AiCodingWidget } from './widget';

const ipc = vi.hoisted(() => ({
  getAiCodingSnapshot: vi.fn<() => Promise<AiCodingSnapshot>>(),
  aiCodingWatch: vi.fn<(watching: boolean) => Promise<void>>(),
  listen: vi.fn(() =>
    Promise.resolve(() => {
      // Nothing to unlisten from outside Tauri.
    }),
  ),
}));

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: {
    getAiCodingSnapshot: ipc.getAiCodingSnapshot,
    aiCodingWatch: ipc.aiCodingWatch,
  },
  events: { aiCodingChanged: { listen: ipc.listen } },
}));

const renderWidget = (span: 1 | 2) =>
  render(
    <I18nextProvider i18n={i18n}>
      <AiCodingWidget span={span} />
    </I18nextProvider>,
  );

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });

describe('AiCodingWidget', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAiCodingStore.setState({ snapshot: null, receivedAt: 0 });
    ipc.getAiCodingSnapshot.mockReset().mockResolvedValue(sampleSnapshot);
    ipc.aiCodingWatch.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('counts the waiting and running agents and lists the projects, waiting first', async () => {
    renderWidget(1);
    await flush();
    expect(ipc.aiCodingWatch).toHaveBeenCalledWith(true);
    const card = screen.getByLabelText('AI coding');
    expect(card).toHaveTextContent('2 waiting · 1 running');
    const rows = within(card).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual(['muna', 'site', 'Muna']);
  });

  it('adds what each agent does on a wide card', async () => {
    renderWidget(2);
    await flush();
    const rows = within(screen.getByLabelText('AI coding')).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Wants to run Bash');
    expect(rows[0]?.querySelector('[data-waiting]')).not.toBeNull();
    expect(rows[1]).toHaveTextContent('Waiting for your prompt');
    expect(rows[2]).toHaveTextContent('Set up the desktop app scaffold with a fake platform layer');
    expect(rows[2]?.querySelector('[data-waiting]')).toBeNull();
  });

  it('says so in one line when nothing runs or the module is off', async () => {
    ipc.getAiCodingSnapshot.mockResolvedValue(emptySnapshot);
    const view = renderWidget(1);
    await flush();
    expect(screen.getByText('No agents')).toBeInTheDocument();
    view.unmount();

    ipc.getAiCodingSnapshot.mockResolvedValue(offSnapshot);
    useAiCodingStore.setState({ snapshot: null });
    renderWidget(1);
    await flush();
    expect(screen.getByText('Off')).toBeInTheDocument();
  });
});
