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
3. Pick a template or add your own text, images and stickers, then click **Print**.

## Pages

### Print Studio (`/`)

One canvas for everything you print. The page is 384 dots wide — the width of the head — and **grows as you add content and shrinks back when you move things up**, so you only ever feed as much paper as the design needs.

**Layout** — the page sits on the left (sticky on desktop, pinned above the controls on a phone) with a zoom control; everything else lives in a three-tab inspector: **Design** for template and border pickers (both are visual galleries of real previews, not dropdowns), **Element** for a layer list plus the selected element's settings, and **Page** for paper, feed and printer details.

**Elements** — add text, images, stickers, QR codes and rules. Every element is **draggable, resizable and rotatable** directly on the canvas: drag the body to move, pull a square handle to resize, and use the round handle above the box to rotate (hold <kbd>Shift</kbd> to snap to 15°). Arrow keys nudge, <kbd>Delete</kbd> removes, <kbd>⌘/Ctrl</kbd>+<kbd>Z</kbd> undoes, and elements snap to the page centre and edges as you drag.

| Element | What you can change |
|---------|---------------------|
| Text | Content, sans/serif/mono, size, bold, italic, alignment, line spacing, knockout (white on black). Boxes auto-fit their wrapped text; corner handles scale the type |
| Image | Drop, paste or browse. Crop, flip, brightness, contrast, gamma, sharpen, auto-level, invert, nine halftone algorithms and a threshold — dithered live at the size it is placed |
| Sticker | 30 monochrome vector stickers — stars, hearts, arrows, weather, animals, scissors and more — with an optional knockout |
| QR | Any payload, three error-correction levels, drawn at whole-module sizes so it always scans |
| Line | Solid, dashed, dotted, double or wave rules of any thickness |

**Borders** — 18 frame templates: hairline, thin, bold, double, rounded, dashed, dotted, ticket stub with punched notches, scallop, zigzag, corner brackets, deco, wave, star/heart/flower motif frames and a dashed cut-here line.

**Templates** — pantry jar, freezer bag, use-by date, cable flag, storage box, address, price tag, name badge, gift tag, Wi-Fi card, event ticket, to-do note, coupon, or a blank page. A template drops real elements on the canvas (with today's dates filled in) — everything stays editable afterwards.

**Output** — the canvas is a live 1-bit preview: exactly the dots that will be burned. The readout gives page size in dots and millimetres, ink coverage and job size; **Save PNG** exports the same bitmap. The page (including its images) is kept in `sessionStorage`, so a reload does not lose your work.

### QR composer (`/qr.html`)

A focused page for QR codes with payload presets:

1. Connect to the printer.
2. Choose a payload type: **URL**, **Plain text**, or **Wi-Fi**.
3. Optionally add a caption and adjust QR size (180–300px).
4. Check the live preview, then click **Print**.

Wi-Fi QR codes use the standard `WIFI:` format — scan with your phone camera to join the network.

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
│   └── crop-tool.ts           # Interactive crop overlay
├── qr.ts                      # QR composer page
├── composer/                  # Block layout + QR rendering for that page
├── ui/connection.ts           # Shared BLE connect UI
├── transport.ts               # PrinterTransport + paced sendChunked()
├── transport/web-bluetooth.ts # Web Bluetooth transport
└── image.ts                   # Canvas thresholding helper
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
