import { commands } from '@muna/contracts';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

export const appInfoQuery = {
  queryKey: ['app-info'] as const,
  queryFn: () => commands.appInfo(),
};

/** Settings window shell. Sections arrive with their modules; M0 shows the about card. */
export function SettingsApp() {
  const { t } = useTranslation();
  const info = useQuery(appInfoQuery);

  return (
    <main className="mx-auto flex h-full max-w-180 flex-col gap-6 p-8">
      <h1 className="text-title1">{t('settings.title')}</h1>
      <section
        aria-labelledby="about-heading"
        className="rounded-card bg-surface-1 p-5 shadow-panel"
      >
        <h2 id="about-heading" className="text-callout text-text-2">
          {t('app.name')}
        </h2>
        {info.isPending ? <p className="text-body text-text-3">{t('settings.loading')}</p> : null}
        {info.isError ? <p className="text-body text-text-3">{t('settings.error')}</p> : null}
        {info.isSuccess ? (
          <p className="text-body" data-testid="version">
            {t('settings.version', { version: info.data.version })}
          </p>
        ) : null}
      </section>
    </main>
  );
}
