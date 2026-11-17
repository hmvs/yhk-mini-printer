/**
 * Postage label → 58 mm thermal strip.
 *
 * Carrier labels (Australia Post and friends) are laid out for A4 or
 * 100×150 mm stock. This re-flows one onto the 48 mm head:
 *
 * 1. Find each label on the PDF page and render it at 16 px/mm.
 * 2. Decode every barcode. Matrix codes (DataMatrix, QR, …) are redrawn from
 *    the decoder's exact module grid; linear codes (Code 128, …) are redrawn
 *    from the bar widths measured on the page, so the symbol is the same one
 *    the carrier printed — never a re-encode, which can pick different code
 *    sets. Both land on whole printer dots.
 * 3. Cut the remaining artwork into blocks (header, address boxes, captions)
 *    and stack them down the strip, scaled to fit.
 * 4. Decode the finished strip and refuse it unless every code reads back
 *    byte-for-byte identical.
 */
import { PRINTER_WIDTH } from "@shared/constants.ts";
import { openPdf } from "./pdf.ts";

const DOTS_PER_MM = 8;
/** Coarse pass, only used to find where labels sit on the page. */
const SCAN_PX_PER_MM = 4;
/** Detail pass: Code 128 at 0.3 mm modules is ~5 px wide here. */
const PX_PER_MM = 16;
/** Dots per detail pixel at the label's original size. */
const NATURAL = DOTS_PER_MM / PX_PER_MM;
const MARGIN = 6;
const CONTENT_WIDTH = PRINTER_WIDTH - MARGIN * 2;
/** Grey level below which a resampled pixel prints. Slightly dark-biased to keep hairline text. */
const PRINT_THRESHOLD = 165;
const MAX_LABEL_DOTS = 4000;

const MATRIX_QUIET_MODULES: Record<string, number> = {
  QRCode: 4,
  MicroQRCode: 2,
  RMQRCode: 2,
  DataMatrix: 2,
  Aztec: 1,
  PDF417: 2,
};

export interface DecodedCode {
  format: string;
  text: string;
}

