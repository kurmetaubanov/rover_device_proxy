const ReceiptPrinter = require("../devices/receipt-printer");
const CardScanner = require("../devices/card-scanner");
// const NetworkPrinter = require("../devices/network-printer");

class DeviceManager {
  constructor() {
    this.receiptPrinter = null;
    this.cardScanner = null;
    this.networkPrinter = null;
    this.initialized = false;
  }

  async initialize() {
    try {
      console.log("Initializing devices...");

      this.receiptPrinter = new ReceiptPrinter();
      // this.networkPrinter = new NetworkPrinter();
      this.cardScanner = new CardScanner();

      this.initialized = true;
      console.log("Devices initialized successfully");
    } catch (error) {
      console.error("Failed to initialize devices:", error.message);
      throw error;
    }
  }

  setupCardScannerCallback(callback) {
    if (this.cardScanner) {
      this.cardScanner.on("cardScanned", callback);
    }
  }

  getPrinter() {
    return this.receiptPrinter;
  }

  getScanner() {
    return this.cardScanner;
  }

  getStatus() {
    return {
      printer: {
        available: !!this.receiptPrinter,
        ready: this.receiptPrinter ? this.receiptPrinter.isReady() : false,
        status: this.receiptPrinter
          ? this.receiptPrinter.getStatus()
          : "not_initialized",
      },
      scanner: {
        available: !!this.cardScanner,
        ready: this.cardScanner ? this.cardScanner.isReady() : false,
        status: this.cardScanner
          ? this.cardScanner.getStatus()
          : "not_initialized",
      },
    };
  }

  disconnect() {
    if (this.receiptPrinter) {
      this.receiptPrinter.disconnect();
    }

    // if (this.networkPrinter) {
    //   this.networkPrinter.disconnect();
    // }

    if (this.cardScanner) {
      this.cardScanner.disconnect();
    }
  }
}

module.exports = DeviceManager;
