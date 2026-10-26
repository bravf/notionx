import type { Editor } from "@tiptap/core";
import { useEffect, useState } from "react";
import {
  autoUpdate,
  flip,
  hide,
  offset,
  shift,
  useFloating,
} from "@floating-ui/react-dom";
import { Menu, MenuItem, MenuDivider } from "./ui";
import { MoreHorizontal, Plus } from "lucide-react";

export function TableTools({ editor }: { editor: Editor }) {
  const [table, setTable] = useState<HTMLElement | null>(null);
  const [focused, setFocused] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { refs, floatingStyles, middlewareData, isPositioned } = useFloating({
    placement: "top-start",
    strategy: "fixed",
    middleware: [
      offset(6),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      hide({ strategy: "referenceHidden" }),
    ],
    whileElementsMounted: autoUpdate,
  });
  useEffect(() => {
    const update = () => {
      if (!editor.isActive("table")) {
        setTable(null);
        return;
      }
      const dom = editor.view.domAtPos(editor.state.selection.from).node;
      const el = dom instanceof HTMLElement ? dom : dom.parentElement;
      setTable(el?.closest("table") || null);
    };
    editor.on("transaction", update);
    update();
    return () => {
      editor.off("transaction", update);
    };
  }, [editor]);
  useEffect(() => {
    refs.setReference(table);
  }, [table, refs]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      const target = document.activeElement;
      setFocused(
        !!target &&
          (editor.view.dom.contains(target) ||
            !!refs.floating.current?.contains(target)),
      );
    };
    const delayed = () => {
      clearTimeout(timer);
      timer = setTimeout(check, 0);
    };
    check();
    document.addEventListener("focusin", check);
    document.addEventListener("focusout", delayed);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("focusin", check);
      document.removeEventListener("focusout", delayed);
    };
  }, [editor, refs]);
  if (!table) return null;
  const visible =
    (focused || menuOpen) &&
    isPositioned &&
    !middlewareData.hide?.referenceHidden;
  return (
    <div
      ref={refs.setFloating}
      className="table-edit-tools contextual-table-tools"
      style={{ ...floatingStyles, visibility: visible ? "visible" : "hidden" }}
      role="toolbar"
      aria-label="表格操作"
      aria-hidden={!visible}
      inert={!visible}
      onMouseDown={(e) => e.preventDefault()}
    >
      <button onClick={() => editor.chain().focus().addRowAfter().run()}>
        <Plus size={14} /> 行
      </button>
      <button onClick={() => editor.chain().focus().addColumnAfter().run()}>
        <Plus size={14} /> 列
      </button>
      <Menu
        modal={false}
        onOpenChange={setMenuOpen}
        align="start"
        trigger={
          <button aria-label="更多表格操作">
            <MoreHorizontal size={16} />
          </button>
        }
      >
        <MenuItem
          onClick={() => {
            editor.chain().focus().addRowBefore().run();
          }}
        >
          在上方插入行
        </MenuItem>
        <MenuItem
          onClick={() => {
            editor.chain().focus().addColumnBefore().run();
          }}
        >
          在左侧插入列
        </MenuItem>
        <MenuItem
          onClick={() => {
            editor.chain().focus().toggleHeaderRow().run();
          }}
        >
          切换表头行
        </MenuItem>
        <MenuItem
          onClick={() => {
            editor.chain().focus().toggleHeaderColumn().run();
          }}
        >
          切换表头列
        </MenuItem>
        <MenuDivider />
        <MenuItem
          disabled={!editor.can().mergeCells()}
          onClick={() => {
            editor.chain().focus().mergeCells().run();
          }}
        >
          合并所选单元格
        </MenuItem>
        <MenuItem
          disabled={!editor.can().splitCell()}
          onClick={() => {
            editor.chain().focus().splitCell().run();
          }}
        >
          拆分单元格
        </MenuItem>
        <MenuDivider />
        <MenuItem
          danger
          onClick={() => {
            editor.chain().focus().deleteRow().run();
          }}
        >
          删除行
        </MenuItem>
        <MenuItem
          danger
          onClick={() => {
            editor.chain().focus().deleteColumn().run();
          }}
        >
          删除列
        </MenuItem>
        <MenuItem
          danger
          onClick={() => {
            editor.chain().focus().deleteTable().run();
          }}
        >
          删除表格
        </MenuItem>
      </Menu>
    </div>
  );
}
