import { Plugin, PluginKey, Selection, TextSelection } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { Extension } from "@tiptap/core";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorView } from "@tiptap/pm/view";
import type { Node as PMNode, Slice } from "@tiptap/pm/model";
import type { Mappable } from "@tiptap/pm/transform";

type Block = { pos: number; size: number };

function topLevelBlocks(doc: PMNode): Block[] {
  const blocks: Block[] = [];
  doc.forEach((node, offset) =>
    blocks.push({ pos: offset, size: node.nodeSize }),
  );
  return blocks;
}

function blockIndexAt(blocks: Block[], pos: number, assoc = 1) {
  if (!blocks.length) return -1;
  if (pos <= blocks[0].pos) return 0;
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (
      pos >= block.pos &&
      (pos < block.pos + block.size ||
        (assoc < 0 && pos === block.pos + block.size))
    )
      return index;
  }
  return blocks.length - 1;
}

const LIST_TYPES = ["bulletList", "orderedList", "taskList"];
const ITEM_TYPES = ["listItem", "taskItem"];
type Unit = { pos: number; size: number };
type ListInfo = {
  node: PMNode;
  depth: number;
  start: number;
  items: Unit[];
  index?: number;
};

function listChildren(node: PMNode, start: number): Unit[] {
  const items: Unit[] = [];
  node.forEach((child, offset) =>
    items.push({ pos: start + 1 + offset, size: child.nodeSize }),
  );
  return items;
}

type SelectionContext =
  | {
      kind: "list";
      node: PMNode;
      depth: number;
      start: number;
      items: Unit[];
      first: number;
      last: number;
    }
  | {
      kind: "item";
      node: PMNode;
      depth: number;
      start: number;
      parent?: ListInfo;
    }
  | { kind: "other" };

function contextFor(doc: PMNode, from: number, to: number): SelectionContext {
  const $from = doc.resolve(from),
    $to = doc.resolve(to);
  let depth = 0;
  let common = doc;
  const max = Math.min($from.depth, $to.depth);
  for (let d = 1; d <= max; d++) {
    if ($from.node(d) !== $to.node(d)) break;
    depth = d;
    common = $from.node(d);
  }
  const type = common.type.name;
  if (LIST_TYPES.includes(type)) {
    const start = depth > 0 ? $from.before(depth) : 0;
    const items = listChildren(common, start);
    const clamp = (index: number) =>
      Math.max(0, Math.min(index, items.length - 1));
    let first = clamp($from.index(depth));
    let last = $to.index(depth);
    // A position at the end of an item is also the start of the next item.
    // Resolve it to the item that ends there rather than the following one.
    if (
      $to.nodeBefore &&
      ITEM_TYPES.includes($to.nodeBefore.type.name) &&
      $to.depth === depth
    )
      last -= 1;
    last = clamp(last);
    if (first > last) [first, last] = [last, first];
    return { kind: "list", node: common, depth, start, items, first, last };
  }
  if (ITEM_TYPES.includes(type)) {
    const start = $from.before(depth);
    let parent: ListInfo | undefined;
    if (depth > 0) {
      const parentNode = $from.node(depth - 1);
      if (LIST_TYPES.includes(parentNode.type.name)) {
        const parentStart = $from.before(depth - 1);
        parent = {
          node: parentNode,
          depth: depth - 1,
          start: parentStart,
          items: listChildren(parentNode, parentStart),
          index: $from.index(depth - 1),
        };
      }
    }
    return { kind: "item", node: common, depth, start, parent };
  }
  return { kind: "other" };
}

function emptyListPositions(doc: PMNode): Unit[] {
  const positions: Unit[] = [];
  doc.descendants((node, pos) => {
    if (LIST_TYPES.includes(node.type.name) && node.childCount === 0)
      positions.push({ pos, size: node.nodeSize });
  });
  return positions;
}

