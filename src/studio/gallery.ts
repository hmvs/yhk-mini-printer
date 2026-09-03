import { PRINTER_WIDTH } from "@shared/constants.ts";
import { renderPage } from "./render.ts";
import { createCanvas } from "./raster.ts";
import { createId, type StudioDocument } from "./types.ts";

/** Renders a document to a small, crisp preview for the pickers. */
export function renderThumbnail(
  document_: StudioDocument,
  targetWidth = 96,
): HTMLCanvasElement {
  const page = renderPage(document_, { sources: new Map() });
  const scale = targetWidth / PRINTER_WIDTH;
  const { canvas, context } = createCanvas(
    targetWidth,
    Math.max(1, Math.round(page.height * scale)),
    "#ffffff",
  );
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(page.canvas, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** A short page carrying just the frame, so borders can be compared at a glance. */
export function borderSampleDocument(border: string): StudioDocument {
  return {
    border,
    bottomMargin: 0,
    minHeight: 150,
    elements: [
      {
        id: createId(),
        type: "text",
        x: 60,
        y: 52,
        width: PRINTER_WIDTH - 120,
        height: 40,
        rotation: 0,
        text: "Aa",
        fontFamily: "sans",
        fontSize: 44,
        bold: true,
        italic: false,
        align: "center",
        lineSpacing: 1.1,
        invert: false,
      },
    ],
  };
}
