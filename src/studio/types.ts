import type { HalftoneMode } from "@shared/halftone.ts";

/** Crop rectangle in untransformed source-image pixels. */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type TextAlign = "left" | "center" | "right";
export type FontFamily = "sans" | "serif" | "mono";

interface ElementBase {
  id: string;
  /** Top-left of the unrotated box, in printer dots. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees clockwise about the box centre. */
  rotation: number;
}

export interface TextElement extends ElementBase {
  type: "text";
  text: string;
  fontFamily: FontFamily;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  align: TextAlign;
  lineSpacing: number;
  /** White text knocked out of a black block. */
  invert: boolean;
}

export interface ImageElement extends ElementBase {
  type: "image";
  sourceId: string;
  crop: CropRect | null;
  flipHorizontal: boolean;
  flipVertical: boolean;
  brightness: number;
  contrast: number;
  gamma: number;
  sharpen: number;
  autoLevel: boolean;
  invert: boolean;
  mode: HalftoneMode;
  threshold: number;
}

export interface StickerElement extends ElementBase {
  type: "sticker";
  sticker: string;
  invert: boolean;
}

export interface QrElement extends ElementBase {
  type: "qr";
  data: string;
  ecc: "M" | "Q" | "H";
}

export interface RuleElement extends ElementBase {
  type: "rule";
  style: "solid" | "dashed" | "dotted" | "double" | "wave";
  thickness: number;
}

export type StudioElement =
  | TextElement
  | ImageElement
  | StickerElement
  | QrElement
  | RuleElement;

export type ElementType = StudioElement["type"];

export interface StudioDocument {
  /** Painted back to front. */
  elements: StudioElement[];
  border: string;
  /** Whitespace kept below the lowest element, in dots. */
  bottomMargin: number;
  /** Shortest page the canvas will shrink to, in dots. */
  minHeight: number;
}

export const PAGE_MIN_HEIGHT = 96;
export const PAGE_MAX_HEIGHT = 4000;

export function createId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function emptyDocument(): StudioDocument {
  return {
    elements: [],
    border: "none",
    bottomMargin: 24,
    minHeight: 160,
  };
}
