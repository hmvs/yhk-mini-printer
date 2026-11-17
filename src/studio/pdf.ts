import { PRINTER_WIDTH } from "@shared/constants.ts";
import type { ImageSource } from "./source.ts";

/** Across-paper render width: 4× the head, so the downscale has detail to work with. */
const TARGET_ACROSS = PRINTER_WIDTH * 4;
/** Matches the image working-copy cap in source.ts. */
const MAX_DIMENSION = 2048;
const MM_PER_POINT = 25.4 / 72;

export function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

/** Region of a page in millimetres from its top-left corner. */
export interface PageRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfDocument {
  numPages: number;
  /** Page size in millimetres. */
  pageSize(number: number): Promise<{ width: number; height: number }>;
  /** Renders a page (or part of one) on white at `pxPerMm`. */
  render(
    number: number,
    pxPerMm: number,
    region?: PageRegion,
  ): Promise<HTMLCanvasElement>;
  close(): Promise<void>;
}

export async function openPdf(file: File): Promise<PdfDocument> {
  // pdf.js is large; only pull it in when someone actually opens a PDF.
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  });
  const pdf = await task.promise;

  return {
    numPages: pdf.numPages,
    async pageSize(number) {
      const page = await pdf.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      return {
        width: viewport.width * MM_PER_POINT,
        height: viewport.height * MM_PER_POINT,
      };
    },
    async render(number, pxPerMm, region) {
      const page = await pdf.getPage(number);
      const scale = pxPerMm * MM_PER_POINT;
      const full = page.getViewport({ scale });
      const area = region ?? {
        x: 0,
        y: 0,
        width: full.width / pxPerMm,
        height: full.height / pxPerMm,
      };
      const viewport = page.getViewport({
        scale,
        offsetX: -Math.round(area.x * pxPerMm),
        offsetY: -Math.round(area.y * pxPerMm),
      });

      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(area.width * pxPerMm));
      canvas.height = Math.max(1, Math.round(area.height * pxPerMm));
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Canvas 2D context is not available.");

      await page.render({
        canvas,
        canvasContext: context,
        viewport,
        background: "#ffffff",
      }).promise;
      page.cleanup();
      return canvas;
    },
    async close() {
      // Tears down the document and its worker.
      await task.destroy();
    },
  };
}

/** Paper a page takes when fitted across the head (landscape pages turn sideways). */
function alongPaper(width: number, height: number): number {
  return Math.round(
    (PRINTER_WIDTH * Math.max(width, height)) / Math.min(width, height),
  );
}

/**
 * Renders PDF pages to white-backed canvases, in order, until the next page
 * would push past `budget` dots of paper. The first page is always included.
 */
export async function loadPdfPages(
  file: File,
  budget: number,
): Promise<{ pages: ImageSource[]; total: number }> {
  const pdf = await openPdf(file);
  const baseName = file.name.replace(/\.pdf$/i, "") || "document";
  const pages: ImageSource[] = [];
  let used = 0;

  try {
    for (let number = 1; number <= pdf.numPages; number++) {
      const size = await pdf.pageSize(number);
      const along = alongPaper(size.width, size.height);
      if (pages.length > 0 && used + along > budget) break;
      used += along;

      const pxPerMm = Math.min(
        TARGET_ACROSS / Math.min(size.width, size.height),
        MAX_DIMENSION / Math.max(size.width, size.height),
      );
      const canvas = await pdf.render(number, pxPerMm);
      pages.push({
        canvas,
        name: pdf.numPages > 1 ? `${baseName} · page ${number}` : baseName,
        naturalWidth: Math.round(size.width / MM_PER_POINT),
        naturalHeight: Math.round(size.height / MM_PER_POINT),
      });
    }
  } finally {
    await pdf.close();
  }

  return { pages, total: pdf.numPages };
}
