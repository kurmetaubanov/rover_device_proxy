const escpos = require("escpos");
escpos.Network = require("escpos-network");
const puppeteer = require("puppeteer");

class NetworkPrinter {
  constructor(config = {}) {
    this.printer = null;
    this.device = null;
    this.ready = false;
    this.status = "initializing";
    this.config = {
      address: config.address || "192.168.123.100",
    };
    this.initialize();
  }

  async initialize() {
    try {
      console.log("Initializing network printer...");

      // Create network printer device
      this.device = new escpos.Network(this.config.address);
      this.printer = new escpos.Printer(this.device);

      // Test connection
      await this.testConnection();

      this.ready = true;
      this.status = "ready";
      console.log(`Network printer initialized at ${this.config.address}`);
    } catch (error) {
      console.error("Failed to initialize network printer:", error.message);
      this.status = "error";
      this.ready = false;
    }
  }

  async testConnection() {
    return new Promise((resolve, reject) => {
      console.log("Testing connection to network printer...");
      this.device.open((error) => {
        console.log("Connection test result:", error);
        if (error) {
          reject(error);
          return;
        }

        try {
          console.log("Connection test successful");
          this.printer
            .text("Connection test")
            .cut()
            .close(() => {
              resolve();
            });
        } catch (printError) {
          reject(printError);
        }
      });
    });
  }

  isReady() {
    return this.ready;
  }

  getStatus() {
    return this.status;
  }

  async printHtml(htmlContent, options = {}) {
    if (!this.ready) {
      throw new Error("Printer not ready");
    }

    try {
      // Convert HTML to image
      const imageBuffer = await this.htmlToImage(htmlContent);

      // Print image
      await this.printImage(imageBuffer);

      console.log("Receipt printed successfully");
    } catch (error) {
      console.error("Print error:", error);
      throw error;
    }
  }

  async htmlToImage(htmlContent) {
    let browser = null;

    try {
      browser = await puppeteer.launch({
        headless: "new",
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });

      const page = await browser.newPage();

      // Set size for receipt paper (58mm ≈ 220px at 96 DPI)
      await page.setViewport({
        width: 220,
        height: 600,
        deviceScaleFactor: 2, // For better print quality
      });

      await page.setContent(htmlContent, {
        waitUntil: "networkidle0",
      });

      // Get content height
      const bodyHeight = await page.evaluate(() => {
        return document.body.scrollHeight;
      });

      // Update viewport to match content height
      await page.setViewport({
        width: 220,
        height: Math.max(bodyHeight, 100),
        deviceScaleFactor: 2,
      });

      // Take screenshot
      const imageBuffer = await page.screenshot({
        type: "png",
        fullPage: true,
        omitBackground: false,
      });

      return imageBuffer;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  async printImage(imageBuffer) {
    return new Promise((resolve, reject) => {
      try {
        this.device.open((error) => {
          if (error) {
            reject(error);
            return;
          }

          try {
            this.printer
              .font("a")
              .align("ct")
              .size(0, 0)
              .raster(escpos.Image.load(imageBuffer))
              .cut()
              .close(() => {
                resolve();
              });
          } catch (printError) {
            reject(printError);
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async printText(text, options = {}) {
    if (!this.ready) {
      throw new Error("Printer not ready");
    }

    return new Promise((resolve, reject) => {
      try {
        this.device.open((error) => {
          if (error) {
            reject(error);
            return;
          }

          try {
            this.printer
              .font("a")
              .align(options.align || "ct")
              .size(options.width || 0, options.height || 0)
              .text(text)
              .cut()
              .close(() => {
                resolve();
              });
          } catch (printError) {
            reject(printError);
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  disconnect() {
    if (this.device) {
      try {
        this.device.close();
      } catch (error) {
        console.error("Error closing printer device:", error);
      }
    }
    this.ready = false;
    this.status = "disconnected";
  }
}

module.exports = NetworkPrinter;
