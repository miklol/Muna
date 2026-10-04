import type * as Contracts from '@muna/contracts';
import { defaultSettings, type Settings, writeTranslationSettings } from '@muna/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { i18n } from '../../lib/i18n';
import { createQueryClient } from '../../lib/query-client';
import { cacheSettings } from '../../lib/settings';
import { idleResult, useTranslationStore } from './translation-store';
import { TranslationWidget } from './widget';

const queryClient = createQueryClient();

const withTranslation = (overrides: Partial<Contracts.TranslationSettings>): Settings =>
  writeTranslationSettings(defaultSettings(), {
    enabled: true,
    provider: 'openai',
    endpoint: '',
    model: '',
    source: 'auto',
    target: 'en',
    ...overrides,
  });

const renderWidget = (settings: Settings) => {
  cacheSettings(queryClient, settings);
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <TranslationWidget span={1} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
};

describe('TranslationWidget', () => {
  beforeEach(() => {
    queryClient.clear();
    useTranslationStore.setState({
      snapshot: null,
      draft: '',
      result: idleResult(),
      focusRequested: false,
    });
  });

  afterEach(cleanup);

  it('says the module is off and where to turn it on', () => {
    renderWidget(defaultSettings());
    expect(screen.getByText('Translation is off')).toBeInTheDocument();
    expect(screen.getByText('Turn it on in Settings')).toBeInTheDocument();
  });

  it('names the pair in the UI language and whether a translation is running', () => {
    renderWidget(withTranslation({ source: 'auto', target: 'de' }));
    expect(screen.getByText('Detect language → German')).toBeInTheDocument();
    expect(screen.getByText('Open the panel to translate')).toBeInTheDocument();
  });

  it('follows the store while a translation streams', () => {
    useTranslationStore.setState({ result: { phase: 'running', output: '', failure: null } });
    renderWidget(withTranslation({ source: 'pt-BR', target: 'zh-Hans' }));
    expect(screen.getByText('Portuguese (Brazil) → Chinese (Simplified)')).toBeInTheDocument();
    expect(screen.getByText('Translating')).toBeInTheDocument();
  });
});
