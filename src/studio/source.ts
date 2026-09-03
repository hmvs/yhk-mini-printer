export interface ImageSource {
  /** Decoded RGBA copy of the picture, on white. */
  canvas: HTMLCanvasElement;
  name: string;
  /** Dimensions before the working-copy downscale. */
  naturalWidth: number;
  naturalHeight: number;
}

/** Working copies are capped so crop dragging and re-dithers stay instant. */
const MAX_WORKING_DIMENSION = 2048;

export const SUPPORTED_IMAGE_TYPES =
  "image/png,image/jpeg,image/webp,image/gif,image/bmp,image/svg+xml,image/avif";

function createContext(
  width: number,
  height: number,
): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("Canvas 2D context is not available.");
  }
  return { canvas, context };
}

function decodeWithImageElement(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The file could not be decoded as an image."));
    };
    image.src = url;
  });
}

async function decode(
  blob: Blob,
): Promise<{ source: CanvasImageSource; width: number; height: number }> {
  // SVG and a few exotic formats fail createImageBitmap; the <img> path covers them.
  if (blob.type !== "image/svg+xml" && typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob);
      return { source: bitmap, width: bitmap.width, height: bitmap.height };
    } catch {
      // Fall through to the <img> decoder.
    }
  }

  const image = await decodeWithImageElement(blob);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (width === 0 || height === 0) {
    throw new Error("The image has no intrinsic size (vector without width?).");
  }
  return { source: image, width, height };
}

function toWorkingCanvas(
  source: CanvasImageSource,
  width: number,
  height: number,
): HTMLCanvasElement {
  const scale = Math.min(
    1,
    MAX_WORKING_DIMENSION / Math.max(width, height),
  );
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  const { canvas, context } = createContext(targetWidth, targetHeight);
  // Thermal output is 1-bit: flatten transparency onto white, not black.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, targetWidth, targetHeight);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, targetWidth, targetHeight);

  if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
    source.close();
  }

  return canvas;
}

export async function loadImageFromBlob(
  blob: Blob,
  name: string,
): Promise<ImageSource> {
  const { source, width, height } = await decode(blob);
  return {
    canvas: toWorkingCanvas(source, width, height),
    name,
    naturalWidth: width,
    naturalHeight: height,
  };
}

export async function loadImageFromFile(file: File): Promise<ImageSource> {
  return loadImageFromBlob(file, file.name || "image");
}

export async function loadImageFromUrl(url: string): Promise<ImageSource> {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error("Enter an image URL first.");
  }

  let response: Response;
  try {
    response = await fetch(trimmed, { mode: "cors" });
  } catch {
    throw new Error(
      "Could not fetch that URL. The host must allow cross-origin requests — download the file and drop it in instead.",
    );
  }

  if (!response.ok) {
    throw new Error(`Fetch failed with HTTP ${response.status}.`);
  }

  const blob = await response.blob();
  const name = decodeURIComponent(trimmed.split("/").pop() ?? "image").split("?")[0] ?? "image";
  return loadImageFromBlob(blob, name);
}

/** Pulls the first image out of a paste or drag-and-drop payload. */
export function imageFileFromDataTransfer(
  transfer: DataTransfer | null,
): File | null {
  if (!transfer) return null;

  for (const item of Array.from(transfer.items ?? [])) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }

  for (const file of Array.from(transfer.files ?? [])) {
    if (file.type.startsWith("image/")) return file;
  }

  return null;
}

export function imageSourceFromCanvas(
  canvas: HTMLCanvasElement,
  name: string,
): ImageSource {
  const { canvas: copy, context } = createContext(canvas.width, canvas.height);
  context.drawImage(canvas, 0, 0);
  return {
    canvas: copy,
    name,
    naturalWidth: canvas.width,
    naturalHeight: canvas.height,
  };
}
