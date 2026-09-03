import { buildPrintJob } from "@shared/escpos.ts";
import { PRINTER_WIDTH } from "@shared/constants.ts";
import { HALFTONE_MODES } from "@shared/halftone.ts";
import {
  createConnectionController,
  initializeBluetoothUi,
} from "./ui/connection.ts";
import { WebBluetoothTransport } from "./transport/web-bluetooth.ts";
import { BORDERS } from "./studio/borders.ts";
import { createCropTool, type CropTool } from "./studio/crop-tool.ts";
import { borderSampleDocument, renderThumbnail } from "./studio/gallery.ts";
import {
  clearRasterCache,
  documentHeight,
  elementHeight,
} from "./studio/render.ts";
import { createStage, type Stage } from "./studio/stage.ts";
import { STICKERS, getSticker, renderSticker } from "./studio/stickers.ts";
import { TEMPLATES, getTemplate } from "./studio/templates.ts";
import {
  createId,
  emptyDocument,
  type ImageElement,
  type StudioDocument,
  type StudioElement,
  type TextElement,
} from "./studio/types.ts";
import {
  imageFileFromDataTransfer,
  loadImageFromFile,
  type ImageSource,
} from "./studio/source.ts";

const DOTS_PER_MM = 8;
const STORAGE_KEY = "yhk-studio-document";
const MAX_HISTORY = 40;
const ZOOM_STEPS = [0.75, 1, 1.5, 2, 3];

