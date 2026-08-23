import { PRINTER_WIDTH } from "@shared/constants.ts";
import { drawPreview, generateTestPattern } from "./image.ts";
import { preparePrintJob, sendPrintJob } from "./print-job.ts";
import {
  createConnectionController,
  initializeBluetoothUi,
} from "./ui/connection.ts";
import { WebBluetoothTransport } from "./transport/web-bluetooth.ts";

function getRequiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Required UI element not found: ${selector}`);
  }

  return element;
}

const connectButton = getRequiredElement<HTMLButtonElement>("#connect-btn");
const printButton = getRequiredElement<HTMLButtonElement>("#print-btn");
const disconnectButton =
  getRequiredElement<HTMLButtonElement>("#disconnect-btn");
const connectionStatus =
  getRequiredElement<HTMLParagraphElement>("#connection-status");
const deviceInfoContainer = getRequiredElement<HTMLElement>("#device-info");
const deviceAddressLabel =
  getRequiredElement<HTMLParagraphElement>("#device-address-label");
const deviceAddressText = getRequiredElement<HTMLElement>("#device-address");
const copyAddressButton =
  getRequiredElement<HTMLButtonElement>("#copy-address-btn");
const deviceAddressHint =
  getRequiredElement<HTMLParagraphElement>("#device-address-hint");
const previewCanvas = getRequiredElement<HTMLCanvasElement>("#preview");
const logElement = getRequiredElement<HTMLPreElement>("#log");

const transport = new WebBluetoothTransport();
const connection = createConnectionController({
  transport,
  elements: {
    connectButton,
    disconnectButton,
    connectionStatus,
    logElement,
    deviceInfo: {
      container: deviceInfoContainer,
      labelText: deviceAddressLabel,
      addressText: deviceAddressText,
      copyButton: copyAddressButton,
      hintText: deviceAddressHint,
    },
  },
  dependentButtons: [printButton],
});

let latestPattern = generateTestPattern(PRINTER_WIDTH);

function updatePreview(): void {
  drawPreview(previewCanvas, latestPattern.canvas);
}

function refreshTestPattern(): void {
  latestPattern = generateTestPattern(PRINTER_WIDTH);
  updatePreview();
}

async function handlePrint(): Promise<void> {
  try {
    refreshTestPattern();
    const job = preparePrintJob(latestPattern.pixels);
    connection.log(`Sending ${job.byteLength} bytes in ${job.segments.length} paced BLE bands...`);
    await sendPrintJob(transport, job);
    connection.log("All print data sent.");
  } catch (error) {
    connection.log(`Print failed: ${connection.formatError(error)}`);
  }
}

function initialize(): void {
  refreshTestPattern();

  printButton.addEventListener("click", () => {
    void handlePrint();
  });

  initializeBluetoothUi(connection, {
    connectButton,
    disconnectButton,
    dependentButtons: [printButton],
    connectionStatus,
  });
}

initialize();