export interface ConvertedLabel {
  /** 1-bit artwork exactly PRINTER_WIDTH wide, black on white. */
  canvas: HTMLCanvasElement;
  page: number;
  codes: DecodedCode[];
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Bits {
  width: number;
  height: number;
  /** 1 = burn. */
  data: Uint8Array;
}

interface LinearCode {
  kind: "linear";
  format: string;
  text: string;
  bytes: string;
  rect: Rect;
  /** Bar/space widths in modules, in page order (top→bottom or left→right). */
  runs: number[];
  /** True when the bars run along the page's y axis (barcode reads downwards). */
  vertical: boolean;
  moduleMm: number;
}

interface MatrixCode {
  kind: "matrix";
  format: string;
  text: string;
  bytes: string;
  rect: Rect;
  modules: Bits;
  moduleMm: number;
}

type Code = LinearCode | MatrixCode;

interface Block {
  rect: Rect;
  /** A ruled line separated this block from the previous one. */
  ruledBefore: boolean;
}

interface Raster {
  width: number;
  height: number;
  lum: Uint8Array;
  ink: Uint8Array;
  paper: Uint8Array;
}

/* ------------------------------------------------------------- utilities */

const mm = (value: number) => Math.round(value * PX_PER_MM);
const rectWidth = (r: Rect) => r.x1 - r.x0;
const rectHeight = (r: Rect) => r.y1 - r.y0;

function grow(r: Rect, by: number, limit: { width: number; height: number }): Rect {
  return {
    x0: Math.max(0, r.x0 - by),
    y0: Math.max(0, r.y0 - by),
    x1: Math.min(limit.width, r.x1 + by),
    y1: Math.min(limit.height, r.y1 + by),
  };
}

function gapBetween(a: Rect, b: Rect): number {
  const dx = Math.max(0, a.x0 - b.x1, b.x0 - a.x1);
  const dy = Math.max(0, a.y0 - b.y1, b.y0 - a.y1);
  return Math.hypot(dx, dy);
}

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function bytesKey(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function newBits(width: number, height: number): Bits {
  return { width, height, data: new Uint8Array(width * height) };
}

function blit(target: Bits, source: Bits, x: number, y: number): void {
  for (let row = 0; row < source.height; row++) {
    const ty = y + row;
    if (ty < 0 || ty >= target.height) continue;
    for (let col = 0; col < source.width; col++) {
      const tx = x + col;
      if (tx < 0 || tx >= target.width) continue;
      if (source.data[row * source.width + col]) {
        target.data[ty * target.width + tx] = 1;
      }
    }
  }
}

function fill(target: Bits, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = Math.max(0, y0); y < Math.min(target.height, y1); y++) {
    target.data.fill(1, y * target.width + Math.max(0, x0), y * target.width + Math.min(target.width, x1));
  }
}

/** Quarter turn clockwise. */
function rotateClockwise(bits: Bits): Bits {
  const out = newBits(bits.height, bits.width);
  for (let y = 0; y < bits.height; y++) {
    for (let x = 0; x < bits.width; x++) {
      out.data[x * out.width + (bits.height - 1 - y)] = bits.data[y * bits.width + x];
    }
  }
  return out;
}

function bitsToCanvas(bits: Bits): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = bits.width;
  canvas.height = bits.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context is not available.");
  const image = context.createImageData(bits.width, bits.height);
  for (let i = 0; i < bits.data.length; i++) {
    const value = bits.data[i] ? 0 : 255;
    image.data[i * 4] = value;
    image.data[i * 4 + 1] = value;
    image.data[i * 4 + 2] = value;
    image.data[i * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

function readRaster(canvas: HTMLCanvasElement): Raster {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas 2D context is not available.");
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  const size = canvas.width * canvas.height;
  const lum = new Uint8Array(size);
  const ink = new Uint8Array(size);
  const paper = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const l = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    lum[i] = l;
    // Saturated colour (a red banner) counts as artwork; pale tints (box rules) don't.
    const saturation = Math.max(r, g, b) - Math.min(r, g, b);
    ink[i] = l < 170 || (saturation > 90 && l < 200) ? 1 : 0;
    paper[i] = l < 242 ? 1 : 0;
  }
  return { width: canvas.width, height: canvas.height, lum, ink, paper };
}

function inkBounds(mask: Uint8Array, width: number, area: Rect): Rect | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (let y = area.y0; y < area.y1; y++) {
    for (let x = area.x0; x < area.x1; x++) {
      if (mask[y * width + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/** Area-averaged downscale of a luminance region, thresholded to dots. */
function regionToBits(raster: Raster, area: Rect, scale: number): Bits {
  const sw = rectWidth(area);
  const sh = rectHeight(area);
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));
  const sx = sw / dw;
  const sy = sh / dh;

  const horizontal = new Float32Array(dw * sh);
  for (let y = 0; y < sh; y++) {
    const row = (area.y0 + y) * raster.width + area.x0;
    for (let i = 0; i < dw; i++) {
      const start = i * sx;
      const end = start + sx;
      let sum = 0;
      for (let k = Math.floor(start); k < Math.ceil(end); k++) {
        const weight = Math.min(end, k + 1) - Math.max(start, k);
        sum += raster.lum[row + Math.min(sw - 1, k)] * weight;
      }
      horizontal[y * dw + i] = sum / sx;
    }
  }

  const out = newBits(dw, dh);
  for (let j = 0; j < dh; j++) {
    const start = j * sy;
    const end = start + sy;
    for (let i = 0; i < dw; i++) {
      let sum = 0;
      for (let k = Math.floor(start); k < Math.ceil(end); k++) {
        const weight = Math.min(end, k + 1) - Math.max(start, k);
        sum += horizontal[Math.min(sh - 1, k) * dw + i] * weight;
      }
      out.data[j * dw + i] = sum / sy < PRINT_THRESHOLD ? 1 : 0;
    }
  }
  return out;
}

/* --------------------------------------------------------------- barcodes */

let zxingReady: Promise<typeof import("zxing-wasm/reader")> | null = null;

function loadZxing(): Promise<typeof import("zxing-wasm/reader")> {
  zxingReady ??= Promise.all([
    import("zxing-wasm/reader"),
    import("zxing-wasm/reader/zxing_reader.wasm?url"),
  ]).then(([zxing, wasm]) => {
    // Serve the decoder from this site rather than the package's CDN default.
    zxing.prepareZXingModule({
      overrides: {
        locateFile: (path: string, prefix: string) =>
          path.endsWith(".wasm") ? wasm.default : prefix + path,
      },
    });
    return zxing;
  });
  return zxingReady;
}

async function decode(canvas: HTMLCanvasElement) {
  const zxing = await loadZxing();
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas 2D context is not available.");
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const results = await zxing.readBarcodes(image, {
    formats: [],
    tryHarder: true,
    tryRotate: true,
    maxNumberOfSymbols: 32,
  });
  return results.filter((result) => result.isValid);
}

type ReadResult = Awaited<ReturnType<typeof decode>>[number];

function resultRect(result: ReadResult): Rect {
  const { topLeft, topRight, bottomLeft, bottomRight } = result.position;
  const xs = [topLeft.x, topRight.x, bottomLeft.x, bottomRight.x];
  const ys = [topLeft.y, topRight.y, bottomLeft.y, bottomRight.y];
  return {
    x0: Math.floor(Math.min(...xs)),
    y0: Math.floor(Math.min(...ys)),
    x1: Math.ceil(Math.max(...xs)) + 1,
    y1: Math.ceil(Math.max(...ys)) + 1,
  };
}

/** Snaps measured run widths (px) to whole modules, choosing the module count that fits best. */
function quantizeRuns(widths: number[]): number[] | null {
  const total = widths.reduce((sum, w) => sum + w, 0);
  const narrow = Math.min(...widths);
  if (narrow <= 0) return null;
  let best: number[] | null = null;
  let bestError = Infinity;
  const low = Math.max(widths.length, Math.floor(total / (narrow * 1.7)));
  const high = Math.ceil(total / (narrow * 0.6));
  for (let modules = low; modules <= high; modules++) {
    const size = total / modules;
    const snapped = widths.map((w) => Math.max(1, Math.round(w / size)));
    const sum = snapped.reduce((acc, q) => acc + q, 0);
    if (sum !== modules) continue;
    const error = widths.reduce((acc, w, i) => acc + (w / size - snapped[i]) ** 2, 0) / widths.length;
    if (error < bestError - 1e-9) {
      bestError = error;
      best = snapped;
    }
  }
  return best && bestError < 0.06 ? best : null;
}

function measureLinear(raster: Raster, result: ReadResult, rect: Rect): LinearCode {
  const { topLeft, topRight, bottomLeft, bottomRight } = result.position;
  const axisX = (topRight.x + bottomRight.x - topLeft.x - bottomLeft.x) / 2;
  const axisY = (topRight.y + bottomRight.y - topLeft.y - bottomLeft.y) / 2;
  const vertical = Math.abs(axisY) > Math.abs(axisX);
  const skew = Math.abs(vertical ? axisX / axisY : axisY / axisX);
  if (skew > 0.03) {
    throw new Error(`The ${result.format} barcode is printed at an angle; only straight labels are supported.`);
  }

  const pad = mm(1.5);
  const votes = new Map<string, { runs: number[]; count: number }>();
  let lines = 0;
  for (let t = 0.15; t <= 0.85; t += 0.0875) {
    lines++;
    const across = vertical
      ? Math.round(rect.x0 + rectWidth(rect) * t)
      : Math.round(rect.y0 + rectHeight(rect) * t);
    const start = Math.max(0, (vertical ? rect.y0 : rect.x0) - pad);
    const end = Math.min(vertical ? raster.height : raster.width, (vertical ? rect.y1 : rect.x1) + pad);

    const widths: number[] = [];
    let current = -1;
    for (let p = start; p < end; p++) {
      const index = vertical ? p * raster.width + across : across * raster.width + p;
      const dark = raster.lum[index] < 128 ? 1 : 0;
      if (dark === current) widths[widths.length - 1]++;
      else {
        widths.push(1);
        current = dark;
      }
    }
    // Drop the quiet zones: the sampled line starts and ends on paper.
    const firstDark = raster.lum[vertical ? start * raster.width + across : across * raster.width + start] < 128;
    if (!firstDark) widths.shift();
    if (widths.length % 2 === 0) widths.pop();
    if (widths.length < 5) continue;

    const runs = quantizeRuns(widths);
    if (!runs) continue;
    const key = runs.join(",");
    const vote = votes.get(key) ?? { runs, count: 0 };
    vote.count++;
    votes.set(key, vote);
  }

  const winner = [...votes.values()].sort((a, b) => b.count - a.count)[0];
  if (!winner || winner.count < Math.max(3, lines / 2)) {
    throw new Error(`Could not measure the ${result.format} bars cleanly enough to redraw them.`);
  }

  const modules = winner.runs.reduce((sum, q) => sum + q, 0);
  const lengthPx = vertical ? rectHeight(rect) : rectWidth(rect);
  return {
    kind: "linear",
    format: result.format,
    text: result.text,
    bytes: bytesKey(result.bytes),
    rect,
    runs: winner.runs,
    vertical,
    moduleMm: lengthPx / modules / PX_PER_MM,
  };
}

function readMatrix(result: ReadResult, rect: Rect): MatrixCode {
  const symbol = result.symbol;
  if (!symbol || symbol.width < 2 || symbol.height < 2) {
    throw new Error(`The ${result.format} code's module grid is not available.`);
  }
  const modules = newBits(symbol.width, symbol.height);
  for (let i = 0; i < modules.data.length; i++) {
    modules.data[i] = symbol.data[i] < 128 ? 1 : 0;
  }
  return {
    kind: "matrix",
    format: result.format,
    text: result.text,
    bytes: bytesKey(result.bytes),
    rect,
    modules,
    moduleMm: Math.max(rectWidth(rect), rectHeight(rect)) / Math.max(symbol.width, symbol.height) / PX_PER_MM,
  };
}

/* ----------------------------------------------------------------- layout */

type Line = Rect;

/** Thin straight rules (box borders) at least `minLength` long. */
function findLines(raster: Raster, area: Rect, horizontal: boolean): Line[] {
  const minLength = mm(20);
  const maxThickness = mm(1.2);
  const lines: Line[] = [];
  const outerStart = horizontal ? area.y0 : area.x0;
  const outerEnd = horizontal ? area.y1 : area.x1;
  let open: Line | null = null;

  for (let o = outerStart; o < outerEnd; o++) {
    let bestStart = 0;
    let bestLength = 0;
    let runStart = 0;
    let run = 0;
    const innerStart = horizontal ? area.x0 : area.y0;
    const innerEnd = horizontal ? area.x1 : area.y1;
    for (let i = innerStart; i < innerEnd; i++) {
      const index = horizontal ? o * raster.width + i : i * raster.width + o;
      if (raster.paper[index]) {
        if (run === 0) runStart = i;
        run++;
        if (run > bestLength) {
          bestLength = run;
          bestStart = runStart;
        }
      } else run = 0;
    }

    if (bestLength >= minLength) {
      const a = bestStart;
      const b = bestStart + bestLength;
      if (open) {
        if (horizontal) {
          open.y1 = o + 1;
          open.x0 = Math.min(open.x0, a);
          open.x1 = Math.max(open.x1, b);
        } else {
          open.x1 = o + 1;
          open.y0 = Math.min(open.y0, a);
          open.y1 = Math.max(open.y1, b);
        }
      } else {
        open = horizontal
          ? { x0: a, x1: b, y0: o, y1: o + 1 }
          : { y0: a, y1: b, x0: o, x1: o + 1 };
      }
    } else if (open) {
      const thickness = horizontal ? rectHeight(open) : rectWidth(open);
      if (thickness <= maxThickness) lines.push(open);
      open = null;
    }
  }
  if (open && (horizontal ? rectHeight(open) : rectWidth(open)) <= maxThickness) lines.push(open);
  return lines;
}

function clearRect(mask: Uint8Array, width: number, r: Rect): void {
  for (let y = r.y0; y < r.y1; y++) mask.fill(0, y * width + r.x0, y * width + r.x1);
}

function rowHasInk(raster: Raster, y: number, x0: number, x1: number): boolean {
  const row = y * raster.width;
  for (let x = x0; x < x1; x++) if (raster.ink[row + x]) return true;
  return false;
}

function columnHasInk(raster: Raster, x: number, y0: number, y1: number): boolean {
  for (let y = y0; y < y1; y++) if (raster.ink[y * raster.width + x]) return true;
  return false;
}

/** Splits an area into ink bands separated by blank runs of at least `gap` (and by `cuts`). */
function bands(
  raster: Raster,
  area: Rect,
  horizontal: boolean,
  gap: number,
  cuts: number[] = [],
): { start: number; end: number; ruledBefore: boolean }[] {
  const result: { start: number; end: number; ruledBefore: boolean }[] = [];
  const from = horizontal ? area.y0 : area.x0;
  const to = horizontal ? area.y1 : area.x1;
  let start = -1;
  let lastInk = -1;
  let ruled = false;
  const cutSet = new Set(cuts);

  for (let p = from; p < to; p++) {
    if (cutSet.has(p)) {
      if (start >= 0) result.push({ start, end: lastInk + 1, ruledBefore: ruled });
      start = -1;
      ruled = true;
      continue;
    }
    const ink = horizontal
      ? rowHasInk(raster, p, area.x0, area.x1)
      : columnHasInk(raster, p, area.y0, area.y1);
    if (!ink) continue;
    if (start >= 0 && p - lastInk > gap) {
      result.push({ start, end: lastInk + 1, ruledBefore: ruled });
      ruled = false;
      start = p;
    }
    if (start < 0) start = p;
    lastInk = p;
  }
  if (start >= 0) result.push({ start, end: lastInk + 1, ruledBefore: ruled });
  return result;
}

/** Recursive XY-cut into leaf blocks. */
function xyCut(raster: Raster, area: Rect, gap: number, depth = 0): Rect[] {
  const tight = inkBounds(raster.ink, raster.width, area);
  if (!tight) return [];
  if (depth > 8) return [tight];
  const rows = bands(raster, tight, true, gap);
  if (rows.length > 1) {
    return rows.flatMap((band) =>
      xyCut(raster, { ...tight, y0: band.start, y1: band.end }, gap, depth + 1),
    );
  }
  const columns = bands(raster, tight, false, gap);
  if (columns.length > 1) {
    return columns.flatMap((band) =>
      xyCut(raster, { ...tight, x0: band.start, x1: band.end }, gap, depth + 1),
    );
  }
  return [tight];
}

/* ---------------------------------------------------------------- compose */

interface Piece {
  bits: Bits;
  align: "left" | "center";
  gapAfter: number;
}

function linearAssembly(raster: Raster, code: LinearCode, captions: Rect[]): Bits {
  const dotsPerModule = Math.max(2, Math.ceil(code.moduleMm * DOTS_PER_MM - 0.2));
  const modules = code.runs.reduce((sum, q) => sum + q, 0);
  const barLength = modules * dotsPerModule;
  const quiet = 10 * dotsPerModule;
  const codeLength = code.vertical ? rectHeight(code.rect) : rectWidth(code.rect);

  // Captions keep their side of the barcode; horizontal codes turn a quarter clockwise.
  const sides = captions.map((caption) => {
    let bits = regionToBits(raster, caption, NATURAL);
    if (!code.vertical) bits = rotateClockwise(bits);
    if (bits.width > CONTENT_WIDTH * 0.3) {
      bits = regionToBits(raster, caption, (NATURAL * CONTENT_WIDTH * 0.3) / bits.width);
      if (!code.vertical) bits = rotateClockwise(bits);
    }
    const before = code.vertical ? caption.x1 <= code.rect.x0 : caption.y1 > code.rect.y1;
    const along = code.vertical ? caption.y0 - code.rect.y0 : caption.x0 - code.rect.x0;
    const offset = Math.round((along / codeLength) * barLength);
    return { bits, before, offset };
  });

  const gap = 8;
  const leftWidth = Math.max(0, ...sides.filter((s) => s.before).map((s) => s.bits.width + gap));
  const rightWidth = Math.max(0, ...sides.filter((s) => !s.before).map((s) => s.bits.width + gap));
  const barWidth = CONTENT_WIDTH - leftWidth - rightWidth;
  if (barWidth < 120) throw new Error("Not enough room across the paper for the barcode.");

  const out = newBits(CONTENT_WIDTH, barLength + quiet * 2);
  let y = quiet;
  code.runs.forEach((width, index) => {
    if (index % 2 === 0) fill(out, leftWidth, y, leftWidth + barWidth, y + width * dotsPerModule);
    y += width * dotsPerModule;
  });

  for (const side of sides) {
    const x = side.before ? leftWidth - gap - side.bits.width : leftWidth + barWidth + gap;
    const top = quiet + Math.max(0, Math.min(barLength - side.bits.height, side.offset));
    blit(out, side.bits, x, top);
  }
  return out;
}

function matrixAssembly(raster: Raster, code: MatrixCode, captions: Rect[]): Bits {
  const quietModules = MATRIX_QUIET_MODULES[code.format] ?? 2;
  const span = Math.max(code.modules.width, code.modules.height) + quietModules * 2;
  const largest = Math.floor(CONTENT_WIDTH / span);
  const dotsPerModule = Math.min(largest, Math.max(3, Math.round(code.moduleMm * DOTS_PER_MM)));
  if (dotsPerModule < 2) throw new Error(`The ${code.format} code is too dense for a 48 mm head.`);

  const symbol = newBits(code.modules.width * dotsPerModule, code.modules.height * dotsPerModule);
  for (let y = 0; y < code.modules.height; y++) {
    for (let x = 0; x < code.modules.width; x++) {
      if (code.modules.data[y * code.modules.width + x]) {
        fill(symbol, x * dotsPerModule, y * dotsPerModule, (x + 1) * dotsPerModule, (y + 1) * dotsPerModule);
      }
    }
  }
  const quiet = quietModules * dotsPerModule;
  const boxWidth = symbol.width + quiet * 2;
  const boxHeight = symbol.height + quiet * 2;

  // Captions sit to the left of the code when they fit at a readable size, otherwise above.
  const room = CONTENT_WIDTH - boxWidth - 8;
  const besideCaptions = captions.map((caption) =>
    regionToBits(raster, caption, Math.min(NATURAL * 1.2, room / Math.max(1, rectWidth(caption)))),
  );
  const fitsBeside =
    room > 60 &&
    besideCaptions.every((bits, i) => bits.width >= rectWidth(captions[i]) * NATURAL * 0.6);

  if (fitsBeside) {
    const stack = besideCaptions.reduce((sum, bits) => sum + bits.height + 6, 0);
    const out = newBits(CONTENT_WIDTH, Math.max(boxHeight, stack));
    let y = Math.max(0, Math.round((out.height - stack) / 2));
    for (const bits of besideCaptions) {
      blit(out, bits, 0, y);
      y += bits.height + 6;
    }
    blit(out, symbol, CONTENT_WIDTH - boxWidth + quiet, Math.round((out.height - symbol.height) / 2));
    return out;
  }

  const above = captions.map((caption) =>
    regionToBits(raster, caption, Math.min(NATURAL * 1.2, CONTENT_WIDTH / rectWidth(caption))),
  );
  const stack = above.reduce((sum, bits) => sum + bits.height + 6, 0);
  const out = newBits(CONTENT_WIDTH, stack + boxHeight);
  let y = 0;
  for (const bits of above) {
    blit(out, bits, Math.round((CONTENT_WIDTH - bits.width) / 2), y);
    y += bits.height + 6;
  }
  blit(out, symbol, Math.round((CONTENT_WIDTH - symbol.width) / 2), y + quiet);
  return out;
}

function assemble(pieces: Piece[]): Bits {
  const top = 8;
  const height = top + pieces.reduce((sum, piece) => sum + piece.bits.height + piece.gapAfter, 0) + 8;
  if (height > MAX_LABEL_DOTS) throw new Error("The converted label would be longer than 50 cm.");
  const out = newBits(PRINTER_WIDTH, height);
  let y = top;
  for (const piece of pieces) {
    const x = MARGIN + (piece.align === "center" ? Math.round((CONTENT_WIDTH - piece.bits.width) / 2) : 0);
    blit(out, piece.bits, x, y);
    y += piece.bits.height + piece.gapAfter;
  }
  return out;
}

function rule(): Bits {
  const bits = newBits(CONTENT_WIDTH, 2);
  bits.data.fill(1);
  return bits;
}

/* ------------------------------------------------------------------- main */

async function convertRegion(canvas: HTMLCanvasElement): Promise<{ bits: Bits; codes: Code[] } | null> {
  const results = await decode(canvas);
  if (results.length === 0) return null;

  const raster = readRaster(canvas);
  const all: Rect = { x0: 0, y0: 0, x1: raster.width, y1: raster.height };
  const label = inkBounds(raster.paper, raster.width, all) ?? all;

  const codes: Code[] = results.map((result) => {
    const rect = resultRect(result);
    const linear = !result.symbol || result.symbol.height <= 1 || /^(Code|EAN|UPC|ITF|Codabar|DataBar|DXFilmEdge)/.test(result.format);
    return linear ? measureLinear(raster, result, rect) : readMatrix(result, rect);
  });

  // Codes are redrawn separately; take them out of the artwork.
  for (const code of codes) {
    const area = grow(code.rect, mm(0.6), raster);
    clearRect(raster.ink, raster.width, area);
    clearRect(raster.paper, raster.width, area);
  }

  // Box borders become cut lines, never artwork.
  const horizontalLines = findLines(raster, label, true);
  const verticalLines = findLines(raster, label, false);
  for (const line of [...horizontalLines, ...verticalLines]) {
    clearRect(raster.ink, raster.width, grow(line, 1, raster));
  }

  // Where the address column ends and the barcode column begins.
  const codeLeft = Math.min(...codes.map((code) => code.rect.x0));
  const codeTop = Math.min(...codes.map((code) => code.rect.y0));
  const codeBottom = Math.max(...codes.map((code) => code.rect.y1));
  const divider = verticalLines
    .filter((line) => line.x1 <= codeLeft && codeLeft - line.x1 < mm(15) && rectHeight(line) > rectHeight(label) * 0.3)
    .sort((a, b) => b.x1 - a.x1)[0];
  let split = divider?.x1 ?? codeLeft;
  if (!divider) {
    // No rule: back off to the first wide blank column left of the codes.
    let blank = 0;
    for (let x = codeLeft - 1; x > label.x0; x--) {
      blank = columnHasInk(raster, x, codeTop, codeBottom) ? 0 : blank + 1;
      if (blank >= mm(2.5)) {
        split = x + blank;
        break;
      }
    }
  }
  const hasColumn = split - label.x0 > mm(15);

  // A header is a top band whose artwork runs across both columns.
  const firstBand = bands(raster, label, true, mm(1), horizontalLines.map((line) => line.y0))[0];
  let headerBottom = label.y0;
  let header: Rect | null = null;
  if (firstBand && hasColumn) {
    const band = { ...label, y0: firstBand.start, y1: firstBand.end };
    const left = inkBounds(raster.ink, raster.width, { ...band, x1: split - mm(2) });
    const right = inkBounds(raster.ink, raster.width, { ...band, x0: split + mm(2) });
    if (left && right && rectHeight(band) < rectHeight(label) * 0.25) {
      header = inkBounds(raster.ink, raster.width, band);
      headerBottom = band.y1;
    }
  }

  // Address column: one block per ruled box.
  const columnBlocks: Block[] = [];
  if (hasColumn) {
    const column: Rect = { x0: label.x0, y0: headerBottom, x1: split, y1: label.y1 };
    const cuts = horizontalLines
      .filter((line) => overlap(line.x0, line.x1, column.x0, column.x1) > rectWidth(column) * 0.5)
      .flatMap((line) => Array.from({ length: rectHeight(line) + 2 }, (_, i) => line.y0 - 1 + i));
    // Ruled boxes are kept whole; without rules, fall back to big blank gaps.
    const gap = cuts.length > 0 ? Infinity : mm(5);
    for (const band of bands(raster, column, true, gap, cuts)) {
      const rect = inkBounds(raster.ink, raster.width, { ...column, y0: band.start, y1: band.end });
      if (rect) columnBlocks.push({ rect, ruledBefore: band.ruledBefore });
    }
  }

  // Everything else: small blocks, attached to the nearest code when they are its caption.
  const rest: Rect = { x0: hasColumn ? split : label.x0, y0: headerBottom, x1: label.x1, y1: label.y1 };
  const captions = new Map<Code, Rect[]>(codes.map((code) => [code, []]));
  const loose: Rect[] = [];
  for (const rect of xyCut(raster, rest, mm(1.5))) {
    let owner: Code | null = null;
    let nearest = mm(6);
    for (const code of codes) {
      const distance = gapBetween(rect, code.rect);
      if (distance > nearest) continue;
      if (code.kind === "linear") {
        const alongCode = code.vertical
          ? overlap(rect.y0, rect.y1, code.rect.y0, code.rect.y1) >= rectHeight(rect) * 0.5
          : overlap(rect.x0, rect.x1, code.rect.x0, code.rect.x1) >= rectWidth(rect) * 0.5;
        if (!alongCode) continue;
      }
      owner = code;
      nearest = distance;
    }
    if (owner) captions.get(owner)?.push(rect);
    else loose.push(rect);
  }

  const pieces: Piece[] = [];
  if (header) {
    pieces.push({
      bits: regionToBits(raster, header, Math.min(NATURAL * 1.5, CONTENT_WIDTH / rectWidth(header))),
      align: "center",
      gapAfter: 10,
    });
  }

  const byPosition = (a: Code, b: Code) => a.rect.y0 - b.rect.y0 || a.rect.x0 - b.rect.x0;
  for (const code of codes.filter((c): c is MatrixCode => c.kind === "matrix").sort(byPosition)) {
    pieces.push({ bits: matrixAssembly(raster, code, captions.get(code) ?? []), align: "left", gapAfter: 10 });
  }

  const textBlocks: Block[] = [
    ...columnBlocks,
    ...loose.sort((a, b) => a.y0 - b.y0).map((rect) => ({ rect, ruledBefore: true })),
  ];
  textBlocks.forEach((block, index) => {
    if (index === 0 || block.ruledBefore) pieces.push({ bits: rule(), align: "left", gapAfter: 10 });
    const scale = Math.min(NATURAL, CONTENT_WIDTH / rectWidth(block.rect));
    pieces.push({ bits: regionToBits(raster, block.rect, scale), align: "left", gapAfter: 8 });
  });

  const linear = codes.filter((c): c is LinearCode => c.kind === "linear").sort(byPosition);
  if (linear.length > 0) pieces.push({ bits: rule(), align: "left", gapAfter: 4 });
  for (const code of linear) {
    pieces.push({ bits: linearAssembly(raster, code, captions.get(code) ?? []), align: "left", gapAfter: 4 });
  }

  return { bits: assemble(pieces), codes };
}

/** Finds label-sized clusters of artwork on a page, in millimetres. */
async function findLabels(canvas: HTMLCanvasElement): Promise<{ x: number; y: number; width: number; height: number }[]> {
  const raster = readRaster(canvas);
  const cell = SCAN_PX_PER_MM; // 1 mm cells
  const cols = Math.ceil(raster.width / cell);
  const rows = Math.ceil(raster.height / cell);
  const occupied = new Uint8Array(cols * rows);
  for (let y = 0; y < raster.height; y++) {
    for (let x = 0; x < raster.width; x++) {
      if (raster.paper[y * raster.width + x]) occupied[Math.floor(y / cell) * cols + Math.floor(x / cell)] = 1;
    }
  }

  // Bridge the small gaps inside a label (3 mm), not the margins between labels.
  const reach = 3;
  const grown = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!occupied[y * cols + x]) continue;
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < cols && ny < rows) grown[ny * cols + nx] = 1;
        }
      }
    }
  }

  const seen = new Uint8Array(cols * rows);
  const found: { x: number; y: number; width: number; height: number }[] = [];
  for (let start = 0; start < grown.length; start++) {
    if (!grown[start] || seen[start]) continue;
    let x0 = cols, y0 = rows, x1 = 0, y1 = 0;
    const queue = [start];
    seen[start] = 1;
    while (queue.length) {
      const index = queue.pop()!;
      const x = index % cols;
      const y = Math.floor(index / cols);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1);
      for (const next of [index - 1, index + 1, index - cols, index + cols]) {
        if (next < 0 || next >= grown.length || seen[next] || !grown[next]) continue;
        if (Math.abs((next % cols) - x) > 1) continue;
        seen[next] = 1;
        queue.push(next);
      }
    }
    // The dilation added `reach` mm on each side; keep it as a margin.
    if (x1 - x0 >= 30 && y1 - y0 >= 30) {
      found.push({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
    }
  }
  return found.sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * Converts every barcoded label in a PDF. Throws if none is found, or if a
 * converted label does not decode back to exactly the original codes.
 */
export async function convertPostagePdf(
  file: File,
  onStatus: (message: string) => void = () => {},
): Promise<ConvertedLabel[]> {
  const pdf = await openPdf(file);
  const labels: ConvertedLabel[] = [];
  try {
    for (let number = 1; number <= pdf.numPages; number++) {
      onStatus(`Looking for labels on page ${number}…`);
      const overview = await pdf.render(number, SCAN_PX_PER_MM);
      const regions = await findLabels(overview);

      for (const region of regions) {
        const canvas = await pdf.render(number, PX_PER_MM, region);
        const converted = await convertRegion(canvas);
        if (!converted) continue;

        const output = bitsToCanvas(converted.bits);
        onStatus("Checking the converted barcodes…");
        await verify(output, converted.codes);
        labels.push({
          canvas: output,
          page: number,
          codes: converted.codes.map(({ format, text }) => ({ format, text })),
        });
      }
    }
  } finally {
    await pdf.close();
  }

  if (labels.length === 0) {
    throw new Error("No barcoded label found in this PDF.");
  }
  return labels;
}

/** Every original code must read back from the strip with identical bytes. */
async function verify(output: HTMLCanvasElement, codes: Code[]): Promise<void> {
  // Decode a 2× copy so module edges are unambiguous.
  const big = document.createElement("canvas");
  big.width = output.width * 2;
  big.height = output.height * 2;
  const context = big.getContext("2d");
  if (!context) throw new Error("Canvas 2D context is not available.");
  context.imageSmoothingEnabled = false;
  context.drawImage(output, 0, 0, big.width, big.height);

  const found = await decode(big);
  const remaining = found.map((result) => `${result.format}:${bytesKey(result.bytes)}`);
  for (const code of codes) {
    const index = remaining.indexOf(`${code.format}:${code.bytes}`);
    if (index < 0) {
      throw new Error(`The converted ${code.format} did not read back as the original (${code.text}). Not printing it.`);
    }
    remaining.splice(index, 1);
  }
}
