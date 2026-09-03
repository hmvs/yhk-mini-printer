export function thresholdImageData(imageData: ImageData): boolean[][] {
  const { width, height, data } = imageData;
  const pixels: boolean[][] = [];

  for (let y = 0; y < height; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const red = data[index] ?? 0;
      const green = data[index + 1] ?? 0;
      const blue = data[index + 2] ?? 0;
      const grayscale = 0.299 * red + 0.587 * green + 0.114 * blue;
      row.push(grayscale < 128);
    }
    pixels.push(row);
  }

  return pixels;
}

export function drawPreview(
  target: HTMLCanvasElement,
  source: HTMLCanvasElement,
): void {
  target.width = source.width;
  target.height = source.height;

  const context = target.getContext("2d");
  if (!context) {
    throw new Error("Preview canvas 2D context is not available.");
  }

  context.clearRect(0, 0, target.width, target.height);
  context.drawImage(source, 0, 0);
}
