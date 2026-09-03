import {
  applyToneAdjustments,
  halftoneGrayscale,
  imageDataToGrayscale,
} from "@shared/halftone.ts";
import type { CropRect, ImageElement } from "./types.ts";

export function createCanvas(
  width: number,
  height: number,
  background?: string,
): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("Canvas 2D context is not available.");
  }
  if (background) {
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  return { canvas, context };
}

export function clampCrop(
  crop: CropRect,
  sourceWidth: number,
  sourceHeight: number,
): CropRect {
  const x = Math.max(0, Math.min(Math.round(crop.x), sourceWidth - 1));
  const y = Math.max(0, Math.min(Math.round(crop.y), sourceHeight - 1));
  const width = Math.max(1, Math.min(Math.round(crop.width), sourceWidth - x));
  const height = Math.max(1, Math.min(Math.round(crop.height), sourceHeight - y));
  return { x, y, width, height };
}

function cropCanvas(
  source: HTMLCanvasElement,
  crop: CropRect | null,
): HTMLCanvasElement {
  if (!crop) return source;

  const rect = clampCrop(crop, source.width, source.height);
  if (
    rect.x === 0 &&
    rect.y === 0 &&
    rect.width === source.width &&
    rect.height === source.height
  ) {
    return source;
  }

  const { canvas, context } = createCanvas(rect.width, rect.height, "#ffffff");
  context.drawImage(
    source,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    rect.width,
    rect.height,
  );
  return canvas;
}

function flipCanvas(
  source: HTMLCanvasElement,
  horizontal: boolean,
  vertical: boolean,
): HTMLCanvasElement {
  if (!horizontal && !vertical) return source;

  const { canvas, context } = createCanvas(
    source.width,
    source.height,
    "#ffffff",
  );
  context.translate(horizontal ? source.width : 0, vertical ? source.height : 0);
  context.scale(horizontal ? -1 : 1, vertical ? -1 : 1);
  context.drawImage(source, 0, 0);
  return canvas;
}

/**
 * Halves repeatedly before the final draw — a single large downscale drops
 * detail that thermal dithering then exaggerates.
 */
export function resizeCanvas(
  source: HTMLCanvasElement,
  targetWidth: number,
  targetHeight: number,
): HTMLCanvasElement {
  let current = source;

  while (current.width >= targetWidth * 2 && current.height >= targetHeight * 2) {
    const { canvas, context } = createCanvas(
      Math.max(targetWidth, Math.floor(current.width / 2)),
      Math.max(targetHeight, Math.floor(current.height / 2)),
      "#ffffff",
    );
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(current, 0, 0, canvas.width, canvas.height);
    current = canvas;
  }

  if (current.width === targetWidth && current.height === targetHeight) {
    return current;
  }

  const { canvas, context } = createCanvas(
    targetWidth,
    targetHeight,
    "#ffffff",
  );
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(current, 0, 0, targetWidth, targetHeight);
  return canvas;
}

export function pixelsToCanvas(pixels: boolean[][]): HTMLCanvasElement {
  const height = pixels.length;
  const width = pixels[0]?.length ?? 0;
  const { canvas, context } = createCanvas(width, height, "#ffffff");
  const imageData = context.createImageData(
    Math.max(1, width),
    Math.max(1, height),
  );

  for (let y = 0; y < height; y++) {
    const row = pixels[y] ?? [];
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const value = row[x] ? 0 : 255;
      imageData.data[index] = value;
      imageData.data[index + 1] = value;
      imageData.data[index + 2] = value;
      imageData.data[index + 3] = 255;
    }
  }

  context.putImageData(imageData, 0, 0);
  return canvas;
}

/** Cache key covering every input that changes the dithered result. */
export function imageRasterKey(
  element: ImageElement,
  width: number,
  height: number,
): string {
  const crop = element.crop
    ? `${element.crop.x},${element.crop.y},${element.crop.width},${element.crop.height}`
    : "full";
  return [
    element.sourceId,
    width,
    height,
    crop,
    element.flipHorizontal,
    element.flipVertical,
    element.brightness,
    element.contrast,
    element.gamma,
    element.sharpen,
    element.autoLevel,
    element.invert,
    element.mode,
    element.threshold,
  ].join("|");
}

/** Crop → flip → resize → tone → halftone, at the element's placed size. */
export function rasterizeImage(
  source: HTMLCanvasElement,
  element: ImageElement,
  width: number,
  height: number,
): HTMLCanvasElement {
  const targetWidth = Math.max(1, Math.round(width));
  const targetHeight = Math.max(1, Math.round(height));

  const prepared = flipCanvas(
    cropCanvas(source, element.crop),
    element.flipHorizontal,
    element.flipVertical,
  );
  const scaled = resizeCanvas(prepared, targetWidth, targetHeight);
  const context = scaled.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("Canvas 2D context is not available.");
  }

  const imageData = context.getImageData(0, 0, targetWidth, targetHeight);
  const grayscale = imageDataToGrayscale(
    imageData.data,
    targetWidth,
    targetHeight,
  );
  const adjusted = applyToneAdjustments(grayscale, targetWidth, targetHeight, {
    brightness: element.brightness,
    contrast: element.contrast,
    gamma: element.gamma,
    sharpen: element.sharpen,
    autoLevel: element.autoLevel,
    invert: element.invert,
  });
  const pixels = halftoneGrayscale(adjusted, targetWidth, targetHeight, {
    mode: element.mode,
    threshold: element.threshold,
  });

  return pixelsToCanvas(pixels);
}
