import { events } from '@muna/contracts';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useAppStore } from '../store/app-store';

/**
 * Keeps the store in sync with the Rust scheduler. Subscribes once per mounted window and
 * unlistens on unmount so nothing runs while the window is gone (performance budget).
 */
function useStripContentSubscription() {
  const setStripContent = useAppStore((state) => state.setStripContent);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void events.stripContentChanged
      .listen((event) => {
        setStripContent(event.payload.content);
      })
      .then((fn) => {
        if (disposed) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch(() => {
        // Not running inside Tauri (Storybook, tests); the strip stays idle.
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [setStripContent]);
}

/** The closed strip. Content slots and the morph state machine land with M1. */
export function NotchWindow() {
  const { t } = useTranslation();
  const content = useAppStore((state) => state.stripContent);
  useStripContentSubscription();

  return (
    <main className="flex h-full items-start justify-center" aria-label={t('app.name')}>
      <div
        role="status"
        data-kind={content.kind}
        className="h-(--size-strip-height) w-(--size-strip-width) rounded-b-strip bg-notch-black"
      >
        <span className="sr-only">{t('notch.placeholder')}</span>
      </div>
    </main>
  );
}
