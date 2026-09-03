export type HalftoneMode =
  | "threshold"
  | "floyd-steinberg"
  | "atkinson"
  | "jarvis"
  | "stucki"
  | "sierra-lite"
  | "bayer2"
  | "bayer4"
  | "bayer8";

export const HALFTONE_MODES: ReadonlyArray<{
  value: HalftoneMode;
  label: string;
}> = [
  { value: "floyd-steinberg", label: "Floyd–Steinberg (photos)" },
  { value: "atkinson", label: "Atkinson (lighter, crisper)" },
  { value: "jarvis", label: "Jarvis–Judice–Ninke (smooth)" },
  { value: "stucki", label: "Stucki (sharp detail)" },
  { value: "sierra-lite", label: "Sierra Lite (fast)" },
  { value: "bayer4", label: "Ordered 4×4 (retro grid)" },
  { value: "bayer8", label: "Ordered 8×8 (fine grid)" },
  { value: "bayer2", label: "Ordered 2×2 (coarse grid)" },
  { value: "threshold", label: "Threshold (line art, text)" },
];

export interface ToneOptions {
  /** -100…100, added as a flat offset scaled to ±255. */
  brightness?: number;
  /** -100…100, applied around mid grey. */
  contrast?: number;
  /** 0.1…4, values below 1 lighten mid-tones. */
  gamma?: number;
  /** 0…100 unsharp-mask strength. */
  sharpen?: number;
  /** Stretch the histogram to full black/white before other adjustments. */
  autoLevel?: boolean;
  invert?: boolean;
}

export interface HalftoneOptions extends ToneOptions {
  mode?: HalftoneMode;
  /** 0…255 cut-off, also biases ordered and error-diffusion modes. */
  threshold?: number;
}

/** Offsets are [dx, dy, weight]; weights are divided by `divisor`. */
interface DiffusionKernel {
  divisor: number;
  offsets: ReadonlyArray<readonly [number, number, number]>;
}

const DIFFUSION_KERNELS: Record<string, DiffusionKernel> = {
  "floyd-steinberg": {
    divisor: 16,
    offsets: [
      [1, 0, 7],
      [-1, 1, 3],
      [0, 1, 5],
      [1, 1, 1],
    ],
  },
  atkinson: {
    divisor: 8,
    offsets: [
      [1, 0, 1],
      [2, 0, 1],
      [-1, 1, 1],
      [0, 1, 1],
      [1, 1, 1],
      [0, 2, 1],
    ],
  },
  jarvis: {
    divisor: 48,
    offsets: [
      [1, 0, 7],
      [2, 0, 5],
      [-2, 1, 3],
      [-1, 1, 5],
      [0, 1, 7],
      [1, 1, 5],
      [2, 1, 3],
      [-2, 2, 1],
      [-1, 2, 3],
      [0, 2, 5],
      [1, 2, 3],
      [2, 2, 1],
    ],
  },
  stucki: {
    divisor: 42,
    offsets: [
      [1, 0, 8],
      [2, 0, 4],
      [-2, 1, 2],
      [-1, 1, 4],
      [0, 1, 8],
      [1, 1, 4],
      [2, 1, 2],
      [-2, 2, 1],
      [-1, 2, 2],
      [0, 2, 4],
      [1, 2, 2],
      [2, 2, 1],
    ],
  },
  "sierra-lite": {
    divisor: 4,
    offsets: [
      [1, 0, 2],
      [-1, 1, 1],
      [0, 1, 1],
    ],
  },
};

const BAYER_2 = [
  [0, 2],
  [3, 1],
];

const BAYER_4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

const BAYER_8 = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
];

const BAYER_MATRICES: Record<string, number[][]> = {
  bayer2: BAYER_2,
  bayer4: BAYER_4,
  bayer8: BAYER_8,
};

/** ITU-R BT.601 luma, one float per pixel. */
export function imageDataToGrayscale(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Float32Array {
  const grayscale = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const red = data[index] ?? 0;
      const green = data[index + 1] ?? 0;
      const blue = data[index + 2] ?? 0;
      grayscale[y * width + x] = 0.299 * red + 0.587 * green + 0.114 * blue;
    }
  }

  return grayscale;
}

function clampByte(value: number): number {
  if (value < 0) return 0;
  if (value > 255) return 255;
  return value;
}

function autoLevelInPlace(grayscale: Float32Array): void {
  let min = 255;
  let max = 0;

  for (const value of grayscale) {
    if (value < min) min = value;
    if (value > max) max = value;
  }

  const span = max - min;
  if (span < 1) {
    return;
  }

  const scale = 255 / span;
  for (let index = 0; index < grayscale.length; index++) {
    grayscale[index] = ((grayscale[index] ?? 0) - min) * scale;
  }
}

