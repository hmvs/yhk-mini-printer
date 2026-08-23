# YHK Mini Printer

> **Fork notice:** This project is a fork of [joshmcarthur/yhk-mini-printer](https://github.com/joshmcarthur/yhk-mini-printer), extended with text and continuous-roll label composers. The original MIT licence and copyright notice are retained in [LICENSE](LICENSE).

Browser-based control for cheap BLE mini thermal printers. Connect over Web Bluetooth from Chrome and print raster images using ESC/POS (`GS v 0`) commands.

**Live demo:** [hmvs.github.io/yhk-mini-printer](https://hmvs.github.io/yhk-mini-printer/) (requires Chrome/Edge — Web Bluetooth needs HTTPS)

In theory, any pocket thermal printer that accepts **rasterized bytes over BLE** via an ISSC-style UART service should work. Compatibility depends on the BLE GATT profile and whether the firmware accepts ESC/POS bitmap commands (many cheap "cat printer" class devices do).

![Kmart Thermal Bluetooth Printer (model 43437771)](docs/images/kmart-43437771.png)

## Demo

**Web app** — connect and print from Chrome:

<video src="docs/images/screen-record.webm" controls width="720">
  <a href="docs/images/screen-record.webm">Download screen recording</a>
</video>

**Printer output** — test image on paper:

<video src="docs/images/demo.webm" controls width="720">
  <a href="docs/images/demo.webm">Download demo video</a>
</video>

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

If you get a connection but garbled output, see [protocol.md](docs/protocol.md) for UUID discovery and pacing tuning. PRs adding tested devices to this table are welcome.

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in **Chrome or Edge**.

1. Power on the printer (disconnect from phone apps first).
2. Click **Connect** → select `YHK-...` in the picker.
3. Click **Print Test Image**.

### QR Composer

Open [http://localhost:5173/qr.html](http://localhost:5173/qr.html) (or use the **QR** nav link).

1. Connect to the printer.
2. Choose a payload type: **URL**, **Plain text**, or **Wi-Fi**.
3. Optionally add a caption and adjust QR size (180–300px).
4. Check the live preview, then click **Print**.

Wi-Fi QR codes use the standard `WIFI:` format — scan with your phone camera to join the network.

### Text Composer

Open [http://localhost:5173/text.html](http://localhost:5173/text.html) (or use the Text nav link) to print regular text rather than a QR code. The live preview supports writing across the paper or rotating a complete line of text to run along the roll, plus left/centre/right alignment, regular or bold type, font size, line spacing, and X/Y positioning. The printer outputs a static raster image, so the movement controls position the text on the printed page rather than animate it.

### Label Composer

Open [http://localhost:5173/labels.html](http://localhost:5173/labels.html) to make full-width labels for continuous thermal or adhesive paper. Add a title and optional details, choose a 20–50 mm print height, alignment, border, number of copies, and dashed tear guides. The height is based on the printer's 8-dot/mm raster resolution; use the preview to allow for your printer's margins and paper feed.

## iOS app

An iOS app in [`ios/`](ios/) wraps the same web UI in a `WKWebView` and polyfills `navigator.bluetooth` via CoreBluetooth. No changes to the web transport are required — chunk pacing still runs in JavaScript.

**Requirements:** physical iPhone (BLE does not work in Simulator), iOS 16+, Xcode 16+.

```bash
npm install
npm run ios:bundle-web   # build web assets into ios/YHKPrinter/Resources/Web
open ios/YHKPrinter.xcodeproj
```

In Xcode, select your iPhone, set a **Signing Team**, then Run. The **Bundle Web Assets** build phase re-runs `npm run ios:bundle-web` automatically on each build.

1. Allow Bluetooth when prompted.
2. Tap **Connect** — a native picker lists nearby `YHK-*` printers.
3. Print from the **Test** or **QR** pages (same UI as the browser app).

Disconnect the printer from other phone apps before connecting.

## Requirements

| | |
|---|---|
| **Browser** | Chrome or Edge (desktop/Android). Not Safari/iOS — use the [iOS app](#ios-app) instead. |
| **Host** | `localhost` or HTTPS |
| **Printer** | BLE thermal with ISSC UART + ESC/POS raster (see [Supported devices](#supported-devices)) |

## Privacy and data flow

The GitHub Pages web app has no analytics, advertising, tracking pixels, cookies, telemetry, or third-party API calls. Text, QR payloads, and label content are rendered in the browser; when you print, the raster data goes directly from that browser to the selected Bluetooth printer. Composer settings are stored only in that browser's `sessionStorage` and are discarded when the browser session ends.

GitHub Pages necessarily receives normal web-hosting requests for the app assets (such as your IP address and browser request metadata), but the app does not submit your print content to GitHub or another service.

The optional local integrations have separate, explicit data paths:

* The local print server binds to `127.0.0.1` by default and sends print data to the paired BLE printer. Do not expose it to a network you do not trust.
* A server `image` block with an `http` or `https` URL makes the local server download that specific image. Use base64 image blocks if the image must never be requested from another host.
* The MCP client sends data only to `PRINT_SERVER_URL` (localhost by default). The teletype integration reads from the MQTT broker configured by `MQTT_URL` and forwards matching messages to `PRINT_SERVER_URL`.

## Documentation

| Doc | Contents |
|-----|----------|
| [Architecture](docs/architecture.md) | Phased roadmap, `PrinterTransport`, Pi server plan |
| [Protocol](docs/protocol.md) | BLE UUIDs, ESC/POS, chunk pacing, tuning |
| [Exploration notes](docs/exploration/chatgpt.md) | Early research and UUID discovery |

## MCP print server

The repo includes a local HTTP print daemon (`server/`) and an MCP server (`mcp/`) so Cursor agents can print via BLE.

### Quick start (Mac dev)

```bash
npm install
npm run mcp:build

# Terminal 1 — print daemon (printer powered on, not connected to phone)
PRINTER_ADDRESS=aa:bb:cc:dd:ee:ff npm run server:dev

# Verify
curl http://localhost:8787/health
curl http://localhost:8787/scan
curl -X POST http://localhost:8787/print \
  -H 'Content-Type: application/json' \
  -d '{"title":"Test","lines":["Hello","World"]}'
```

On first run without `PRINTER_ADDRESS`, the server scans for `YHK-*` devices and logs discovered addresses. Pair the printer in macOS Bluetooth settings, then set `PRINTER_ADDRESS` to the BLE MAC.

**Note:** `@abandonware/noble` ships prebuilt binaries only for older Node ABIs. On Node 22+ (including Node 24), compile from source after `npm install`:

```bash
npm run server:rebuild-ble
```

Alternatively, use Node 20 LTS. The HTTP server starts even if BLE is unavailable; `/health` will show `printer_connected: false`.

### Cursor MCP config

Add to `.cursor/mcp.json` (or Cursor user MCP settings):

```json
{
  "mcpServers": {
    "yhk-printer": {
      "command": "node",
      "args": ["mcp/dist/index.js"],
      "env": {
        "PRINT_SERVER_URL": "http://localhost:8787"
      }
    }
  }
}
```

For a Raspberry Pi print server on the LAN, point `PRINT_SERVER_URL` at `http://pi.local:8787` and run the daemon on the Pi with `PRINT_SERVER_HOST=0.0.0.0`.

### Meshtastic teletype

The `teletype/` workspace subscribes to Meshtastic JSON MQTT and prints **text** messages from the **primary channel** or **DMs** on the BLE printer via the print server.

```bash
npm install
npm run teletype:build

# Terminal 1 — print daemon
PRINTER_ADDRESS=<connect_id> npm run server:dev

# Terminal 2 — dry-run (log blocks, no print)
MQTT_URL=mqtt://127.0.0.1:1883 TELETYPE_DRY_RUN=1 npm run teletype:dev

# Terminal 2 — live teletype
MQTT_URL=mqtt://127.0.0.1:1883 npm run teletype:dev
```

**Prerequisites:** Meshtastic node with JSON MQTT uplink enabled; broker reachable from the teletype host. DMs only appear if the MQTT gateway can decrypt them (sender may need **Ok to MQTT** on firmware ≥2.5).

| Var | Default | Purpose |
|-----|---------|---------|
| `MQTT_URL` | — (required) | Broker URL, e.g. `mqtt://127.0.0.1:1883` |
| `MQTT_TOPIC` | `msh/+/+/json/#` | Subscribe pattern |
| `MQTT_CLIENT_ID` | `yhk-teletype` | MQTT client id |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | — | Optional broker auth |
| `PRINT_SERVER_URL` | `http://localhost:8787` | Print daemon |
| `TELETYPE_DRY_RUN` | unset | Set to `1` to log without printing |
| `TELETYPE_LOG_LEVEL` | `info` | Set to `debug` to log skipped messages |

Run `npm run teletype:test` for unit tests.

### MCP tools

| Tool | Purpose |
|------|---------|
| `printer_status` | Check daemon health and BLE connection |
| `print` | Compose and print a document (`blocks[]` or shorthand `title`/`lines`/`qr`/`footer`/`images`) |

### Environment variables

| Var | Default | Package | Purpose |
|-----|---------|---------|---------|
| `PRINT_SERVER_URL` | `http://localhost:8787` | mcp, teletype | HTTP API base URL |
| `PORT` | `8787` | server | HTTP listen port |
| `PRINT_SERVER_HOST` | `127.0.0.1` | server | Bind address (`0.0.0.0` on Pi) |
| `PRINTER_ADDRESS` | — | server | BLE MAC after pairing |
| `PRINTER_NAME_PREFIX` | `YHK` | server | Scan filter when MAC unset |
| `BLE_CHUNK_DELAY_MS` | `40` | server | Chunk pacing between writes |

### Pi deployment

1. Install Node 20+ on the Pi.
2. Clone the repo, `npm install`, `npm run server:build` (or use `tsx` via `server:dev`).
3. Set `PRINTER_ADDRESS` and `PRINT_SERVER_HOST=0.0.0.0`.
4. Run `npm run server:start` under systemd on boot.
5. Keep MCP on your laptop; only the HTTP daemon runs on the Pi.

## Project layout

```
shared/
├── constants.ts               # PRINTER_WIDTH, BLE pacing constants
├── escpos.ts                  # ESC/POS encoding
├── print-document.ts          # PrintBlock schema + request normalizer
├── send-chunked.ts            # BLE chunk pacing helper
└── dither.ts                  # Threshold + Floyd-Steinberg dither
server/
├── src/
│   ├── main.ts                # Hono HTTP server entry
│   ├── config.ts              # env parsing
│   ├── composer/              # Node canvas composer
│   ├── routes/                # /health, /print, /print/raw
│   └── transport/             # Native BLE (noble)
mcp/
└── src/index.ts               # MCP stdio server (printer_status, print)
teletype/
└── src/                       # Meshtastic MQTT → print server teletype
ios/
└── YHKPrinter/                # SwiftUI shell + Web Bluetooth polyfill
src/
├── main.ts                    # Test image UI
├── qr.ts                      # QR composer UI
├── composer/
│   ├── compose.ts             # Block layout + QR rendering
│   └── presets.ts             # Wi-Fi / URL / text payload helpers
├── ui/
│   └── connection.ts            # Shared BLE connect UI
├── transport.ts               # PrinterTransport + paced sendChunked()
├── transport/web-bluetooth.ts # Web Bluetooth (Phase 1)
└── image.ts                   # Test pattern + thresholding
```

## Build

```bash
npm run build          # local build (base /)
npm run build:pages    # GitHub Pages build (base /yhk-mini-printer/)
npm run build:ios      # iOS bundle build (base ./)
npm run ios:bundle-web # build:ios + copy to ios/YHKPrinter/Resources/Web
npm run preview        # serve production build locally
```

Deploys to GitHub Pages automatically on push to `main` via [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Bottom of image missing | Increase `BLE_CHUNK_DELAY_MS` in `src/transport.ts` (try 50–60) |
| Service not found | Wrong UUIDs — see [protocol.md](docs/protocol.md#uuid-discovery) |
| Upside-down output | Rotate image 180° before encoding |
| Web Bluetooth unavailable | Use Chrome/Edge on localhost or HTTPS; on iOS use the [iOS app](#ios-app) |

## Roadmap

- [x] **Phase 1** — Web Bluetooth PoC, test image print
- [x] **Phase 2** — Pi print server, native BLE, MCP tools
- [x] **iOS** — WebView app with CoreBluetooth polyfill (local phone printing)
- [ ] **Phase 3** — HTTP client transport (remote iOS / Safari via Pi)
- [ ] **Phase 4** — Webhooks, queue, auth

## License

MIT
