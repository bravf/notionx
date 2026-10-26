import { useEffect, useLayoutEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
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
  suppressed,
  children,
}: {
  editor: Editor;
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
    // Anchor the toolbar above the selected text, never above the caret.
    refs.setReference({
      contextElement: editor.view.dom,
      getBoundingClientRect() {
        if (editor.isDestroyed) return new DOMRect();
        const selection = editor.state.selection;
        if (!(selection instanceof TextSelection) || selection.empty)
          return new DOMRect();
        const from = editor.view.coordsAtPos(selection.from);
        const to = editor.view.coordsAtPos(selection.to);
        return new DOMRect(
          from.left,
          from.top,
          Math.max(
            1,
            selection.$from.sameParent(selection.$to)
              ? to.right - from.left
              : editor.view.dom.getBoundingClientRect().right - from.left,
          ),
          Math.max(1, from.bottom - from.top),
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
  }, [hasFocus, suppressed, update]);
  const selection = editor.state.selection;
  const hasTextSelection =
    selection instanceof TextSelection && !selection.empty;
  const visible =
    hasTextSelection &&
    hasFocus &&
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
