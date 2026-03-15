import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import { useEffect } from 'react';
import {
  Bold, Italic, Strikethrough, Code, List, ListOrdered, CheckSquare,
  Heading1, Heading2, Heading3, Quote, Minus, Highlighter, Link as LinkIcon, Undo2, Redo2,
} from 'lucide-react';

interface NoteEditorProps {
  content: string;
  onChange: (html: string) => void;
  editable?: boolean;
}

export default function NoteEditor({ content, onChange, editable = true }: NoteEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: { HTMLAttributes: { class: 'code-block' } },
      }),
      Placeholder.configure({ placeholder: 'Start writing...' }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight.configure({ multicolor: false }),
      Link.configure({ openOnClick: true, HTMLAttributes: { class: 'editor-link' } }),
    ],
    content,
    editable,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  // Sync content when note changes
  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content, false);
    }
  }, [content]);

  if (!editor) return null;

  return (
    <div className="note-editor">
      {editable && (
        <div className="editor-toolbar">
          <button
            className={`tb ${editor.isActive('bold') ? 'active' : ''}`}
            onClick={() => editor.chain().focus().toggleBold().run()}
            title="Bold (Ctrl+B)"
          ><Bold size={15} /></button>
          <button
            className={`tb ${editor.isActive('italic') ? 'active' : ''}`}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            title="Italic (Ctrl+I)"
          ><Italic size={15} /></button>
          <button
            className={`tb ${editor.isActive('strike') ? 'active' : ''}`}
            onClick={() => editor.chain().focus().toggleStrike().run()}
            title="Strikethrough"
          ><Strikethrough size={15} /></button>
          <button
            className={`tb ${editor.isActive('code') ? 'active' : ''}`}
            onClick={() => editor.chain().focus().toggleCode().run()}
            title="Inline Code"
          ><Code size={15} /></button>
          <button
            className={`tb ${editor.isActive('highlight') ? 'active' : ''}`}
            onClick={() => editor.chain().focus().toggleHighlight().run()}
            title="Highlight"
          ><Highlighter size={15} /></button>

          <span className="tb-sep" />

          <button
            className={`tb ${editor.isActive('heading', { level: 1 }) ? 'active' : ''}`}
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            title="Heading 1"
          ><Heading1 size={15} /></button>
          <button
            className={`tb ${editor.isActive('heading', { level: 2 }) ? 'active' : ''}`}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            title="Heading 2"
          ><Heading2 size={15} /></button>
          <button
            className={`tb ${editor.isActive('heading', { level: 3 }) ? 'active' : ''}`}
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            title="Heading 3"
          ><Heading3 size={15} /></button>

          <span className="tb-sep" />

          <button
            className={`tb ${editor.isActive('bulletList') ? 'active' : ''}`}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            title="Bullet List"
          ><List size={15} /></button>
          <button
            className={`tb ${editor.isActive('orderedList') ? 'active' : ''}`}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            title="Numbered List"
          ><ListOrdered size={15} /></button>
          <button
            className={`tb ${editor.isActive('taskList') ? 'active' : ''}`}
            onClick={() => editor.chain().focus().toggleTaskList().run()}
            title="Task List"
          ><CheckSquare size={15} /></button>

          <span className="tb-sep" />

          <button
            className={`tb ${editor.isActive('blockquote') ? 'active' : ''}`}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            title="Quote"
          ><Quote size={15} /></button>
          <button
            className="tb"
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            title="Divider"
          ><Minus size={15} /></button>
          <button
            className={`tb ${editor.isActive('codeBlock') ? 'active' : ''}`}
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            title="Code Block"
          ><Code size={15} /></button>
          <button
            className="tb"
            onClick={() => {
              const url = window.prompt('URL:');
              if (url) editor.chain().focus().setLink({ href: url }).run();
            }}
            title="Insert Link"
          ><LinkIcon size={15} /></button>

          <span className="tb-sep" />

          <button className="tb" onClick={() => editor.chain().focus().undo().run()} title="Undo"><Undo2 size={15} /></button>
          <button className="tb" onClick={() => editor.chain().focus().redo().run()} title="Redo"><Redo2 size={15} /></button>
        </div>
      )}
      <EditorContent editor={editor} className="editor-content" />
    </div>
  );
}
