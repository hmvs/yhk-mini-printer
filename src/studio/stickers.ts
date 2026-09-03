/**
 * Monochrome vector stickers, drawn on a 100×100 unit canvas so they scale to
 * any element size and stay crisp after the 1-bit threshold.
 */
export interface Sticker {
  id: string;
  name: string;
  draw: (context: CanvasRenderingContext2D) => void;
}

function polygon(
  context: CanvasRenderingContext2D,
  points: Array<[number, number]>,
): void {
  context.beginPath();
  points.forEach(([x, y], index) => {
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.closePath();
  context.fill();
}

function starPoints(
  spikes: number,
  outer: number,
  inner: number,
): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (let index = 0; index < spikes * 2; index++) {
    const radius = index % 2 === 0 ? outer : inner;
    const angle = (Math.PI * index) / spikes - Math.PI / 2;
    points.push([50 + radius * Math.cos(angle), 50 + radius * Math.sin(angle)]);
  }
  return points;
}

function heartPath(context: CanvasRenderingContext2D): void {
  context.beginPath();
  context.moveTo(50, 88);
  context.bezierCurveTo(6, 58, 12, 20, 34, 18);
  context.bezierCurveTo(44, 17, 50, 25, 50, 31);
  context.bezierCurveTo(50, 25, 56, 17, 66, 18);
  context.bezierCurveTo(88, 20, 94, 58, 50, 88);
  context.closePath();
}

function line(
  context: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number,
): void {
  context.lineWidth = width;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.stroke();
}

function ring(
  context: CanvasRenderingContext2D,
  radius: number,
  thickness: number,
): void {
  context.lineWidth = thickness;
  context.beginPath();
  context.arc(50, 50, radius, 0, Math.PI * 2);
  context.stroke();
}

function dot(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
): void {
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();
}

export const STICKERS: Sticker[] = [
  {
    id: "star",
    name: "Star",
    draw: (c) => polygon(c, starPoints(5, 46, 19)),
  },
  {
    id: "burst",
    name: "Burst",
    draw: (c) => polygon(c, starPoints(12, 47, 30)),
  },
  {
    id: "heart",
    name: "Heart",
    draw: (c) => {
      heartPath(c);
      c.fill();
    },
  },
  {
    id: "heart-outline",
    name: "Heart outline",
    draw: (c) => {
      heartPath(c);
      c.lineWidth = 8;
      c.stroke();
    },
  },
  { id: "dot", name: "Dot", draw: (c) => dot(c, 50, 50, 42) },
  { id: "ring", name: "Ring", draw: (c) => ring(c, 40, 10) },
  {
    id: "square",
    name: "Square",
    draw: (c) => c.fillRect(10, 10, 80, 80),
  },
  {
    id: "square-outline",
    name: "Square outline",
    draw: (c) => {
      c.lineWidth = 8;
      c.strokeRect(12, 12, 76, 76);
    },
  },
  {
    id: "triangle",
    name: "Triangle",
    draw: (c) => polygon(c, [[50, 8], [92, 88], [8, 88]]),
  },
  {
    id: "diamond",
    name: "Diamond",
    draw: (c) => polygon(c, [[50, 6], [94, 50], [50, 94], [6, 50]]),
  },
  {
    id: "arrow",
    name: "Arrow",
    draw: (c) =>
      polygon(c, [
        [8, 38],
        [58, 38],
        [58, 16],
        [94, 50],
        [58, 84],
        [58, 62],
        [8, 62],
      ]),
  },
  {
    id: "check",
    name: "Tick",
    draw: (c) => {
      c.lineWidth = 14;
      c.lineCap = "round";
      c.lineJoin = "round";
      c.beginPath();
      c.moveTo(14, 52);
      c.lineTo(40, 78);
      c.lineTo(88, 22);
      c.stroke();
    },
  },
  {
    id: "cross",
    name: "Cross",
    draw: (c) => {
      line(c, 18, 18, 82, 82, 14);
      line(c, 82, 18, 18, 82, 14);
    },
  },
  {
    id: "plus",
    name: "Plus",
    draw: (c) => {
      c.fillRect(41, 12, 18, 76);
      c.fillRect(12, 41, 76, 18);
    },
  },
  {
    id: "bolt",
    name: "Lightning",
    draw: (c) =>
      polygon(c, [[58, 4], [22, 56], [45, 56], [38, 96], [78, 40], [53, 40]]),
  },
  {
    id: "sun",
    name: "Sun",
    draw: (c) => {
      dot(c, 50, 50, 24);
      for (let index = 0; index < 8; index++) {
        const angle = (Math.PI * index) / 4;
        line(
          c,
          50 + Math.cos(angle) * 32,
          50 + Math.sin(angle) * 32,
          50 + Math.cos(angle) * 46,
          50 + Math.sin(angle) * 46,
          8,
        );
      }
    },
  },
  {
    id: "moon",
    name: "Moon",
    draw: (c) => {
      c.beginPath();
      c.arc(50, 50, 42, 0, Math.PI * 2);
      c.arc(70, 40, 38, 0, Math.PI * 2, true);
      c.fill("evenodd");
    },
  },
  {
    id: "cloud",
    name: "Cloud",
    draw: (c) => {
      dot(c, 34, 56, 20);
      dot(c, 54, 44, 26);
      dot(c, 74, 58, 18);
      c.fillRect(34, 58, 40, 18);
    },
  },
  {
    id: "snowflake",
    name: "Snowflake",
    draw: (c) => {
      for (let index = 0; index < 6; index++) {
        const angle = (Math.PI * index) / 3;
        const tipX = 50 + Math.cos(angle) * 44;
        const tipY = 50 + Math.sin(angle) * 44;
        line(c, 50, 50, tipX, tipY, 7);
        const barbX = 50 + Math.cos(angle) * 28;
        const barbY = 50 + Math.sin(angle) * 28;
        line(
          c,
          barbX,
          barbY,
          barbX + Math.cos(angle + 0.9) * 14,
          barbY + Math.sin(angle + 0.9) * 14,
          5,
        );
        line(
          c,
          barbX,
          barbY,
          barbX + Math.cos(angle - 0.9) * 14,
          barbY + Math.sin(angle - 0.9) * 14,
          5,
        );
      }
    },
  },
  {
    id: "flower",
    name: "Flower",
    draw: (c) => {
      for (let index = 0; index < 6; index++) {
        const angle = (Math.PI * index) / 3;
        dot(c, 50 + Math.cos(angle) * 26, 50 + Math.sin(angle) * 26, 18);
      }
      c.save();
      c.globalCompositeOperation = "destination-out";
      dot(c, 50, 50, 14);
      c.restore();
    },
  },
  {
    id: "paw",
    name: "Paw",
    draw: (c) => {
      dot(c, 26, 42, 13);
      dot(c, 44, 28, 13);
      dot(c, 64, 30, 13);
      dot(c, 80, 46, 12);
      c.beginPath();
      c.ellipse(52, 68, 26, 22, 0, 0, Math.PI * 2);
      c.fill();
    },
  },
  {
    id: "smiley",
    name: "Smiley",
    draw: (c) => {
      ring(c, 42, 8);
      dot(c, 36, 40, 6);
      dot(c, 64, 40, 6);
      c.lineWidth = 8;
      c.lineCap = "round";
      c.beginPath();
      c.arc(50, 52, 24, 0.35 * Math.PI, 0.65 * Math.PI);
      c.stroke();
    },
  },
  {
    id: "warning",
    name: "Warning",
    draw: (c) => {
      c.lineWidth = 9;
      c.lineJoin = "round";
      c.beginPath();
      c.moveTo(50, 10);
      c.lineTo(94, 86);
      c.lineTo(6, 86);
      c.closePath();
      c.stroke();
      c.fillRect(45, 36, 10, 28);
      dot(c, 50, 74, 6);
    },
  },
  {
    id: "pin",
    name: "Map pin",
    draw: (c) => {
      c.beginPath();
      c.arc(50, 38, 28, Math.PI, 0);
      c.lineTo(50, 94);
      c.closePath();
      c.fill();
      c.save();
      c.globalCompositeOperation = "destination-out";
      dot(c, 50, 36, 11);
      c.restore();
    },
  },
  {
    id: "note",
    name: "Music note",
    draw: (c) => {
      c.fillRect(44, 12, 8, 60);
      c.fillRect(44, 12, 34, 9);
      c.fillRect(70, 12, 8, 52);
      c.beginPath();
      c.ellipse(34, 74, 16, 12, -0.3, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.ellipse(60, 66, 16, 12, -0.3, 0, Math.PI * 2);
      c.fill();
    },
  },
  {
    id: "envelope",
    name: "Envelope",
    draw: (c) => {
      c.lineWidth = 7;
      c.lineJoin = "round";
      c.strokeRect(10, 24, 80, 54);
      c.beginPath();
      c.moveTo(10, 24);
      c.lineTo(50, 56);
      c.lineTo(90, 24);
      c.stroke();
    },
  },
  {
    id: "clock",
    name: "Clock",
    draw: (c) => {
      ring(c, 40, 8);
      line(c, 50, 50, 50, 26, 7);
      line(c, 50, 50, 68, 58, 7);
    },
  },
  {
    id: "leaf",
    name: "Leaf",
    draw: (c) => {
      c.beginPath();
      c.moveTo(16, 84);
      c.bezierCurveTo(16, 30, 52, 12, 88, 14);
      c.bezierCurveTo(90, 52, 66, 86, 16, 84);
      c.closePath();
      c.fill();
      c.save();
      c.globalCompositeOperation = "destination-out";
      c.lineWidth = 6;
      c.beginPath();
      c.moveTo(22, 82);
      c.bezierCurveTo(44, 62, 62, 44, 84, 20);
      c.stroke();
      c.restore();
    },
  },
  {
    id: "cup",
    name: "Coffee",
    draw: (c) => {
      c.lineWidth = 7;
      c.beginPath();
      c.moveTo(18, 40);
      c.lineTo(18, 74);
      c.quadraticCurveTo(18, 88, 34, 88);
      c.lineTo(58, 88);
      c.quadraticCurveTo(74, 88, 74, 74);
      c.lineTo(74, 40);
      c.closePath();
      c.stroke();
      c.beginPath();
      c.arc(74, 56, 14, -Math.PI / 2, Math.PI / 2);
      c.stroke();
      line(c, 34, 12, 34, 28, 6);
      line(c, 52, 8, 52, 26, 6);
    },
  },
  {
    id: "cat",
    name: "Cat",
    draw: (c) => {
      polygon(c, [[20, 44], [24, 12], [48, 30]]);
      polygon(c, [[80, 44], [76, 12], [52, 30]]);
      ring(c, 32, 8);
      dot(c, 38, 46, 5);
      dot(c, 62, 46, 5);
      polygon(c, [[50, 58], [45, 53], [55, 53]]);
      line(c, 22, 52, 34, 56, 4);
      line(c, 78, 52, 66, 56, 4);
      line(c, 22, 64, 34, 62, 4);
      line(c, 78, 64, 66, 62, 4);
    },
  },
  {
    id: "scissors",
    name: "Cut here",
    draw: (c) => {
      c.lineWidth = 6;
      c.lineCap = "round";
      c.beginPath();
      c.arc(26, 74, 12, 0, Math.PI * 2);
      c.moveTo(74, 62);
      c.arc(74, 74, 12, 0, Math.PI * 2);
      c.stroke();
      line(c, 34, 66, 78, 16, 7);
      line(c, 66, 66, 22, 16, 7);
    },
  },
];

const STICKER_INDEX = new Map(STICKERS.map((sticker) => [sticker.id, sticker]));

export function getSticker(id: string): Sticker {
  return STICKER_INDEX.get(id) ?? (STICKERS[0] as Sticker);
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

/**
 * Stickers draw on their own transparent buffer: several punch holes with
 * `destination-out`, which would otherwise erase the page underneath.
 */
export function renderSticker(
  id: string,
  width: number,
  height: number,
  invert = false,
): HTMLCanvasElement {
  const ink = createCanvas(width, height);
  const context = ink.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D context is not available.");
  }

  context.scale(ink.width / 100, ink.height / 100);
  context.fillStyle = "#000000";
  context.strokeStyle = "#000000";
  context.lineWidth = 6;
  context.lineCap = "butt";
  context.lineJoin = "miter";
  getSticker(id).draw(context);

  if (!invert) {
    return ink;
  }

  // Knock the shape out of a black block so the page shows through as white.
  const inverted = createCanvas(width, height);
  const invertedContext = inverted.getContext("2d");
  if (!invertedContext) {
    throw new Error("Canvas 2D context is not available.");
  }
  invertedContext.fillStyle = "#000000";
  invertedContext.fillRect(0, 0, inverted.width, inverted.height);
  invertedContext.globalCompositeOperation = "destination-out";
  invertedContext.drawImage(ink, 0, 0);
  return inverted;
}
