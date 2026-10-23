import { useEffect, useRef, useState } from "react";
import { sortableDrag } from "../lib/sortableDrag";
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, NodeSelection, Selection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { closeHistory } from "@tiptap/pm/history";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { ArrowDown, ArrowUp, Copy, GripVertical, Trash2 } from "lucide-react";

const dragKey = new PluginKey<DecorationSet>("blockDragFeedback");

type Block = {
  pos: number;
  node: PMNode;
  parent: PMNode;
  parentStart: number;
  index: number;
  element: HTMLElement;
};
function atPosition(editor: Editor, pos: number): Block | null {
  const $pos = editor.state.doc.resolve(pos);
  let depth = 1;
  for (let d = $pos.depth; d > 0; d--) {
    if (["listItem", "taskItem"].includes($pos.node(d).type.name)) {
      depth = d;
      break;
    }
  }
  const start = ["listItem", "taskItem"].includes(
    $pos.nodeAfter?.type.name || "",
  )
    ? pos
    : $pos.depth >= depth
      ? $pos.before(depth)
      : pos;
  const node = editor.state.doc.nodeAt(start);
  const $start = editor.state.doc.resolve(start);
  const element = editor.view.nodeDOM(start);
  return node && element instanceof HTMLElement
    ? {
        pos: start,
        node,
        parent: $start.parent,
        parentStart: $start.start(),
        index: $start.index(),
        element,
      }
    : null;
}
export function selectedBlock(editor: Editor) {
  return atPosition(editor, editor.state.selection.from);
}
function siblings(editor: Editor, source: Block) {
  const result: Block[] = [];
  source.parent.forEach((node, offset, index) => {
    const pos = source.parentStart + offset;
    const element = editor.view.nodeDOM(pos);
    if (element instanceof HTMLElement)
      result.push({ ...source, node, pos, index, element });
  });
  return result;
}
function moveTo(editor: Editor, block: Block, dest: number) {
  if (dest >= block.pos && dest <= block.pos + block.node.nodeSize) return;
  const tr = closeHistory(editor.state.tr).delete(
    block.pos,
    block.pos + block.node.nodeSize,
  );
  const mapped = tr.mapping.map(dest);
  tr.insert(mapped, block.node);
  tr.setSelection(NodeSelection.create(tr.doc, mapped));
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
}
export function blockAction(
  editor: Editor,
  action: "up" | "down" | "duplicate" | "delete",
  block = selectedBlock(editor),
) {
  if (!block) return;
  if (action === "up" || action === "down") {
    const other = siblings(editor, block)[
      block.index + (action === "up" ? -1 : 1)
    ];
    if (other)
      moveTo(
        editor,
        block,
        action === "up" ? other.pos : other.pos + other.node.nodeSize,
      );
    return;
  }
  const tr = closeHistory(editor.state.tr);
  if (action === "duplicate") {
    const pos = block.pos + block.node.nodeSize;
    tr.insert(pos, block.node).setSelection(NodeSelection.create(tr.doc, pos));
  } else {
    tr.delete(block.pos, block.pos + block.node.nodeSize);
    tr.setSelection(
      Selection.near(tr.doc.resolve(Math.min(block.pos, tr.doc.content.size))),
    );
  }
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
}

