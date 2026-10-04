import type { Note, NoteContent, NotesSnapshot } from '@muna/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { PanelFrame } from '../../storybook/frames';
import { type IpcHandlers, type MunaStoryParameters, refuse } from '../../storybook/ipc';
import { useNotesStore } from './notes-store';
import { NotesPanel } from './panel';

const NOW = 1_790_503_600_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const FOLDER = 'C:\\Users\\sam\\AppData\\Roaming\\Muna\\notes';

const note = (overrides: Partial<Note> & Pick<Note, 'id' | 'title'>): Note => ({
  folder: '',
  excerpt: '',
  modifiedMs: NOW - HOUR,
  bytes: 400,
  pinned: false,
  ...overrides,
});

const BODIES: Readonly<Record<string, string>> = {
  'Groceries.md':
    '# Groceries\n\n- [x] milk\n- [ ] eggs\n- [ ] bread\n\nAsk about the **sourdough** at the market.',
  'work/Standup notes.md':
    '## Monday\n\n1. Snap zones demo\n2. Review queue polish\n\n> Keep it under ten minutes.',
  'Ideas.md':
    'A notch widget that shows the next train.\n\nSee [the transit API](https://example.com/api) for the feed format; `GET /departures` returns JSON.',
  'Reading list.md': 'Designing Interfaces, third edition\nThe Design of Everyday Things',
  'Inbox.md': 'call the dentist\npick up the parcel\n',
};

const excerptOf = (id: string): string =>
  (BODIES[id] ?? '')
    .split('\n')
    .map((line) => line.replace(/^[#>\-*\d.)\s[\]x]+/u, '').trim())
    .find((line) => line !== '') ?? '';

/** A week of notes: a pinned list, one in a sub-folder, an idea, a reading list and Inbox. */
const notes = (): Note[] => [
  note({
    id: 'Groceries.md',
    title: 'Groceries',
    excerpt: excerptOf('Groceries.md'),
    pinned: true,
  }),
  note({
    id: 'work/Standup notes.md',
    title: 'Standup notes',
    folder: 'work',
    excerpt: excerptOf('work/Standup notes.md'),
    modifiedMs: NOW - 20 * 60_000,
  }),
  note({
    id: 'Ideas.md',
    title: 'Ideas',
    excerpt: excerptOf('Ideas.md'),
    modifiedMs: NOW - 2 * DAY,
  }),
  note({
    id: 'Reading list.md',
    title: 'Reading list',
    excerpt: excerptOf('Reading list.md'),
    modifiedMs: NOW - 9 * DAY,
  }),
  note({
    id: 'Inbox.md',
    title: 'Inbox',
    excerpt: excerptOf('Inbox.md'),
    modifiedMs: NOW - 40 * DAY,
  }),
];

const folder = (list: Note[], extra: Partial<NotesSnapshot> = {}): NotesSnapshot => ({
  folder: FOLDER,
  defaultFolder: true,
  notes: list,
  inboxId: list.some((row) => row.id === 'Inbox.md') ? 'Inbox.md' : null,
  problem: null,
  ...extra,
});

const contentOf = (id: string, title: string, body: string): NoteContent => ({
  id,
  title,
  body,
  modifiedMs: NOW - HOUR,
});

/**
 * A fake notes folder: opens answer from `BODIES`, saves and renames are accepted as they
 * come, search matches titles and bodies. Stateless on purpose: the stories share this object.
 */
const notesService = (initial: NotesSnapshot): IpcHandlers => ({
  get_notes_snapshot: () => initial,
  notes_command: () => initial,
  notes_create: (args) => {
    const { title } = args as { title: string };
    return contentOf(`${title}.md`, title, '');
  },
  notes_open: (args) => {
    const { id } = args as { id: string };
    const row = initial.notes.find((candidate) => candidate.id === id);
    if (row === undefined) return refuse('notes.unknown', 'not a note in the folder');
    return contentOf(id, row.title, BODIES[id] ?? '');
  },
  notes_open_inbox: () => contentOf('Inbox.md', 'Inbox', BODIES['Inbox.md'] ?? ''),
  notes_save: (args) => {
    const { draft } = args as { draft: { id: string; body: string } };
    const row = initial.notes.find((candidate) => candidate.id === draft.id);
    return contentOf(draft.id, row?.title ?? draft.id, draft.body);
  },
  notes_rename: (args) => {
    const { id, title } = args as { id: string; title: string };
    const row = initial.notes.find((candidate) => candidate.id === id);
    return note({ ...row, id: `${title}.md`, title });
  },
  notes_search: (args) => {
    const { query } = args as { query: string };
    const needle = query.toLowerCase();
    return initial.notes
      .filter(
        (row) =>
          row.title.toLowerCase().includes(needle) ||
          (BODIES[row.id] ?? '').toLowerCase().includes(needle),
      )
      .map((row) => row.id);
  },
  notes_reveal: () => null,
  notes_open_external: () => null,
  open_settings: () => null,
});

const meta = {
  title: 'Modules/Notes/Panel',
  component: NotesPanel,
  parameters: {
    layout: 'centered',
    window: 'notch',
    ipc: notesService(folder(notes())),
  } satisfies MunaStoryParameters & { layout: string },
  render: () => (
    <PanelFrame title="Notes">
      <NotesPanel />
    </PanelFrame>
  ),
  beforeEach: () => {
    useNotesStore.setState({ snapshot: null, receivedAt: NOW, quickNotePending: false });
  },
  globals: { backgrounds: { value: 'desktop' } },
} satisfies Meta<typeof NotesPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Five notes, the pinned list first, then newest; one lives in a sub-folder. */
export const Default: Story = {};

/** A row opens the editor in place: the title, its actions, the text and when it was edited. */
export const Editor: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: /Groceries/ }));
    await waitFor(async () => {
      await expect(canvas.getByRole('textbox', { name: 'Note text' })).toBeVisible();
    });
  },
};

