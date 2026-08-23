import { buildPrintJob } from "@shared/escpos.ts";
import { PRINTER_WIDTH } from "@shared/constants.ts";
import { drawPreview, thresholdImageData } from "./image.ts";
import {
  createConnectionController,
  initializeBluetoothUi,
} from "./ui/connection.ts";
import { WebBluetoothTransport } from "./transport/web-bluetooth.ts";

type TextDirection =
  | "horizontal"
  | "rotate-clockwise"
  | "rotate-counterclockwise";
type TextAlign = "left" | "center" | "right";
type FontWeight = "normal" | "bold";

interface TextFormState {
  text: string;
  direction: TextDirection;
  align: TextAlign;
  weight: FontWeight;
  fontSize: number;
  lineSpacing: number;
  xOffset: number;
  yOffset: number;
}

interface TextComposeResult {
  canvas: HTMLCanvasElement;
  pixels: boolean[][];
}

const STORAGE_KEY = "yhk-text-composer-state";
const EDGE_PADDING = 16;

function getRequiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Required UI element not found: ${selector}`);
  }

  return element;
}

const connectButton = getRequiredElement<HTMLButtonElement>("#connect-btn");
const printButton = getRequiredElement<HTMLButtonElement>("#print-btn");
const disconnectButton = getRequiredElement<HTMLButtonElement>("#disconnect-btn");
const connectionStatus = getRequiredElement<HTMLParagraphElement>("#connection-status");
const previewCanvas = getRequiredElement<HTMLCanvasElement>("#preview");
const logElement = getRequiredElement<HTMLPreElement>("#log");
const textInput = getRequiredElement<HTMLTextAreaElement>("#text-input");
const directionInput = getRequiredElement<HTMLSelectElement>("#direction-input");
const alignInput = getRequiredElement<HTMLSelectElement>("#align-input");
const weightInput = getRequiredElement<HTMLSelectElement>("#weight-input");
const fontSizeInput = getRequiredElement<HTMLInputElement>("#font-size-input");
const fontSizeValue = getRequiredElement<HTMLSpanElement>("#font-size-value");
const lineSpacingInput = getRequiredElement<HTMLInputElement>("#line-spacing-input");
const lineSpacingValue = getRequiredElement<HTMLSpanElement>("#line-spacing-value");
const xOffsetInput = getRequiredElement<HTMLInputElement>("#x-offset-input");
const xOffsetValue = getRequiredElement<HTMLSpanElement>("#x-offset-value");
const yOffsetInput = getRequiredElement<HTMLInputElement>("#y-offset-input");
const yOffsetValue = getRequiredElement<HTMLSpanElement>("#y-offset-value");

const transport = new WebBluetoothTransport();
const connection = createConnectionController({
  transport,
  elements: { connectButton, disconnectButton, connectionStatus, logElement },
  dependentButtons: [printButton],
});

function readSelect<T extends string>(input: HTMLSelectElement, values: readonly T[], fallback: T): T {
  return values.includes(input.value as T) ? (input.value as T) : fallback;
}

function readFormState(): TextFormState {
  return {
    text: textInput.value,
    direction: readSelect(
      directionInput,
      ["horizontal", "rotate-clockwise", "rotate-counterclockwise"],
      "horizontal",
    ),
    align: readSelect(alignInput, ["left", "center", "right"], "center"),
    weight: readSelect(weightInput, ["normal", "bold"], "normal"),
    fontSize: Number(fontSizeInput.value),
    lineSpacing: Number(lineSpacingInput.value) / 100,
    xOffset: Number(xOffsetInput.value),
    yOffset: Number(yOffsetInput.value),
  };
}

function applyFormState(state: TextFormState): void {
  textInput.value = state.text;
  directionInput.value = state.direction;
  alignInput.value = state.align;
  weightInput.value = state.weight;
  fontSizeInput.value = String(state.fontSize);
  lineSpacingInput.value = String(Math.round(state.lineSpacing * 100));
  xOffsetInput.value = String(state.xOffset);
  yOffsetInput.value = String(state.yOffset);
  updateRangeLabels();
}

function saveFormState(state: TextFormState): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadFormState(): TextFormState | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const saved = JSON.parse(raw) as Partial<TextFormState>;
    return {
      text: saved.text ?? "",
      direction:
        saved.direction === "rotate-clockwise" ||
        saved.direction === "rotate-counterclockwise"
          ? saved.direction
          : "horizontal",
      align: ["left", "center", "right"].includes(saved.align ?? "")
        ? (saved.align as TextAlign)
        : "center",
      weight: saved.weight === "bold" ? "bold" : "normal",
      fontSize:
        typeof saved.fontSize === "number" && Number.isFinite(saved.fontSize)
          ? saved.fontSize
          : 32,
      lineSpacing:
        typeof saved.lineSpacing === "number" && Number.isFinite(saved.lineSpacing)
          ? saved.lineSpacing
          : 1.25,
      xOffset:
        typeof saved.xOffset === "number" && Number.isFinite(saved.xOffset)
          ? saved.xOffset
          : 0,
      yOffset:
        typeof saved.yOffset === "number" && Number.isFinite(saved.yOffset)
          ? saved.yOffset
          : EDGE_PADDING,
    };
  } catch {
    return null;
  }
}

function updateRangeLabels(): void {
  fontSizeValue.textContent = fontSizeInput.value;
  lineSpacingValue.textContent = lineSpacingInput.value;
  xOffsetValue.textContent = xOffsetInput.value;
  yOffsetValue.textContent = yOffsetInput.value;
}

function fontFor(state: TextFormState): string {
  return `${state.weight} ${state.fontSize}px sans-serif`;
}

function wrapLine(
  context: CanvasRenderingContext2D,
  line: string,
  maxWidth: number,
): string[] {
  if (!line) {
    return [""];
  }

  const words = line.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && context.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }

  if (current) {
    lines.push(current);
  }
  return lines;
}

function horizontalLines(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  return text.split("\n").flatMap((line) => wrapLine(context, line, maxWidth));
}

function alignedX(align: TextAlign, offset: number): number {
  switch (align) {
    case "left":
      return EDGE_PADDING + offset;
    case "right":
      return PRINTER_WIDTH - EDGE_PADDING + offset;
    case "center":
      return PRINTER_WIDTH / 2 + offset;
  }
}

function composeText(state: TextFormState): TextComposeResult {
  const measureCanvas = document.createElement("canvas");
  const measureContext = measureCanvas.getContext("2d");
  if (!measureContext) {
    throw new Error("Canvas 2D context is not available.");
  }

  measureContext.font = fontFor(state);
  const lineHeight = Math.max(1, Math.round(state.fontSize * state.lineSpacing));
  const maxWidth = PRINTER_WIDTH - EDGE_PADDING * 2;
  const sourceLines = state.direction === "horizontal"
    ? horizontalLines(measureContext, state.text, maxWidth)
    : state.text.split("\n");
  const rotatedWidth = Math.max(
    1,
    ...sourceLines.map((line) => measureContext.measureText(line).width),
  );
  const contentHeight = state.direction === "horizontal"
    ? sourceLines.length * lineHeight
    : rotatedWidth;
  const height = Math.max(1, state.yOffset + contentHeight + EDGE_PADDING);
  const canvas = document.createElement("canvas");
  canvas.width = PRINTER_WIDTH;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D context is not available.");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#000000";
  context.font = fontFor(state);
  context.textBaseline = "top";

  if (state.direction === "horizontal") {
    context.textAlign = state.align;
    const x = alignedX(state.align, state.xOffset);
    sourceLines.forEach((line, index) => {
      context.fillText(line, x, state.yOffset + index * lineHeight);
    });
  } else {
    const blockWidth = Math.max(1, sourceLines.length * lineHeight);
    let startX = EDGE_PADDING + state.xOffset;
    if (state.align === "center") {
      startX = (PRINTER_WIDTH - blockWidth) / 2 + state.xOffset;
    } else if (state.align === "right") {
      startX = PRINTER_WIDTH - EDGE_PADDING - blockWidth + state.xOffset;
    }

    context.save();
    if (state.direction === "rotate-clockwise") {
      context.translate(startX + blockWidth, state.yOffset);
      context.rotate(Math.PI / 2);
    } else {
      context.translate(startX, state.yOffset + rotatedWidth);
      context.rotate(-Math.PI / 2);
    }
    context.textAlign = "left";
    sourceLines.forEach((line, index) => {
      context.fillText(line, 0, index * lineHeight);
    });
    context.restore();
  }

  return { canvas, pixels: thresholdImageData(context.getImageData(0, 0, canvas.width, canvas.height)) };
}

function validate(state: TextFormState): string | null {
  return state.text.trim() ? null : "Enter some text before printing.";
}

function refreshPreview(): void {
  const state = readFormState();
  saveFormState(state);
  updateRangeLabels();
  const validationError = validate(state);
  if (validationError) {
    previewCanvas.width = PRINTER_WIDTH;
    previewCanvas.height = 1;
    return;
  }

  try {
    drawPreview(previewCanvas, composeText(state).canvas);
  } catch (error) {
    connection.log(`Preview failed: ${connection.formatError(error)}`);
  }
}

async function handlePrint(): Promise<void> {
  const state = readFormState();
  const validationError = validate(state);
  if (validationError) {
    connection.log(validationError);
    return;
  }

  try {
    const result = composeText(state);
    drawPreview(previewCanvas, result.canvas);
    const job = buildPrintJob(result.pixels);
    connection.log(`Sending ${job.length} bytes with paced BLE writes...`);
    await transport.send(job);
    connection.log("All print data sent.");
  } catch (error) {
    connection.log(`Print failed: ${connection.formatError(error)}`);
  }
}

function initialize(): void {
  const saved = loadFormState();
  if (saved) {
    applyFormState(saved);
  } else {
    updateRangeLabels();
  }

  [textInput, directionInput, alignInput, weightInput, fontSizeInput, lineSpacingInput, xOffsetInput, yOffsetInput]
    .forEach((input) => input.addEventListener("input", refreshPreview));
  [directionInput, alignInput, weightInput].forEach((input) => input.addEventListener("change", refreshPreview));
  printButton.addEventListener("click", () => void handlePrint());
  initializeBluetoothUi(connection, {
    connectButton,
    disconnectButton,
    dependentButtons: [printButton],
    connectionStatus,
    readyMessage: "Ready. Enter text, position it in the preview, then print.",
  });
  refreshPreview();
}

initialize();
