import { PRINTER_WIDTH } from "@shared/constants.ts";
import { elementHeight } from "./render.ts";
import { createId, type StudioDocument, type StudioElement } from "./types.ts";

export interface StudioTemplate {
  id: string;
  name: string;
  hint: string;
  build: () => StudioDocument;
}

interface TextOptions {
  x?: number;
  width?: number;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  align?: "left" | "center" | "right";
  family?: "sans" | "serif" | "mono";
  invert?: boolean;
  spacing?: number;
  rotation?: number;
}

function text(
  value: string,
  y: number,
  options: TextOptions = {},
): StudioElement {
  const width = options.width ?? PRINTER_WIDTH - 80;
  return {
    id: createId(),
    type: "text",
    x: options.x ?? Math.round((PRINTER_WIDTH - width) / 2),
    y,
    width,
    height: 40,
    rotation: options.rotation ?? 0,
    text: value,
    fontFamily: options.family ?? "sans",
    fontSize: options.size ?? 22,
    bold: options.bold ?? false,
    italic: options.italic ?? false,
    align: options.align ?? "center",
    lineSpacing: options.spacing ?? 1.25,
    invert: options.invert ?? false,
  };
}

function sticker(
  id: string,
  x: number,
  y: number,
  size: number,
  rotation = 0,
): StudioElement {
  return {
    id: createId(),
    type: "sticker",
    x,
    y,
    width: size,
    height: size,
    rotation,
    sticker: id,
    invert: false,
  };
}

function rule(
  y: number,
  style: "solid" | "dashed" | "dotted" | "double" | "wave" = "solid",
  inset = 48,
): StudioElement {
  return {
    id: createId(),
    type: "rule",
    x: inset,
    y,
    width: PRINTER_WIDTH - inset * 2,
    height: 10,
    rotation: 0,
    style,
    thickness: 2,
  };
}

function qr(data: string, x: number, y: number, size: number): StudioElement {
  return {
    id: createId(),
    type: "qr",
    x,
    y,
    width: size,
    height: size,
    rotation: 0,
    data,
    ecc: "H",
  };
}

function page(
  border: string,
  elements: StudioElement[],
  minHeight = 160,
): StudioDocument {
  return { elements, border, bottomMargin: 24, minHeight };
}

/**
 * Stacks elements top to bottom. Text boxes size themselves to their content,
 * so laying templates out by hand is how overlaps sneak in.
 */
function stack(
  startY: number,
  gap: number,
  elements: StudioElement[],
): StudioElement[] {
  let y = startY;
  for (const element of elements) {
    element.y = Math.round(y);
    y += elementHeight(element) + gap;
  }
  return elements;
}

