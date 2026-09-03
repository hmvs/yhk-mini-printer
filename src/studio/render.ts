import QRCode from "qrcode";
import { PRINTER_WIDTH } from "@shared/constants.ts";
import { drawBorder } from "./borders.ts";
import { renderSticker } from "./stickers.ts";
import {
  createCanvas,
  imageRasterKey,
  pixelsToCanvas,
  rasterizeImage,
} from "./raster.ts";
import {
  PAGE_MAX_HEIGHT,
  PAGE_MIN_HEIGHT,
  type QrElement,
  type RuleElement,
  type StickerElement,
  type StudioDocument,
  type StudioElement,
  type TextElement,
} from "./types.ts";

export interface RenderResources {
  /** Decoded source images, keyed by `ImageElement.sourceId`. */
  sources: Map<string, HTMLCanvasElement>;
}

export interface PageRender {
  /** 1-bit page, exactly what the printer will burn. */
  canvas: HTMLCanvasElement;
  pixels: boolean[][];
  width: number;
  height: number;
  coverage: number;
}

const FONT_STACKS: Record<TextElement["fontFamily"], string> = {
  sans: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
};

const TEXT_PADDING = 4;

const rasterCache = new Map<string, HTMLCanvasElement>();
const measureContext = createCanvas(8, 8).context;

export function clearRasterCache(): void {
  rasterCache.clear();
}

export function textFont(element: TextElement): string {
  const style = element.italic ? "italic " : "";
  const weight = element.bold ? "bold " : "";
  return `${style}${weight}${element.fontSize}px ${FONT_STACKS[element.fontFamily]}`;
}

function wrapLines(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];

  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }

    let current = words[0] as string;
    for (const word of words.slice(1)) {
      const candidate = `${current} ${word}`;
      if (context.measureText(candidate).width <= maxWidth) {
        current = candidate;
        continue;
      }
      lines.push(current);
      current = word;
    }
    lines.push(current);
  }

  return lines;
}

export interface TextLayout {
  lines: string[];
  lineHeight: number;
  height: number;
}

export function layoutText(element: TextElement): TextLayout {
  measureContext.font = textFont(element);
  const lines = wrapLines(
    measureContext,
    element.text,
    Math.max(8, element.width - TEXT_PADDING * 2),
  );
  const lineHeight = Math.round(element.fontSize * element.lineSpacing);
  return {
    lines,
    lineHeight,
    height: Math.max(lineHeight, lines.length * lineHeight) + TEXT_PADDING * 2,
  };
}

/** Text boxes are as tall as their wrapped content. */
export function elementHeight(element: StudioElement): number {
  return element.type === "text" ? layoutText(element).height : element.height;
}

/** Axis-aligned bounds after rotation, in page dots. */
export function elementBounds(element: StudioElement): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const width = element.width;
  const height = elementHeight(element);
  if (element.rotation === 0) {
    return { x: element.x, y: element.y, width, height };
  }

  const radians = (element.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const boundsWidth = width * cos + height * sin;
  const boundsHeight = width * sin + height * cos;
  const centerX = element.x + width / 2;
  const centerY = element.y + height / 2;

  return {
    x: centerX - boundsWidth / 2,
    y: centerY - boundsHeight / 2,
    width: boundsWidth,
    height: boundsHeight,
  };
}

/** The page grows with its content and shrinks back when elements move up. */
export function documentHeight(document_: StudioDocument): number {
  let bottom = 0;
  for (const element of document_.elements) {
    const bounds = elementBounds(element);
    bottom = Math.max(bottom, bounds.y + bounds.height);
  }

  const height = Math.round(bottom + document_.bottomMargin);
  return Math.min(
    PAGE_MAX_HEIGHT,
    Math.max(PAGE_MIN_HEIGHT, document_.minHeight, height),
  );
}

function drawText(
  context: CanvasRenderingContext2D,
  element: TextElement,
): void {
  const layout = layoutText(element);

  if (element.invert) {
    context.fillStyle = "#000000";
    context.fillRect(0, 0, element.width, layout.height);
  }

  context.fillStyle = element.invert ? "#ffffff" : "#000000";
  context.textBaseline = "top";
  context.textAlign = element.align;
  context.font = textFont(element);

  const x =
    element.align === "left"
      ? TEXT_PADDING
      : element.align === "right"
        ? element.width - TEXT_PADDING
        : element.width / 2;

  layout.lines.forEach((line, index) => {
    context.fillText(line, x, TEXT_PADDING + index * layout.lineHeight);
  });
}

function drawQr(
  context: CanvasRenderingContext2D,
  element: QrElement,
): void {
  const size = Math.max(16, Math.min(element.width, element.height));
  const data = element.data.trim();

  if (!data) {
    context.strokeStyle = "#000000";
    context.lineWidth = 2;
    context.strokeRect(1, 1, size - 2, size - 2);
    return;
  }

  const qr = QRCode.create(data, { errorCorrectionLevel: element.ecc });
  const modules = qr.modules;
  const quiet = 2;
  const total = modules.size + quiet * 2;
  // Integer module size keeps every cell identical after thresholding.
  const moduleSize = Math.max(1, Math.floor(size / total));
  const drawn = moduleSize * total;
  const offset = Math.round((size - drawn) / 2);

  context.fillStyle = "#ffffff";
  context.fillRect(offset, offset, drawn, drawn);
  context.fillStyle = "#000000";

  for (let y = 0; y < modules.size; y++) {
    for (let x = 0; x < modules.size; x++) {
      if (!modules.get(x, y)) continue;
      context.fillRect(
        offset + (x + quiet) * moduleSize,
        offset + (y + quiet) * moduleSize,
        moduleSize,
        moduleSize,
      );
    }
  }
}

