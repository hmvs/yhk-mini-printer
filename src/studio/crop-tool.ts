import { clampCrop } from "./raster.ts";
import type { CropRect } from "./types.ts";

type HandleId =
  | "nw"
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w"
  | "move"
  | "new";

export interface CropTool {
  /** Swaps the picture being cropped and resets the selection to full frame. */
  setSource(source: HTMLCanvasElement | null): void;
  setCrop(crop: CropRect | null): void;
  getCrop(): CropRect | null;
  reset(): void;
  redraw(): void;
}

export interface CropToolOptions {
  canvas: HTMLCanvasElement;
  /** Fires continuously while dragging, and once when the drag ends. */
  onChange: (crop: CropRect | null, committed: boolean) => void;
}

const MAX_DISPLAY_WIDTH = 640;
const HANDLE_HIT_RADIUS = 14;
const MIN_CROP_PIXELS = 8;

const HANDLE_CURSORS: Record<HandleId, string> = {
  nw: "nwse-resize",
  n: "ns-resize",
  ne: "nesw-resize",
  e: "ew-resize",
  se: "nwse-resize",
  s: "ns-resize",
  sw: "nesw-resize",
  w: "ew-resize",
  move: "move",
  new: "crosshair",
};

interface DragState {
  handle: HandleId;
  pointerId: number;
  startX: number;
  startY: number;
  origin: CropRect;
}

function requireContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Crop canvas 2D context is not available.");
  }
  return context;
}

