import { Button as AriaButton } from 'react-aria-components';

import './decision-buttons.css';
import { cx } from './shared';

export interface DecisionButtonsProps {
  /** Names the pair for assistive technology ("Allow or deny"). */
  'aria-label': string;
  /** The two verbs, already localised ("Allow", "Deny"). */
  allowLabel: string;
  denyLabel: string;
  onAllow: () => void;
  onDeny: () => void;
  /** Both buttons stop taking presses (the answer is on its way). */
  isDisabled?: boolean;
  className?: string;
}

/**
 * DecisionButtons (docs/modules/ai-coding.md): the *Allow* / *Deny* pair a coding agent's
 * permission prompt puts in the strip's trailing slot. Two 20 px pills — the strip's slot
 * height — with caption labels; *Allow* carries the green tint, *Deny* stays plain so the
 * affirmative reads first. Their hit area grows to the strip's height so a quick press lands.
 */
export function DecisionButtons({
  'aria-label': label,
  allowLabel,
  denyLabel,
  onAllow,
  onDeny,
  isDisabled = false,
  className,
}: DecisionButtonsProps) {
  return (
    <span role="group" aria-label={label} className={cx('muna-decision', className)}>
      <AriaButton
        className="muna-decision__button muna-decision__button--allow"
        isDisabled={isDisabled}
        onPress={onAllow}
      >
        {allowLabel}
      </AriaButton>
      <AriaButton
        className="muna-decision__button muna-decision__button--deny"
        isDisabled={isDisabled}
        onPress={onDeny}
      >
        {denyLabel}
      </AriaButton>
    </span>
  );
}