function drawRule(
  context: CanvasRenderingContext2D,
  element: RuleElement,
): void {
  const y = element.height / 2;
  context.strokeStyle = "#000000";
  context.lineWidth = element.thickness;
  context.lineCap = "butt";
  context.save();

  switch (element.style) {
    case "dashed":
      context.setLineDash([10, 7]);
      break;
    case "dotted":
      context.setLineDash([2, 6]);
      context.lineCap = "round";
      break;
    default:
      break;
  }

  if (element.style === "wave") {
    context.beginPath();
    for (let x = 0; x <= element.width; x += 2) {
      const offset = Math.sin((x / 14) * Math.PI) * (element.thickness * 1.6);
      if (x === 0) context.moveTo(x, y + offset);
      else context.lineTo(x, y + offset);
    }
    context.stroke();
  } else if (element.style === "double") {
    const gap = Math.max(3, element.thickness * 1.5);
    for (const offset of [-gap / 2, gap / 2]) {
      context.beginPath();
      context.moveTo(0, y + offset);
      context.lineTo(element.width, y + offset);
      context.stroke();
    }
  } else {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(element.width, y);
    context.stroke();
  }

  context.restore();
}

function drawStickerElement(
  context: CanvasRenderingContext2D,
  element: StickerElement,
): void {
  const sticker = renderSticker(
    element.sticker,
    Math.max(4, Math.round(element.width)),
    Math.max(4, Math.round(element.height)),
    element.invert,
  );
  context.drawImage(sticker, 0, 0, element.width, element.height);
}

function drawImageElement(
  context: CanvasRenderingContext2D,
  element: Extract<StudioElement, { type: "image" }>,
  resources: RenderResources,
): void {
  const source = resources.sources.get(element.sourceId);
  if (!source) {
    context.strokeStyle = "#000000";
    context.lineWidth = 2;
    context.strokeRect(1, 1, element.width - 2, element.height - 2);
    return;
  }

  const width = Math.max(1, Math.round(element.width));
  const height = Math.max(1, Math.round(element.height));
  const key = imageRasterKey(element, width, height);

  let raster = rasterCache.get(key);
  if (!raster) {
    raster = rasterizeImage(source, element, width, height);
    if (rasterCache.size > 48) {
      rasterCache.clear();
    }
    rasterCache.set(key, raster);
  }

  context.imageSmoothingEnabled = false;
  context.drawImage(raster, 0, 0, element.width, element.height);
}

function drawElement(
  context: CanvasRenderingContext2D,
  element: StudioElement,
  resources: RenderResources,
): void {
  const height = elementHeight(element);
  context.save();
  context.translate(element.x + element.width / 2, element.y + height / 2);
  context.rotate((element.rotation * Math.PI) / 180);
  context.translate(-element.width / 2, -height / 2);

  switch (element.type) {
    case "text":
      drawText(context, element);
      break;
    case "image":
      drawImageElement(context, element, resources);
      break;
    case "sticker":
      drawStickerElement(context, element);
      break;
    case "qr":
      drawQr(context, element);
      break;
    case "rule":
      drawRule(context, element);
      break;
    default: {
      const unreachable: never = element;
      throw new Error(`Unsupported element: ${String(unreachable)}`);
    }
  }

  context.restore();
}

export function renderPage(
  document_: StudioDocument,
  resources: RenderResources,
  width = PRINTER_WIDTH,
): PageRender {
  const height = documentHeight(document_);
  const { context } = createCanvas(width, height, "#ffffff");

  for (const element of document_.elements) {
    drawElement(context, element, resources);
  }

  drawBorder(context, document_.border, width, height);

  // Everything is drawn as black on white; one threshold pass crisps the
  // antialiased text and shape edges into printable dots.
  const imageData = context.getImageData(0, 0, width, height);
  const pixels: boolean[][] = [];
  let dark = 0;

  for (let y = 0; y < height; y++) {
    const row = new Array<boolean>(width);
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const alpha = (imageData.data[index + 3] ?? 255) / 255;
      const red = imageData.data[index] ?? 255;
      const green = imageData.data[index + 1] ?? 255;
      const blue = imageData.data[index + 2] ?? 255;
      const luma = 0.299 * red + 0.587 * green + 0.114 * blue;
      // Unpainted pixels are transparent, i.e. paper white.
      const value = luma * alpha + 255 * (1 - alpha);
      const isDark = value < 128;
      row[x] = isDark;
      if (isDark) dark++;
    }
    pixels.push(row);
  }

  return {
    canvas: pixelsToCanvas(pixels),
    pixels,
    width,
    height,
    coverage: dark / Math.max(1, width * height),
  };
}
