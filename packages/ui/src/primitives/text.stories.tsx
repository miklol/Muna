import type { Meta, StoryObj } from '@storybook/react-vite';

import { Text, type TextVariant } from './text';

const meta = {
  title: 'Primitives/Text',
  component: Text,
  parameters: { layout: 'padded' },
  args: { children: 'Now playing', variant: 'body', tone: 'primary' },
} satisfies Meta<typeof Text>;

export default meta;

type Story = StoryObj<typeof meta>;

const scale: TextVariant[] = [
  'display',
  'title1',
  'title2',
  'title3',
  'callout',
  'body',
  'footnote',
  'caption',
  'caption2',
];

export const Default: Story = {};

export const TypeScale: Story = {
  render: () => (
    <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 'var(--space-3)' }}>
      {scale.map((variant) => (
        <div key={variant} style={{ display: 'contents' }}>
          <Text as="dt" variant="caption" tone="secondary" tabular>
            {variant}
          </Text>
          <Text as="dd" variant={variant}>
            Now playing — Nothing else matters
          </Text>
        </div>
      ))}
    </dl>
  ),
};

/** Every tone passes 4.5:1 on the panel; `--text-3` is not a text tone (disabled glyphs only). */
export const Tones: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
      <Text tone="primary">Primary — titles and values</Text>
      <Text tone="secondary">Secondary — labels and metadata</Text>
      <Text tone="tertiary" variant="footnote">
        Tertiary — footnotes and hints, same readable tone
      </Text>
    </div>
  ),
};

export const Tabular: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 'var(--space-1)', inlineSize: '8ch' }}>
      <Text tabular variant="title3">
        01:11
      </Text>
      <Text tabular variant="title3">
        10:00
      </Text>
      <Text tabular variant="title3">
        88:88
      </Text>
    </div>
  ),
};

export const LongContent: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 'var(--space-3)', inlineSize: 200 }}>
      <Text truncate={1} weight={600}>
        A very long track title that keeps going past the edge of the strip
      </Text>
      <Text truncate={2} tone="secondary" variant="footnote">
        A two-line notification body that explains what happened and what the user might want to do
        about it, then stops.
      </Text>
    </div>
  ),
};

export const RingLabel: Story = {
  args: { variant: 'caption2', caps: true, tone: 'secondary', children: 'Move' },
};

export const RTL: Story = {
  render: () => (
    <div dir="rtl" style={{ display: 'grid', gap: 'var(--space-2)', inlineSize: 220 }}>
      <Text as="p" variant="title3">
        الآن يعمل
      </Text>
      <Text as="p" truncate={1} tone="secondary">
        عنوان طويل جدًا يتجاوز حافة الشريط ويستمر بعدها
      </Text>
    </div>
  ),
};
