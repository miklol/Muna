import type { ShapeRect } from '@muna/contracts';
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useAppStore } from '../store/app-store';
import { toShapeRect, useShellLayoutSubscription, useShellReady } from './use-shell';
import { useStripContentSubscription } from './use-strip-content';

/**
 * The closed strip, placed by the Rust shell (docs/modules/notch-shell.md). Reports ready and
 * its painted rect so the window is moved into place and hit-testing is limited to the strip;
 * follows the shell's layout (strip height preset, Island offset) and yield state. Content
 * slots and the morph state machine land with the next M1-E1 PR.
 */
export function NotchWindow() {
  const { t } = useTranslation();
  const content = useAppStore((state) => state.stripContent);
  const layout = useAppStore((state) => state.shellLayout);
  const yieldState = useAppStore((state) => state.yieldState);
  const stripRef = useRef<HTMLDivElement>(null);
  useStripContentSubscription();
  useShellLayoutSubscription();

  const measure = useCallback((): ShapeRect[] => {
    const node = stripRef.current;
    return node ? [toShapeRect(node.getBoundingClientRect())] : [];
  }, []);
  const publish = useShellReady(measure);

  // The strip's rect changes with the layout (height preset, Island gap); re-publish it once
  // the new size has painted. Parked windows publish nothing new: they are off-screen.
  const stripHeight = layout?.stripHeight;
  const stripTopOffset = layout?.stripTopOffset;
  useEffect(() => {
    if (stripHeight === undefined || yieldState === 'parked') {
      return;
    }
    const frame = requestAnimationFrame(publish);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [publish, stripHeight, stripTopOffset, yieldState]);

  const parked = yieldState === 'parked';

  return (
    <main
      className="flex h-full items-start justify-center"
      aria-label={t('app.name')}
      data-shape={layout?.shape ?? 'notch'}
      data-yield={yieldState}
    >
      <div
        ref={stripRef}
        role="status"
        data-kind={content.kind}
        hidden={parked}
        className="w-(--size-strip-width) rounded-b-strip bg-notch-black"
        style={{
          height: stripHeight ?? 'var(--size-strip-height)',
          marginTop: stripTopOffset ?? 0,
        }}
      >
        <span className="sr-only">{t('notch.placeholder')}</span>
      </div>
    </main>
  );
}
