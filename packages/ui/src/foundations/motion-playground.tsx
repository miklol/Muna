import { motion } from 'motion/react';
import { useState } from 'react';
import { Button } from 'react-aria-components';

import { Text } from '../primitives/text';
import {
  type SpringName,
  springNames,
  springs,
  timings,
  toAppleSpring,
  toLinearEasing,
} from '../motion/presets';
import { useMotionPreset } from '../motion/reduced-motion';

const format = (n: number, digits = 2) => n.toFixed(digits);

/** The spring table from docs/06-motion-spec.md#spring-presets, derived from the code. */
export function SpringTable() {
  return (
    <section aria-labelledby="motion-springs" className="token-table">
      <h2 id="motion-springs">Spring presets</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">Preset</th>
            <th scope="col">stiffness / damping / mass</th>
            <th scope="col">response / ζ</th>
            <th scope="col">SwiftUI</th>
            <th scope="col">Settle (CSS)</th>
          </tr>
        </thead>
        <tbody>
          {springNames.map((name) => {
            const preset = springs[name];
            const apple = toAppleSpring(preset);
            const linear = toLinearEasing(preset);
            return (
              <tr key={name}>
                <th scope="row">
                  <code>{name}</code>
                </th>
                <td>
                  <code>
                    {preset.stiffness} / {preset.damping} / {preset.mass}
                  </code>
                </td>
                <td>
                  <code>
                    {format(apple.response)} s / {format(apple.dampingFraction)}
                  </code>
                </td>
                <td>
                  <code>
                    .spring(response: {format(apple.response)}, dampingFraction:{' '}
                    {format(apple.dampingFraction)})
                  </code>
                </td>
                <td>
                  <code>{Math.round(linear.durationMs)} ms</code>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/** Non-spring timings, straight from `timings`. */
export function TimingTable() {
  return (
    <section aria-labelledby="motion-timings" className="token-table">
      <h2 id="motion-timings">Timings</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(timings).map(([name, value]) => (
            <tr key={name}>
              <th scope="row">
                <code>{name}</code>
              </th>
              <td>
                <code>{value}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

interface LaneProps {
  name: SpringName;
  on: boolean;
}

/** Lane geometry in px: the track is `laneWidth`, the puck `puckSize`; travel is the difference. */
const laneWidth = 320;
const puckSize = 24;
const laneTravel = laneWidth - puckSize;

function Lane({ name, on }: LaneProps) {
  const transition = useMotionPreset(name);
  const apple = toAppleSpring(springs[name]);
  return (
    <div className="motion-lane">
      <Text as="div" variant="footnote" weight={600} className="motion-lane__name">
        {name}
      </Text>
      <Text as="div" variant="caption" tone="secondary" tabular className="motion-lane__meta">
        {format(apple.response)} s · ζ {format(apple.dampingFraction)}
      </Text>
      <div className="motion-lane__track" style={{ inlineSize: laneWidth }}>
        <motion.div
          aria-hidden="true"
          className="motion-lane__puck"
          style={{ inlineSize: puckSize, blockSize: puckSize }}
          initial={false}
          animate={{ x: on ? laneTravel : 0, scale: on ? 1.15 : 1 }}
          transition={transition}
        />
      </div>
    </div>
  );
}

export interface PlaygroundProps {
  /** Which presets to race; defaults to all of them in table order. */
  presets?: readonly SpringName[];
}

/**
 * Side-by-side lanes: every preset moves the same distance at the same time. Press the button
 * mid-flight to see the physics springs reverse with their velocity intact.
 */
export function Playground({ presets = springNames }: PlaygroundProps) {
  const [on, setOn] = useState(false);
  return (
    <div className="motion-playground">
      <div className="motion-playground__controls">
        <Button
          className="muna-chip muna-chip--selectable"
          onPress={() => {
            setOn((v) => !v);
          }}
        >
          <span className="muna-chip__label">{on ? 'Return' : 'Go'}</span>
        </Button>
        <Text variant="footnote" tone="secondary">
          Press again before the lanes settle to interrupt.
        </Text>
      </div>
      <div className="motion-playground__lanes">
        {presets.map((name) => (
          <Lane key={name} name={name} on={on} />
        ))}
      </div>
    </div>
  );
}
