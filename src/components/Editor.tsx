import { EditorToolbar } from "./EditorToolbar";
import { BlockControls, blockAction } from "./BlockControls";
import {
  useEditor,
  EditorContent,
  ReactNodeViewRenderer,
  NodeViewWrapper,
} from "@tiptap/react";
import { Node, mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { TableKit } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import { useEffect, useRef, useState } from "react";
import {
  AlignLeft,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  CheckSquare,
  Quote,
  Code2,
  Minus,
  Table2,
  Lightbulb,
  ImagePlus,
  Database as DatabaseIcon,
  Bold,
  Italic,
  Strikethrough,
  Link,
  ArrowUp,
  ArrowDown,
  Copy,
  Trash2,
  MoreHorizontal,
  Plus,
  Undo2,
  Redo2,
} from "lucide-react";
import type { Doc } from "../types";
import { useStore } from "../store";
import { DatabaseGrid } from "./DatabaseGrid";
import { Menu, MenuItem, MenuDivider, Modal } from "./ui";
const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  parseHTML: () => [{ tag: "aside[data-callout]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "aside",
    mergeAttributes(HTMLAttributes, {
      "data-callout": "",
      class: "editor-callout",
    }),
    0,
  ],
});
function EmbedView({ node, selected }: any) {
  const { data } = useStore();
  return (
    <NodeViewWrapper
      className={"database-embed " + (selected ? "selected" : "")}
      contentEditable={false}
    >
      {data.databases.some((d) => d.id === node.attrs.databaseId) ? (
        <DatabaseGrid databaseId={node.attrs.databaseId} embedded />
      ) : (
        <div className="empty-state">数据库已不存在</div>
      )}
    </NodeViewWrapper>
  );
}
const DatabaseEmbed = Node.create({
  name: "databaseEmbed",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes: () => ({ databaseId: { default: null } }),
  parseHTML: () => [{ tag: "div[data-database]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "div",
    mergeAttributes(HTMLAttributes, { "data-database": "" }),
  ],
  addNodeView: () => ReactNodeViewRenderer(EmbedView),
});
export function Editor({
  content,
  onChange,
  compact = false,
}: {
  content: Doc;
  onChange: (doc: Doc) => void;
  compact?: boolean;
}) {
  const { data, toast } = useStore();
  const change = useRef(onChange);
  change.current = onChange;
  const [slash, setSlash] = useState<{
      query: string;
      from: number;
      to: number;
      top: number;
      left: number;
    } | null>(null),
    [selected, setSelected] = useState(0),
    [toolbarMenuOpen, setToolbarMenuOpen] = useState(false),
    [embed, setEmbed] = useState(false),
    [linkOpen, setLinkOpen] = useState(false),
    [link, setLink] = useState(""),
    [version, setVersion] = useState(0);
  const container = useRef<HTMLDivElement>(null),
    file = useRef<HTMLInputElement>(null),
    last = useRef(""),
    slashRef = useRef(slash),
    commandsRef = useRef<any[]>([]),
    selectedRef = useRef(0);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: {
          openOnClick: false,
          HTMLAttributes: { rel: "noopener noreferrer" },
        },
      }),
      Placeholder.configure({
        placeholder: ({ node }) =>
          node.type.name === "heading"
            ? "标题"
            : "写点什么，或输入 / 插入内容…",
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: true } }),
      Image.configure({ allowBase64: true }),
      Callout,
      DatabaseEmbed,
    ],
    content,
    editorProps: {
      attributes: { class: "block-editor", "aria-label": "页面正文" },
      handleKeyDown: (view, event) => {
        if (!slashRef.current || event.isComposing) return false;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          setSelected(
            (s) =>
              (s +
                (event.key === "ArrowDown" ? 1 : -1) +
                commandsRef.current.length) %
              Math.max(1, commandsRef.current.length),
          );
          return true;
        }
        if (event.key === "Enter" && commandsRef.current.length) {
          event.preventDefault();
          commandsRef.current[selectedRef.current]?.run();
          return true;
        }
        if (event.key === "Escape") {
          setSlash(null);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      last.current = JSON.stringify(editor.getJSON());
      change.current(editor.getJSON());
    },
  });
  useEffect(() => {
    if (!editor) return;
    const serialized = JSON.stringify(content);
    if (
      serialized !== last.current &&
      serialized !== JSON.stringify(editor.getJSON())
    ) {
      editor.commands.setContent(content, { emitUpdate: false });
      last.current = serialized;
    }
  }, [content, editor]);
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      setVersion((v) => v + 1);
      const { $from, empty } = editor.state.selection;
      if (!empty) {
        setSlash(null);
        return;
      }
      const text = $from.parent.textBetween(
        0,
        $from.parentOffset,
        "\n",
        "\ufffc",
      );
      const match = text.match(/(?:^|\s)\/([^/]*)$/);
      if (match && match[1].length < 20) {
        const from = $from.pos - match[1].length - 1;
        const coords = editor.view.coordsAtPos(from);
        const rect = container.current?.getBoundingClientRect();
        setSlash((old) => {
          const next = {
            query: match[1],
            from,
            to: $from.pos,
            top:
              window.innerHeight - coords.bottom < 200 && coords.top > 360
                ? coords.top - (rect?.top || 0) - 348
                : coords.bottom - (rect?.top || 0) + 8,
            left: Math.max(
              0,
              Math.min(
                coords.left - (rect?.left || 0),
                Math.max(0, (rect?.width || 500) - 290),
              ),
            ),
          };
          if (old?.query !== next.query) setSelected(0);
          return next;
        });
      } else setSlash(null);
    };
    editor.on("transaction", update);
    return () => {
      editor.off("transaction", update);
    };
  }, [editor]);
  useEffect(() => {
    container.current
      ?.querySelector('.slash-menu [aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  slashRef.current = slash;
  selectedRef.current = selected;
  if (!editor) return null;
  const exec = (fn: () => void) => {
    if (slash)
      editor
        .chain()
        .focus()
        .deleteRange({ from: slash.from, to: slash.to })
        .run();
    fn();
    setSlash(null);
  };
  const commands = [
    {
      label: "文本",
      hint: "普通文字，自由记录",
      icon: AlignLeft,
      keywords: "text paragraph wenben",
      run: () => exec(() => editor.chain().focus().setParagraph().run()),
    },
    ...([1, 2, 3] as const).map((level, i) => ({
      label: `标题 ${level}`,
      hint: ["大标题，开启新篇章", "中标题，组织内容", "小标题，梳理细节"][i],
      icon: [Heading1, Heading2, Heading3][i],
      keywords: `heading h${level} biaoti`,
      run: () =>
        exec(() => editor.chain().focus().toggleHeading({ level }).run()),
    })),
    {
      label: "待办事项",
      hint: "把想法变成行动",
      icon: CheckSquare,
      keywords: "todo task daiban",
      run: () => exec(() => editor.chain().focus().toggleTaskList().run()),
    },
    {
      label: "无序列表",
      hint: "清晰地列出要点",
      icon: List,
      keywords: "bullet list wouxu",
      run: () => exec(() => editor.chain().focus().toggleBulletList().run()),
    },
    {
      label: "有序列表",
      hint: "一步一步，井井有条",
      icon: ListOrdered,
      keywords: "ordered list youxu",
      run: () => exec(() => editor.chain().focus().toggleOrderedList().run()),
    },
    {
      label: "引用",
      hint: "留下一句值得记住的话",
      icon: Quote,
      keywords: "quote yinyong",
      run: () => exec(() => editor.chain().focus().toggleBlockquote().run()),
    },
    {
      label: "提示块",
      hint: "给重要的内容一点强调",
      icon: Lightbulb,
      keywords: "callout tishi",
      run: () =>
        exec(() =>
          editor
            .chain()
            .focus()
            .insertContent({
              type: "callout",
              content: [{ type: "paragraph" }],
            })
            .run(),
        ),
    },
    {
      label: "代码块",
      hint: "保存代码与技术片段",
      icon: Code2,
      keywords: "code daima",
      run: () => exec(() => editor.chain().focus().toggleCodeBlock().run()),
    },
    {
      label: "分割线",
      hint: "给内容留一点呼吸",
      icon: Minus,
      keywords: "divider line fengexian",
      run: () => exec(() => editor.chain().focus().setHorizontalRule().run()),
    },
    {
      label: "普通表格",
      hint: "简单的行与列",
      icon: Table2,
      keywords: "table biaoge",
      run: () =>
        exec(() =>
          editor
            .chain()
            .focus()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run(),
        ),
    },
    {
      label: "数据库",
      hint: "嵌入带属性和计算的数据库",
      icon: DatabaseIcon,
      keywords: "database shujuku",
      run: () => exec(() => setEmbed(true)),
    },
    {
      label: "图片",
      hint: "上传一张图片（最大 5MB）",
      icon: ImagePlus,
      keywords: "image photo tupian",
      run: () => exec(() => file.current?.click()),
    },
    {
      label: "页面链接",
      hint: "连接工作空间中的另一页",
      icon: Link,
      keywords: "page link lianjie",
      run: () =>
        exec(() => {
          setLink("");
          setLinkOpen(true);
        }),
    },
  ];
  const filtered = commands.filter(
    (c) =>
      !slash?.query ||
      `${c.label} ${c.keywords}`
        .toLowerCase()
        .includes(slash.query.toLowerCase()),
  );
  commandsRef.current = filtered;
  const moveBlock = (direction: number) =>
    blockAction(editor, direction < 0 ? "up" : "down");
  const duplicateBlock = () => blockAction(editor, "duplicate");
  const deleteBlock = () => blockAction(editor, "delete");
  return (
    <div
      ref={container}
      className={"editor-shell " + (compact ? "compact" : "")}
      data-editor-version={version}
    >
      <BlockControls editor={editor} />
      <EditorToolbar
        editor={editor}
        menuOpen={toolbarMenuOpen}
        suppressed={!!slash || linkOpen || embed}
      >
        <Menu
          onOpenChange={setToolbarMenuOpen}
          modal={false}
          onCloseAutoFocus={(event) => {
            if (editor.isFocused) event.preventDefault();
          }}
          trigger={
            <button className="editor-type">
              {editor.isActive("heading")
                ? "标题"
                : editor.isActive("taskList")
                  ? "待办"
                  : "正文"}
              <span>⌄</span>
            </button>
          }
          align="start"
        >
          {commands.slice(0, 10).map((c) => (
            <MenuItem key={c.label} onClick={c.run}>
              <c.icon size={15} />
              {c.label}
            </MenuItem>
          ))}
        </Menu>
        <span className="toolbar-divider" />
        <button
          aria-label="加粗"
          className={editor.isActive("bold") ? "active" : ""}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold size={16} />
        </button>
        <button
          aria-label="斜体"
          className={editor.isActive("italic") ? "active" : ""}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic size={16} />
        </button>
        <button
          aria-label="删除线"
          className={editor.isActive("strike") ? "active" : ""}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          <Strikethrough size={16} />
        </button>
        <button
          aria-label="添加链接"
          onClick={() => {
            setLink(editor.getAttributes("link").href || "");
            setLinkOpen(true);
          }}
        >
          <Link size={16} />
        </button>
        <span className="toolbar-divider" />
        <button
          aria-label="撤销"
          disabled={!editor.can().undo()}
          onClick={() => editor.chain().focus().undo().run()}
        >
          <Undo2 size={16} />
        </button>
        <button
          aria-label="重做"
          disabled={!editor.can().redo()}
          onClick={() => editor.chain().focus().redo().run()}
        >
          <Redo2 size={16} />
        </button>
        <Menu
          onOpenChange={setToolbarMenuOpen}
          modal={false}
          onCloseAutoFocus={(event) => {
            if (editor.isFocused) event.preventDefault();
          }}
          trigger={
            <button aria-label="块操作">
              <MoreHorizontal size={18} />
            </button>
          }
        >
          <MenuItem onClick={() => moveBlock(-1)}>
            <ArrowUp size={15} />
            上移此块
          </MenuItem>
          <MenuItem onClick={() => moveBlock(1)}>
            <ArrowDown size={15} />
            下移此块
          </MenuItem>
          <MenuItem onClick={duplicateBlock}>
            <Copy size={15} />
            复制此块
          </MenuItem>
          <MenuDivider />
          <MenuItem danger onClick={deleteBlock}>
            <Trash2 size={15} />
            删除此块
          </MenuItem>
        </Menu>
      </EditorToolbar>
      <EditorContent editor={editor} />
      {editor.isActive("table") && (
        <div className="table-edit-tools">
          <button onClick={() => editor.chain().focus().addRowAfter().run()}>
            ＋ 行
          </button>
          <button onClick={() => editor.chain().focus().addColumnAfter().run()}>
            ＋ 列
          </button>
          <button onClick={() => editor.chain().focus().deleteRow().run()}>
            删除行
          </button>
          <button onClick={() => editor.chain().focus().deleteColumn().run()}>
            删除列
          </button>
          <button
            onClick={() => editor.chain().focus().toggleHeaderRow().run()}
          >
            切换表头
          </button>
          <button onClick={() => editor.chain().focus().deleteTable().run()}>
            删除表格
          </button>
        </div>
      )}
      {slash && (
        <div
          className="slash-menu"
          style={{ top: slash.top, left: slash.left }}
          role="listbox"
          aria-label="插入块"
        >
          <div className="menu-label">添加内容块</div>
          {filtered.length ? (
            filtered.map((c, i) => (
              <button
                key={c.label}
                role="option"
                aria-selected={i === selected}
                className={i === selected ? "selected" : ""}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setSelected(i)}
                onClick={c.run}
              >
                <span className="slash-icon">
                  <c.icon size={19} />
                </span>
                <span>
                  <strong>{c.label}</strong>
                  <small>{c.hint}</small>
                </span>
              </button>
            ))
          ) : (
            <p className="muted small">没有匹配的块</p>
          )}
          <div className="slash-footer">
            ↑ ↓ 选择 <span>↵ 插入</span>
          </div>
        </div>
      )}
      <button
        className="add-block"
        onClick={() => {
          editor.chain().focus("end").insertContent("<p>/</p>").run();
        }}
      >
        <Plus size={16} />
        添加内容
      </button>
      <input
        hidden
        ref={file}
        type="file"
        accept="image/*"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          if (f.size > 5 * 1024 * 1024) {
            toast("图片大小不能超过 5MB");
            return;
          }
          const reader = new FileReader();
          reader.onload = () =>
            editor
              .chain()
              .focus()
              .setImage({ src: String(reader.result), alt: f.name })
              .run();
          reader.readAsDataURL(f);
          e.target.value = "";
        }}
      />
      <Modal
        open={embed}
        onOpenChange={setEmbed}
        title="嵌入数据库"
        description="视图共享同一份数据，编辑会同步到原数据库。"
      >
        <div className="choice-list">
          {data.databases.map((db) => (
            <button
              key={db.id}
              onClick={() => {
                editor
                  .chain()
                  .focus()
                  .insertContent([
                    { type: "databaseEmbed", attrs: { databaseId: db.id } },
                    { type: "paragraph" },
                  ])
                  .run();
                setEmbed(false);
              }}
            >
              <DatabaseIcon size={18} />
              <span>{db.name}</span>
              <Plus size={15} />
            </button>
          ))}
        </div>
        {!data.databases.length && (
          <p className="muted">先在侧栏新建一个数据库。</p>
        )}
      </Modal>
      <Modal open={linkOpen} onOpenChange={setLinkOpen} title="插入链接">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const href = link.trim();
            if (!href) {
              editor.chain().focus().unsetLink().run();
              setLinkOpen(false);
              return;
            }
            if (!/^(https?:\/\/|mailto:|#page=)/i.test(href)) {
              toast("请输入 https://、http:// 或 mailto: 开头的链接");
              return;
            }
            if (editor.state.selection.empty)
              editor
                .chain()
                .focus()
                .insertContent({
                  type: "text",
                  text: href,
                  marks: [{ type: "link", attrs: { href } }],
                })
                .run();
            else editor.chain().focus().setLink({ href }).run();
            setLinkOpen(false);
          }}
        >
          <label className="form-label">
            网址
            <input
              autoFocus
              placeholder="https://…"
              value={link}
              onChange={(e) => setLink(e.target.value)}
            />
          </label>
          <div className="modal-actions">
            <button className="button primary">应用链接</button>
          </div>
        </form>
        <div className="menu-label">或链接到工作空间页面</div>
        <div className="choice-list">
          {data.pages
            .filter((p) => !p.deleted)
            .map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  editor
                    .chain()
                    .focus()
                    .insertContent({
                      type: "text",
                      text: p.icon + " " + p.title,
                      marks: [
                        { type: "link", attrs: { href: "#page=" + p.id } },
                      ],
                    })
                    .run();
                  setLinkOpen(false);
                }}
              >
                {p.icon}
                <span>{p.title}</span>
              </button>
            ))}
        </div>
      </Modal>
    </div>
  );
}
