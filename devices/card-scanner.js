const EventEmitter = require("events");
const HID = require("node-hid");

class CardScanner extends EventEmitter {
  constructor() {
    super();
    this.device = null;
    this.ready = false;
    this.status = "initializing";
    this.cardBuffer = "";
    this.initialize();
  }

  initialize() {
    try {
      console.log("Initializing card scanner...");

      // Поиск HID устройств
      const devices = HID.devices();
      console.log(`Found ${devices.length} HID devices`);

      // Ищем устройство сканера карт
      // Замените vendorId и productId на реальные значения вашего сканера
      const scannerDevice = devices.find(
        (d) => d.vendorId === 0x5131 && d.productId === 0x2007 // Пример для некоторых считывателей карт
      );

      if (scannerDevice) {
        this.device = new HID.HID(scannerDevice.path);
        this.setupDataHandler();
        this.ready = true;
        this.status = "ready";
        console.log("Card scanner initialized:", scannerDevice.product);
      } else {
        console.warn("Card scanner not found. Available devices:");
        devices.forEach((d) => {
          console.log(
            `  - ${d.product} (VID: 0x${d.vendorId.toString(
              16
            )}, PID: 0x${d.productId.toString(16)})`
          );
        });

        // Запускаем mock режим для тестирования
        // this.startMockScanner();
      }
    } catch (error) {
      console.error("Failed to initialize card scanner:", error.message);
      // this.startMockScanner();
    }
  }

  setupDataHandler() {
    this.device.on("data", (data) => {
      try {
        // Обработка данных от сканера
        for (let i = 0; i < data.length; i++) {
          const byte = data[i];

          if (byte === 0) continue; // Пропускаем нулевые байты

          const char = String.fromCharCode(byte);

          // Проверяем на конец строки
          if (char === "\r" || char === "\n") {
            if (this.cardBuffer.length > 0) {
              this.processCardData(this.cardBuffer.trim());
              this.cardBuffer = "";
            }
          } else if (char.match(/[\x20-\x7E]/)) {
            // Печатные ASCII символы
            this.cardBuffer += char;
          }
        }
      } catch (error) {
        console.error("Error processing scanner data:", error);
      }
    });

    this.device.on("error", (error) => {
      console.error("Scanner device error:", error);
      this.status = "error";
      this.ready = false;
    });
  }

  processCardData(rawData) {
    try {
      console.log("Raw card data:", rawData);

      const cardData = {
        raw_data: rawData,
        card_id: this.extractCardId(rawData),
        timestamp: new Date().toISOString(),
        format: this.detectCardFormat(rawData),
      };

      console.log("Processed card data:", cardData);
      this.emit("cardScanned", cardData);
    } catch (error) {
      console.error("Error processing card data:", error);
    }
  }

  extractCardId(rawData) {
    // Логика извлечения ID карты зависит от формата ваших карт

    // Для карт с префиксом (например, "CARD123456")
    const prefixMatch = rawData.match(/^[A-Z]+(\d+)$/);
    if (prefixMatch) {
      return prefixMatch[1];
    }

    // Для чисто цифровых карт
    const numberMatch = rawData.match(/^\d+$/);
    if (numberMatch) {
      return rawData;
    }

    // Для карт в формате hex
    const hexMatch = rawData.match(/^[0-9A-F]+$/i);
    if (hexMatch) {
      return rawData.toLowerCase();
    }

    // По умолчанию возвращаем как есть
    return rawData;
  }

  detectCardFormat(rawData) {
    if (/^\d+$/.test(rawData)) {
      return "numeric";
    } else if (/^[0-9A-F]+$/i.test(rawData)) {
      return "hex";
    } else if (/^[A-Z]+\d+$/.test(rawData)) {
      return "prefixed_numeric";
    } else {
      return "unknown";
    }
  }

  startMockScanner() {
    console.log("Starting mock card scanner for testing");
    this.ready = true;
    this.status = "mock_mode";

    // Эмуляция сканирования карт для тестирования
    let mockCardCounter = 1000;

    const mockScanInterval = setInterval(() => {
      // 5% шанс сканирования каждые 3 секунды
      if (Math.random() < 0.05) {
        const mockCardId = (mockCardCounter++).toString();
        const mockCardData = {
          raw_data: `CARD${mockCardId}`,
          card_id: mockCardId,
          timestamp: new Date().toISOString(),
          format: "prefixed_numeric",
        };

        console.log("Mock card scanned:", mockCardData.card_id);
        this.emit("cardScanned", mockCardData);
      }
    }, 3000);

    // Очищаем интервал при отключении
    this.once("disconnect", () => {
      clearInterval(mockScanInterval);
    });
  }

  isReady() {
    return this.ready;
  }

  getStatus() {
    return this.status;
  }

  disconnect() {
    if (this.device) {
      try {
        this.device.close();
      } catch (error) {
        console.error("Error closing scanner device:", error);
      }
    }

    this.ready = false;
    this.status = "disconnected";
    this.emit("disconnect");
  }
}

module.exports = CardScanner;
