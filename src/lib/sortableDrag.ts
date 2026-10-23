export type DragItem = { id: string; elements: HTMLElement[] };
type Placement = { target: string; after: boolean };

// Keep framework-owned DOM in place. Only temporary styles change until drop.
// A styled DOM snapshot preserves rich blocks, controls and typed table values.
function snapshot(element: HTMLElement) {
  const copy = element.cloneNode(true) as HTMLElement;
  const originals = [element, ...element.querySelectorAll<HTMLElement>("*")];
  const copies = [copy, ...copy.querySelectorAll<HTMLElement>("*")];
  originals.forEach((original, i) => {
    const target = copies[i];
    const computed = getComputedStyle(original);
    for (const property of computed)
      target.style.setProperty(property, computed.getPropertyValue(property));
    // Freeze flex items at their used size: resolving auto margins outside the
    // original table otherwise shrinks number labels and adds an ellipsis.
    if (
      original.parentElement &&
      getComputedStyle(original.parentElement).display.includes("flex")
    ) {
      const rect = original.getBoundingClientRect();
      Object.assign(target.style, {
        flex: "0 0 auto",
        boxSizing: "border-box",
        width: `${rect.width}px`,
        inlineSize: `${rect.width}px`,
        height: `${rect.height}px`,
        blockSize: `${rect.height}px`,
      }); // A web font can finish loading during the drag. Intrinsic text must
      // still have enough room after its glyph metrics change.
      if (
        !original.children.length &&
        original.textContent?.trim() &&
        original.scrollWidth <= original.clientWidth + 1
      ) {
        target.style.minWidth = "max-content";
        target.style.minInlineSize = "max-content";
      }
    }
    target.removeAttribute("id");
    target.removeAttribute("autofocus");
    if (
      original instanceof HTMLInputElement &&
      target instanceof HTMLInputElement
    ) {
      target.value = original.value;
      target.checked = original.checked;
    }
    if (
      original instanceof HTMLTextAreaElement &&
      target instanceof HTMLTextAreaElement
    )
      target.value = original.value;
  });
  return copy;
}
function bounds(elements: HTMLElement[]) {
  const rects = elements.map((el) => el.getBoundingClientRect());
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  return {
    left,
    top,
    width: Math.max(...rects.map((r) => r.right)) - left,
    height: Math.max(...rects.map((r) => r.bottom)) - top,
  };
}
export function sortableDrag(
  event: React.PointerEvent,
  options: {
    items: DragItem[];
    source: string;
    axis: "x" | "y";
    className: string;
    preview?: "block";
    scroll: HTMLElement[];
    applyTransforms?: (
      items: { id: string; offset: number; source: boolean }[] | null,
    ) => void;
    onStart?: () => void;
    onFinish: (placement: Placement | null) => void;
  },
) {
  if (event.button !== 0 || options.items.length < 2) return () => {};
  event.preventDefault();
  const sourceIndex = options.items.findIndex(
    (item) => item.id === options.source,
  );
  if (sourceIndex < 0) return () => {};
  const horizontal = options.axis === "x";
  const source = options.items[sourceIndex];
  let x = event.clientX,
    y = event.clientY;
  const startX = x,
    startY = y;
  let started = false,
    finished = false,
    frame = 0,
    destination = sourceIndex;
  let overlay: HTMLDivElement | undefined;
  let initial = bounds(source.elements);
  let rects = options.items.map((item) => bounds(item.elements));
  let lastDestination = -1;
  let scrollPositions: { el: HTMLElement; x: number; y: number }[] = [];
  const originals = new Map<HTMLElement, string | null>();
  const scrollStyles = new Map<HTMLElement, string>();
  const shift = (el: HTMLElement, offset: number, isSource: boolean) => {
    el.style.transform = horizontal
      ? `translateX(${offset}px)`
      : `translateY(${offset}px)`;
    el.style.transition =
      "transform 180ms cubic-bezier(.2,.8,.2,1), opacity 120ms";
    el.style.opacity = isSource ? "0.13" : "";
    el.style.willChange = "transform";
  };
  const draw = () => {
    if (!overlay) return;
    overlay.style.transform = `translate3d(${x - startX}px, ${y - startY}px, 0)`;
    const scrolled = scrollPositions.reduce(
      (delta, s) => ({
        x: delta.x + s.el.scrollLeft - s.x,
        y: delta.y + s.el.scrollTop - s.y,
      }),
      { x: 0, y: 0 },
    );
    const pointer = horizontal ? x + scrolled.x : y + scrolled.y;
    const start = (r: typeof initial) => (horizontal ? r.left : r.top);
    const size = (r: typeof initial) => (horizontal ? r.width : r.height);
    const remaining = rects
      .map((r, i) => ({ r, i }))
      .filter(({ i }) => i !== sourceIndex);
    const insertion = remaining.findIndex(
      ({ r }) => pointer < start(r) + size(r) / 2,
    );
    destination = insertion < 0 ? remaining.length : insertion;
    if (destination === lastDestination) return;
    lastDestination = destination;
    const transforms: { id: string; offset: number; source: boolean }[] = [];
    const gap =
      sourceIndex < rects.length - 1
        ? start(rects[sourceIndex + 1]) - start(initial) - size(initial)
        : start(initial) -
          start(rects[sourceIndex - 1]) -
          size(rects[sourceIndex - 1]);
    const stride = size(initial) + Math.max(0, gap);
    options.items.forEach((item, i) => {
      let offset = 0;
      if (i === sourceIndex) {
        if (destination > sourceIndex)
          offset =
            start(rects[destination]) +
            size(rects[destination]) -
            start(initial) -
            size(initial);
        else if (destination < sourceIndex)
          offset = start(rects[destination]) - start(initial);
      } else if (sourceIndex < i && i <= destination) offset = -stride;
      else if (destination <= i && i < sourceIndex)
        offset = size(initial) + Math.max(0, stride - size(initial));
      transforms.push({ id: item.id, offset, source: i === sourceIndex });
      if (!options.applyTransforms)
        item.elements.forEach((el) => shift(el, offset, i === sourceIndex));
    });
    options.applyTransforms?.(transforms);
  };
  const tick = () => {
    for (const el of options.scroll) {
      const r = el.getBoundingClientRect();
      if (horizontal && el.scrollWidth > el.clientWidth)
        el.scrollLeft += x < r.left + 48 ? -14 : x > r.right - 48 ? 14 : 0;
      if (!horizontal && el.scrollHeight > el.clientHeight)
        el.scrollTop += y < r.top + 56 ? -12 : y > r.bottom - 56 ? 12 : 0;
    }
    draw();
    frame = requestAnimationFrame(tick);
  };
  const move = (e: PointerEvent) => {
    x = e.clientX;
    y = e.clientY;
    if (!started && Math.hypot(x - startX, y - startY) < 5) return;
    e.preventDefault();
    if (!started) {
      started = true;
      initial = bounds(source.elements);
      rects = options.items.map((item) => bounds(item.elements));
      options.scroll.forEach((el) => {
        scrollStyles.set(el, el.style.scrollBehavior);
        el.style.scrollBehavior = "auto";
      });
      scrollPositions = options.scroll.map((el) => ({
        el,
        x: el.scrollLeft,
        y: el.scrollTop,
      }));
      overlay = document.createElement("div");
      overlay.className = `sortable-drag-preview ${options.className}`;
      overlay.setAttribute("aria-hidden", "true");
      overlay.inert = true;
      const isBlock = options.preview === "block";
      const listItem =
        isBlock && source.elements[0].tagName === "LI"
          ? source.elements[0]
          : null;
      const listGutter =
        listItem && getComputedStyle(listItem).display === "list-item" ? 24 : 0;
      const inset = isBlock
        ? { left: 16 + listGutter, top: 12, right: 16, bottom: 12 }
        : { left: 0, top: 0, right: 0, bottom: 0 };
      Object.assign(overlay.style, {
        left: `${initial.left - inset.left}px`,
        top: `${initial.top - inset.top}px`,
        width: `${initial.width + inset.left + inset.right}px`,
        height: `${initial.height + inset.top + inset.bottom}px`,
      });
      for (const el of source.elements) {
        const parts =
          el.tagName === "TR"
            ? (Array.from(el.children) as HTMLElement[])
            : [el];
        for (const part of parts) {
          const rect = part.getBoundingClientRect();
          const clone = snapshot(part);
          Object.assign(clone.style, {
            position: "absolute",
            display: ["TD", "TH"].includes(part.tagName)
              ? "block"
              : clone.style.display,
            margin: "0",
            left: `${rect.left - initial.left + inset.left}px`,
            top: `${rect.top - initial.top + inset.top}px`,
            right: "auto",
            bottom: "auto",
            width: `${rect.width}px`,
            height: `${rect.height}px`,
            boxSizing: "border-box",
            transform: "none",
            opacity: "1",
            transition: "none",
          });
          clone.classList.add("drag-snapshot");
          if (isBlock && part.tagName === "LI" && part.parentElement) {
            // An inside marker before a block paragraph creates an extra line.
            // Keep a real list parent, outside markers and the original ordinal.
            const parent = part.parentElement;
            const list = parent.cloneNode(false) as HTMLElement;
            list.removeAttribute("id");
            list.className = "drag-snapshot-list";
            Object.assign(list.style, {
              position: "absolute",
              left: clone.style.left,
              top: clone.style.top,
              width: clone.style.width,
              margin: "0",
              padding: "0",
              listStylePosition: "outside",
            });
            if (parent instanceof HTMLOListElement) {
              const index = Array.from(parent.children).indexOf(part);
              const start = parent.hasAttribute("start")
                ? parent.start
                : parent.reversed
                  ? parent.children.length
                  : 1;
              list.setAttribute(
                "start",
                String(start + (parent.reversed ? -index : index)),
              );
            }
            Object.assign(clone.style, {
              position: "relative",
              left: "0",
              top: "0",
              listStylePosition: "outside",
            });
            list.appendChild(clone);
            overlay.appendChild(list);
          } else overlay.appendChild(clone);
        }
      }
      document.body.appendChild(overlay);
      if (!options.applyTransforms)
        options.items.forEach((item) =>
          item.elements.forEach((el) => {
            originals.set(el, el.getAttribute("style"));
            el.classList.add("sortable-drag-item");
            if (item.id === source.id) el.classList.add("sortable-drag-source");
          }),
        );
      document.body.classList.add("sorting-content");
      options.onStart?.();
      frame = requestAnimationFrame(tick);
    }
    draw();
  };
  const finish = (cancel: boolean) => {
    if (finished) return;
    finished = true;
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", up);
    document.removeEventListener("pointercancel", cancelDrag);
    document.removeEventListener("keydown", key, true);
    window.removeEventListener("blur", cancelDrag);
    cancelAnimationFrame(frame);
    if (
      overlay &&
      started &&
      !cancel &&
      destination !== sourceIndex &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      const target = rects[destination];
      const offset = horizontal
        ? target.left -
          initial.left +
          (destination > sourceIndex ? target.width - initial.width : 0)
        : target.top -
          initial.top +
          (destination > sourceIndex ? target.height - initial.height : 0);
      const scrolled = scrollPositions.reduce(
        (delta, s) => ({
          x: delta.x + s.el.scrollLeft - s.x,
          y: delta.y + s.el.scrollTop - s.y,
        }),
        { x: 0, y: 0 },
      );
      const node = overlay;
      node.classList.add("drag-settling");
      const animation = node.animate(
        [
          { transform: node.style.transform, opacity: 1 },
          {
            transform: `translate3d(${(horizontal ? offset : 0) - scrolled.x}px, ${(horizontal ? 0 : offset) - scrolled.y}px, 0)`,
            opacity: 0,
          },
        ],
        { duration: 150, easing: "cubic-bezier(.2,.8,.2,1)", fill: "forwards" },
      );
      animation.finished.then(
        () => node.remove(),
        () => node.remove(),
      );
    } else overlay?.remove();
    if (started) options.applyTransforms?.(null);
    originals.forEach((style, el) => {
      if (style === null) el.removeAttribute("style");
      else el.setAttribute("style", style);
      el.classList.remove("sortable-drag-item", "sortable-drag-source");
    });
    scrollStyles.forEach((style, el) => {
      el.style.scrollBehavior = style;
    });
    document.body.classList.remove("sorting-content");
    let placement: Placement | null = null;
    if (started && !cancel && destination !== sourceIndex)
      placement = {
        target: options.items[destination].id,
        after: destination > sourceIndex,
      };
    options.onFinish(placement);
  };
  const up = () => finish(false);
  const cancelDrag = () => finish(true);
  const key = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      finish(true);
    }
  };
  document.addEventListener("pointermove", move, { passive: false });
  document.addEventListener("pointerup", up);
  document.addEventListener("pointercancel", cancelDrag);
  document.addEventListener("keydown", key, true);
  window.addEventListener("blur", cancelDrag);
  return cancelDrag;
}