export function BlockControls({ editor }: { editor: Editor }) {
  const root = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<Block | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const active = useRef(false);
  const suppressClick = useRef(false);
  const cleanup = useRef<() => void>(() => {});
  const menuRef = useRef(false);
  menuRef.current = menuOpen;
  useEffect(() => {
    const shell = root.current?.parentElement;
    if (!shell) return;
    editor.registerPlugin(
      new Plugin<DecorationSet>({
        key: dragKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, previous) =>
            tr.getMeta(dragKey) ?? previous.map(tr.mapping, tr.doc),
        },
        props: { decorations: (state) => dragKey.getState(state) },
      }),
    );
    const track = (event: MouseEvent) => {
      if (active.current || menuRef.current) return;
      const target = event.target as HTMLElement;
      if (
        !editor.view.dom.contains(target) ||
        target.closest(".block-editor") !== editor.view.dom
      )
        return;
      const listItem = target.closest("li");
      const element =
        listItem ||
        Array.from(editor.view.dom.children).find(
          (el) => el.contains(target) || el === target,
        );
      if (!element) return;
      const pos = editor.view.posAtDOM(element, 0);
      setHovered(atPosition(editor, pos));
    };
    const leave = () => {
      if (!active.current && !menuRef.current) setHovered(null);
    };
    shell.addEventListener("mousemove", track);
    shell.addEventListener("mouseleave", leave);
    const reset = () => {
      if (!active.current && !menuRef.current) setHovered(null);
    };
    editor.on("update", reset);
    return () => {
      shell.removeEventListener("mousemove", track);
      shell.removeEventListener("mouseleave", leave);
      editor.off("update", reset);
      cleanup.current();
      editor.unregisterPlugin(dragKey);
    };
  }, [editor]);
  function begin(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !hovered) return;
    event.preventDefault();
    const source = hovered;
    const candidates = siblings(editor, source);
    const shell = root.current!.parentElement!;
    cleanup.current();
    cleanup.current = sortableDrag(event, {
      items: candidates.map((block) => ({
        id: String(block.pos),
        elements: [block.element],
      })),
      source: String(source.pos),
      axis: "y",
      className: "block-drag-preview",
      preview: "block",
      scroll: [shell.closest<HTMLElement>(".main-scroll")].filter(
        (el): el is HTMLElement => !!el,
      ),
      applyTransforms: (items) => {
        if (editor.isDestroyed) return;
        const decorations = (items || []).map((item) => {
          const block = candidates.find(
            (candidate) => String(candidate.pos) === item.id,
          )!;
          return Decoration.node(block.pos, block.pos + block.node.nodeSize, {
            class:
              "sortable-drag-item" +
              (item.source ? " sortable-drag-source" : ""),
            style: `transform:translateY(${item.offset}px);opacity:${item.source ? ".13" : "1"};transition:transform 180ms cubic-bezier(.2,.8,.2,1),opacity 120ms;will-change:transform;`,
          });
        });
        editor.view.dispatch(
          editor.state.tr
            .setMeta(
              dragKey,
              DecorationSet.create(editor.state.doc, decorations),
            )
            .setMeta("addToHistory", false),
        );
      },
      onStart: () => {
        active.current = true;
        suppressClick.current = true;
      },
      onFinish: (placement) => {
        active.current = false;
        if (placement) {
          const target = candidates.find(
            (block) => String(block.pos) === placement.target,
          )!;
          moveTo(
            editor,
            source,
            target.pos + (placement.after ? target.node.nodeSize : 0),
          );
        }
        if (suppressClick.current) setHovered(null);
        setTimeout(() => {
          suppressClick.current = false;
        }, 0);
        cleanup.current = () => {};
      },
    });
  }

  const shell = root.current?.parentElement;
  const top =
    hovered && shell
      ? hovered.element.getBoundingClientRect().top -
        shell.getBoundingClientRect().top
      : 0;
  const left =
    hovered && shell
      ? hovered.element.getBoundingClientRect().left -
        shell.getBoundingClientRect().left -
        32
      : 0;
  return (
    <div ref={root} className="block-controls">
      {hovered && (
        <Dropdown.Root
          modal={false}
          open={menuOpen}
          onOpenChange={(open) => {
            if (suppressClick.current) return;
            menuRef.current = open;
            if (open) editor.commands.setNodeSelection(hovered.pos);
            setMenuOpen(open);
          }}
        >
          <Dropdown.Trigger asChild>
            <button
              className="block-drag-handle"
              style={{ top: top + 2, left }}
              aria-label="拖动内容块"
              title="拖动排序，点击打开块菜单"
              onPointerDown={begin}
              onClick={(e) => {
                e.preventDefault();
                if (!suppressClick.current) {
                  menuRef.current = !menuOpen;
                  editor.commands.setNodeSelection(hovered.pos);
                  setMenuOpen(!menuOpen);
                }
              }}
            >
              <GripVertical size={18} />
            </button>
          </Dropdown.Trigger>
          <Dropdown.Portal>
            <Dropdown.Content
              className="dropdown"
              align="start"
              sideOffset={5}
              onCloseAutoFocus={(event) => {
                if (editor.isFocused) event.preventDefault();
              }}
            >
              {(
                [
                  ["up", ArrowUp, "上移此块"],
                  ["down", ArrowDown, "下移此块"],
                  ["duplicate", Copy, "复制此块"],
                  ["delete", Trash2, "删除此块"],
                ] as const
              ).map(([action, Icon, label]) => (
                <Dropdown.Item
                  key={action}
                  className={
                    "menu-item " + (action === "delete" ? "danger" : "")
                  }
                  disabled={
                    action === "up"
                      ? hovered.index === 0
                      : action === "down"
                        ? hovered.index === hovered.parent.childCount - 1
                        : false
                  }
                  onSelect={() => {
                    blockAction(editor, action, hovered);
                    setHovered(null);
                  }}
                >
                  <Icon size={15} />
                  {label}
                </Dropdown.Item>
              ))}
            </Dropdown.Content>
          </Dropdown.Portal>
        </Dropdown.Root>
      )}
    </div>
  );
}
