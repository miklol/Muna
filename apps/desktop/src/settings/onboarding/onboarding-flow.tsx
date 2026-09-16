import type { MonitorInfo } from '@muna/contracts';
import { Button, Text } from '@muna/ui';
import {
  contentExitTransition,
  contentRecipe,
  reducedMotionTransition,
  springs,
  timings,
  useReduceMotion,
} from '@muna/ui/motion';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion, type Transition } from 'motion/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { monitorsQuery } from '../panes/screens';
import { useSettingsEditor } from '../settings-editor';
import './onboarding.css';
import {
  DisplaysStep,
  DoneStep,
  PermissionsStep,
  PlacementStep,
  ShapeStep,
  StartupStep,
  WelcomeStep,
} from './steps';

export type OnboardingStepId =
  'welcome' | 'displays' | 'placement' | 'shape' | 'permissions' | 'startup' | 'done';

const everyStep: readonly OnboardingStepId[] = [
  'welcome',
  'displays',
  'placement',
  'shape',
  'permissions',
  'startup',
  'done',
];

/**
 * The steps for this machine. Choosing screens only makes sense with two or more, so the
 * step is left out on a single screen — and when the list is unavailable, since there would
 * be nothing to choose from. While the list loads the step stays in, so the count is stable.
 */
export const onboardingSteps = (monitors: {
  readonly isError: boolean;
  readonly data: readonly MonitorInfo[] | undefined;
}): readonly OnboardingStepId[] => {
  const single = monitors.data !== undefined && monitors.data.length <= 1;
  return single || monitors.isError ? everyStep.filter((step) => step !== 'displays') : everyStep;
};

export interface OnboardingFlowProps {
  /** Finished or skipped; the caller shows the settings window again. */
  onDone: () => void;
}

/**
 * The welcome tour (docs/build-plan/m1-shell.md, M1-E5): welcome, screens, placement, shape,
 * permissions, launch at login, done — one 560 × 420 card. Every choice is written through the
 * settings editor as it is made, so the real notch previews it; Skip and Finish both mark the
 * tour as seen. Steps change with the content recipe: the old body leaves, the new one enters
 * `moduleSwitchEnterDelayMs` later.
 */
export function OnboardingFlow({ onDone }: OnboardingFlowProps) {
  const { t } = useTranslation();
  const { settings, update } = useSettingsEditor();
  const reduceMotion = useReduceMotion();
  const monitors = useQuery(monitorsQuery);
  const [index, setIndex] = useState(0);
  // False until the first Back/Continue, so opening the tour never steals focus.
  const [focusTitle, setFocusTitle] = useState(false);

  const steps = onboardingSteps(monitors);
  const position = Math.min(index, steps.length - 1);
  const step: OnboardingStepId = steps[position] ?? 'welcome';
  const last = position === steps.length - 1;

  const go = (next: number) => {
    setFocusTitle(true);
    setIndex(Math.max(0, Math.min(next, steps.length - 1)));
  };

  const finish = () => {
    if (!settings.general.onboarded) {
      update((current) => ({ ...current, general: { ...current.general, onboarded: true } }));
    }
    onDone();
  };

  const enterTransition: Transition = reduceMotion
    ? reducedMotionTransition
    : { ...springs.content, delay: timings.moduleSwitchEnterDelayMs / 1000 };
  const exit = {
    ...(reduceMotion ? contentRecipe.reducedExitTo : contentRecipe.exitTo),
    transition: contentExitTransition,
  };

  const body = () => {
    switch (step) {
      case 'welcome':
        return <WelcomeStep focusTitle={focusTitle} />;
      case 'displays':
        return <DisplaysStep focusTitle={focusTitle} monitors={monitors} />;
      case 'placement':
        return <PlacementStep focusTitle={focusTitle} />;
      case 'shape':
        return <ShapeStep focusTitle={focusTitle} />;
      case 'permissions':
        return <PermissionsStep focusTitle={focusTitle} />;
      case 'startup':
        return <StartupStep focusTitle={focusTitle} />;
      case 'done':
        return <DoneStep focusTitle={focusTitle} />;
    }
  };

  return (
    <main className="onboarding-stage" aria-label={t('onboarding.title')}>
      <section className="onboarding-card">
        <header className="onboarding-card__header">
          <Text as="p" variant="footnote" tone="secondary" tabular>
            {t('onboarding.progress', { current: position + 1, total: steps.length })}
          </Text>
          {!last && <Button onPress={finish}>{t('onboarding.skip')}</Button>}
        </header>
        <div className="onboarding-card__body">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={step}
              className="origin-top"
              initial={reduceMotion ? contentRecipe.reducedEnterFrom : contentRecipe.enterFromLarge}
              animate={reduceMotion ? contentRecipe.reducedVisible : contentRecipe.visible}
              exit={exit}
              transition={enterTransition}
            >
              {body()}
            </motion.div>
          </AnimatePresence>
        </div>
        <footer className="onboarding-card__footer">
          <span>
            {position > 0 && (
              <Button
                onPress={() => {
                  go(position - 1);
                }}
              >
                {t('onboarding.back')}
              </Button>
            )}
          </span>
          {last ? (
            <Button variant="primary" onPress={finish}>
              {t('onboarding.finish')}
            </Button>
          ) : (
            <Button
              variant="primary"
              onPress={() => {
                go(position + 1);
              }}
            >
              {t('onboarding.next')}
            </Button>
          )}
        </footer>
      </section>
    </main>
  );
}
