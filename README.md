# YHK Mini Printer

> **Fork notice:** This project is a fork of [joshmcarthur/yhk-mini-printer](https://github.com/joshmcarthur/yhk-mini-printer), extended with a full canvas editor for text, images, stickers and borders. The original MIT licence and copyright notice are retained in [LICENSE](LICENSE).

Browser-based control for cheap BLE mini thermal printers. Connect over Web Bluetooth from Chrome and print raster images using ESC/POS (`GS v 0`) commands. Everything runs in the page — there is no server, app or account.

**Live demo:** [hmvs.github.io/yhk-mini-printer](https://hmvs.github.io/yhk-mini-printer/) (requires Chrome/Edge — Web Bluetooth needs HTTPS)

In theory, any pocket thermal printer that accepts **rasterized bytes over BLE** via an ISSC-style UART service should work. Compatibility depends on the BLE GATT profile and whether the firmware accepts ESC/POS bitmap commands (many cheap "cat printer" class devices do).

![Kmart Thermal Bluetooth Printer (model 43437771)](docs/images/kmart-43437771.png)

## Supported devices

| Device | BLE name | BLE profile | ESC/POS raster | Status | Notes |
|--------|----------|-------------|----------------|--------|-------|
| [Kmart Thermal Bluetooth Printer](https://www.kmart.co.nz/product/thermal-bluetooth-printer-43437771/) (SKU 43437771) | `YHK-*` | ISSC UART | `GS v 0` | **Tested** | Primary dev device; 58mm head, ~384 dots wide |
| YHK-962D | `YHK-*` | ISSC UART | `GS v 0` | **Tested** | Same class of printer as above |

### Compatibility criteria

A printer is likely compatible if it meets all of:

1. **BLE peripheral** with a UART-like GATT service (ISSC `49535343-…` is common on this hardware).
2. **Writable TX characteristic** supporting `writeWithoutResponse`.
3. **ESC/POS raster** — accepts `GS v 0` (`1D 76 30 00`) bitmap data; text commands may not work.
4. **~384 dot print width** (48 bytes/row) for 58mm paper — adjust image width if your model differs.

Printers using a different BLE service UUID, a proprietary binary protocol (e.g. cat-printer `0xAE30`), or Classic Bluetooth SPP only will **not** work without a new transport implementation.

If you get a connection but garbled output, see [protocol.md](docs/protocol.md) for UUID discovery and pacing tuning.

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in **Chrome or Edge**.

1. Power on the printer (disconnect from phone apps first).
2. Click **Connect** → select `YHK-...` in the picker.
3. Click **Print a picture** to print a photo or PDF as-is, or pick a template and add your own text, images and stickers.
4. Choose a darkness on the **Print** tab, then click **Print**.

## Print Studio

One canvas for everything you print. The page is 384 dots wide — the width of the head — and **grows as you add content and shrinks back when you move things up**, so you only ever feed as much paper as the design needs.

**Layout** — the page sits on the left (sticky on desktop, pinned above the controls on a phone) with a zoom control; everything else lives in a three-tab inspector: **Design** for template and border pickers (both are visual galleries of real previews, not dropdowns), **Element** for a layer list plus the selected element's settings, and **Print** for darkness, paper, feed and printer details.

**Print a picture or PDF** — the **Print a picture** button replaces the page with an image or PDF fitted to the full paper width. Landscape pictures and pages are turned sideways so they use the whole head, the way the WalkPrint app does. Each PDF page is rendered in the browser with [pdf.js](https://mozilla.github.io/pdf.js/) and stacked down the paper, up to 50 cm per print. Photos default to auto-levelled Floyd–Steinberg dithering; PDFs default to a plain threshold, which keeps text sharp. Every picture is still an ordinary image element, so you can crop it, change the dither style, **Turn 90°** it, or add text and stickers on top. Images and PDFs can also be dropped or pasted onto the window, which adds them to the current page.

**Postage labels** — **Postage label** takes a carrier's label PDF (built against Australia Post MyPost Business labels, on A4 or label stock) and re-flows it onto the 48 mm head:

- Every barcode on the label is decoded with [zxing-cpp](https://github.com/zxing-cpp/zxing-cpp) (WebAssembly, served from this site). Matrix codes such as DataMatrix are redrawn from the decoder's exact module grid. Linear codes such as Code 128 are redrawn from the bar widths measured on the page — the very symbol the carrier printed, never a re-encode — at whole printer dots and turned to run along the paper.
- The rest of the label (header, address boxes, sender, declaration, captions) is cut along its ruled boxes, scaled to fit and stacked down the strip, with each barcode's human-readable text kept beside it.
- The finished strip is decoded again, and the label is refused unless every code reads back byte-for-byte identical.

The result is one 1-bit image at exactly the head width, placed dot for dot — move it if you like, but don't resize it. A typical Parcel Post label comes out about 22 cm long. Check that your carrier accepts a label at this size before relying on it.

**Darkness** — how much heat the head burns into the paper (the `density` byte of the job header). **Light** (20), **Moderate** (25, WalkPrint's default) and **Dark** (30) mirror the app's presets; drag the slider for a custom level from 1 to 40. Darker prints are bolder but slower. The choice is remembered in this browser.

**Elements** — add text, images, stickers, QR codes and rules. Every element is **draggable, resizable and rotatable** directly on the canvas: drag the body to move, pull a square handle to resize, and use the round handle above the box to rotate (hold <kbd>Shift</kbd> to snap to 15°). Arrow keys nudge, <kbd>Delete</kbd> removes, <kbd>⌘/Ctrl</kbd>+<kbd>Z</kbd> undoes, and elements snap to the page centre and edges as you drag.

| Element | What you can change |
|---------|---------------------|
| Text | Content, sans/serif/mono, size, bold, italic, alignment, line spacing, knockout (white on black). Boxes auto-fit their wrapped text; corner handles scale the type |
| Image | Drop, paste or browse — PNG, JPEG, WebP, GIF, SVG or PDF. Crop, flip, brightness, contrast, gamma, sharpen, auto-level, invert, nine halftone algorithms and a threshold — dithered live at the size it is placed |
| Sticker | 30 monochrome vector stickers — stars, hearts, arrows, weather, animals, scissors and more — with an optional knockout |
| QR | Any payload, three error-correction levels, drawn at whole-module sizes so it always scans |
| Line | Solid, dashed, dotted, double or wave rules of any thickness |

**Borders** — 18 frame templates: hairline, thin, bold, double, rounded, dashed, dotted, ticket stub with punched notches, scallop, zigzag, corner brackets, deco, wave, star/heart/flower motif frames and a dashed cut-here line.

**Templates** — pantry jar, freezer bag, use-by date, cable flag, storage box, address, price tag, name badge, gift tag, Wi-Fi card, event ticket, to-do note, coupon, or a blank page. A template drops real elements on the canvas (with today's dates filled in) — everything stays editable afterwards.

**Output** — the canvas is a live 1-bit preview: exactly the dots that will be burned. The readout gives page size in dots and millimetres, ink coverage and job size; **Save PNG** exports the same bitmap. The page (including its images) is kept in `sessionStorage`, so a reload does not lose your work.

## Requirements

| | |
|---|---|
| **Browser** | Chrome or Edge (desktop/Android). Safari and iOS do not implement Web Bluetooth. |
| **Host** | `localhost` or HTTPS |
| **Printer** | BLE thermal with ISSC UART + ESC/POS raster (see [Supported devices](#supported-devices)) |

## Privacy and data flow

The web app has no analytics, advertising, tracking pixels, cookies, telemetry, or third-party API calls. Everything you place on the canvas is rendered in your browser; when you print, the raster data goes directly from that browser to the selected Bluetooth printer. Your page — including any images you add — is stored only in that browser's `sessionStorage` and is discarded when the browser session ends.

GitHub Pages necessarily receives normal web-hosting requests for the app assets (such as your IP address and browser request metadata), but the app does not submit your print content to GitHub or another service.

## Documentation

| Doc | Contents |
|-----|----------|
| [Architecture](docs/architecture.md) | Modules, transport interface, print pipeline |
| [Protocol](docs/protocol.md) | BLE UUIDs, ESC/POS, chunk pacing, tuning |
| [Exploration notes](docs/exploration/chatgpt.md) | Early research and UUID discovery |

## Project layout

```
shared/
├── constants.ts               # PRINTER_WIDTH, BLE pacing constants
├── escpos.ts                  # ESC/POS encoding + job framing
└── halftone.ts                # Grayscale, tone adjustments, 9 halftone algorithms
src/
├── main.ts                    # Print Studio page controller
├── studio/
│   ├── types.ts               # Document + element model
│   ├── stage.ts               # Canvas selection, drag, resize, rotate
│   ├── render.ts              # Page composition → 1-bit pixels
│   ├── raster.ts              # Crop, flip, resize, dither for image elements
│   ├── stickers.ts            # 30 vector stickers
│   ├── borders.ts             # 18 border templates
│   ├── templates.ts           # Ready-made pages
│   ├── source.ts              # File / paste / drop image loading
│   ├── pdf.ts                 # PDF pages → canvases (pdf.js, loaded on demand)
│   ├── postage.ts             # Postage label PDF → verified 48 mm strip
│   └── crop-tool.ts           # Interactive crop overlay
├── ui/connection.ts           # Shared BLE connect UI
├── transport.ts               # PrinterTransport + paced sendChunked()
└── transport/web-bluetooth.ts # Web Bluetooth transport
```

## Build

```bash
npm run build          # local build (base /)
npm run build:pages    # GitHub Pages build (base /yhk-mini-printer/)
npm run preview        # serve production build locally
```

Deploys to GitHub Pages automatically on push to `main` via [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Bottom of image missing | Increase `BLE_CHUNK_DELAY_MS` in [`shared/constants.ts`](shared/constants.ts) (try 50–60) |
| Service not found | Wrong UUIDs — see [protocol.md](docs/protocol.md#uuid-discovery) |
| Upside-down output | Rotate the element 180° with its rotation handle before printing |
| Print too faint or too dark | Adjust an image's contrast/gamma, or switch halftone algorithm (Atkinson is lightest) |
| Web Bluetooth unavailable | Use Chrome/Edge on localhost or HTTPS |

## License

MIT
