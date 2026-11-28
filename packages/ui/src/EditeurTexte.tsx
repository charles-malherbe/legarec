import { readMessage, writeMessage, type MessageBlock, type MessageRun } from '@legarec/contracts';
import { RichTextEditor } from '@mantine/tiptap';
import { useEditor, type JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useId, useRef } from 'react';
import { Icone } from './Icone';
import css from './EditeurTexte.module.css';
import type { LayoutProps } from './types';

export interface EditeurTexteProps extends LayoutProps {
  label: string;
  /** Text with its marks (`messageText.ts` of the contracts): `**gras**`, `*italique*`, lines `- ` and `1. `. */
  value: string;
  onChange: (value: string) => void;
  help?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
}

const runsOf = (nodes: JSONContent[] = []): MessageRun[] => {
  const runs: MessageRun[] = [];
  for (const node of nodes) {
    const text = node.type === 'hardBreak' ? '\n' : (node.text ?? '');
    if (!text) continue;
    const bold = node.marks?.some((mark) => mark.type === 'bold') ? true : undefined;
    const italic = node.marks?.some((mark) => mark.type === 'italic') ? true : undefined;
    const last = runs.at(-1);
    if (last && (last.bold === bold || text === '\n') && (last.italic === italic || text === '\n')) last.text += text;
    else runs.push({ text, ...(bold ? { bold } : {}), ...(italic ? { italic } : {}) });
  }
  return runs;
};
/** What the editor holds, as the blocks of the message; a list inside a list is flattened. */
function blocksOf(doc: JSONContent): MessageBlock[] {
  const items = (list: JSONContent): MessageRun[][] =>
    (list.content ?? []).flatMap((item) =>
      (item.content ?? []).flatMap((child) => (child.type === 'paragraph' ? [runsOf(child.content)] : items(child))).filter((runs) => runs.length > 0),
    );
  return (doc.content ?? []).flatMap((node): MessageBlock[] => {
    if (node.type === 'bulletList') {
      const list = items(node);
      return list.length > 0 ? [{ bullets: list }] : [];
    }
    if (node.type === 'orderedList') {
      const list = items(node);
      return list.length > 0 ? [{ numbers: list }] : [];
    }
    const runs = runsOf(node.content);
    return runs.length > 0 ? [{ paragraph: runs }] : [];
  });
}
const nodesOf = (runs: MessageRun[]): JSONContent[] =>
  runs.flatMap((run) => {
    const marks = [...(run.bold ? [{ type: 'bold' }] : []), ...(run.italic ? [{ type: 'italic' }] : [])];
    return run.text
      .split('\n')
      .flatMap((part, index): JSONContent[] => [
        ...(index > 0 ? [{ type: 'hardBreak' }] : []),
        ...(part ? [{ type: 'text', text: part, ...(marks.length > 0 ? { marks } : {}) }] : []),
      ]);
  });
const docOf = (text: string): JSONContent => {
  const blocks = readMessage(text);
  const item = (runs: MessageRun[]) => ({ type: 'listItem', content: [{ type: 'paragraph', content: nodesOf(runs) }] });
  return {
    type: 'doc',
    content:
      blocks.length === 0
        ? [{ type: 'paragraph' }]
        : blocks.map((block) =>
            'paragraph' in block
              ? { type: 'paragraph', content: nodesOf(block.paragraph) }
              : 'bullets' in block
                ? { type: 'bulletList', content: block.bullets.map(item) }
                : { type: 'orderedList', content: block.numbers.map(item) },
          ),
  };
};

const LABELS = {
  boldControlLabel: 'Gras',
  italicControlLabel: 'Italique',
  bulletListControlLabel: 'Liste à puces',
  orderedListControlLabel: 'Liste numérotée',
};

/**
 * Text of a message with a few marks: bold, italic, bullets, numbered items (Tiptap through @mantine/tiptap). It gives
 * and takes text with marks, never HTML: the API reads it and the template of the e-mail escapes every word
 * (DECISIONS.md, 28/11/2026). Ctrl+B and Ctrl+I as in a word processor; « - » or « 1. » at the start of a line opens a list.
 */
export function EditeurTexte({ label, value, onChange, help, error, required, disabled, layout }: EditeurTexteProps) {
  const id = useId();
  const written = useRef(value);
  const describedBy = error ? `${id}-err` : help ? `${id}-help` : undefined;
  const editor = useEditor({
    immediatelyRender: true,
    shouldRerenderOnTransaction: true,
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
        underline: false,
        link: false,
      }),
    ],
    content: docOf(value),
    editorProps: {
      attributes: {
        id,
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-labelledby': `${id}-label`,
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        ...(required ? { 'aria-required': 'true' } : {}),
        ...(error ? { 'aria-invalid': 'true' } : {}),
        class: css.content ?? '',
      },
    },
    onUpdate: ({ editor: current }) => {
      const next = writeMessage(blocksOf(current.getJSON()));
      written.current = next;
      onChange(next);
    },
  });
  // A text put from outside (a template inserted, « Annuler »): the editor takes it.
  useEffect(() => {
    if (!editor || value === written.current) return;
    written.current = value;
    editor.commands.setContent(docOf(value), { emitUpdate: false });
  }, [editor, value]);
  useEffect(() => editor?.setEditable(!disabled), [editor, disabled]);

  return (
    <div className={css.root} style={layout}>
      <span id={`${id}-label`} className={css.label} onClick={() => editor?.commands.focus()}>
        {label}
        {required && (
          <span aria-hidden className={css.required}>
            {' '}
            *
          </span>
        )}
      </span>
      <RichTextEditor
        editor={editor}
        unstyled
        labels={LABELS}
        withTypographyStyles={false}
        withCodeHighlightStyles={false}
        classNames={{ root: css.editor, toolbar: css.toolbar, controlsGroup: css.group, control: css.control, content: css.area }}
        data-invalid={error ? true : undefined}
        data-disabled={disabled || undefined}
      >
        <RichTextEditor.Toolbar aria-label={`Mise en forme : ${label}`}>
          <RichTextEditor.ControlsGroup>
            <RichTextEditor.Bold />
            <RichTextEditor.Italic />
          </RichTextEditor.ControlsGroup>
          <RichTextEditor.ControlsGroup>
            <RichTextEditor.BulletList />
            <RichTextEditor.OrderedList />
          </RichTextEditor.ControlsGroup>
        </RichTextEditor.Toolbar>
        <RichTextEditor.Content />
      </RichTextEditor>
      {help && !error && (
        <span id={`${id}-help`} className={css.help}>
          {help}
        </span>
      )}
      {error && (
        <span id={`${id}-err`} role="alert" className={css.error}>
          <Icone icon="alert" size={14} />
          {error}
        </span>
      )}
    </div>
  );
}
