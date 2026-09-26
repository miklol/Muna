import { describe, expect, it } from 'vitest';

import {
  dropSize,
  type GeometryInput,
  moduleBarOffsetY,
  moduleBarSize,
  panelSize,
  revealSize,
  shellSizes,
  showsDrop,
  showsLarge,
  showsPanel,
  stripSize,
  targetOffsetY,
  targetSize,
} from './shell-geometry';

const input = (overrides: Partial<GeometryInput> = {}): GeometryInput => ({
  layout: { stripHeight: 32, stripTopOffset: 0, panelMaxWidth: 1000 },
  wide: false,
  panelContentHeight: null,
  ...overrides,
});

const layoutWith = (overrides: Partial<GeometryInput['layout']>): Partial<GeometryInput> => ({
  layout: { stripHeight: 32, stripTopOffset: 0, panelMaxWidth: 1000, ...overrides },
});

describe('shell geometry', () => {
  it('matches the design-system sizes', () => {
    expect(shellSizes).toMatchObject({
      stripWidth: 200,
      stripWideWidth: 420,
      revealGrowWidth: 16,
      revealGrowHeight: 4,
      peekHeight: 6,
      panelMinWidth: 720,
      panelMinHeight: 190,
      panelMaxHeight: 360,
      moduleBarWidth: 640,
      moduleBarHeight: 40,
      moduleBarGap: 12,
    });
    expect(moduleBarSize).toEqual({ width: 640, height: 40 });
  });

  it('sizes the strip from the layout and the wide form', () => {
    expect(stripSize(input())).toEqual({ width: 200, height: 32 });
    expect(stripSize(input(layoutWith({ stripHeight: 38 })))).toEqual({
      width: 200,
      height: 38,
    });
    expect(stripSize(input({ wide: true }))).toEqual({ width: 420, height: 32 });
  });

  it('grows the reveal by +16 × +4 from whichever strip form is showing', () => {
    expect(revealSize(input())).toEqual({ width: 216, height: 36 });
    expect(revealSize(input({ wide: true }))).toEqual({ width: 436, height: 36 });
  });

  it('clamps the panel to the shell width bound and the content height', () => {
    expect(panelSize(input())).toEqual({ width: 1000, height: 190 });
    expect(panelSize(input(layoutWith({ panelMaxWidth: 640 }))).width).toBe(720);
    expect(panelSize(input({ panelContentHeight: 250 })).height).toBe(250);
    expect(panelSize(input({ panelContentHeight: 900 })).height).toBe(360);
    expect(panelSize(input({ panelContentHeight: 40 })).height).toBe(190);
  });

  it('maps every state to a target size and vertical offset', () => {
    expect(targetSize('collapsed', input())).toEqual({ width: 200, height: 32 });
    expect(targetSize('peek', input())).toEqual({ width: 200, height: 32 });
    expect(targetSize('hoverReveal', input())).toEqual({ width: 216, height: 36 });
    expect(targetSize('expanded', input())).toEqual({ width: 1000, height: 190 });
    expect(targetSize('pinned', input())).toEqual({ width: 1000, height: 190 });
    expect(targetSize('parked', input())).toEqual({ width: 200, height: 32 });

    expect(targetOffsetY('peek', input())).toBe(-26);
    expect(targetOffsetY('peek', input(layoutWith({ stripHeight: 38 })))).toBe(-32);
    // The island rests 8 px below the top edge and still leaves exactly the 6 px sliver.
    expect(targetOffsetY('peek', input(layoutWith({ stripTopOffset: 8 })))).toBe(-34);
    expect(targetOffsetY('collapsed', input())).toBe(0);
    expect(targetOffsetY('expanded', input())).toBe(0);
  });

  it('knows which states show the panel', () => {
    expect(showsPanel('expanded')).toBe(true);
    expect(showsPanel('pinned')).toBe(true);
    expect(showsPanel('hoverReveal')).toBe(false);
    expect(showsPanel('collapsed')).toBe(false);
    expect(showsPanel('drop')).toBe(false);
    expect(showsDrop('drop')).toBe(true);
    expect(showsDrop('expanded')).toBe(false);
    expect(showsLarge('drop')).toBe(true);
    expect(showsLarge('pinned')).toBe(true);
    expect(showsLarge('hoverReveal')).toBe(false);
  });

  it('sizes the drop row from its tiles, no wider than the panel, and from the strip until measured', () => {
    expect(targetSize('drop', input())).toEqual({ width: 200, height: 32 });
    expect(dropSize(input({ dropContentSize: null }))).toEqual({ width: 200, height: 32 });
    expect(dropSize(input({ wide: true, dropContentSize: { width: 0, height: 0 } }))).toEqual({
      width: 420,
      height: 32,
    });
    expect(targetSize('drop', input({ dropContentSize: { width: 544, height: 116 } }))).toEqual({
      width: 544,
      height: 116,
    });
    expect(
      dropSize(
        input({
          ...layoutWith({ panelMaxWidth: 720 }),
          dropContentSize: { width: 1100, height: 116 },
        }),
      ),
    ).toEqual({ width: 720, height: 116 });
    // The row never slides for peek: it replaces the strip at the top edge.
    expect(targetOffsetY('drop', input())).toBe(0);
  });

  it('hangs the module bar 12 px under whatever silhouette the shell is heading for', () => {
    expect(moduleBarOffsetY('expanded', input())).toBe(190 + 12);
    expect(moduleBarOffsetY('pinned', input({ panelContentHeight: 250 }))).toBe(250 + 12);
    // Before the panel opens the bar sits under the strip, so it rides the expand spring.
    expect(moduleBarOffsetY('collapsed', input())).toBe(32 + 12);
    // The tallest panel plus the bar stays inside the 480 px window with room for the island.
    expect(shellSizes.panelMaxHeight + 12 + 40 + 8).toBeLessThanOrEqual(480);
  });
});