function cleanupEmptyLists(transaction: Transaction): Transaction {
  const positions = emptyListPositions(transaction.doc).sort(
    (a, b) => b.pos - a.pos,
  );
  for (const position of positions)
    transaction = transaction.delete(
      position.pos,
      position.pos + position.size,
    );
  return transaction;
}

export function blockRangeForPositions(doc: PMNode, from: number, to: number) {
  if (from === to) return null;
  const context = contextFor(doc, from, to);
  if (context.kind === "list") {
    if (!context.items.length) return null;
    const first = context.items[context.first];
    const last = context.items[context.last];
    return { from: first.pos, to: last.pos + last.size };
  }
  if (context.kind === "item")
    return { from: context.start, to: context.start + context.node.nodeSize };
  return topLevelBlockRange(doc, from, to);
}

export function topLevelBlockRange(doc: PMNode, from: number, to: number) {
  const blocks = topLevelBlocks(doc);
  if (!blocks.length) return null;
  let start = blockIndexAt(blocks, from);
  let end = blockIndexAt(blocks, to, -1);
  if (start < 0 || end < 0) return null;
  if (start > end) [start, end] = [end, start];
  if (
    start === end &&
    (from !== blocks[start].pos || to !== blocks[end].pos + blocks[end].size)
  )
    return null;
  return {
    from: blocks[start].pos,
    to: blocks[end].pos + blocks[end].size,
    start,
    end,
  };
}

function deletionRange(doc: PMNode, from: number, to: number) {
  const context = contextFor(doc, from, to);
  if (
    context.kind === "list" &&
    context.first === 0 &&
    context.last === context.items.length - 1
  )
    return {
      from: context.start,
      to: context.start + context.node.nodeSize,
    };
  if (
    context.kind === "item" &&
    context.parent &&
    context.parent.items.length === 1
  )
    return {
      from: context.parent.start,
      to: context.parent.start + context.parent.node.nodeSize,
    };
  return { from, to };
}

export function blockRangeForSelection(state: EditorState) {
  const selection = state.selection;
  if (!(selection instanceof TextSelection) || selection.empty) return null;
  return blockRangeForPositions(state.doc, selection.from, selection.to);
}

function crossesBlockBoundary(doc: PMNode, from: number, to: number) {
  if (from === to) return false;
  const context = contextFor(doc, from, to);
  if (context.kind === "list") return context.first !== context.last;
  if (context.kind === "item") return false;
  const blocks = topLevelBlocks(doc);
  const start = blockIndexAt(blocks, Math.min(from, to));
  const end = blockIndexAt(blocks, Math.max(from, to), -1);
  return start >= 0 && end >= 0 && start !== end;
}

export class BlockSelection extends Selection {
  constructor(doc: PMNode, from: number, to: number, backward = false) {
    super(doc.resolve(backward ? to : from), doc.resolve(backward ? from : to));
  }

  map(doc: PMNode, mapping: Mappable): Selection {
    const from = mapping.map(this.from, -1);
    const to = mapping.map(this.to, 1);
    const range = blockRangeForPositions(doc, from, to);
    if (range)
      return new BlockSelection(
        doc,
        range.from,
        range.to,
        this.anchor > this.head,
      );
    return Selection.near(
      doc.resolve(Math.max(0, Math.min(from, doc.content.size))),
      1,
    );
  }

  replace(tr: Transaction, content?: Slice) {
    if (!content || content.size === 0) {
      const range = deletionRange(this.$from.doc, this.from, this.to);
      if (range.from !== this.from || range.to !== this.to) {
        tr.delete(range.from, range.to);
        tr.setSelection(
          Selection.near(
            tr.doc.resolve(
              Math.max(0, Math.min(range.from, tr.doc.content.size)),
            ),
            1,
          ),
        );
        return;
      }
    }
    super.replace(tr, content);
  }

  eq(other: Selection): boolean {
    return (
      other instanceof BlockSelection &&
      other.from === this.from &&
      other.to === this.to &&
      other.anchor === this.anchor
    );
  }

