import type * as Contracts from '@muna/contracts';
import type { DragOutRequest, DragOutcome, IpcError, Result } from '@muna/contracts';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DRAG_OUT_THRESHOLD_PX, DragGesture, useDragOut, useDragSpike } from './drag-out';

const ipc = vi.hoisted(() => ({
  dragOut: vi.fn<(request: DragOutRequest) => Promise<Result<DragOutcome, IpcError>>>(() =>
    Promise.resolve({ status: 'ok', data: { kind: 'cancelled' } }),
  ),
  getDragSpike: vi.fn(() => Promise.resolve<{ paths: string[] } | null>(null)),
}));

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: { dragOut: ipc.dragOut, getDragSpike: ipc.getDragSpike },
}));

describe('DragGesture', () => {
  it('starts once when a primary press travels past the threshold with the button down', () => {
    const gesture = new DragGesture();
    gesture.down({ x: 10, y: 10 }, 0);
    expect(gesture.armed).toBe(true);
    expect(gesture.move({ x: 12, y: 10 }, 1)).toBe(false);
    expect(gesture.move({ x: 10 + DRAG_OUT_THRESHOLD_PX, y: 10 }, 1)).toBe(true);
    expect(gesture.armed).toBe(false);
    expect(gesture.move({ x: 40, y: 40 }, 1)).toBe(false);
  });

  it('ignores secondary buttons and a move without the button down', () => {
    const gesture = new DragGesture();
    gesture.down({ x: 0, y: 0 }, 2);
    expect(gesture.move({ x: 50, y: 0 }, 2)).toBe(false);
    gesture.down({ x: 0, y: 0 }, 0);
    expect(gesture.move({ x: 50, y: 0 }, 0)).toBe(false);
    expect(gesture.armed).toBe(false);
  });

  it('disarms on release', () => {
    const gesture = new DragGesture();
    gesture.down({ x: 0, y: 0 }, 0);
    gesture.up();
    expect(gesture.move({ x: 50, y: 50 }, 1)).toBe(false);
  });
});

const FILES: DragOutRequest = { kind: 'files', paths: ['C:\\tmp\\spike.png'] };

function Armed({
  request,
  onOutcome,
  onNativeDragStart,
}: {
  request: DragOutRequest | null;
  onOutcome?: (outcome: DragOutcome) => void;
  onNativeDragStart?: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const dragging = useDragOut(ref, request, { onOutcome, onNativeDragStart });
  return <div ref={ref} data-testid="armed" data-dragging={dragging} />;
}

const press = (element: HTMLElement, x: number, y: number) => {
  fireEvent.pointerDown(element, { button: 0, buttons: 1, clientX: x, clientY: y });
};
const drag = (element: HTMLElement, x: number, y: number) => {
  fireEvent.pointerMove(element, { buttons: 1, clientX: x, clientY: y });
};

describe('useDragOut', () => {
  beforeEach(() => {
    ipc.dragOut.mockClear();
    ipc.getDragSpike.mockClear();
  });
  afterEach(cleanup);

  it('hands the gesture to Rust once and reports the outcome', async () => {
    const onOutcome = vi.fn();
    const { getByTestId } = render(<Armed request={FILES} onOutcome={onOutcome} />);
    const armed = getByTestId('armed');
    press(armed, 100, 20);
    drag(armed, 103, 20);
    expect(ipc.dragOut).not.toHaveBeenCalled();
    await act(async () => {
      drag(armed, 108, 20);
      drag(armed, 140, 20);
      await Promise.resolve();
    });
    expect(ipc.dragOut).toHaveBeenCalledTimes(1);
    expect(ipc.dragOut).toHaveBeenCalledWith(FILES);
    expect(onOutcome).toHaveBeenCalledWith({ kind: 'cancelled' });
    expect(armed.dataset.dragging).toBe('false');
  });

  it('shows the drag in flight until Rust answers', async () => {
    let settle: ((outcome: DragOutcome) => void) | undefined;
    ipc.dragOut.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settle = (outcome) => {
            resolve({ status: 'ok', data: outcome });
          };
        }),
    );
    const { getByTestId } = render(<Armed request={FILES} />);
    const armed = getByTestId('armed');
    act(() => {
      press(armed, 0, 0);
      drag(armed, 0, 10);
    });
    expect(armed.dataset.dragging).toBe('true');
    // A second gesture while one is running is ignored.
    act(() => {
      press(armed, 0, 0);
      drag(armed, 0, 10);
    });
    expect(ipc.dragOut).toHaveBeenCalledTimes(1);
    await act(async () => {
      settle?.({ kind: 'dropped', effect: 'copy' });
      await Promise.resolve();
    });
    expect(armed.dataset.dragging).toBe('false');
  });

  it('does nothing when released early, disarmed, or pressed with another button', () => {
    const { getByTestId, rerender } = render(<Armed request={FILES} />);
    const armed = getByTestId('armed');
    press(armed, 0, 0);
    fireEvent.pointerUp(armed);
    drag(armed, 50, 50);
    fireEvent.pointerDown(armed, { button: 2, buttons: 2, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(armed, { buttons: 2, clientX: 50, clientY: 50 });
    expect(ipc.dragOut).not.toHaveBeenCalled();
    rerender(<Armed request={null} />);
    press(armed, 0, 0);
    drag(armed, 50, 50);
    expect(ipc.dragOut).not.toHaveBeenCalled();
  });

  it('suppresses the native HTML5 drag and reports the attempt', () => {
    const onNativeDragStart = vi.fn();
    const { getByTestId } = render(<Armed request={FILES} onNativeDragStart={onNativeDragStart} />);
    const prevented = !fireEvent.dragStart(getByTestId('armed'));
    expect(prevented).toBe(true);
    expect(onNativeDragStart).toHaveBeenCalledTimes(1);
  });
});

function Spike() {
  const request = useDragSpike();
  return (
    <output data-testid="spike">
      {request?.kind === 'files' ? request.paths.join(';') : 'off'}
    </output>
  );
}

describe('useDragSpike', () => {
  afterEach(cleanup);

  it('is off in the product', async () => {
    const { getByTestId } = render(<Spike />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(getByTestId('spike').textContent).toBe('off');
  });

  it('arms the files the spike names', async () => {
    ipc.getDragSpike.mockResolvedValueOnce({ paths: ['C:\\a.txt', 'C:\\b.txt'] });
    const { getByTestId } = render(<Spike />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(getByTestId('spike').textContent).toBe('C:\\a.txt;C:\\b.txt');
  });
});