export function createCropTool(options: CropToolOptions): CropTool {
  const { canvas, onChange } = options;
  const context = requireContext(canvas);

  let source: HTMLCanvasElement | null = null;
  let crop: CropRect | null = null;
  let drag: DragState | null = null;
  let scale = 1;

  function fullFrame(): CropRect | null {
    if (!source) return null;
    return { x: 0, y: 0, width: source.width, height: source.height };
  }

  function activeCrop(): CropRect | null {
    return crop ?? fullFrame();
  }

  function layout(): void {
    if (!source) {
      canvas.width = 1;
      canvas.height = 1;
      scale = 1;
      return;
    }

    scale = Math.min(1, MAX_DISPLAY_WIDTH / source.width);
    canvas.width = Math.max(1, Math.round(source.width * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));
  }

  function toCanvasPoint(event: PointerEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / Math.max(1, rect.width);
    const scaleY = canvas.height / Math.max(1, rect.height);
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  }

  function handleAt(x: number, y: number): HandleId {
    const rect = activeCrop();
    if (!rect) return "new";

    const left = rect.x * scale;
    const top = rect.y * scale;
    const right = (rect.x + rect.width) * scale;
    const bottom = (rect.y + rect.height) * scale;
    const midX = (left + right) / 2;
    const midY = (top + bottom) / 2;

    const points: Array<[HandleId, number, number]> = [
      ["nw", left, top],
      ["n", midX, top],
      ["ne", right, top],
      ["e", right, midY],
      ["se", right, bottom],
      ["s", midX, bottom],
      ["sw", left, bottom],
      ["w", left, midY],
    ];

    for (const [id, pointX, pointY] of points) {
      if (Math.hypot(x - pointX, y - pointY) <= HANDLE_HIT_RADIUS) {
        return id;
      }
    }

    // With no selection yet the whole frame is "inside", so a drag there
    // should start a new selection rather than nudge an immovable full crop.
    if (x >= left && x <= right && y >= top && y <= bottom) {
      return crop ? "move" : "new";
    }

    return "new";
  }

  function applyDrag(pointX: number, pointY: number): void {
    if (!drag || !source) return;

    const deltaX = (pointX - drag.startX) / scale;
    const deltaY = (pointY - drag.startY) / scale;
    const origin = drag.origin;

    if (drag.handle === "move") {
      const maxX = source.width - origin.width;
      const maxY = source.height - origin.height;
      crop = {
        x: Math.max(0, Math.min(maxX, origin.x + deltaX)),
        y: Math.max(0, Math.min(maxY, origin.y + deltaY)),
        width: origin.width,
        height: origin.height,
      };
    } else if (drag.handle === "new") {
      const startX = drag.startX / scale;
      const startY = drag.startY / scale;
      const currentX = pointX / scale;
      const currentY = pointY / scale;
      crop = {
        x: Math.min(startX, currentX),
        y: Math.min(startY, currentY),
        width: Math.abs(currentX - startX),
        height: Math.abs(currentY - startY),
      };
    } else {
      let left = origin.x;
      let top = origin.y;
      let right = origin.x + origin.width;
      let bottom = origin.y + origin.height;

      if (drag.handle.includes("w")) left = origin.x + deltaX;
      if (drag.handle.includes("e")) right = origin.x + origin.width + deltaX;
      if (drag.handle.includes("n")) top = origin.y + deltaY;
      if (drag.handle.includes("s")) bottom = origin.y + origin.height + deltaY;

      crop = {
        x: Math.min(left, right),
        y: Math.min(top, bottom),
        width: Math.abs(right - left),
        height: Math.abs(bottom - top),
      };
    }

    if (crop.width < MIN_CROP_PIXELS || crop.height < MIN_CROP_PIXELS) {
      crop = {
        ...crop,
        width: Math.max(MIN_CROP_PIXELS, crop.width),
        height: Math.max(MIN_CROP_PIXELS, crop.height),
      };
    }

    crop = clampCrop(crop, source.width, source.height);
    redraw();
    onChange(crop, false);
  }

  function drawHandles(rect: CropRect): void {
    const left = rect.x * scale;
    const top = rect.y * scale;
    const right = (rect.x + rect.width) * scale;
    const bottom = (rect.y + rect.height) * scale;
    const midX = (left + right) / 2;
    const midY = (top + bottom) / 2;
    const size = 8;

    context.fillStyle = "#ffffff";
    context.strokeStyle = "#18181b";
    context.lineWidth = 1;

    for (const [pointX, pointY] of [
      [left, top],
      [midX, top],
      [right, top],
      [right, midY],
      [right, bottom],
      [midX, bottom],
      [left, bottom],
      [left, midY],
    ]) {
      context.beginPath();
      context.rect(pointX - size / 2, pointY - size / 2, size, size);
      context.fill();
      context.stroke();
    }
  }

  function redraw(): void {
    if (!source) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(source, 0, 0, canvas.width, canvas.height);

    const rect = activeCrop();
    if (!rect) return;

    const left = rect.x * scale;
    const top = rect.y * scale;
    const width = rect.width * scale;
    const height = rect.height * scale;

    context.save();
    context.fillStyle = "rgba(9, 9, 11, 0.55)";
    context.beginPath();
    context.rect(0, 0, canvas.width, canvas.height);
    context.rect(left, top, width, height);
    context.fill("evenodd");
    context.restore();

    context.save();
    context.strokeStyle = "rgba(255, 255, 255, 0.7)";
    context.lineWidth = 1;
    context.beginPath();
    for (let index = 1; index < 3; index++) {
      const thirdX = left + (width * index) / 3;
      const thirdY = top + (height * index) / 3;
      context.moveTo(thirdX, top);
      context.lineTo(thirdX, top + height);
      context.moveTo(left, thirdY);
      context.lineTo(left + width, thirdY);
    }
    context.stroke();
    context.restore();

    context.strokeStyle = "#fafafa";
    context.lineWidth = 2;
    context.strokeRect(left, top, width, height);
    drawHandles(rect);
  }

  function capturePointer(pointerId: number): void {
    try {
      canvas.setPointerCapture(pointerId);
    } catch {
      // Synthetic or already-released pointers cannot be captured.
    }
  }

  function releasePointer(pointerId: number): void {
    try {
      if (canvas.hasPointerCapture(pointerId)) {
        canvas.releasePointerCapture(pointerId);
      }
    } catch {
      // Nothing to release.
    }
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (!source || event.button !== 0) return;

    const point = toCanvasPoint(event);
    const handle = handleAt(point.x, point.y);
    const origin = activeCrop();
    if (!origin) return;

    drag = {
      handle,
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      origin,
    };

    capturePointer(event.pointerId);
    event.preventDefault();

    if (handle === "new") {
      crop = clampCrop(
        {
          x: point.x / scale,
          y: point.y / scale,
          width: MIN_CROP_PIXELS,
          height: MIN_CROP_PIXELS,
        },
        source.width,
        source.height,
      );
      redraw();
    }
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!source) return;

    const point = toCanvasPoint(event);

    if (!drag) {
      canvas.style.cursor = HANDLE_CURSORS[handleAt(point.x, point.y)];
      return;
    }

    if (drag.pointerId !== event.pointerId) return;
    applyDrag(point.x, point.y);
  });

  function endDrag(event: PointerEvent): void {
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag = null;
    releasePointer(event.pointerId);
    onChange(crop, true);
  }

  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  canvas.addEventListener("dblclick", () => {
    if (!source) return;
    crop = null;
    redraw();
    onChange(null, true);
  });

  return {
    setSource(next) {
      source = next;
      crop = null;
      layout();
      redraw();
    },
    setCrop(next) {
      crop = next && source ? clampCrop(next, source.width, source.height) : null;
      redraw();
    },
    getCrop() {
      return crop;
    },
    reset() {
      crop = null;
      redraw();
      onChange(null, true);
    },
    redraw,
  };
}
