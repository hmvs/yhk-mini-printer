import { PRINTER_WIDTH } from "@shared/constants.ts";
import {
  documentHeight,
  elementHeight,
  layoutText,
  renderPage,
  type PageRender,
  type RenderResources,
} from "./render.ts";
import type { StudioDocument, StudioElement } from "./types.ts";

type HandleId =
  | "nw"
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w"
  | "rotate"
  | "move";

export interface Stage {
  /** Re-renders the page and the selection chrome. */
  refresh(): PageRender;
  latest(): PageRender | null;
  setSelection(id: string | null): void;
}

export interface StageOptions {
  canvas: HTMLCanvasElement;
  getDocument: () => StudioDocument;
  getResources: () => RenderResources;
  getSelectedId: () => string | null;
  onSelect: (id: string | null) => void;
  /** Fires while dragging and once more when the gesture ends. */
  onChange: (committed: boolean) => void;
}

interface DragState {
  pointerId: number;
  handle: HandleId;
  element: StudioElement;
  startPointer: { x: number; y: number };
  origin: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    fontSize: number;
  };
}

const DISPLAY_SCALE = 2;
const HANDLE_SIZE = 9;
const HANDLE_HIT = 13;
const ROTATE_OFFSET = 26;
const MIN_SIZE = 12;
const SNAP = 4;

const HANDLE_CURSORS: Record<HandleId, string> = {
  nw: "nwse-resize",
  n: "ns-resize",
  ne: "nesw-resize",
  e: "ew-resize",
  se: "nwse-resize",
  s: "ns-resize",
  sw: "nesw-resize",
  w: "ew-resize",
  rotate: "grab",
  move: "move",
};

function rotatePoint(
  x: number,
  y: number,
  radians: number,
): { x: number; y: number } {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

function keepsAspect(element: StudioElement): boolean {
  return element.type === "image" || element.type === "qr";
}

function requireContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Stage canvas 2D context is not available.");
  }
  return context;
}

