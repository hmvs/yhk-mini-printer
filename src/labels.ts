import { PRINTER_WIDTH } from "@shared/constants.ts";
import { drawPreview, thresholdImageData } from "./image.ts";
import { preparePrintJob, sendPrintJob } from "./print-job.ts";
import { createConnectionController, initializeBluetoothUi } from "./ui/connection.ts";
import { WebBluetoothTransport } from "./transport/web-bluetooth.ts";

type TextAlign = "left" | "center" | "right";

interface LabelState {
  title: string;
  details: string;
  heightMm: number;
  align: TextAlign;
  copies: number;
  border: boolean;
  tearGuide: boolean;
}

interface ComposeResult {
  canvas: HTMLCanvasElement;
  pixels: boolean[][];
}

const STORAGE_KEY = "yhk-label-composer-state";
const DOTS_PER_MM = 8;
const PADDING = 18;
const COPY_GAP = 18;

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required UI element not found: ${selector}`);
  return element;
}

const connectButton = required<HTMLButtonElement>("#connect-btn");
const printButton = required<HTMLButtonElement>("#print-btn");
const disconnectButton = required<HTMLButtonElement>("#disconnect-btn");
const connectionStatus = required<HTMLParagraphElement>("#connection-status");
const previewCanvas = required<HTMLCanvasElement>("#preview");
const logElement = required<HTMLPreElement>("#log");
const titleInput = required<HTMLInputElement>("#title-input");
const detailsInput = required<HTMLTextAreaElement>("#details-input");
const heightInput = required<HTMLSelectElement>("#height-input");
const alignInput = required<HTMLSelectElement>("#align-input");
const copiesInput = required<HTMLInputElement>("#copies-input");
const borderInput = required<HTMLInputElement>("#border-input");
const tearGuideInput = required<HTMLInputElement>("#tear-guide-input");

const transport = new WebBluetoothTransport();
const connection = createConnectionController({
  transport,
  elements: { connectButton, disconnectButton, connectionStatus, logElement },
  dependentButtons: [printButton],
});

function readAlign(value: string): TextAlign {
  return value === "left" || value === "right" ? value : "center";
}

function readState(): LabelState {
  return {
    title: titleInput.value,
    details: detailsInput.value,
    heightMm: Number(heightInput.value),
    align: readAlign(alignInput.value),
    copies: Math.max(1, Math.min(20, Math.round(Number(copiesInput.value) || 1))),
    border: borderInput.checked,
    tearGuide: tearGuideInput.checked,
  };
}

function saveState(state: LabelState): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadState(): LabelState | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw) as Partial<LabelState>;
    return {
      title: saved.title ?? "",
      details: saved.details ?? "",
      heightMm: [20, 30, 40, 50].includes(saved.heightMm ?? 0) ? saved.heightMm as number : 30,
      align: readAlign(saved.align ?? "center"),
      copies: typeof saved.copies === "number" ? Math.max(1, Math.min(20, Math.round(saved.copies))) : 1,
      border: saved.border ?? true,
      tearGuide: saved.tearGuide ?? true,
    };
  } catch {
    return null;
  }
}

function applyState(state: LabelState): void {
  titleInput.value = state.title;
  detailsInput.value = state.details;
  heightInput.value = String(state.heightMm);
  alignInput.value = state.align;
  copiesInput.value = String(state.copies);
  borderInput.checked = state.border;
  tearGuideInput.checked = state.tearGuide;
}

function xFor(align: TextAlign): number {
  return align === "left" ? PADDING : align === "right" ? PRINTER_WIDTH - PADDING : PRINTER_WIDTH / 2;
}

function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && context.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
}

function drawDashedGuide(context: CanvasRenderingContext2D, y: number): void {
  context.save();
  context.setLineDash([4, 4]);
  context.strokeStyle = "#000000";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(PADDING, y + COPY_GAP / 2);
  context.lineTo(PRINTER_WIDTH - PADDING, y + COPY_GAP / 2);
  context.stroke();
  context.restore();
}

function composeLabels(state: LabelState): ComposeResult {
  const labelHeight = state.heightMm * DOTS_PER_MM;
  const totalHeight = labelHeight * state.copies + COPY_GAP * (state.copies - 1);
  const canvas = document.createElement("canvas");
  canvas.width = PRINTER_WIDTH;
  canvas.height = totalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context is not available.");

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const x = xFor(state.align);
  const textAlign = state.align;
  const titleSize = Math.max(22, Math.min(42, Math.round(labelHeight * 0.24)));
  const detailSize = Math.max(14, Math.min(24, Math.round(labelHeight * 0.12)));
  const contentWidth = PRINTER_WIDTH - PADDING * 2;

  for (let copy = 0; copy < state.copies; copy++) {
    const top = copy * (labelHeight + COPY_GAP);
    if (state.border) {
      context.strokeStyle = "#000000";
      context.lineWidth = 2;
      context.strokeRect(3, top + 3, PRINTER_WIDTH - 6, labelHeight - 6);
    }

    context.fillStyle = "#000000";
    context.textAlign = textAlign;
    context.textBaseline = "top";
    context.font = `bold ${titleSize}px sans-serif`;
    const titleLines = wrapText(context, state.title.trim(), contentWidth).slice(0, 2);
    const titleLineHeight = Math.round(titleSize * 1.15);
    const titleHeight = titleLines.length * titleLineHeight;
    const detailsTop = top + Math.max(PADDING, Math.round((labelHeight - titleHeight) / 2));
    titleLines.forEach((line, index) => context.fillText(line, x, detailsTop + index * titleLineHeight));

    if (state.details.trim()) {
      context.font = `${detailSize}px sans-serif`;
      const detailLines = wrapText(context, state.details.trim(), contentWidth).slice(0, 3);
      const detailLineHeight = Math.round(detailSize * 1.25);
      const bodyTop = detailsTop + titleHeight + Math.max(5, Math.round(detailSize * 0.35));
      detailLines.forEach((line, index) => context.fillText(line, x, bodyTop + index * detailLineHeight));
    }

    if (copy < state.copies - 1 && state.tearGuide) drawDashedGuide(context, top + labelHeight);
  }

  return { canvas, pixels: thresholdImageData(context.getImageData(0, 0, canvas.width, canvas.height)) };
}

function validate(state: LabelState): string | null {
  return state.title.trim() ? null : "Enter a label title before printing.";
}

function refreshPreview(): void {
  const state = readState();
  saveState(state);
  const error = validate(state);
  if (error) {
    previewCanvas.width = PRINTER_WIDTH;
    previewCanvas.height = 1;
    return;
  }
  try {
    drawPreview(previewCanvas, composeLabels(state).canvas);
  } catch (error) {
    connection.log(`Preview failed: ${connection.formatError(error)}`);
  }
}

async function printLabels(): Promise<void> {
  const state = readState();
  const error = validate(state);
  if (error) {
    connection.log(error);
    return;
  }
  try {
    const result = composeLabels(state);
    drawPreview(previewCanvas, result.canvas);
    const job = preparePrintJob(result.pixels);
    connection.log(`Sending ${job.byteLength} bytes in ${job.segments.length} paced BLE bands...`);
    await sendPrintJob(transport, job);
    connection.log("Print job sent. Tear labels at the dashed guides.");
  } catch (error) {
    connection.log(`Print failed: ${connection.formatError(error)}`);
  }
}

function initialize(): void {
  const saved = loadState();
  if (saved) applyState(saved);
  [titleInput, detailsInput, heightInput, alignInput, copiesInput, borderInput, tearGuideInput]
    .forEach((input) => input.addEventListener("input", refreshPreview));
  [heightInput, alignInput, borderInput, tearGuideInput].forEach((input) => input.addEventListener("change", refreshPreview));
  printButton.addEventListener("click", () => void printLabels());
  initializeBluetoothUi(connection, {
    connectButton,
    disconnectButton,
    dependentButtons: [printButton],
    connectionStatus,
    readyMessage: "Ready. Compose a label, preview it, then print.",
  });
  refreshPreview();
}

initialize();
