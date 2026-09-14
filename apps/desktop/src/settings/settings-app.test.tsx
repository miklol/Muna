import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';

import { i18n } from '../lib/i18n';
import { createQueryClient } from '../lib/query-client';
import { SettingsApp } from './settings-app';

const appInfo = vi.fn();

vi.mock('@muna/contracts', () => ({
  commands: {
    appInfo: () => appInfo() as unknown,
  },
}));

const renderSettings = () =>
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={createQueryClient()}>
        <SettingsApp />
      </QueryClientProvider>
    </I18nextProvider>,
  );

describe('SettingsApp', () => {
  it('shows the version reported by the backend', async () => {
    appInfo.mockResolvedValue({
      name: 'muna',
      version: '0.0.0',
      platform: 'fake',
      profileDir: 'C:\\Users\\me\\AppData\\Local\\Muna',
    });
    renderSettings();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Muna settings');
    expect(await screen.findByTestId('version')).toHaveTextContent('Version 0.0.0');
  });

  it('shows an inline error state instead of a modal', async () => {
    appInfo.mockRejectedValue(new Error('ipc down'));
    renderSettings();
    expect(
      await screen.findByText('Settings could not be loaded. Restart Muna and try again.'),
    ).toBeInTheDocument();
  });
});