function today(offsetDays = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function now(): string {
  return new Date().toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Templates are starting points: they drop real elements on the page, and
 * every one of them stays draggable, rotatable and editable afterwards.
 */
export const TEMPLATES: StudioTemplate[] = [
  {
    id: "blank",
    name: "Blank page",
    hint: "Empty canvas — add your own elements.",
    build: () => page("none", []),
  },
  {
    id: "pantry",
    name: "Pantry jar",
    hint: "Decanted staples: what it is and when it was opened.",
    build: () =>
      page(
        "deco",
        stack(30, 6, [
          text("RICE", 0, { size: 40, bold: true }),
          text(`Jasmine · opened ${today()}`, 0, { size: 18 }),
        ]),
      ),
  },
  {
    id: "freezer",
    name: "Freezer bag",
    hint: "Contents with frozen-on and use-by dates.",
    build: () =>
      page("bold", [
        sticker("snowflake", 26, 30, 44),
        ...stack(28, 6, [
          text("CHICKEN THIGHS", 0, {
            size: 26,
            bold: true,
            width: 240,
            x: 84,
          }),
          text(`Frozen ${today()}\nUse by ${today(90)}`, 0, {
            size: 17,
            width: 240,
            x: 84,
          }),
        ]),
      ]),
  },
  {
    id: "use-by",
    name: "Use-by date",
    hint: "Small dated sticker for leftovers.",
    build: () =>
      page(
        "dashed",
        stack(28, 0, [text(`USE BY\n${today(7)}`, 0, { size: 30, bold: true })]),
        130,
      ),
  },
  {
    id: "cable",
    name: "Cable flag",
    hint: "Short flag to wrap around a cable end.",
    build: () =>
      page(
        "corners",
        stack(26, 4, [
          text("HDMI", 0, { size: 30, bold: true }),
          text("TV → Console", 0, { size: 16 }),
        ]),
        120,
      ),
  },
  {
    id: "storage",
    name: "Storage box",
    hint: "Big box number with contents underneath.",
    build: () =>
      page(
        "thin",
        stack(28, 6, [
          text("BOX 04", 0, { size: 48, bold: true }),
          rule(0, "double"),
          text("Winter clothes · attic", 0, { size: 18 }),
        ]),
      ),
  },
  {
    id: "address",
    name: "Address",
    hint: "Parcel address block, left aligned.",
    build: () =>
      page(
        "hairline",
        stack(28, 8, [
          text("Jane Doe", 0, {
            size: 26,
            bold: true,
            align: "left",
            x: 30,
            width: 320,
          }),
          text("12 Example Street\nSuburb, City 1010\nNew Zealand", 0, {
            size: 19,
            align: "left",
            x: 30,
            width: 320,
          }),
        ]),
      ),
  },
  {
    id: "price",
    name: "Price tag",
    hint: "Market stall pricing with a tear-off stub.",
    build: () =>
      page(
        "ticket",
        stack(28, 4, [
          text("$12.50", 0, { size: 44, bold: true }),
          text("Ceramic mug", 0, { size: 18, italic: true }),
        ]),
        140,
      ),
  },
  {
    id: "badge",
    name: "Name badge",
    hint: "Workshop badge with a starry frame.",
    build: () =>
      page(
        "stars",
        stack(42, 6, [
          text("HELLO, I'M", 0, { size: 16, spacing: 1.1 }),
          text("ALEX", 0, { size: 52, bold: true }),
          text("Design team", 0, { size: 18, italic: true }),
        ]),
      ),
  },
  {
    id: "gift",
    name: "Gift tag",
    hint: "Hearts frame with a to/from note.",
    build: () =>
      page("hearts", [
        sticker("heart", 168, 36, 48),
        ...stack(94, 4, [
          text("For you", 0, { size: 30, bold: true, family: "serif" }),
          text("— with love", 0, { size: 18, italic: true, family: "serif" }),
        ]),
      ]),
  },
  {
    id: "wifi",
    name: "Wi-Fi card",
    hint: "Scannable network card for guests.",
    build: () =>
      page(
        "rounded",
        stack(28, 10, [
          text("GUEST WI-FI", 0, { size: 24, bold: true }),
          qr("WIFI:T:WPA;S:MyNetwork;P:changeme;;", 112, 0, 160),
          text("MyNetwork · changeme", 0, { size: 16, family: "mono" }),
        ]),
      ),
  },
  {
    id: "ticket",
    name: "Event ticket",
    hint: "Title, details and a scannable code.",
    build: () =>
      page(
        "ticket",
        stack(28, 8, [
          text("GIG NIGHT", 0, { size: 30, bold: true }),
          rule(0, "dashed"),
          text(`${today(14)} · doors ${now()}`, 0, { size: 17 }),
          qr("https://example.com/ticket/1234", 122, 0, 140),
          text("ADMIT ONE", 0, { size: 16, family: "mono" }),
        ]),
      ),
  },
  {
    id: "note",
    name: "To-do note",
    hint: "Checklist lines you can type over.",
    build: () =>
      page(
        "wave",
        stack(30, 10, [
          text("TO DO", 0, { size: 30, bold: true }),
          text("☐ First thing\n☐ Second thing\n☐ Third thing", 0, {
            size: 20,
            align: "left",
            x: 44,
            width: 296,
            spacing: 1.6,
          }),
        ]),
      ),
  },
  {
    id: "coupon",
    name: "Coupon",
    hint: "Cut-along-the-line voucher.",
    build: () =>
      page(
        "cut-here",
        stack(36, 10, [
          text("ONE FREE COFFEE", 0, { size: 26, bold: true }),
          sticker("cup", 160, 0, 64),
          text(`Valid until ${today(30)}`, 0, { size: 16 }),
        ]),
      ),
  },
];

export function getTemplate(id: string): StudioTemplate | undefined {
  return TEMPLATES.find((template) => template.id === id);
}
