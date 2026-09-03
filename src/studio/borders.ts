import { renderSticker } from "./stickers.ts";

export interface BorderTemplate {
  id: string;
  name: string;
  /** Whitespace the frame occupies, so templates can inset their content. */
  inset: number;
  draw: (context: CanvasRenderingContext2D, width: number, height: number) => void;
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function frame(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  inset: number,
  thickness: number,
): void {
  context.lineWidth = thickness;
  context.strokeRect(
    inset + thickness / 2,
    inset + thickness / 2,
    width - (inset + thickness / 2) * 2,
    height - (inset + thickness / 2) * 2,
  );
}

/** Walks the frame rectangle, calling `stamp` at a roughly even spacing. */
function alongFrame(
  width: number,
  height: number,
  inset: number,
  spacing: number,
  stamp: (x: number, y: number, angle: number) => void,
): void {
  const left = inset;
  const top = inset;
  const right = width - inset;
  const bottom = height - inset;
  const edges: Array<[number, number, number, number, number]> = [
    [left, top, right, top, 0],
    [right, top, right, bottom, Math.PI / 2],
    [right, bottom, left, bottom, Math.PI],
    [left, bottom, left, top, -Math.PI / 2],
  ];

  for (const [x1, y1, x2, y2, angle] of edges) {
    const length = Math.hypot(x2 - x1, y2 - y1);
    const count = Math.max(1, Math.round(length / spacing));
    for (let index = 0; index < count; index++) {
      const t = index / count;
      stamp(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, angle);
    }
  }
}

function motifBorder(stickerId: string, size: number) {
  return (
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
  ): void => {
    const motif = renderSticker(stickerId, size, size);
    alongFrame(width, height, 4, size + 4, (x, y) => {
      context.drawImage(motif, x - size / 2, y - size / 2, size, size);
    });
  };
}

export const BORDERS: BorderTemplate[] = [
  { id: "none", name: "None", inset: 0, draw: () => undefined },
  {
    id: "hairline",
    name: "Hairline",
    inset: 8,
    draw: (c, w, h) => frame(c, w, h, 6, 1),
  },
  {
    id: "thin",
    name: "Thin rule",
    inset: 10,
    draw: (c, w, h) => frame(c, w, h, 6, 2),
  },
  {
    id: "bold",
    name: "Bold",
    inset: 14,
    draw: (c, w, h) => frame(c, w, h, 5, 6),
  },
  {
    id: "double",
    name: "Double rule",
    inset: 16,
    draw: (c, w, h) => {
      frame(c, w, h, 4, 3);
      frame(c, w, h, 12, 1);
    },
  },
  {
    id: "rounded",
    name: "Rounded",
    inset: 14,
    draw: (c, w, h) => {
      c.lineWidth = 3;
      roundedRect(c, 6, 6, w - 12, h - 12, 18);
      c.stroke();
    },
  },
  {
    id: "dashed",
    name: "Dashed",
    inset: 12,
    draw: (c, w, h) => {
      c.save();
      c.setLineDash([10, 7]);
      frame(c, w, h, 6, 3);
      c.restore();
    },
  },
  {
    id: "dotted",
    name: "Dotted",
    inset: 12,
    draw: (c, w, h) => {
      alongFrame(w, h, 8, 9, (x, y) => {
        c.beginPath();
        c.arc(x, y, 2.5, 0, Math.PI * 2);
        c.fill();
      });
    },
  },
  {
    id: "ticket",
    name: "Ticket stub",
    inset: 18,
    draw: (c, w, h) => {
      c.lineWidth = 3;
      roundedRect(c, 6, 6, w - 12, h - 12, 10);
      c.stroke();
      // Punched notches read as a torn-off ticket.
      for (const [x, y] of [
        [6, h / 2],
        [w - 6, h / 2],
      ]) {
        c.save();
        c.fillStyle = "#ffffff";
        c.beginPath();
        c.arc(x, y, 11, 0, Math.PI * 2);
        c.fill();
        c.restore();
        c.beginPath();
        c.arc(x, y, 11, 0, Math.PI * 2);
        c.lineWidth = 3;
        c.stroke();
      }
    },
  },
  {
    id: "scallop",
    name: "Scallop",
    inset: 20,
    draw: (c, w, h) => {
      c.lineWidth = 2;
      alongFrame(w, h, 12, 14, (x, y, angle) => {
        c.beginPath();
        c.arc(x, y, 7, angle + Math.PI, angle);
        c.stroke();
      });
      frame(c, w, h, 12, 2);
    },
  },
  {
    id: "zigzag",
    name: "Zigzag",
    inset: 20,
    draw: (c, w, h) => {
      c.lineWidth = 2.5;
      c.lineJoin = "miter";
      c.beginPath();
      let started = false;
      alongFrame(w, h, 12, 10, (x, y, angle) => {
        const offsetX = Math.cos(angle - Math.PI / 2) * 6;
        const offsetY = Math.sin(angle - Math.PI / 2) * 6;
        const pointX = started ? x + offsetX : x - offsetX;
        const pointY = started ? y + offsetY : y - offsetY;
        if (!started) {
          c.moveTo(pointX, pointY);
          started = true;
        } else {
          c.lineTo(pointX, pointY);
          started = false;
        }
      });
      c.closePath();
      c.stroke();
    },
  },
  {
    id: "corners",
    name: "Corner brackets",
    inset: 16,
    draw: (c, w, h) => {
      const size = Math.min(46, Math.min(w, h) / 3);
      c.lineWidth = 5;
      c.lineCap = "butt";
      const corners: Array<[number, number, number, number]> = [
        [8, 8, 1, 1],
        [w - 8, 8, -1, 1],
        [8, h - 8, 1, -1],
        [w - 8, h - 8, -1, -1],
      ];
      for (const [x, y, dx, dy] of corners) {
        c.beginPath();
        c.moveTo(x + dx * size, y);
        c.lineTo(x, y);
        c.lineTo(x, y + dy * size);
        c.stroke();
      }
    },
  },
  {
    id: "deco",
    name: "Deco",
    inset: 20,
    draw: (c, w, h) => {
      frame(c, w, h, 5, 2);
      frame(c, w, h, 13, 1);
      const diamonds: Array<[number, number]> = [
        [9, 9],
        [w - 9, 9],
        [9, h - 9],
        [w - 9, h - 9],
      ];
      for (const [x, y] of diamonds) {
        c.save();
        c.translate(x, y);
        c.rotate(Math.PI / 4);
        c.fillRect(-5, -5, 10, 10);
        c.restore();
      }
    },
  },
  {
    id: "wave",
    name: "Wave",
    inset: 22,
    draw: (c, w, h) => {
      c.lineWidth = 2.5;
      for (const [y, direction] of [
        [10, 1],
        [h - 10, -1],
      ] as Array<[number, number]>) {
        c.beginPath();
        for (let x = 8; x <= w - 8; x += 2) {
          const offset = Math.sin((x / 18) * Math.PI) * 5 * direction;
          if (x === 8) c.moveTo(x, y + offset);
          else c.lineTo(x, y + offset);
        }
        c.stroke();
      }
      c.beginPath();
      c.moveTo(10, 14);
      c.lineTo(10, h - 14);
      c.moveTo(w - 10, 14);
      c.lineTo(w - 10, h - 14);
      c.stroke();
    },
  },
  { id: "stars", name: "Stars", inset: 22, draw: motifBorder("star", 16) },
  { id: "hearts", name: "Hearts", inset: 22, draw: motifBorder("heart", 16) },
  { id: "flowers", name: "Flowers", inset: 24, draw: motifBorder("flower", 18) },
  {
    id: "cut-here",
    name: "Cut here",
    inset: 16,
    draw: (c, w, h) => {
      c.save();
      c.setLineDash([6, 5]);
      c.lineWidth = 2;
      c.strokeRect(7, 7, w - 14, h - 14);
      c.restore();
      const scissors = renderSticker("scissors", 22, 22);
      c.drawImage(scissors, 12, -4, 22, 22);
    },
  },
];

const BORDER_INDEX = new Map(BORDERS.map((border) => [border.id, border]));

export function getBorder(id: string): BorderTemplate {
  return BORDER_INDEX.get(id) ?? (BORDERS[0] as BorderTemplate);
}

export function borderInset(id: string): number {
  return getBorder(id).inset;
}

export function drawBorder(
  context: CanvasRenderingContext2D,
  id: string,
  width: number,
  height: number,
): void {
  const border = getBorder(id);
  context.save();
  context.fillStyle = "#000000";
  context.strokeStyle = "#000000";
  context.lineCap = "butt";
  context.lineJoin = "miter";
  border.draw(context, width, height);
  context.restore();
}