/** Unsharp mask: blend the pixel away from a 3×3 box blur of its neighbours. */
export function sharpenGrayscale(
  grayscale: Float32Array,
  width: number,
  height: number,
  amount: number,
): Float32Array {
  if (amount <= 0) {
    return grayscale;
  }

  const strength = amount / 100;
  const output = new Float32Array(grayscale.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      let sum = 0;
      let count = 0;

      for (let dy = -1; dy <= 1; dy++) {
        const sampleY = y + dy;
        if (sampleY < 0 || sampleY >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const sampleX = x + dx;
          if (sampleX < 0 || sampleX >= width) continue;
          sum += grayscale[sampleY * width + sampleX] ?? 0;
          count++;
        }
      }

      const original = grayscale[index] ?? 0;
      const blurred = count > 0 ? sum / count : original;
      output[index] = clampByte(original + (original - blurred) * strength);
    }
  }

  return output;
}

/** Applies auto-level, brightness, contrast, gamma, sharpen and invert in that order. */
export function applyToneAdjustments(
  grayscale: Float32Array,
  width: number,
  height: number,
  options: ToneOptions = {},
): Float32Array {
  const {
    brightness = 0,
    contrast = 0,
    gamma = 1,
    sharpen = 0,
    autoLevel = false,
    invert = false,
  } = options;

  const output = new Float32Array(grayscale);

  if (autoLevel) {
    autoLevelInPlace(output);
  }

  const brightnessOffset = (brightness / 100) * 255;
  const contrastFactor =
    contrast === 0
      ? 1
      : (259 * (contrast * 2.55 + 255)) / (255 * (259 - contrast * 2.55));
  const gammaExponent = gamma > 0 ? 1 / gamma : 1;
  const needsGamma = Math.abs(gamma - 1) > 0.001;

  for (let index = 0; index < output.length; index++) {
    let value = (output[index] ?? 0) + brightnessOffset;

    if (contrastFactor !== 1) {
      value = contrastFactor * (value - 128) + 128;
    }

    value = clampByte(value);

    if (needsGamma) {
      value = clampByte(255 * Math.pow(value / 255, gammaExponent));
    }

    output[index] = value;
  }

  const sharpened = sharpenGrayscale(output, width, height, sharpen);

  if (invert) {
    for (let index = 0; index < sharpened.length; index++) {
      sharpened[index] = 255 - (sharpened[index] ?? 0);
    }
  }

  return sharpened;
}

function orderedDither(
  grayscale: Float32Array,
  width: number,
  height: number,
  matrix: number[][],
  threshold: number,
): boolean[][] {
  const size = matrix.length;
  const levels = size * size;
  const bias = threshold - 128;
  const pixels: boolean[][] = [];

  for (let y = 0; y < height; y++) {
    const row: boolean[] = [];
    const matrixRow = matrix[y % size] ?? [];
    for (let x = 0; x < width; x++) {
      const cell = matrixRow[x % size] ?? 0;
      const limit = ((cell + 0.5) / levels) * 255 + bias;
      row.push((grayscale[y * width + x] ?? 0) < limit);
    }
    pixels.push(row);
  }

  return pixels;
}

function diffusionDither(
  grayscale: Float32Array,
  width: number,
  height: number,
  kernel: DiffusionKernel,
  threshold: number,
): boolean[][] {
  const errors = new Float32Array(grayscale);
  const pixels: boolean[][] = [];

  for (let y = 0; y < height; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const oldValue = errors[index] ?? 0;
      const isDark = oldValue < threshold;
      const newValue = isDark ? 0 : 255;
      const error = oldValue - newValue;
      row.push(isDark);

      for (const [dx, dy, weight] of kernel.offsets) {
        const targetX = x + dx;
        const targetY = y + dy;
        if (targetX < 0 || targetX >= width || targetY >= height) {
          continue;
        }
        const targetIndex = targetY * width + targetX;
        errors[targetIndex] =
          (errors[targetIndex] ?? 0) + (error * weight) / kernel.divisor;
      }
    }
    pixels.push(row);
  }

  return pixels;
}

/** Converts a grayscale plane to 1-bit pixels (true = burn a dot). */
export function halftoneGrayscale(
  grayscale: Float32Array,
  width: number,
  height: number,
  options: HalftoneOptions = {},
): boolean[][] {
  const { mode = "floyd-steinberg", threshold = 128 } = options;

  const matrix = BAYER_MATRICES[mode];
  if (matrix) {
    return orderedDither(grayscale, width, height, matrix, threshold);
  }

  const kernel = DIFFUSION_KERNELS[mode];
  if (kernel) {
    return diffusionDither(grayscale, width, height, kernel, threshold);
  }

  const pixels: boolean[][] = [];
  for (let y = 0; y < height; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < width; x++) {
      row.push((grayscale[y * width + x] ?? 0) < threshold);
    }
    pixels.push(row);
  }

  return pixels;
}
