import { commands, type DropJob, events } from '@muna/contracts';
import { useEffect, useState } from 'react';

/**
 * The file operations Rust is running for this module, live while the caller is mounted: one
 * `get_drop_actions_snapshot` round trip, then `DropActionsChanged`. Unlistens on unmount so
 * a closed pane costs nothing (PRD performance budget). Outside Tauri the list stays empty.
 */
export function useDropJobs(): readonly DropJob[] {
  const [jobs, setJobs] = useState<readonly DropJob[]>([]);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const outsideTauri = () => {
      // Storybook and tests: nothing is running.
    };
    void events.dropActionsChanged
      .listen((event) => {
        setJobs(event.payload.snapshot.jobs);
      })
      .then((stop) => {
        if (disposed) {
          stop();
        } else {
          unlisten = stop;
        }
      }, outsideTauri);
    void commands
      .getDropActionsSnapshot()
      .then((snapshot) => {
        if (!disposed) setJobs(snapshot.jobs);
      })
      .catch(outsideTauri);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  return jobs;
}
