function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

/** WalkPrint's default print density for YHK printers. */
export const DEFAULT_PRINT_DENSITY = 25;

export function init(): Uint8Array {
  return new Uint8Array([0x1b, 0x40]);
}

export function startPrint(
  density = DEFAULT_PRINT_DENSITY,
): Uint8Array {
  if (!Number.isInteger(density) || density < 0 || density > 0xff) {
    throw new Error("Print density must be an integer from 0 to 255.");
  }

  return new Uint8Array([0x1d, 0x49, 0xf0, density]);
}

export function lineFeeds(count: number): Uint8Array {
  return new Uint8Array(Array.from({ length: count }, () => 0x0a));
}

export function pixelsToBitmap(pixels: boolean[][]): {
  bitmap: Uint8Array;
  widthBytes: number;
  height: number;
} {
  const height = pixels.length;
  if (height === 0) {
    throw new Error("Image must have at least one row.");
  }

  const width = pixels[0]?.length ?? 0;
  if (width === 0) {
    throw new Error("Image must have at least one column.");
  }

  const widthBytes = Math.ceil(width / 8);
  const bitmap = new Uint8Array(widthBytes * height);

  for (let y = 0; y < height; y++) {
    const row = pixels[y];
    if (row.length !== width) {
      throw new Error(`Row ${y} has inconsistent width.`);
    }

    for (let x = 0; x < width; x++) {
      if (row[x]) {
        bitmap[y * widthBytes + (x >> 3)] |= 1 << (7 - (x & 7));
      }
    }
  }

  return { bitmap, widthBytes, height };
}

export function rasterImage(
  bitmap: Uint8Array,
  widthBytes: number,
  height: number,
): Uint8Array {
  const header = new Uint8Array([
    0x1d,
    0x76,
    0x30,
    0x00,
    widthBytes & 0xff,
    (widthBytes >> 8) & 0xff,
    height & 0xff,
    (height >> 8) & 0xff,
  ]);

  return concatBytes([header, bitmap]);
}

export interface PrintJobOptions {
  /** Burn strength; higher is darker but slower. */
  density?: number;
  /** Blank lines fed after the image so it clears the tear bar. */
  feedLines?: number;
}

export function buildPrintJob(
  pixels: boolean[][],
  options: PrintJobOptions = {},
): Uint8Array {
  const { density = DEFAULT_PRINT_DENSITY, feedLines = 4 } = options;

  if (!Number.isInteger(feedLines) || feedLines < 0 || feedLines > 64) {
    throw new Error("Feed lines must be an integer from 0 to 64.");
  }

  const { bitmap, widthBytes, height } = pixelsToBitmap(pixels);
  return concatBytes([
    init(),
    startPrint(density),
    rasterImage(bitmap, widthBytes, height),
    lineFeeds(feedLines),
  ]);
}
