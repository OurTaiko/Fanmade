import { useEffect, useRef } from 'react'
import { EditorState, Compartment } from '@codemirror/state'
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  highlightSpecialChars,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { StreamLanguage, HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'

// A TJA line is a header (NAME:value), a #COMMAND, note digits with ","
// bar ends, or a // comment. Lines are independent, so no parser state.
const tja = StreamLanguage.define<{ inBlock: boolean }>({
  name: 'tja',
  startState: () => ({ inBlock: false }),
  token(stream, state) {
    if (stream.match(/\/\/.*/)) return 'comment'
    if (stream.sol()) {
      if (stream.match(/^#START\b.*/i)) {
        state.inBlock = true
        return 'keyword'
      }
      if (stream.match(/^#END\b.*/i)) {
        state.inBlock = false
        return 'keyword'
      }
      if (stream.match(/^#[A-Za-z]+/)) return 'keyword'
      if (!state.inBlock && stream.match(/^[A-Za-z_][A-Za-z0-9_]*(?=:)/)) return 'propertyName'
    }
    if (stream.match(/^[0-9]+/)) return 'number'
    if (stream.match(/^,/)) return 'punctuation'
    if (stream.match(/^:/)) return 'operator'
    if (stream.match(/^[-+]?\d*\.?\d+/)) return 'number'
    stream.next()
    return null
  },
})

// Colors follow the site's tokens so both themes work.
const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--primary)', fontWeight: '600' },
  { tag: tags.propertyName, color: 'var(--muted-foreground)' },
  { tag: tags.number, color: 'var(--foreground)' },
  { tag: tags.punctuation, color: 'var(--muted-foreground)' },
  { tag: tags.operator, color: 'var(--muted-foreground)' },
  { tag: tags.comment, color: 'var(--muted-foreground)', fontStyle: 'italic' },
])

const theme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'var(--background)',
    color: 'var(--foreground)',
    fontSize: '13px',
  },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
  '.cm-content': { caretColor: 'var(--foreground)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--foreground)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'color-mix(in oklab, var(--primary) 25%, transparent)',
  },
  '.cm-activeLine': { backgroundColor: 'color-mix(in oklab, var(--muted) 60%, transparent)' },
  '.cm-gutters': {
    backgroundColor: 'var(--muted)',
    color: 'var(--muted-foreground)',
    borderRight: '1px solid var(--border)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'color-mix(in oklab, var(--muted) 60%, var(--border))',
  },
  '&.cm-focused': { outline: 'none' },
})

export type TjaEditorProps = {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  /** Scroll to and select this 1-based line when it changes. */
  jumpToLine?: { line: number; at: number } | null
  /** Called on Ctrl/Cmd+S. */
  onSave?: () => void
  ariaLabel: string
  className?: string
}

/** A CodeMirror 6 editor for TJA text. Loaded lazily: see chart-editor.tsx. */
export default function TjaEditor({
  value,
  onChange,
  disabled = false,
  jumpToLine,
  onSave,
  ariaLabel,
  className,
}: TjaEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const readOnly = useRef(new Compartment())
  const latest = useRef({ onChange, onSave })
  latest.current = { onChange, onSave }

  useEffect(() => {
    if (!host.current) return
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        highlightActiveLine(),
        tja,
        syntaxHighlighting(highlight),
        theme,
        EditorView.lineWrapping,
        readOnly.current.of(EditorState.readOnly.of(disabled)),
        keymap.of([
          {
            key: 'Mod-s',
            run: () => {
              latest.current.onSave?.()
              return true
            },
          },
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) latest.current.onChange(update.state.doc.toString())
        }),
        EditorView.contentAttributes.of({ 'aria-label': ariaLabel }),
      ],
    })
    const editor = new EditorView({ state, parent: host.current })
    view.current = editor
    return () => {
      editor.destroy()
      view.current = null
    }
    // The document is owned by the editor after mount; `value` only seeds it
    // and is pushed back in below when it changes elsewhere.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ariaLabel])

  useEffect(() => {
    const editor = view.current
    if (!editor) return
    const current = editor.state.doc.toString()
    if (current !== value)
      editor.dispatch({ changes: { from: 0, to: current.length, insert: value } })
  }, [value])

  useEffect(() => {
    view.current?.dispatch({
      effects: readOnly.current.reconfigure(EditorState.readOnly.of(disabled)),
    })
  }, [disabled])

  useEffect(() => {
    const editor = view.current
    if (!editor || !jumpToLine) return
    const line = Math.min(Math.max(1, jumpToLine.line), editor.state.doc.lines)
    const { from, to } = editor.state.doc.line(line)
    editor.dispatch({
      selection: { anchor: from, head: to },
      effects: EditorView.scrollIntoView(from, { y: 'center' }),
    })
    editor.focus()
  }, [jumpToLine])

  return <div ref={host} className={className} />
}
