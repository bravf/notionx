import { useEffect, useRef, useState } from "react";
import { sortableDrag } from "../lib/sortableDrag";
import type { Editor } from "@tiptap/core";
import { Fragment } from "@tiptap/pm/model";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  Plugin,
  PluginKey,
  NodeSelection,
  Selection,
  TextSelection,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { closeHistory } from "@tiptap/pm/history";
import { setBlockType } from "@tiptap/pm/commands";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import {
  ArrowDown,
  ArrowUp,
  CheckSquare,
  Code2,
  Copy,
  GripVertical,
  Heading1,
  Heading2,
  Heading3,
  Lightbulb,
  List,
  ListOrdered,
  Pilcrow,
  Quote,
  Redo2,
  Trash2,
  Undo2,
} from "lucide-react";
import { SubMenu } from "./ui";
import {
  BlockSelection,
  selectCurrentBlock,
  duplicateSelectedBlocks,
  moveSelectedBlocks,
} from "../lib/blockSelection";

const dragKey = new PluginKey<DecorationSet>("blockDragFeedback");
const LIST_TYPES = ["bulletList", "orderedList", "taskList"];

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
function listAtPosition(editor: Editor, pos: number): Block | null {
  const $pos = editor.state.doc.resolve(pos);
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (!LIST_TYPES.includes(node.type.name)) continue;
    const start = $pos.before(depth);
    const element = editor.view.nodeDOM(start);
    const $start = editor.state.doc.resolve(start);
    return element instanceof HTMLElement
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
  return null;
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
function selectedBlocks(editor: Editor): Block[] {
  const selection = editor.state.selection;
  if (!(selection instanceof BlockSelection)) return [];
  const $from = editor.state.doc.resolve(selection.from);
  const result: Block[] = [];
  $from.parent.forEach((node, offset, index) => {
    const pos = $from.start() + offset;
    const element = editor.view.nodeDOM(pos);
    if (
      pos >= selection.from &&
      pos + node.nodeSize <= selection.to &&
      element instanceof HTMLElement
    )
      result.push({
        pos,
        node,
        parent: $from.parent,
        parentStart: $from.start(),
        index,
        element,
      });
  });
  return result;
}

function moveAcross(
  editor: Editor,
  blocks: Block[],
  target: Block,
  after: boolean,
  nest: boolean,
  focus = true,
) {
  if (
    !blocks.length ||
    blocks.some(
      (block) =>
        block.pos <= target.pos && target.pos < block.pos + block.node.nodeSize,
    )
  )
    return;
  const first = blocks[0],
    last = blocks[blocks.length - 1];
  const sourceIsItems = ["listItem", "taskItem"].includes(first.node.type.name);
  const targetIsItem = ["listItem", "taskItem"].includes(target.node.type.name);
  let nodes: PMNode[] = blocks.map((block) => block.node);
  let dest = target.pos + (after ? target.node.nodeSize : 0);
  let parent = target.parent;
  if (nest && targetIsItem) {
    dest = target.pos + target.node.nodeSize - 1;
    const list = target.parent.type.create(
      null,
      nodes.map((node) => {
        if (["listItem", "taskItem"].includes(node.type.name))
          return target.node.type.create(target.node.attrs, node.content);
        return target.node.type.create(null, node);
      }),
    );
    nodes = [list];
    parent = target.node;
  } else if (targetIsItem) {
    nodes = nodes.map((node) =>
      target.node.type.create(
        node.type.name === "taskItem" ? node.attrs : null,
        ["listItem", "taskItem"].includes(node.type.name) ? node.content : node,
      ),
    );
  } else if (sourceIsItems) {
    nodes = nodes.flatMap((node) => {
      const content: PMNode[] = [];
      node.forEach((child) => content.push(child));
      return content;
    });
  }
  const index = editor.state.doc.resolve(dest).index();
  const fragment = Fragment.fromArray(nodes);
  if (!parent.canReplace(index, index, fragment)) return;
  const entireList = sourceIsItems && blocks.length === first.parent.childCount;
  const tr = closeHistory(editor.state.tr).delete(
    entireList ? first.parentStart - 1 : first.pos,
    entireList
      ? first.parentStart - 1 + first.parent.nodeSize
      : last.pos + last.node.nodeSize,
  );
  const mapped = tr.mapping.map(dest);
  tr.insert(mapped, fragment);
  tr.setSelection(new BlockSelection(tr.doc, mapped, mapped + fragment.size));
  editor.view.dispatch(focus ? tr.scrollIntoView() : tr);
  if (focus) editor.view.focus();
}

function moveTo(editor: Editor, block: Block, dest: number, focus = true) {
  if (dest >= block.pos && dest <= block.pos + block.node.nodeSize) return;
  const tr = closeHistory(editor.state.tr).delete(
    block.pos,
    block.pos + block.node.nodeSize,
  );
  const mapped = tr.mapping.map(dest);
  tr.insert(mapped, block.node);
  tr.setSelection(NodeSelection.create(tr.doc, mapped));
  editor.view.dispatch(focus ? tr.scrollIntoView() : tr);
  if (focus) editor.view.focus();
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

type TurnInto =
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "bulletList"
  | "orderedList"
  | "taskList"
  | "blockquote"
  | "codeBlock"
  | "callout";

function turnInto(editor: Editor, block: Block, target: TurnInto) {
  const nodeName = block.node.type.name;
  const parentName = block.parent.type.name;
  const same =
    (target === "bulletList" && parentName === "bulletList") ||
    (target === "orderedList" && parentName === "orderedList") ||
    (target === "taskList" && parentName === "taskList") ||
    (target === "paragraph" && nodeName === "paragraph") ||
    (target === "heading1" &&
      nodeName === "heading" &&
      block.node.attrs.level === 1) ||
    (target === "heading2" &&
      nodeName === "heading" &&
      block.node.attrs.level === 2) ||
    (target === "heading3" &&
      nodeName === "heading" &&
      block.node.attrs.level === 3) ||
    (target === "blockquote" && nodeName === "blockquote") ||
    (target === "codeBlock" && nodeName === "codeBlock") ||
    (target === "callout" && nodeName === "callout");
  if (same) return;
  if (block.node.isAtom && !block.node.isTextblock) return;
  const selection = TextSelection.between(
    editor.state.doc.resolve(block.pos + 1),
    editor.state.doc.resolve(block.pos + block.node.nodeSize - 1),
  );
  let chain = editor.chain().focus().setTextSelection({
    from: selection.from,
    to: selection.to,
  });
  if (nodeName === "listItem" || nodeName === "taskItem")
    chain = chain.liftListItem(nodeName);
  if (nodeName === "blockquote") chain = chain.lift("blockquote");
  if (nodeName === "callout") chain = chain.lift("callout");
  if (nodeName === "codeBlock") chain = chain.toggleCodeBlock();
  switch (target) {
    case "paragraph":
      // Already-paragraph children need no conversion after lifting. Avoid
      // setParagraph's clearNodes fallback remapping the original wrapper.
      chain = chain.command(({ state, dispatch }) => {
        setBlockType(state.schema.nodes.paragraph)(state, dispatch);
        return true;
      });
      break;
    case "heading1":
      chain = chain.setHeading({ level: 1 });
      break;
    case "heading2":
      chain = chain.setHeading({ level: 2 });
      break;
    case "heading3":
      chain = chain.setHeading({ level: 3 });
      break;
    case "bulletList":
      chain = chain.toggleBulletList();
      break;
    case "orderedList":
      chain = chain.toggleOrderedList();
      break;
    case "taskList":
      chain = chain.toggleTaskList();
      break;
    case "blockquote":
      chain = chain.toggleBlockquote();
      break;
    case "codeBlock":
      chain = chain.toggleCodeBlock();
      break;
    case "callout":
      chain = chain.wrapIn("callout");
      break;
  }
  chain.run();
}

const conversionItems = [
  ["paragraph", Pilcrow, "正文"],
  ["heading1", Heading1, "标题 1"],
  ["heading2", Heading2, "标题 2"],
  ["heading3", Heading3, "标题 3"],
  ["bulletList", List, "无序列表"],
  ["orderedList", ListOrdered, "有序列表"],
  ["taskList", CheckSquare, "待办事项"],
  ["blockquote", Quote, "引用"],
  ["codeBlock", Code2, "代码块"],
  ["callout", Lightbulb, "提示块"],
] as const;

export function BlockControls({ editor }: { editor: Editor }) {
  const root = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<Block | null>(null);
  const [hoveredList, setHoveredList] = useState<Block | null>(null);
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
      if (editor.state.selection instanceof BlockSelection) return;
      const target = event.target as HTMLElement;
      const bounds = editor.view.dom.getBoundingClientRect();
      const inEditor = target.closest(".block-editor") === editor.view.dom;
      const inGutter =
        !inEditor &&
        event.clientX >= bounds.left - 42 &&
        event.clientX <= bounds.left + 4 &&
        event.clientY >= bounds.top &&
        event.clientY <= bounds.bottom;
      if (!inEditor && !inGutter) return;
      let pos: number | null = null;
      if (inEditor) {
        const listItem = target.closest("li");
        const element =
          listItem ||
          Array.from(editor.view.dom.children).find(
            (el) => el.contains(target) || el === target,
          );
        if (!element) return;
        pos = editor.view.posAtDOM(element, 0);
      } else {
        const coords = editor.view.posAtCoords({
          left: bounds.left + 12,
          top: event.clientY,
        });
        if (!coords) return;
        pos = coords.pos;
      }
      setHovered(atPosition(editor, pos));
      setHoveredList(listAtPosition(editor, pos));
    };
    const leave = () => {
      if (!active.current && !menuRef.current) {
        setHovered(null);
        setHoveredList(null);
      }
    };
    const openMenu = () => {
      if (!(editor.state.selection instanceof BlockSelection))
        selectCurrentBlock(editor.view);
      setHovered(atPosition(editor, editor.state.selection.from + 1));
      setMenuOpen(true);
    };
    const keys = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "/") {
        event.preventDefault();
        event.stopPropagation();
        openMenu();
      }
    };
    editor.view.dom.addEventListener("open-block-menu", openMenu);
    editor.view.dom.addEventListener("keydown", keys);
    shell.addEventListener("mousemove", track);
    shell.addEventListener("mouseleave", leave);
    const reset = () => {
      if (!active.current && !menuRef.current) setHovered(null);
    };
    editor.on("update", reset);
    return () => {
      editor.view.dom.removeEventListener("open-block-menu", openMenu);
      editor.view.dom.removeEventListener("keydown", keys);
      shell.removeEventListener("mousemove", track);
      shell.removeEventListener("mouseleave", leave);
      editor.off("update", reset);
      cleanup.current();
      editor.unregisterPlugin(dragKey);
    };
  }, [editor]);
  function begin(
    event: React.PointerEvent<HTMLButtonElement>,
    sourceOverride?: Block | null,
  ) {
    const group = sourceOverride ? [] : selectedBlocks(editor);
    const source = sourceOverride || group[0] || hovered;
    if (event.button !== 0 || !source) return;
    event.preventDefault();
    const touch = event.pointerType === "touch";
    const moving = group.length ? group : [source];
    const all = siblings(editor, source);
    const candidates = all.filter(
      (block) =>
        !moving.some((item) => item.pos === block.pos) ||
        block.pos === source.pos,
    );
    let external: { block: Block; after: boolean; nest: boolean } | null = null;
    const shell = root.current!.parentElement!;
    const scrollElement = shell.closest<HTMLElement>(".main-scroll");
    let scrollStart = scrollElement?.scrollTop || 0;
    const seen = new Set<number>();
    const dropTargets = Array.from(
      editor.view.dom.querySelectorAll<HTMLElement>(
        "ul[data-type='bulletList'], ul[data-type='orderedList'], ul[data-type='taskList'], p, h1, h2, h3, li, blockquote, aside, pre, table, .database-embed",
      ),
    ).flatMap((element) => {
      try {
        const block = atPosition(editor, editor.view.posAtDOM(element, 0));
        if (
          !block ||
          seen.has(block.pos) ||
          moving.some(
            (item) =>
              item.pos <= block.pos &&
              block.pos < item.pos + item.node.nodeSize,
          )
        )
          return [];
        seen.add(block.pos);
        return [{ block, rect: block.element.getBoundingClientRect() }];
      } catch {
        return [];
      }
    });
    cleanup.current();
    cleanup.current = sortableDrag(event, {
      items: candidates.map((block) => ({
        id: String(block.pos),
        elements:
          block.pos === source.pos
            ? moving.map((item) => item.element)
            : [block.element],
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
        const decorations = (items || []).flatMap((item) => {
          const block = candidates.find(
            (candidate) => String(candidate.pos) === item.id,
          )!;
          return (item.source ? moving : [block]).map((unit) =>
            Decoration.node(unit.pos, unit.pos + unit.node.nodeSize, {
              class:
                "sortable-drag-item" +
                (item.source ? " sortable-drag-source" : ""),
              style: `transform:translateY(${item.offset}px);opacity:${item.source ? ".13" : "1"};transition:transform 180ms cubic-bezier(.2,.8,.2,1),opacity 120ms;will-change:transform;`,
            }),
          );
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
      onGeometryChange: () => {
        scrollStart = scrollElement?.scrollTop || 0;
        for (const item of dropTargets)
          item.rect = item.block.element.getBoundingClientRect();
      },
      onMove: (x, y) => {
        external = null;
        const scrollDelta = (scrollElement?.scrollTop || 0) - scrollStart;
        const possible = dropTargets.map((item) => ({
          block: item.block,
          rect: {
            left: item.rect.left,
            top: item.rect.top - scrollDelta,
            bottom: item.rect.bottom - scrollDelta,
            width: item.rect.width,
            height: item.rect.height,
          },
        }));
        const match = possible.sort((a, b) => {
          const ra = a.rect,
            rb = b.rect;
          const da =
            y < ra.top ? ra.top - y : y > ra.bottom ? y - ra.bottom : 0;
          const db =
            y < rb.top ? rb.top - y : y > rb.bottom ? y - rb.bottom : 0;
          return da - db || ra.height - rb.height;
        })[0];
        if (!match) return null;
        const { block: target, rect } = match;
        if (
          LIST_TYPES.includes(source.node.type.name) &&
          target.parent !== source.parent
        )
          return null;
        const after = y > rect.top + rect.height / 2;
        const nest =
          ["listItem", "taskItem"].includes(target.node.type.name) &&
          x > rect.left + 90 &&
          y > rect.top + 8 &&
          y < rect.bottom - 5;
        if (target.parent === source.parent && !nest) return null;
        external = { block: target, after, nest };
        return {
          left: rect.left + (nest ? 24 : 0),
          top: nest ? rect.bottom : after ? rect.bottom : rect.top,
          width: rect.width - (nest ? 24 : 0),
          label: nest ? "嵌套到此项" : "移动到此处",
        };
      },
      onStart: () => {
        active.current = true;
        suppressClick.current = true;
        if (touch) {
          // Dragging is a block operation: dismiss the keyboard and caret,
          // then keep the editor blurred after drop instead of reopening it.
          editor.commands.blur();
          document.getSelection()?.removeAllRanges();
        }
      },
      onFinish: (placement, cancelled) => {
        active.current = false;
        if (external && !cancelled) {
          moveAcross(
            editor,
            moving,
            external.block,
            external.after,
            external.nest,
            !touch,
          );
        } else if (placement) {
          const target = candidates.find(
            (block) => String(block.pos) === placement.target,
          )!;
          if (moving.length > 1)
            moveAcross(editor, moving, target, placement.after, false, !touch);
          else
            moveTo(
              editor,
              source,
              target.pos + (placement.after ? target.node.nodeSize : 0),
              !touch,
            );
        }
        if (suppressClick.current) {
          setHovered(null);
          setHoveredList(null);
        }
        setTimeout(() => {
          suppressClick.current = false;
        }, 0);
        cleanup.current = () => {};
      },
    });
  }

  const shell = root.current?.parentElement;
  const blockSelectionActive = editor.state.selection instanceof BlockSelection;
  const group = selectedBlocks(editor);
  const current = blockSelectionActive ? group[0] : hovered;
  const listCurrent =
    hoveredList ||
    (current && LIST_TYPES.includes(current.node.type.name) ? current : null);
  // Keep the grip centered on the first line, including list and callout
  // content. The touch target is taller on phones, so a fixed top offset
  // puts the icon below the text even when the block itself is positioned.
  const anchor = current
    ? current.element.matches("p, h1, h2, h3, pre")
      ? current.element
      : current.element.querySelector<HTMLElement>(
          "p, h1, h2, h3, pre, th, td",
        ) || current.element
    : null;
  const anchorStyle = anchor ? getComputedStyle(anchor) : null;
  const lineHeight = anchorStyle
    ? parseFloat(anchorStyle.lineHeight) ||
      parseFloat(anchorStyle.fontSize) * 1.2
    : 0;
  const top =
    anchor && anchorStyle && shell
      ? anchor.getBoundingClientRect().top -
        shell.getBoundingClientRect().top +
        parseFloat(anchorStyle.borderTopWidth || "0") +
        parseFloat(anchorStyle.paddingTop || "0") +
        lineHeight / 2
      : 0;
  const left =
    current && shell
      ? current.element.getBoundingClientRect().left -
        shell.getBoundingClientRect().left -
        32
      : 0;
  const listAnchor = listCurrent
    ? listCurrent.element.querySelector<HTMLElement>(
        "p, h1, h2, h3, pre, th, td",
      ) || listCurrent.element
    : null;
  const listAnchorStyle = listAnchor ? getComputedStyle(listAnchor) : null;
  const listLineHeight = listAnchorStyle
    ? parseFloat(listAnchorStyle.lineHeight) ||
      parseFloat(listAnchorStyle.fontSize) * 1.2
    : 0;
  const listTop =
    listAnchor && listAnchorStyle && shell
      ? listAnchor.getBoundingClientRect().top -
        shell.getBoundingClientRect().top +
        parseFloat(listAnchorStyle.borderTopWidth || "0") +
        parseFloat(listAnchorStyle.paddingTop || "0") +
        listLineHeight / 2
      : 0;
  const listLeft =
    listCurrent && shell
      ? listCurrent.element.getBoundingClientRect().left -
        shell.getBoundingClientRect().left -
        60
      : 0;
  return (
    <div ref={root} className="block-controls">
      {listCurrent && (
        <button
          className="block-drag-handle list-drag-handle"
          style={{
            top: listTop,
            left: Math.max(
              listLeft,
              -(shell?.getBoundingClientRect().left || 0) + 2,
            ),
          }}
          aria-label="拖动整个列表"
          title="拖动整个列表"
          onPointerDown={(event) => begin(event, listCurrent)}
          onClick={(event) => event.preventDefault()}
        >
          <GripVertical size={18} />
        </button>
      )}
      {current && (
        <Dropdown.Root
          modal={false}
          open={menuOpen}
          onOpenChange={(open) => {
            if (suppressClick.current) return;
            menuRef.current = open;
            if (open && !blockSelectionActive)
              editor.commands.setNodeSelection(current.pos);
            setMenuOpen(open);
          }}
        >
          <Dropdown.Trigger asChild>
            <button
              className="block-drag-handle"
              style={{
                top,
                left: Math.max(
                  left,
                  -(shell?.getBoundingClientRect().left || 0) + 2,
                ),
              }}
              aria-label="拖动内容块"
              title="拖动排序，点击打开块菜单"
              onPointerDown={begin}
              onClick={(e) => {
                e.preventDefault();
                if (!suppressClick.current) {
                  menuRef.current = !menuOpen;
                  if (!blockSelectionActive)
                    editor.commands.setNodeSelection(current.pos);
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
              <SubMenu
                label={
                  <>
                    <Pilcrow size={15} />
                    转换为
                  </>
                }
              >
                {conversionItems.map(([target, Icon, label]) => (
                  <Dropdown.Item
                    key={target}
                    className="menu-item"
                    onSelect={() => {
                      if (group.length) {
                        for (const block of [...group].reverse())
                          turnInto(editor, block, target);
                      } else turnInto(editor, current, target);
                      setHovered(null);
                    }}
                  >
                    <Icon size={15} />
                    {label}
                  </Dropdown.Item>
                ))}
              </SubMenu>
              <Dropdown.Separator className="menu-divider" />
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
                      ? current.index === 0
                      : action === "down"
                        ? current.index === current.parent.childCount - 1
                        : false
                  }
                  onSelect={() => {
                    if (blockSelectionActive) {
                      if (action === "duplicate")
                        duplicateSelectedBlocks(editor.view);
                      else if (action === "up" || action === "down")
                        moveSelectedBlocks(
                          editor.view,
                          action === "up" ? -1 : 1,
                        );
                      else editor.chain().focus().deleteSelection().run();
                    } else blockAction(editor, action, current);
                    setHovered(null);
                  }}
                >
                  <Icon size={15} />
                  {label}
                </Dropdown.Item>
              ))}
              <Dropdown.Separator className="menu-divider" />
              <Dropdown.Item
                className="menu-item"
                disabled={!editor.can().undo()}
                onSelect={() => {
                  editor.chain().focus().undo().run();
                  setHovered(null);
                }}
              >
                <Undo2 size={15} />
                撤销
              </Dropdown.Item>
              <Dropdown.Item
                className="menu-item"
                disabled={!editor.can().redo()}
                onSelect={() => {
                  editor.chain().focus().redo().run();
                  setHovered(null);
                }}
              >
                <Redo2 size={15} />
                重做
              </Dropdown.Item>
            </Dropdown.Content>
          </Dropdown.Portal>
        </Dropdown.Root>
      )}
    </div>
  );
}
