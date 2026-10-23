import { useEffect, useLayoutEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import {
  autoUpdate,
  flip,
  hide,
  offset,
  shift,
  useFloating,
} from "@floating-ui/react-dom";

export function EditorToolbar({
  editor,
  menuOpen,
  suppressed,
  children,
}: {
  editor: Editor;
  menuOpen: boolean;
  suppressed: boolean;
  children: ReactNode;
}) {
  const [hasFocus, setHasFocus] = useState(false);
  const {
    refs,
    floatingStyles,
    update,
    middlewareData,
    placement,
    isPositioned,
  } = useFloating({
    placement: "top-start",
    strategy: "absolute",
    middleware: [
      offset(8),
      flip({ padding: 10 }),
      shift({ padding: 10 }),
      hide({ strategy: "referenceHidden" }),
    ],
    whileElementsMounted: autoUpdate,
  });
  useLayoutEffect(() => {
    // Read the live ProseMirror selection on every positioning update. The
    // caret's line is the vertical anchor, so long blocks also stay usable.
    refs.setReference({
      contextElement: editor.view.dom,
      getBoundingClientRect() {
        if (editor.isDestroyed) return new DOMRect();
        const selection = editor.state.selection;
        if (selection instanceof NodeSelection) {
          const node = editor.view.nodeDOM(selection.from);
          if (node instanceof HTMLElement) return node.getBoundingClientRect();
        }
        const { $head, head } = selection;
        const node = $head.depth
          ? editor.view.nodeDOM($head.before($head.depth))
          : editor.view.dom;
        const block = node instanceof HTMLElement ? node : editor.view.dom;
        const bounds = block.getBoundingClientRect();
        const caret = editor.view.coordsAtPos(head);
        return new DOMRect(
          bounds.left,
          caret.top,
          bounds.width,
          caret.bottom - caret.top,
        );
      },
    });
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    editor.on("transaction", schedule);
    return () => {
      cancelAnimationFrame(frame);
      editor.off("transaction", schedule);
      refs.setReference(null);
    };
  }, [editor, refs, update]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      const target = document.activeElement;
      setHasFocus(
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
  useEffect(() => {
    update();
  }, [hasFocus, menuOpen, suppressed, update]);
  const visible =
    (hasFocus || menuOpen) &&
    !suppressed &&
    isPositioned &&
    !middlewareData.hide?.referenceHidden;
  return (
    <div
      ref={refs.setFloating}
      role="toolbar"
      aria-label="块格式工具栏"
      aria-hidden={!visible}
      inert={!visible}
      data-placement={placement}
      className={"editor-toolbar " + (visible ? "visible" : "")}
      style={{ ...floatingStyles, visibility: visible ? "visible" : "hidden" }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {children}
    </div>
  );
}