export function createStage(options: StageOptions): Stage {
  const { canvas, getDocument, getResources, getSelectedId, onSelect, onChange } =
    options;
  const context = requireContext(canvas);

  let page: PageRender | null = null;
  let drag: DragState | null = null;

  function selectedElement(): StudioElement | null {
    const id = getSelectedId();
    if (!id) return null;
    return getDocument().elements.find((element) => element.id === id) ?? null;
  }

  function toPagePoint(event: PointerEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / Math.max(1, rect.width) / DISPLAY_SCALE;
    const scaleY = canvas.height / Math.max(1, rect.height) / DISPLAY_SCALE;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  }

  /** Pointer position in the element's unrotated frame, origin at its centre. */
  function toLocalPoint(
    element: StudioElement,
    point: { x: number; y: number },
  ): { x: number; y: number } {
    const height = elementHeight(element);
    const centerX = element.x + element.width / 2;
    const centerY = element.y + height / 2;
    return rotatePoint(
      point.x - centerX,
      point.y - centerY,
      (-element.rotation * Math.PI) / 180,
    );
  }

  function handleAt(
    element: StudioElement,
    point: { x: number; y: number },
  ): HandleId | null {
    const local = toLocalPoint(element, point);
    const halfWidth = element.width / 2;
    const halfHeight = elementHeight(element) / 2;
    const hit = HANDLE_HIT / DISPLAY_SCALE;

    if (
      Math.hypot(local.x, local.y + halfHeight + ROTATE_OFFSET / DISPLAY_SCALE) <=
      hit
    ) {
      return "rotate";
    }

    const handles: Array<[HandleId, number, number]> = [
      ["nw", -halfWidth, -halfHeight],
      ["n", 0, -halfHeight],
      ["ne", halfWidth, -halfHeight],
      ["e", halfWidth, 0],
      ["se", halfWidth, halfHeight],
      ["s", 0, halfHeight],
      ["sw", -halfWidth, halfHeight],
      ["w", -halfWidth, 0],
    ];

    for (const [id, x, y] of handles) {
      if (Math.hypot(local.x - x, local.y - y) <= hit) {
        // Text height follows its content, so vertical handles do nothing.
        if (element.type === "text" && (id === "n" || id === "s")) continue;
        return id;
      }
    }

    if (
      Math.abs(local.x) <= halfWidth &&
      Math.abs(local.y) <= halfHeight
    ) {
      return "move";
    }

    return null;
  }

  function elementAt(point: { x: number; y: number }): StudioElement | null {
    const elements = getDocument().elements;
    for (let index = elements.length - 1; index >= 0; index--) {
      const element = elements[index] as StudioElement;
      const local = toLocalPoint(element, point);
      if (
        Math.abs(local.x) <= element.width / 2 &&
        Math.abs(local.y) <= elementHeight(element) / 2
      ) {
        return element;
      }
    }
    return null;
  }

  function applyMove(element: StudioElement, point: { x: number; y: number }): void {
    if (!drag) return;

    let x = drag.origin.x + (point.x - drag.startPointer.x);
    let y = drag.origin.y + (point.y - drag.startPointer.y);

    // Snap to the page centre line and to the left/right edges.
    const centerOffset = x + element.width / 2 - PRINTER_WIDTH / 2;
    if (Math.abs(centerOffset) <= SNAP) x -= centerOffset;
    if (Math.abs(x) <= SNAP) x = 0;
    if (Math.abs(x + element.width - PRINTER_WIDTH) <= SNAP) {
      x = PRINTER_WIDTH - element.width;
    }
    if (Math.abs(y) <= SNAP) y = 0;

    element.x = Math.round(
      Math.max(-element.width + 16, Math.min(PRINTER_WIDTH - 16, x)),
    );
    element.y = Math.round(Math.max(0, y));
  }

  function applyRotate(
    element: StudioElement,
    point: { x: number; y: number },
    shift: boolean,
  ): void {
    const height = elementHeight(element);
    const centerX = element.x + element.width / 2;
    const centerY = element.y + height / 2;
    const radians = Math.atan2(point.y - centerY, point.x - centerX);
    let degrees = (radians * 180) / Math.PI + 90;

    degrees = ((degrees % 360) + 360) % 360;
    const step = shift ? 15 : 0;
    if (step) {
      degrees = Math.round(degrees / step) * step;
    } else {
      // Gentle magnet on the right angles.
      for (const angle of [0, 90, 180, 270, 360]) {
        if (Math.abs(degrees - angle) <= 3) degrees = angle % 360;
      }
    }

    element.rotation = Math.round(degrees % 360);
  }

  function applyResize(
    element: StudioElement,
    point: { x: number; y: number },
    handle: HandleId,
  ): void {
    if (!drag) return;

    const origin = drag.origin;
    const radians = (origin.rotation * Math.PI) / 180;
    const originCenterX = origin.x + origin.width / 2;
    const originCenterY = origin.y + origin.height / 2;
    const local = rotatePoint(
      point.x - originCenterX,
      point.y - originCenterY,
      -radians,
    );

    let left = -origin.width / 2;
    let right = origin.width / 2;
    let top = -origin.height / 2;
    let bottom = origin.height / 2;

    if (handle.includes("w")) left = Math.min(local.x, right - MIN_SIZE);
    if (handle.includes("e")) right = Math.max(local.x, left + MIN_SIZE);
    if (handle.includes("n")) top = Math.min(local.y, bottom - MIN_SIZE);
    if (handle.includes("s")) bottom = Math.max(local.y, top + MIN_SIZE);

    let width = right - left;
    let height = bottom - top;

    const isCorner = handle.length === 2;
    if (isCorner && keepsAspect(element)) {
      const ratio = origin.height / origin.width;
      height = width * ratio;
      if (handle.includes("n")) top = bottom - height;
      else bottom = top + height;
    }

    if (element.type === "text") {
      if (isCorner) {
        const scale = width / origin.width;
        element.fontSize = Math.max(
          6,
          Math.min(200, Math.round(origin.fontSize * scale)),
        );
      }
      element.width = Math.round(width);
      height = layoutText(element).height;
      if (handle.includes("n")) top = bottom - height;
      else bottom = top + height;
    } else {
      element.width = Math.round(width);
      element.height = Math.round(height);
    }

    // Keep the handle opposite the one being dragged pinned in page space.
    const anchorLocalX = handle.includes("w")
      ? origin.width / 2
      : handle.includes("e")
        ? -origin.width / 2
        : 0;
    const anchorLocalY = handle.includes("n")
      ? origin.height / 2
      : handle.includes("s")
        ? -origin.height / 2
        : 0;
    const anchorPage = rotatePoint(anchorLocalX, anchorLocalY, radians);
    const anchorX = originCenterX + anchorPage.x;
    const anchorY = originCenterY + anchorPage.y;

    const newAnchorLocalX = handle.includes("w")
      ? width / 2
      : handle.includes("e")
        ? -width / 2
        : 0;
    const newAnchorLocalY = handle.includes("n")
      ? height / 2
      : handle.includes("s")
        ? -height / 2
        : 0;
    const newAnchorOffset = rotatePoint(newAnchorLocalX, newAnchorLocalY, radians);
    const centerX = anchorX - newAnchorOffset.x;
    const centerY = anchorY - newAnchorOffset.y;

    element.x = Math.round(centerX - width / 2);
    element.y = Math.round(Math.max(0, centerY - height / 2));
  }

  function drawChrome(element: StudioElement): void {
    const height = elementHeight(element);
    const centerX = (element.x + element.width / 2) * DISPLAY_SCALE;
    const centerY = (element.y + height / 2) * DISPLAY_SCALE;
    const halfWidth = (element.width / 2) * DISPLAY_SCALE;
    const halfHeight = (height / 2) * DISPLAY_SCALE;

    context.save();
    context.translate(centerX, centerY);
    context.rotate((element.rotation * Math.PI) / 180);

    context.strokeStyle = "#2563eb";
    context.lineWidth = 1.5;
    context.setLineDash([5, 4]);
    context.strokeRect(-halfWidth, -halfHeight, halfWidth * 2, halfHeight * 2);
    context.setLineDash([]);

    context.beginPath();
    context.moveTo(0, -halfHeight);
    context.lineTo(0, -halfHeight - ROTATE_OFFSET);
    context.stroke();
    context.fillStyle = "#2563eb";
    context.beginPath();
    context.arc(0, -halfHeight - ROTATE_OFFSET, HANDLE_SIZE / 2 + 1, 0, Math.PI * 2);
    context.fill();

    const handles: Array<[HandleId, number, number]> = [
      ["nw", -halfWidth, -halfHeight],
      ["n", 0, -halfHeight],
      ["ne", halfWidth, -halfHeight],
      ["e", halfWidth, 0],
      ["se", halfWidth, halfHeight],
      ["s", 0, halfHeight],
      ["sw", -halfWidth, halfHeight],
      ["w", -halfWidth, 0],
    ];

    for (const [id, x, y] of handles) {
      if (element.type === "text" && (id === "n" || id === "s")) continue;
      context.fillStyle = "#ffffff";
      context.strokeStyle = "#2563eb";
      context.lineWidth = 1.5;
      context.beginPath();
      context.rect(
        x - HANDLE_SIZE / 2,
        y - HANDLE_SIZE / 2,
        HANDLE_SIZE,
        HANDLE_SIZE,
      );
      context.fill();
      context.stroke();
    }

    context.restore();
  }

  function refresh(): PageRender {
    const document_ = getDocument();
    const rendered = renderPage(document_, getResources());
    page = rendered;

    canvas.width = PRINTER_WIDTH * DISPLAY_SCALE;
    canvas.height = documentHeight(document_) * DISPLAY_SCALE;

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = false;
    context.drawImage(rendered.canvas, 0, 0, canvas.width, canvas.height);

    const selected = selectedElement();
    if (selected) {
      drawChrome(selected);
    }

    return rendered;
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const point = toPagePoint(event);
    const selected = selectedElement();
    const handle = selected ? handleAt(selected, point) : null;

    let target = selected;
    let action: HandleId | null = handle;

    if (!handle || handle === "move") {
      const hit = elementAt(point);
      if (hit !== selected) {
        target = hit;
        action = hit ? "move" : null;
        onSelect(hit ? hit.id : null);
      }
    }

    if (!target || !action) {
      refresh();
      return;
    }

    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointers cannot be captured; dragging still works.
    }
    event.preventDefault();

    drag = {
      pointerId: event.pointerId,
      handle: action,
      element: target,
      startPointer: point,
      origin: {
        x: target.x,
        y: target.y,
        width: target.width,
        height: elementHeight(target),
        rotation: target.rotation,
        fontSize: target.type === "text" ? target.fontSize : 0,
      },
    };
    refresh();
  });

  canvas.addEventListener("pointermove", (event) => {
    const point = toPagePoint(event);

    if (!drag) {
      const selected = selectedElement();
      const handle = selected ? handleAt(selected, point) : null;
      canvas.style.cursor = handle
        ? HANDLE_CURSORS[handle]
        : elementAt(point)
          ? "move"
          : "default";
      return;
    }

    if (drag.pointerId !== event.pointerId) return;

    if (drag.handle === "move") {
      applyMove(drag.element, point);
    } else if (drag.handle === "rotate") {
      applyRotate(drag.element, point, event.shiftKey);
    } else {
      applyResize(drag.element, point, drag.handle);
    }

    onChange(false);
    refresh();
  });

  function endDrag(event: PointerEvent): void {
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag = null;
    try {
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Nothing to release.
    }
    onChange(true);
    refresh();
  }

  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  return {
    refresh,
    latest: () => page,
    setSelection(id) {
      onSelect(id);
      refresh();
    },
  };
}