/** The light Markdown preview: headings, a task list, bold, a quote — links shown, not followed. */
export const Preview: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: /Groceries/ }));
    await userEvent.click(await canvas.findByRole('button', { name: 'Preview' }));
    await waitFor(async () => {
      await expect(canvas.getByRole('heading', { level: 1, name: 'Groceries' })).toBeVisible();
    });
  },
};

/** Search narrows the list to the notes whose title or text contain the word. */
export const Searching: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(await canvas.findByRole('searchbox', { name: 'Search notes' }), 'train');
    await waitFor(async () => {
      await expect(canvas.getByText('1 note')).toBeVisible();
    });
  },
};

/** *New note* swaps the search field for a title field; Enter creates and opens the note. */
export const NewNote: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'New note' }));
    await waitFor(async () => {
      await expect(canvas.getByRole('textbox', { name: 'Title of the new note' })).toHaveFocus();
    });
  },
};

/** The quick note action: Inbox opens with the caret after the last line. */
export const QuickNote: Story = {
  beforeEach: () => {
    useNotesStore.setState({ snapshot: null, receivedAt: NOW, quickNotePending: true });
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByRole('textbox', { name: 'Note text' })).toHaveFocus();
    });
  },
};

/** An empty folder says what to do. */
export const Empty: Story = {
  parameters: {
    ipc: notesService(folder([])),
  } satisfies MunaStoryParameters,
};

/** The chosen folder (an external drive) is not there: the panel points at Settings. */
export const FolderMissing: Story = {
  parameters: {
    ipc: notesService(
      folder([], { folder: 'E:\\Vault', defaultFolder: false, problem: 'missing' }),
    ),
  } satisfies MunaStoryParameters,
};

/** Long titles and excerpts end in an ellipsis; the list scrolls inside the panel. */
export const LongContent: Story = {
  parameters: {
    ipc: notesService(
      folder(
        Array.from({ length: 14 }, (_, index) =>
          note({
            id: `Note ${String(index + 1)}.md`,
            title: `A note with a title long enough to overflow the row and keep going ${String(index + 1)}`,
            excerpt:
              'The first line of the note runs on for a while so the row has to cut it short with an ellipsis.',
            modifiedMs: NOW - index * 5 * HOUR,
            pinned: index === 0,
          }),
        ),
      ),
    ),
  } satisfies MunaStoryParameters,
};

export const RTL: Story = {
  globals: { direction: 'rtl' },
};

/** Spike S3: the mirrored-English pseudo-locale; the list, the editor and the toolbar flip. */
export const PseudoRtl: Story = {
  globals: { locale: 'ar-XB' },
};

export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
};
