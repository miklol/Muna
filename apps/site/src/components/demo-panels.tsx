import {
  AlbumArt,
  Checkbox,
  formatCountdown,
  IconButton,
  ListRow,
  ProgressTrack,
  Ring,
  Text,
  TimerText,
} from '@muna/ui/primitives';
import { Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react';
import { useState } from 'react';

import { albumArtSrc, type DemoModule, ICON_STROKE, pomodoro, track } from './demo-content';

const formatClock = (ms: number): string => {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

/** The Media panel, cut down to art, titles, progress and transport. */
export function MediaBody({ live }: { live: boolean }) {
  const [playing, setPlaying] = useState(true);
  return (
    <div className="demo-media">
      <AlbumArt src={albumArtSrc} palette={track.palette} adaptive size={112} />
      <div className="demo-media__info">
        <Text as="p" variant="title3" weight={600} truncate={1}>
          {track.title}
        </Text>
        <Text as="p" variant="footnote" tone="secondary" truncate={1}>
          {track.artist} · {track.album}
        </Text>
        <div className="demo-media__progress">
          <Text variant="footnote" tone="tertiary" tabular>
            {formatClock(track.positionMs)}
          </Text>
          <ProgressTrack
            aria-label="Track position"
            tint="cyan"
            seekable
            value={track.positionMs}
            maxValue={track.durationMs}
          />
          <Text variant="footnote" tone="tertiary" tabular>
            {formatClock(track.durationMs)}
          </Text>
        </div>
        <div className="demo-media__transport">
          <IconButton aria-label="Previous track">
            <SkipBack strokeWidth={ICON_STROKE} />
          </IconButton>
          <IconButton
            size="large"
            aria-label={playing ? 'Pause' : 'Play'}
            aria-pressed={playing}
            onPress={() => {
              setPlaying((value) => !value);
            }}
          >
            {playing && live ? (
              <Pause strokeWidth={ICON_STROKE} />
            ) : (
              <Play strokeWidth={ICON_STROKE} />
            )}
          </IconButton>
          <IconButton aria-label="Next track">
            <SkipForward strokeWidth={ICON_STROKE} />
          </IconButton>
        </div>
      </div>
    </div>
  );
}

/** The Pomodoro panel: the ring with the countdown inside and the session controls. */
export function PomodoroBody({ live, receivedAt }: { live: boolean; receivedAt: number }) {
  const elapsed = pomodoro.totalMs - pomodoro.remainingMs;
  return (
    <div className="demo-pomodoro">
      <Ring
        diameter={128}
        tint="orange"
        value={elapsed}
        maxValue={pomodoro.totalMs}
        valueText={`${formatCountdown(pomodoro.remainingMs)} left`}
        aria-label="Focus session"
      >
        <TimerText
          variant="title2"
          weight={600}
          remainingMs={pomodoro.remainingMs}
          running={live}
          receivedAt={receivedAt}
        />
      </Ring>
      <div className="demo-pomodoro__side">
        <Text as="p" variant="callout" weight={600}>
          Focus
        </Text>
        <Text as="p" variant="footnote" tone="secondary">
          Work 25, then a 5 minute break
        </Text>
        <div className="demo-pomodoro__controls">
          <IconButton aria-label="Reset session">
            <RotateCcw strokeWidth={ICON_STROKE} />
          </IconButton>
          <IconButton size="large" aria-label="Pause session">
            <Pause strokeWidth={ICON_STROKE} />
          </IconButton>
          <IconButton aria-label="Skip to break">
            <SkipForward strokeWidth={ICON_STROKE} />
          </IconButton>
        </div>
      </div>
    </div>
  );
}

const tasks = [
  { id: 'review', label: 'Review the release notes', due: 'Today' },
  { id: 'invoice', label: 'Send the March invoice', due: 'Tomorrow' },
  { id: 'plants', label: 'Water the plants', due: 'Friday' },
] as const;

/** The Todo panel: three tasks with checkboxes. */
export function TodoBody() {
  const [done, setDone] = useState<readonly string[]>([]);
  return (
    <ul className="demo-todo" aria-label="Tasks">
      {tasks.map((task) => {
        const checked = done.includes(task.id);
        return (
          <li key={task.id}>
            <ListRow
              icon={
                <Checkbox
                  aria-label={`Complete ${task.label}`}
                  isSelected={checked}
                  onChange={(selected) => {
                    setDone((value) =>
                      selected ? [...value, task.id] : value.filter((id) => id !== task.id),
                    );
                  }}
                />
              }
              label={
                <Text variant="body" tone={checked ? 'tertiary' : 'primary'}>
                  {checked ? <s>{task.label}</s> : task.label}
                </Text>
              }
              trailing={
                <Text variant="footnote" tone="secondary">
                  {task.due}
                </Text>
              }
            />
          </li>
        );
      })}
    </ul>
  );
}

export const moduleTitles: Readonly<Record<DemoModule, string>> = {
  media: 'Media',
  pomodoro: 'Pomodoro',
  todo: 'Todo',
};