  toJSON() {
    return {
      type: "notionxBlock",
      from: this.from,
      to: this.to,
      backward: this.anchor > this.head,
    };
  }

  static fromJSON(
    doc: PMNode,
    json: { from: number; to: number; backward?: boolean },
  ) {
    return new BlockSelection(doc, json.from, json.to, json.backward);
  }
}
Selection.jsonID("notionxBlock", BlockSelection);

export const blockSelectionKey = new PluginKey("notionxBlockSelection");

function blockDecorations(doc: PMNode, from: number, to: number) {
  const decorations: Decoration[] = [];
  const visit = (node: PMNode, start: number) => {
    const end = start + node.nodeSize;
    if (end <= from || start >= to) return;
    if (start >= from && end <= to) {
      decorations.push(
        Decoration.node(start, end, { class: "block-selected" }),
      );
      return;
    }
    if (node.isText || node.isLeaf) return;
    node.forEach((child, offset) => visit(child, start + 1 + offset));
  };
  doc.forEach((node, offset) => visit(node, offset));
  return DecorationSet.create(doc, decorations);
}

function deleteBlockRange(view: EditorView, from: number, to: number) {
  const { state } = view;
  const range = deletionRange(state.doc, from, to);
  let tr = cleanupEmptyLists(state.tr.delete(range.from, range.to));
  if (tr.doc.childCount === 0)
    tr = tr.insert(0, state.schema.nodes.paragraph.create());
  tr = tr.setSelection(
    Selection.near(
      tr.doc.resolve(Math.max(0, Math.min(range.from, tr.doc.content.size))),
      1,
    ),
  );
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

function collapseBlockSelection(
  view: EditorView,
  selection: BlockSelection,
  side: "start" | "end",
) {
  const pos = side === "start" ? selection.from : selection.to;
  const next = TextSelection.near(
    view.state.doc.resolve(pos),
    side === "start" ? 1 : -1,
  );
  view.dispatch(
    view.state.tr
      .setSelection(next)
      .scrollIntoView()
      .setMeta("addToHistory", false),
  );
  view.focus();
}

export function currentBlockRange(
  state: Pick<EditorState, "doc" | "selection">,
) {
  const pos = Math.min(
    state.selection.from + (state.selection instanceof BlockSelection ? 1 : 0),
    state.doc.content.size,
  );
  const $pos = state.doc.resolve(pos);
  for (let d = $pos.depth; d > 0; d--) {
    if (ITEM_TYPES.includes($pos.node(d).type.name))
      return { from: $pos.before(d), to: $pos.after(d) };
  }
  if ($pos.depth) return { from: $pos.before(1), to: $pos.after(1) };
  const node = $pos.nodeAfter || $pos.nodeBefore;
  if (!node) return null;
  const from = $pos.nodeAfter ? pos : pos - node.nodeSize;
  return { from, to: from + node.nodeSize };
}

export function selectCurrentBlock(view: EditorView) {
  const range = currentBlockRange(view.state);
  if (!range) return false;
  view.dispatch(
    view.state.tr
      .setSelection(new BlockSelection(view.state.doc, range.from, range.to))
      .setMeta("addToHistory", false),
  );
  view.focus();
  return true;
}

function selectionUnits(doc: PMNode, selection: BlockSelection): Unit[] {
  const context = contextFor(doc, selection.from, selection.to);
  if (context.kind === "list") return context.items;
  if (context.kind === "item" && context.parent) return context.parent.items;
  return topLevelBlocks(doc);
}

function extendBlockSelection(
  view: EditorView,
  selection: BlockSelection,
  direction: -1 | 1,
) {
  const units = selectionUnits(view.state.doc, selection);
  const first = blockIndexAt(units, selection.from);
  const last = blockIndexAt(units, selection.to, -1);
  const backward = selection.anchor > selection.head;
  const anchor = backward ? last : first;
  const focus = backward ? first : last;
  const next = Math.max(0, Math.min(units.length - 1, focus + direction));
  const start = Math.min(anchor, next),
    end = Math.max(anchor, next);
  if (!units[start] || !units[end]) return;
  view.dispatch(
    view.state.tr
      .setSelection(
        new BlockSelection(
          view.state.doc,
          units[start].pos,
          units[end].pos + units[end].size,
          next < anchor,
        ),
      )
      .scrollIntoView()
      .setMeta("addToHistory", false),
  );
  view.focus();
}

export function duplicateSelectedBlocks(view: EditorView) {
  const selection = view.state.selection;
  if (!(selection instanceof BlockSelection)) return false;
  const fragment = view.state.doc.slice(selection.from, selection.to).content;
  const tr = view.state.tr.insert(selection.to, fragment);
  tr.setSelection(
    new BlockSelection(tr.doc, selection.to, selection.to + fragment.size),
  );
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

export function moveSelectedBlocks(view: EditorView, direction: -1 | 1) {
  const selection = view.state.selection;
  if (!(selection instanceof BlockSelection)) return false;
  const units = selectionUnits(view.state.doc, selection);
  const first = blockIndexAt(units, selection.from),
    last = blockIndexAt(units, selection.to, -1);
  const target = units[direction < 0 ? first - 1 : last + 1];
  if (!target) return true;
  const dest = direction < 0 ? target.pos : target.pos + target.size;
  const fragment = view.state.doc.slice(selection.from, selection.to).content;
  const tr = view.state.tr.delete(selection.from, selection.to);
  const mapped = tr.mapping.map(dest);
  tr.insert(mapped, fragment).setSelection(
    new BlockSelection(tr.doc, mapped, mapped + fragment.size),
  );
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

function selectAllBlocks(view: EditorView) {
  if (!view.state.doc.childCount) return;
  view.dispatch(
    view.state.tr
      .setSelection(
        new BlockSelection(view.state.doc, 0, view.state.doc.content.size),
      )
      .setMeta("addToHistory", false),
  );
}

export function createBlockSelectionPlugin() {
  let gutterAnchor: number | null = null;
  return new Plugin({
    key: blockSelectionKey,
    props: {
      handleClick(view, pos, event) {
        if (
          event.shiftKey ||
          event.metaKey ||
          event.ctrlKey ||
          event.detail > 1
        )
          return false;
        const target = event.target as HTMLElement;
        if (target.closest("button, a, input, [contenteditable='false']"))
          return false;
        const element = target.closest("p, h1, h2, h3, pre");
        if (!element || !view.dom.contains(element)) return false;
        const start = view.posAtDOM(element, 0);
        const node = view.state.doc.resolve(start).parent;
        if (!node.isTextblock) return false;
        const point = Math.max(start, Math.min(start + node.content.size, pos));
        const selection = TextSelection.create(view.state.doc, point);
        if (!view.state.selection.eq(selection))
          view.dispatch(
            view.state.tr
              .setSelection(selection)
              .setMeta("addToHistory", false),
          );
        return true;
      },
      decorations(state) {
        const selection = state.selection;
        if (selection instanceof BlockSelection)
          return blockDecorations(state.doc, selection.from, selection.to);
        if (gutterAnchor !== null) {
          const range = blockRangeForSelection(state);
          if (range) return blockDecorations(state.doc, range.from, range.to);
        }
        return null;
      },
      handleDOMEvents: {
        mousedown(view, event) {
          if (event.button !== 0) return false;
          const target = event.target as HTMLElement;
          if (target.closest("input, textarea, select, .block-drag-handle"))
            return false;
          if (view.state.selection instanceof BlockSelection) {
            const pos = view.posAtCoords({
              left: event.clientX,
              top: event.clientY,
            });
            if (pos)
              view.dispatch(
                view.state.tr
                  .setSelection(
                    TextSelection.near(view.state.doc.resolve(pos.pos)),
                  )
                  .setMeta("addToHistory", false),
              );
          }
          return false;
        },
        beforeinput(view, event) {
          if (!(view.state.selection instanceof BlockSelection)) return false;
          const inputEvent = event as InputEvent;
          const inputType = inputEvent.inputType || "";
          if (
            !inputType.startsWith("insert") ||
            inputType === "insertFromPaste" ||
            inputType === "insertFromDrop"
          )
            return false;
          const selection = view.state.selection;
          deleteBlockRange(view, selection.from, selection.to);
          return false;
        },
        keydown(view, event) {
          if (event.isComposing) return false;
          if (
            event.key === "Escape" &&
            view.dom.closest(".editor-shell")?.querySelector(".slash-menu")
          )
            return false;
          if (
            (event.metaKey || event.ctrlKey) &&
            event.key.toLowerCase() === "a"
          ) {
            const target = event.target as HTMLElement;
            if (target.closest("input, textarea, select")) return false;
            if (view.state.selection instanceof BlockSelection)
              selectAllBlocks(view);
            else selectCurrentBlock(view);
            event.preventDefault();
            return true;
          }
          const selection = view.state.selection;
          if (!(selection instanceof BlockSelection)) {
            if (event.key === "Escape") {
              event.preventDefault();
              return selectCurrentBlock(view);
            }
            if (
              (event.metaKey || event.ctrlKey) &&
              event.key.toLowerCase() === "d"
            ) {
              event.preventDefault();
              selectCurrentBlock(view);
              return duplicateSelectedBlocks(view);
            }
            return false;
          }
          if (
            (event.metaKey || event.ctrlKey) &&
            event.key.toLowerCase() === "d"
          ) {
            event.preventDefault();
            return duplicateSelectedBlocks(view);
          }
          if (
            (event.metaKey || event.ctrlKey) &&
            event.shiftKey &&
            ["ArrowUp", "ArrowDown"].includes(event.key)
          ) {
            event.preventDefault();
            return moveSelectedBlocks(view, event.key === "ArrowUp" ? -1 : 1);
          }
          if (event.key === "Escape") {
            collapseBlockSelection(view, selection, "start");
            event.preventDefault();
            return true;
          }
          if (event.key === "Backspace" || event.key === "Delete") {
            deleteBlockRange(view, selection.from, selection.to);
            event.preventDefault();
            return true;
          }
          if (event.key === "Enter") {
            collapseBlockSelection(view, selection, "start");
            event.preventDefault();
            return true;
          }
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            if (event.shiftKey)
              extendBlockSelection(
                view,
                selection,
                event.key === "ArrowUp" ? -1 : 1,
              );
            else
              collapseBlockSelection(
                view,
                selection,
                event.key === "ArrowUp" ? "start" : "end",
              );
            event.preventDefault();
            return true;
          }
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            if (event.shiftKey)
              extendBlockSelection(
                view,
                selection,
                event.key === "ArrowLeft" ? -1 : 1,
              );
            else
              collapseBlockSelection(
                view,
                selection,
                event.key === "ArrowLeft" ? "start" : "end",
              );
            event.preventDefault();
            return true;
          }
          if (
            event.key.length === 1 &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.altKey
          ) {
            // Typing over a block selection starts a fresh paragraph at the
            // deletion point and lets the browser insert the character.
            deleteBlockRange(view, selection.from, selection.to);
            return false;
          }
          return false;
        },
      },
    },
    appendTransaction(transactions, _oldState, newState) {
      const selection = newState.selection;
      if (
        selection instanceof TextSelection &&
        !selection.empty &&
        crossesBlockBoundary(newState.doc, selection.from, selection.to)
      ) {
        const range = blockRangeForPositions(
          newState.doc,
          selection.from,
          selection.to,
        );
        if (range)
          return newState.tr
            .setSelection(
              new BlockSelection(
                newState.doc,
                range.from,
                range.to,
                selection.anchor > selection.head,
              ),
            )
            .setMeta("addToHistory", false);
      }
      if (transactions.some((transaction) => transaction.docChanged)) {
        const emptyLists = emptyListPositions(newState.doc);
        if (emptyLists.length) {
          let tr = cleanupEmptyLists(newState.tr);
          if (tr.doc.childCount === 0) {
            const paragraph = newState.schema.nodes.paragraph.create();
            tr = tr.insert(0, paragraph);
            tr.setSelection(TextSelection.near(tr.doc.resolve(1), 1));
          }
          return tr;
        }
      }
      if (newState.doc.childCount === 0) {
        const paragraph = newState.schema.nodes.paragraph.create();
        const tr = newState.tr.insert(0, paragraph);
        tr.setSelection(TextSelection.near(tr.doc.resolve(1), 1));
        return tr;
      }
      return null;
    },
    view(editorView) {
      const updateClass = (view: EditorView) => {
        const preview =
          gutterAnchor !== null ? blockRangeForSelection(view.state) : null;
        view.dom.classList.toggle(
          "block-select-mode",
          view.state.selection instanceof BlockSelection || !!preview,
        );
      };
      const shell = document;
      const gutterStart = (event: MouseEvent) => {
        if (
          event.button !== 0 ||
          (event.target as HTMLElement).closest(
            "button, input, [contenteditable='false']",
          )
        )
          return;
        const rect = editorView.dom.getBoundingClientRect();
        if (
          event.clientX >= rect.left ||
          event.clientX < rect.left - 44 ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          return;
        const pos = editorView.posAtCoords({
          left: rect.left + 4,
          top: event.clientY,
        });
        if (!pos) return;
        event.preventDefault();
        const selection = TextSelection.near(
          editorView.state.doc.resolve(pos.pos),
        );
        const range = currentBlockRange({
          doc: editorView.state.doc,
          selection,
        });
        if (!range) return;
        gutterAnchor = range.from;
        editorView.dispatch(
          editorView.state.tr
            .setSelection(
              new BlockSelection(editorView.state.doc, range.from, range.to),
            )
            .setMeta("addToHistory", false),
        );
        editorView.focus();
      };
      const gutterMove = (event: MouseEvent) => {
        if (gutterAnchor === null) return;
        const rect = editorView.dom.getBoundingClientRect();
        const pos = editorView.posAtCoords({
          left: rect.left + 4,
          top: Math.max(rect.top + 1, Math.min(rect.bottom - 1, event.clientY)),
        });
        if (!pos) return;
        const range = blockRangeForPositions(
          editorView.state.doc,
          Math.min(gutterAnchor, pos.pos),
          Math.max(gutterAnchor + 1, pos.pos),
        );
        if (range)
          editorView.dispatch(
            editorView.state.tr
              .setSelection(
                new BlockSelection(
                  editorView.state.doc,
                  range.from,
                  range.to,
                  pos.pos < gutterAnchor,
                ),
              )
              .setMeta("addToHistory", false),
          );
      };
      const finish = () => {
        gutterAnchor = null;
        updateClass(editorView);
      };
      const cancel = finish;
      shell?.addEventListener("mousedown", gutterStart);
      window.addEventListener("mousemove", gutterMove);
      window.addEventListener("mouseup", finish);
      window.addEventListener("touchend", finish);
      window.addEventListener("blur", cancel);
      updateClass(editorView);
      return {
        update(view) {
          updateClass(view);
        },
        destroy() {
          shell?.removeEventListener("mousedown", gutterStart);
          window.removeEventListener("mousemove", gutterMove);
          window.removeEventListener("mouseup", finish);
          window.removeEventListener("touchend", finish);
          window.removeEventListener("blur", cancel);
          editorView.dom.classList.remove("block-select-mode");
        },
      };
    },
  });
}

export const BlockSelectionExtension = Extension.create({
  name: "blockSelection",
  addProseMirrorPlugins() {
    return [createBlockSelectionPlugin()];
  },
});
