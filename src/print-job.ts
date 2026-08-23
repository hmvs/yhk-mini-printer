import { buildPrintJobSegments } from "@shared/escpos.ts";
import type { PrinterTransport } from "./transport.ts";

export interface PreparedPrintJob {
  byteLength: number;
  segments: Uint8Array[];
}

export function preparePrintJob(pixels: boolean[][]): PreparedPrintJob {
  const segments = buildPrintJobSegments(pixels);
  return {
    byteLength: segments.reduce((total, segment) => total + segment.length, 0),
    segments,
  };
}

/** Give the printer a flush interval after every bounded raster band. */
export async function sendPrintJob(
  transport: PrinterTransport,
  job: PreparedPrintJob,
): Promise<void> {
  for (const segment of job.segments) {
    await transport.send(segment);
  }
}