type TabId = "design" | "element" | "page";

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Required UI element not found: ${selector}`);
  }
  return element;
}

const el = {
  connect: required<HTMLButtonElement>("#connect-btn"),
  disconnect: required<HTMLButtonElement>("#disconnect-btn"),
  print: required<HTMLButtonElement>("#print-btn"),
  status: required<HTMLElement>("#connection-status"),
  log: required<HTMLPreElement>("#log"),

  addText: required<HTMLButtonElement>("#add-text-btn"),
  addImage: required<HTMLButtonElement>("#add-image-btn"),
  addSticker: required<HTMLButtonElement>("#add-sticker-btn"),
  addQr: required<HTMLButtonElement>("#add-qr-btn"),
  addRule: required<HTMLButtonElement>("#add-rule-btn"),
  file: required<HTMLInputElement>("#file-input"),

  zoomIn: required<HTMLButtonElement>("#zoom-in-btn"),
  zoomOut: required<HTMLButtonElement>("#zoom-out-btn"),
  zoomLabel: required<HTMLElement>("#zoom-label"),

  stage: required<HTMLCanvasElement>("#stage"),
  stageEmpty: required<HTMLParagraphElement>("#stage-empty"),
  stageInfo: required<HTMLParagraphElement>("#stage-info"),

  undo: required<HTMLButtonElement>("#undo-btn"),
  duplicate: required<HTMLButtonElement>("#duplicate-btn"),
  forward: required<HTMLButtonElement>("#forward-btn"),
  backward: required<HTMLButtonElement>("#backward-btn"),
  remove: required<HTMLButtonElement>("#delete-btn"),
  download: required<HTMLButtonElement>("#download-btn"),

  tabButtons: {
    design: required<HTMLButtonElement>("#tab-design-btn"),
    element: required<HTMLButtonElement>("#tab-element-btn"),
    page: required<HTMLButtonElement>("#tab-page-btn"),
  },
  tabPanels: {
    design: required<HTMLElement>("#tab-design"),
    element: required<HTMLElement>("#tab-element"),
    page: required<HTMLElement>("#tab-page"),
  },

  templateGallery: required<HTMLDivElement>("#template-gallery"),
  templateHint: required<HTMLParagraphElement>("#template-hint"),
  borderGallery: required<HTMLDivElement>("#border-gallery"),

  layerList: required<HTMLUListElement>("#layer-list"),
  propsEmpty: required<HTMLParagraphElement>("#props-empty"),
  propsCommon: required<HTMLElement>("#props-common"),
  propsTitle: required<HTMLElement>("#props-title"),
  propsText: required<HTMLElement>("#props-text"),
  propsImage: required<HTMLElement>("#props-image"),
  propsSticker: required<HTMLElement>("#props-sticker"),
  propsQr: required<HTMLElement>("#props-qr"),
  propsRule: required<HTMLElement>("#props-rule"),

  alignLeft: required<HTMLButtonElement>("#align-left-btn"),
  alignCenter: required<HTMLButtonElement>("#align-center-btn"),
  alignRight: required<HTMLButtonElement>("#align-right-btn"),
  rotation: required<HTMLInputElement>("#rotation-input"),
  rotationValue: required<HTMLOutputElement>("#rotation-value"),
  rotateReset: required<HTMLButtonElement>("#rotate-reset-btn"),

  text: required<HTMLTextAreaElement>("#text-input"),
  fontSize: required<HTMLInputElement>("#font-size-input"),
  fontSizeValue: required<HTMLOutputElement>("#font-size-value"),
  lineSpacing: required<HTMLInputElement>("#line-spacing-input"),
  lineSpacingValue: required<HTMLOutputElement>("#line-spacing-value"),
  bold: required<HTMLButtonElement>("#bold-btn"),
  italic: required<HTMLButtonElement>("#italic-btn"),
  textInvert: required<HTMLButtonElement>("#text-invert-btn"),

  brightness: required<HTMLInputElement>("#brightness-input"),
  brightnessValue: required<HTMLOutputElement>("#brightness-value"),
  contrast: required<HTMLInputElement>("#contrast-input"),
  contrastValue: required<HTMLOutputElement>("#contrast-value"),
  gamma: required<HTMLInputElement>("#gamma-input"),
  gammaValue: required<HTMLOutputElement>("#gamma-value"),
  sharpen: required<HTMLInputElement>("#sharpen-input"),
  sharpenValue: required<HTMLOutputElement>("#sharpen-value"),
  mode: required<HTMLSelectElement>("#mode-input"),
  threshold: required<HTMLInputElement>("#threshold-input"),
  thresholdValue: required<HTMLOutputElement>("#threshold-value"),
  autoLevel: required<HTMLButtonElement>("#auto-level-btn"),
  imageInvert: required<HTMLButtonElement>("#image-invert-btn"),
  flipH: required<HTMLButtonElement>("#flip-h-btn"),
  flipV: required<HTMLButtonElement>("#flip-v-btn"),
  fitWidth: required<HTMLButtonElement>("#fit-width-btn"),
  resetAspect: required<HTMLButtonElement>("#reset-aspect-btn"),
  crop: required<HTMLButtonElement>("#crop-btn"),
  replaceImage: required<HTMLButtonElement>("#replace-image-btn"),
  cropPanel: required<HTMLElement>("#crop-panel"),
  cropCanvas: required<HTMLCanvasElement>("#crop-canvas"),
  cropClear: required<HTMLButtonElement>("#crop-clear-btn"),
  cropDone: required<HTMLButtonElement>("#crop-done-btn"),

  stickerSearch: required<HTMLInputElement>("#sticker-search"),
  stickerGrid: required<HTMLDivElement>("#sticker-grid"),
  stickerEmpty: required<HTMLParagraphElement>("#sticker-empty"),
  stickerInvert: required<HTMLButtonElement>("#sticker-invert-btn"),

  qrData: required<HTMLTextAreaElement>("#qr-data-input"),

  ruleStyle: required<HTMLSelectElement>("#rule-style-input"),
  ruleThickness: required<HTMLInputElement>("#rule-thickness-input"),
  ruleThicknessValue: required<HTMLOutputElement>("#rule-thickness-value"),

  bottomMargin: required<HTMLInputElement>("#bottom-margin-input"),
  bottomMarginValue: required<HTMLOutputElement>("#bottom-margin-value"),
  minHeight: required<HTMLInputElement>("#min-height-input"),
  minHeightValue: required<HTMLOutputElement>("#min-height-value"),
  feed: required<HTMLInputElement>("#feed-input"),
  feedValue: required<HTMLOutputElement>("#feed-value"),
  clear: required<HTMLButtonElement>("#clear-btn"),
};

const transport = new WebBluetoothTransport();
const connection = createConnectionController({
  transport,
  elements: {
    connectButton: el.connect,
    disconnectButton: el.disconnect,
    connectionStatus: el.status as HTMLParagraphElement,
    logElement: el.log,
    deviceInfo: {
      container: required<HTMLElement>("#device-info"),
      labelText: required<HTMLParagraphElement>("#device-address-label"),
      addressText: required<HTMLElement>("#device-address"),
      copyButton: required<HTMLButtonElement>("#copy-address-btn"),
      hintText: required<HTMLParagraphElement>("#device-address-hint"),
    },
  },
  dependentButtons: [el.print],
  onConnectionChange: (connected) => {
    el.status.classList.toggle("connected", connected);
    updatePrintButton();
  },
});

const sources = new Map<string, HTMLCanvasElement>();
let doc: StudioDocument = emptyDocument();
let selectedId: string | null = null;
let history: string[] = [];
let templateId: string | null = null;
let pendingReplaceId: string | null = null;
let feedLines = 4;
let zoom = 1;
let cropTool: CropTool | null = null;

const stage: Stage = createStage({
  canvas: el.stage,
  getDocument: () => doc,
  getResources: () => ({ sources }),
  getSelectedId: () => selectedId,
  onSelect: (id) => {
    const changed = id !== selectedId;
    selectedId = id;
    if (id && changed) setTab("element");
    syncInspector();
  },
  onChange: (committed) => {
    if (committed) {
      pushHistory();
      persist();
    }
    syncInspector();
    updateStageInfo();
  },
});

/* ------------------------------------------------------------- selection */

function selected(): StudioElement | null {
  return doc.elements.find((element) => element.id === selectedId) ?? null;
}

function select(id: string | null): void {
  selectedId = id;
  if (id) setTab("element");
  syncInspector();
  stage.refresh();
}

function elementLabel(element: StudioElement): string {
  switch (element.type) {
    case "text": {
      const line = element.text.split("\n")[0]?.trim() ?? "";
      return line ? line.slice(0, 28) : "Empty text";
    }
    case "image":
      return "Image";
    case "sticker":
      return getSticker(element.sticker).name;
    case "qr":
      return element.data.trim() ? `QR · ${element.data.slice(0, 20)}` : "QR code";
    case "rule":
      return `${element.style[0]?.toUpperCase()}${element.style.slice(1)} line`;
  }
}

const LAYER_ICONS: Record<StudioElement["type"], string> = {
  text: "T",
  image: "▣",
  sticker: "★",
  qr: "▦",
  rule: "─",
};

/* ----------------------------------------------------------------- state */

function pushHistory(): void {
  history.push(JSON.stringify(doc));
  if (history.length > MAX_HISTORY) history.shift();
  el.undo.disabled = history.length < 2;
}

function refresh(commit = true): void {
  stage.refresh();
  updateStageInfo();
  if (commit) {
    pushHistory();
    persist();
  }
}

function updateStageInfo(): void {
  const height = documentHeight(doc);
  const page = stage.latest();
  const coverage = page ? Math.round(page.coverage * 100) : 0;
  const bytes = Math.ceil(PRINTER_WIDTH / 8) * height + 12;
  const count = doc.elements.length;

  el.stageEmpty.hidden = count > 0;
  el.stageInfo.textContent = count
    ? `${count} element${count === 1 ? "" : "s"} · ${(height / DOTS_PER_MM).toFixed(1)} mm of paper · ${coverage}% ink · ~${(bytes / 1024).toFixed(1)} KB`
    : "Empty page.";
}

function updatePrintButton(): void {
  el.print.disabled = !transport.connected || doc.elements.length === 0;
}

function setPressed(button: HTMLButtonElement, value: boolean): void {
  button.setAttribute("aria-pressed", String(value));
}

function persist(): void {
  try {
    const images: Record<string, string> = {};
    let budget = 2_000_000;
    for (const [id, canvas] of sources) {
      const data = canvas.toDataURL("image/webp", 0.75);
      budget -= data.length;
      if (budget < 0) break;
      images[id] = data;
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ doc, images }));
  } catch {
    // Storage is best-effort; a full quota must not break editing.
  }
}

async function restore(): Promise<boolean> {
  let saved: { doc?: StudioDocument; images?: Record<string, string> } | null =
    null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    saved = raw ? JSON.parse(raw) : null;
  } catch {
    saved = null;
  }

  if (!saved?.doc?.elements) return false;

  for (const [id, dataUrl] of Object.entries(saved.images ?? {})) {
    try {
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("decode failed"));
        image.src = dataUrl;
      });
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext("2d")?.drawImage(image, 0, 0);
      sources.set(id, canvas);
    } catch {
      // A dropped image renders as an outline placeholder.
    }
  }

  doc = saved.doc;
  return true;
}

/* -------------------------------------------------------------- add/edit */

function addElement(element: StudioElement): void {
  doc.elements.push(element);
  select(element.id);
  refresh();
  updatePrintButton();
}

function nextY(): number {
  let bottom = 24;
  for (const element of doc.elements) {
    bottom = Math.max(bottom, element.y + elementHeight(element));
  }
  return Math.min(bottom + 12, 3000);
}

function addText(): void {
  addElement({
    id: createId(),
    type: "text",
    x: 32,
    y: nextY(),
    width: PRINTER_WIDTH - 64,
    height: 40,
    rotation: 0,
    text: "Your text",
    fontFamily: "sans",
    fontSize: 26,
    bold: true,
    italic: false,
    align: "center",
    lineSpacing: 1.25,
    invert: false,
  });
  el.text.focus();
  el.text.select();
}

function addStickerElement(): void {
  addElement({
    id: createId(),
    type: "sticker",
    x: (PRINTER_WIDTH - 96) / 2,
    y: nextY(),
    width: 96,
    height: 96,
    rotation: 0,
    sticker: "star",
    invert: false,
  });
}

function addQrElement(): void {
  addElement({
    id: createId(),
    type: "qr",
    x: (PRINTER_WIDTH - 160) / 2,
    y: nextY(),
    width: 160,
    height: 160,
    rotation: 0,
    data: "https://example.com",
    ecc: "H",
  });
}

function addRuleElement(): void {
  addElement({
    id: createId(),
    type: "rule",
    x: 40,
    y: nextY(),
    width: PRINTER_WIDTH - 80,
    height: 12,
    rotation: 0,
    style: "solid",
    thickness: 2,
  });
}

function imageElementFor(source: ImageSource, sourceId: string): ImageElement {
  const width = Math.min(PRINTER_WIDTH - 48, source.canvas.width);
  const height = Math.round((source.canvas.height * width) / source.canvas.width);
  return {
    id: createId(),
    type: "image",
    x: Math.round((PRINTER_WIDTH - width) / 2),
    y: nextY(),
    width,
    height,
    rotation: 0,
    sourceId,
    crop: null,
    flipHorizontal: false,
    flipVertical: false,
    brightness: 0,
    contrast: 0,
    gamma: 1,
    sharpen: 0,
    autoLevel: false,
    invert: false,
    mode: "floyd-steinberg",
    threshold: 128,
  };
}

async function loadImage(file: File): Promise<void> {
  try {
    const source = await loadImageFromFile(file);
    const sourceId = createId();
    sources.set(sourceId, source.canvas);

    const replaceId = pendingReplaceId;
    pendingReplaceId = null;

    if (replaceId) {
      const element = doc.elements.find((entry) => entry.id === replaceId);
      if (element?.type === "image") {
        element.sourceId = sourceId;
        element.crop = null;
        element.height = Math.round(
          (source.canvas.height * element.width) / source.canvas.width,
        );
        refresh();
        syncInspector();
        return;
      }
    }

    addElement(imageElementFor(source, sourceId));
    connection.log(
      `Added ${source.name} (${source.naturalWidth}×${source.naturalHeight}).`,
    );
  } catch (error) {
    connection.log(`Could not load image: ${connection.formatError(error)}`);
  }
}

function mutate(apply: (element: StudioElement) => void, commit = true): void {
  const element = selected();
  if (!element) return;
  apply(element);
  refresh(commit);
  syncInspector();
}

function mutateText(apply: (element: TextElement) => void): void {
  const element = selected();
  if (element?.type !== "text") return;
  apply(element);
  refresh();
  syncInspector();
}

function mutateImage(apply: (element: ImageElement) => void): void {
  const element = selected();
  if (element?.type !== "image") return;
  apply(element);
  refresh();
  syncInspector();
}

function moveInStack(delta: number): void {
  const element = selected();
  if (!element) return;
  const index = doc.elements.indexOf(element);
  const target = Math.max(0, Math.min(doc.elements.length - 1, index + delta));
  if (target === index) return;
  doc.elements.splice(index, 1);
  doc.elements.splice(target, 0, element);
  refresh();
  syncInspector();
}

function duplicateSelected(): void {
  const element = selected();
  if (!element) return;
  const copy = { ...element, id: createId(), x: element.x + 12, y: element.y + 12 };
  doc.elements.push(copy);
  select(copy.id);
  refresh();
}

function deleteSelected(): void {
  const element = selected();
  if (!element) return;
  doc.elements = doc.elements.filter((entry) => entry.id !== element.id);
  select(null);
  refresh();
  updatePrintButton();
}

function undo(): void {
  if (history.length < 2) return;
  history.pop();
  const previous = history[history.length - 1];
  if (!previous) return;
  doc = JSON.parse(previous) as StudioDocument;
  selectedId = null;
  syncPage();
  syncInspector();
  stage.refresh();
  updateStageInfo();
  updatePrintButton();
  persist();
  el.undo.disabled = history.length < 2;
}

function alignSelected(align: "left" | "center" | "right"): void {
  mutate((element) => {
    const margin = 16;
    element.x =
      align === "left"
        ? margin
        : align === "right"
          ? PRINTER_WIDTH - element.width - margin
          : Math.round((PRINTER_WIDTH - element.width) / 2);
  });
}

/* ------------------------------------------------------------------- UI */

function setTab(tab: TabId): void {
  for (const id of ["design", "element", "page"] as TabId[]) {
    el.tabButtons[id].setAttribute("aria-selected", String(id === tab));
    el.tabPanels[id].hidden = id !== tab;
  }
}

function setZoom(next: number): void {
  zoom = Math.min(3, Math.max(0.75, next));
  el.stage.style.width = `${Math.round(PRINTER_WIDTH * zoom)}px`;
  el.zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  el.zoomOut.disabled = zoom <= ZOOM_STEPS[0]!;
  el.zoomIn.disabled = zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]!;
}

/** Starts at the largest whole step that fits the canvas pane. */
function fitZoom(): void {
  const available = el.stage.parentElement?.parentElement?.clientWidth ?? 0;
  const usable = available - 48;
  const best = [...ZOOM_STEPS]
    .reverse()
    .find((step) => PRINTER_WIDTH * step <= usable && step <= 2);
  setZoom(best ?? 1);
}

function stepZoom(direction: 1 | -1): void {
  const index = ZOOM_STEPS.findIndex((step) => step >= zoom - 0.001);
  const next = ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, index + direction))];
  setZoom(next ?? 1);
}

/** Keeps ragged-height previews from breaking the grid rhythm. */
function thumbFrame(canvas: HTMLCanvasElement): HTMLElement {
  const frame = document.createElement("span");
  frame.className = "gallery-thumb";
  frame.append(canvas);
  return frame;
}

function buildTemplateGallery(): void {
  for (const template of TEMPLATES) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gallery-item";
    button.title = template.hint;
    button.append(thumbFrame(renderThumbnail(template.build(), 96)));
    const label = document.createElement("span");
    label.textContent = template.name;
    button.append(label);
    button.addEventListener("click", () => applyTemplate(template.id));
    el.templateGallery.append(button);
  }
}

function buildBorderGallery(): void {
  for (const border of BORDERS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gallery-item";
    button.dataset.border = border.id;
    button.title = border.name;
    button.append(thumbFrame(renderThumbnail(borderSampleDocument(border.id), 72)));
    const label = document.createElement("span");
    label.textContent = border.name;
    button.append(label);
    button.addEventListener("click", () => {
      doc.border = border.id;
      syncBorderGallery();
      refresh();
    });
    el.borderGallery.append(button);
  }
}

function syncBorderGallery(): void {
  for (const button of Array.from(
    el.borderGallery.querySelectorAll<HTMLButtonElement>(".gallery-item"),
  )) {
    setPressed(button, button.dataset.border === doc.border);
  }
}

function syncTemplateGallery(): void {
  const buttons = Array.from(
    el.templateGallery.querySelectorAll<HTMLButtonElement>(".gallery-item"),
  );
  buttons.forEach((button, index) => {
    setPressed(button, TEMPLATES[index]?.id === templateId);
  });
}

function buildStickerGrid(): void {
  for (const sticker of STICKERS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sticker-button";
    button.title = sticker.name;
    button.setAttribute("aria-label", sticker.name);
    button.dataset.sticker = sticker.id;
    button.dataset.name = sticker.name.toLowerCase();
    const preview = renderSticker(sticker.id, 56, 56);
    preview.className = "sticker-preview";
    button.append(preview);
    button.addEventListener("click", () =>
      mutate((element) => {
        if (element.type === "sticker") element.sticker = sticker.id;
      }),
    );
    el.stickerGrid.append(button);
  }
}

function filterStickers(query: string): void {
  const needle = query.trim().toLowerCase();
  let visible = 0;
  for (const button of Array.from(
    el.stickerGrid.querySelectorAll<HTMLButtonElement>(".sticker-button"),
  )) {
    const match = !needle || (button.dataset.name ?? "").includes(needle);
    button.hidden = !match;
    if (match) visible++;
  }
  el.stickerEmpty.hidden = visible > 0;
}

function applyTemplate(id: string): void {
  const template = getTemplate(id);
  if (!template) return;

  doc = template.build();
  templateId = id;
  selectedId = null;
  el.templateHint.textContent = template.hint;
  syncTemplateGallery();
  syncBorderGallery();
  syncPage();
  syncInspector();
  refresh();
  updatePrintButton();
}

function syncPage(): void {
  el.bottomMargin.value = String(doc.bottomMargin);
  el.bottomMarginValue.textContent = String(doc.bottomMargin);
  el.minHeight.value = String(doc.minHeight);
  el.minHeightValue.textContent = String(doc.minHeight);
  syncBorderGallery();
}

function syncLayers(): void {
  el.layerList.replaceChildren();

  if (doc.elements.length === 0) {
    const empty = document.createElement("li");
    empty.className = "meta";
    empty.textContent = "No elements yet.";
    el.layerList.append(empty);
    return;
  }

  // Top of the list is the top of the stack, so walk the array backwards.
  for (let index = doc.elements.length - 1; index >= 0; index--) {
    const element = doc.elements[index] as StudioElement;
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "layer-item";
    button.setAttribute("aria-current", String(element.id === selectedId));

    const kind = document.createElement("span");
    kind.className = "layer-kind";
    kind.textContent = LAYER_ICONS[element.type];
    kind.setAttribute("aria-hidden", "true");

    const name = document.createElement("span");
    name.className = "layer-name";
    name.textContent = elementLabel(element);

    button.append(kind, name);
    button.addEventListener("click", () => select(element.id));
    item.append(button);
    el.layerList.append(item);
  }
}

function syncSegmented(
  container: HTMLElement,
  attribute: string,
  value: string,
): void {
  for (const button of Array.from(
    container.querySelectorAll<HTMLButtonElement>(`[data-${attribute}]`),
  )) {
    setPressed(button, button.dataset[attribute] === value);
  }
}

function syncInspector(): void {
  const element = selected();

  syncLayers();

  el.propsEmpty.hidden = element !== null;
  el.propsCommon.hidden = element === null;
  el.propsText.hidden = element?.type !== "text";
  el.propsImage.hidden = element?.type !== "image";
  el.propsSticker.hidden = element?.type !== "sticker";
  el.propsQr.hidden = element?.type !== "qr";
  el.propsRule.hidden = element?.type !== "rule";

  if (element?.type !== "image") {
    el.cropPanel.hidden = true;
    setPressed(el.crop, false);
  }

  const hasSelection = element !== null;
  el.duplicate.disabled = !hasSelection;
  el.remove.disabled = !hasSelection;
  el.forward.disabled = !hasSelection;
  el.backward.disabled = !hasSelection;

  if (!element) return;

  el.propsTitle.textContent = elementLabel(element);
  el.rotation.value = String(element.rotation);
  el.rotationValue.textContent = `${element.rotation}°`;

  if (element.type === "text") {
    if (document.activeElement !== el.text) el.text.value = element.text;
    el.fontSize.value = String(element.fontSize);
    el.fontSizeValue.textContent = String(element.fontSize);
    el.lineSpacing.value = String(element.lineSpacing);
    el.lineSpacingValue.textContent = element.lineSpacing.toFixed(2);
    setPressed(el.bold, element.bold);
    setPressed(el.italic, element.italic);
    setPressed(el.textInvert, element.invert);
    syncSegmented(el.propsText, "textAlign", element.align);
    syncSegmented(el.propsText, "font", element.fontFamily);
  }

  if (element.type === "image") {
    el.brightness.value = String(element.brightness);
    el.brightnessValue.textContent = String(element.brightness);
    el.contrast.value = String(element.contrast);
    el.contrastValue.textContent = String(element.contrast);
    el.gamma.value = String(element.gamma);
    el.gammaValue.textContent = element.gamma.toFixed(2);
    el.sharpen.value = String(element.sharpen);
    el.sharpenValue.textContent = String(element.sharpen);
    el.mode.value = element.mode;
    el.threshold.value = String(element.threshold);
    el.thresholdValue.textContent = String(element.threshold);
    setPressed(el.autoLevel, element.autoLevel);
    setPressed(el.imageInvert, element.invert);
    setPressed(el.flipH, element.flipHorizontal);
    setPressed(el.flipV, element.flipVertical);
  }

  if (element.type === "sticker") {
    setPressed(el.stickerInvert, element.invert);
    for (const button of Array.from(
      el.stickerGrid.querySelectorAll<HTMLButtonElement>(".sticker-button"),
    )) {
      setPressed(button, button.dataset.sticker === element.sticker);
    }
  }

  if (element.type === "qr") {
    if (document.activeElement !== el.qrData) el.qrData.value = element.data;
    syncSegmented(el.propsQr, "ecc", element.ecc);
  }

  if (element.type === "rule") {
    el.ruleStyle.value = element.style;
    el.ruleThickness.value = String(element.thickness);
    el.ruleThicknessValue.textContent = String(element.thickness);
  }
}

function openCrop(): void {
  const element = selected();
  if (element?.type !== "image") return;
  const source = sources.get(element.sourceId);
  if (!source) {
    connection.log("This image is no longer loaded — replace it first.");
    return;
  }

  el.cropPanel.hidden = false;
  setPressed(el.crop, true);

  if (!cropTool) {
    cropTool = createCropTool({
      canvas: el.cropCanvas,
      onChange: (crop, committed) => {
        mutateImage((image) => {
          image.crop = crop;
        });
        if (committed) persist();
      },
    });
  }

  cropTool.setSource(source);
  cropTool.setCrop(element.crop);
}

function downloadPage(): void {
  const page = stage.latest();
  if (!page) return;
  const link = document.createElement("a");
  link.download = "yhk-print.png";
  link.href = page.canvas.toDataURL("image/png");
  link.click();
}

async function handlePrint(): Promise<void> {
  if (doc.elements.length === 0) {
    connection.log("Add something to the page first.");
    return;
  }

  try {
    // Render without the selection chrome so it never reaches the paper.
    const previous = selectedId;
    selectedId = null;
    const page = stage.refresh();
    selectedId = previous;
    stage.refresh();

    const job = buildPrintJob(page.pixels, { feedLines });
    connection.log(
      `Sending ${job.length} bytes (${page.height} raster lines) with paced BLE writes...`,
    );
    el.print.disabled = true;
    await transport.send(job);
    connection.log("All print data sent.");
  } catch (error) {
    connection.log(`Print failed: ${connection.formatError(error)}`);
  } finally {
    updatePrintButton();
  }
}

function initializeControls(): void {
  el.addText.addEventListener("click", addText);
  el.addSticker.addEventListener("click", addStickerElement);
  el.addQr.addEventListener("click", addQrElement);
  el.addRule.addEventListener("click", addRuleElement);
  el.addImage.addEventListener("click", () => {
    pendingReplaceId = null;
    el.file.click();
  });
  el.replaceImage.addEventListener("click", () => {
    pendingReplaceId = selectedId;
    el.file.click();
  });
  el.file.addEventListener("change", () => {
    const file = el.file.files?.[0];
    if (file) void loadImage(file);
    el.file.value = "";
  });

  el.zoomIn.addEventListener("click", () => stepZoom(1));
  el.zoomOut.addEventListener("click", () => stepZoom(-1));

  for (const id of ["design", "element", "page"] as TabId[]) {
    el.tabButtons[id].addEventListener("click", () => setTab(id));
  }

  el.stage.addEventListener("dblclick", () => {
    const element = selected();
    if (element?.type !== "text") return;
    setTab("element");
    el.text.focus();
    el.text.select();
  });

  el.undo.addEventListener("click", undo);
  el.duplicate.addEventListener("click", duplicateSelected);
  el.remove.addEventListener("click", deleteSelected);
  el.forward.addEventListener("click", () => moveInStack(1));
  el.backward.addEventListener("click", () => moveInStack(-1));
  el.download.addEventListener("click", downloadPage);
  el.print.addEventListener("click", () => void handlePrint());

  el.rotation.addEventListener("input", () =>
    mutate((element) => {
      element.rotation = Number(el.rotation.value);
    }, false),
  );
  el.rotation.addEventListener("change", () => refresh());
  el.rotateReset.addEventListener("click", () =>
    mutate((element) => {
      element.rotation = 0;
    }),
  );
  el.alignLeft.addEventListener("click", () => alignSelected("left"));
  el.alignCenter.addEventListener("click", () => alignSelected("center"));
  el.alignRight.addEventListener("click", () => alignSelected("right"));

  el.text.addEventListener("input", () =>
    mutateText((element) => {
      element.text = el.text.value;
    }),
  );
  el.fontSize.addEventListener("input", () =>
    mutateText((element) => {
      element.fontSize = Number(el.fontSize.value);
    }),
  );
  el.lineSpacing.addEventListener("input", () =>
    mutateText((element) => {
      element.lineSpacing = Number(el.lineSpacing.value);
    }),
  );
  el.bold.addEventListener("click", () =>
    mutateText((element) => {
      element.bold = !element.bold;
    }),
  );
  el.italic.addEventListener("click", () =>
    mutateText((element) => {
      element.italic = !element.italic;
    }),
  );
  el.textInvert.addEventListener("click", () =>
    mutateText((element) => {
      element.invert = !element.invert;
    }),
  );
  for (const button of Array.from(
    el.propsText.querySelectorAll<HTMLButtonElement>("[data-text-align]"),
  )) {
    button.addEventListener("click", () =>
      mutateText((element) => {
        element.align = button.dataset.textAlign as TextElement["align"];
      }),
    );
  }
  for (const button of Array.from(
    el.propsText.querySelectorAll<HTMLButtonElement>("[data-font]"),
  )) {
    button.addEventListener("click", () =>
      mutateText((element) => {
        element.fontFamily = button.dataset.font as TextElement["fontFamily"];
      }),
    );
  }

  const imageSliders: Array<[HTMLInputElement, keyof ImageElement]> = [
    [el.brightness, "brightness"],
    [el.contrast, "contrast"],
    [el.gamma, "gamma"],
    [el.sharpen, "sharpen"],
    [el.threshold, "threshold"],
  ];
  for (const [input, key] of imageSliders) {
    input.addEventListener("input", () =>
      mutateImage((element) => {
        (element[key] as number) = Number(input.value);
      }),
    );
  }
  el.mode.addEventListener("change", () =>
    mutateImage((element) => {
      element.mode = el.mode.value as ImageElement["mode"];
    }),
  );
  el.autoLevel.addEventListener("click", () =>
    mutateImage((element) => {
      element.autoLevel = !element.autoLevel;
    }),
  );
  el.imageInvert.addEventListener("click", () =>
    mutateImage((element) => {
      element.invert = !element.invert;
    }),
  );
  el.flipH.addEventListener("click", () =>
    mutateImage((element) => {
      element.flipHorizontal = !element.flipHorizontal;
    }),
  );
  el.flipV.addEventListener("click", () =>
    mutateImage((element) => {
      element.flipVertical = !element.flipVertical;
    }),
  );
  el.fitWidth.addEventListener("click", () =>
    mutateImage((element) => {
      const ratio = element.height / element.width;
      element.width = PRINTER_WIDTH;
      element.height = Math.round(PRINTER_WIDTH * ratio);
      element.x = 0;
    }),
  );
  el.resetAspect.addEventListener("click", () =>
    mutateImage((element) => {
      const source = sources.get(element.sourceId);
      if (!source) return;
      const crop = element.crop;
      const ratio = crop ? crop.height / crop.width : source.height / source.width;
      element.height = Math.round(element.width * ratio);
    }),
  );
  el.crop.addEventListener("click", () => {
    if (el.cropPanel.hidden) {
      openCrop();
    } else {
      el.cropPanel.hidden = true;
      setPressed(el.crop, false);
    }
  });
  el.cropClear.addEventListener("click", () => cropTool?.reset());
  el.cropDone.addEventListener("click", () => {
    el.cropPanel.hidden = true;
    setPressed(el.crop, false);
  });

  el.stickerSearch.addEventListener("input", () =>
    filterStickers(el.stickerSearch.value),
  );
  el.stickerInvert.addEventListener("click", () =>
    mutate((element) => {
      if (element.type === "sticker") element.invert = !element.invert;
    }),
  );

  el.qrData.addEventListener("input", () =>
    mutate((element) => {
      if (element.type === "qr") element.data = el.qrData.value;
    }),
  );
  for (const button of Array.from(
    el.propsQr.querySelectorAll<HTMLButtonElement>("[data-ecc]"),
  )) {
    button.addEventListener("click", () =>
      mutate((element) => {
        if (element.type === "qr") {
          element.ecc = button.dataset.ecc as "M" | "Q" | "H";
        }
      }),
    );
  }

  el.ruleStyle.addEventListener("change", () =>
    mutate((element) => {
      if (element.type === "rule") {
        element.style = el.ruleStyle.value as typeof element.style;
      }
    }),
  );
  el.ruleThickness.addEventListener("input", () =>
    mutate((element) => {
      if (element.type === "rule") {
        element.thickness = Number(el.ruleThickness.value);
      }
    }),
  );

  el.bottomMargin.addEventListener("input", () => {
    doc.bottomMargin = Number(el.bottomMargin.value);
    el.bottomMarginValue.textContent = String(doc.bottomMargin);
    refresh(false);
  });
  el.bottomMargin.addEventListener("change", () => refresh());
  el.minHeight.addEventListener("input", () => {
    doc.minHeight = Number(el.minHeight.value);
    el.minHeightValue.textContent = String(doc.minHeight);
    refresh(false);
  });
  el.minHeight.addEventListener("change", () => refresh());
  el.feed.addEventListener("input", () => {
    feedLines = Number(el.feed.value);
    el.feedValue.textContent = String(feedLines);
  });
  el.clear.addEventListener("click", () => {
    doc = emptyDocument();
    doc.border = "none";
    templateId = null;
    selectedId = null;
    clearRasterCache();
    syncTemplateGallery();
    syncPage();
    syncInspector();
    refresh();
    updatePrintButton();
  });
}

function initializeShortcuts(): void {
  window.addEventListener("keydown", (event) => {
    const target = event.target as HTMLElement | null;
    const typing =
      target?.tagName === "INPUT" ||
      target?.tagName === "TEXTAREA" ||
      target?.tagName === "SELECT";

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      undo();
      return;
    }

    if (typing) return;

    if (event.key === "Escape") {
      select(null);
      return;
    }

    if (event.key === "Delete" || event.key === "Backspace") {
      if (!selectedId) return;
      event.preventDefault();
      deleteSelected();
      return;
    }

    const step = event.shiftKey ? 10 : 1;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[event.key];
    if (move && selectedId) {
      event.preventDefault();
      mutate((element) => {
        element.x += move[0];
        element.y = Math.max(0, element.y + move[1]);
      });
    }
  });

  window.addEventListener("dragover", (event) => event.preventDefault());
  window.addEventListener("drop", (event) => {
    const file = imageFileFromDataTransfer(event.dataTransfer);
    if (!file) return;
    event.preventDefault();
    pendingReplaceId = null;
    void loadImage(file);
  });
  window.addEventListener("paste", (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
    const file = imageFileFromDataTransfer(event.clipboardData);
    if (!file) return;
    event.preventDefault();
    pendingReplaceId = null;
    void loadImage(file);
  });
}

declare global {
  interface Window {
    /** Dev-only inspection hook, handy when debugging stage interactions. */
    __studio?: () => { doc: StudioDocument; selectedId: string | null };
  }
}

async function initialize(): Promise<void> {
  if (import.meta.env.DEV) {
    window.__studio = () => ({ doc, selectedId });
  }

  for (const mode of HALFTONE_MODES) {
    const option = document.createElement("option");
    option.value = mode.value;
    option.textContent = mode.label;
    el.mode.append(option);
  }

  buildTemplateGallery();
  buildBorderGallery();
  buildStickerGrid();
  initializeControls();
  initializeShortcuts();
  fitZoom();

  const restored = await restore();
  if (!restored) {
    applyTemplate("pantry");
  }

  syncPage();
  syncInspector();
  refresh();
  history = [JSON.stringify(doc)];
  el.undo.disabled = true;

  initializeBluetoothUi(connection, {
    connectButton: el.connect,
    disconnectButton: el.disconnect,
    dependentButtons: [el.print],
    connectionStatus: el.status as HTMLParagraphElement,
    readyMessage: "Ready. Build a page, then connect and print.",
  });

  updatePrintButton();
}

void initialize();
