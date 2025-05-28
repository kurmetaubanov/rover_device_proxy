const escpos = require('escpos');
escpos.USB = require('escpos-usb');
const puppeteer = require('puppeteer');

class ReceiptPrinter {
    constructor() {
        this.printer = null;
        this.device = null;
        this.ready = false;
        this.status = 'initializing';
        this.initialize();
    }
    
    async initialize() {
        try {
            console.log('Initializing receipt printer...');
            
            // Попытка подключения к USB принтеру
            const devices = escpos.USB.findPrinter();
            
            if (devices.length > 0) {
                this.device = new escpos.USB();
                this.printer = new escpos.Printer(this.device);
                this.ready = true;
                this.status = 'ready';
                console.log(`Receipt printer initialized: ${devices.length} device(s) found`);
            } else {
                console.warn('No ESC/POS printers found. Running in mock mode.');
                this.status = 'mock_mode';
                this.ready = true; // Для тестирования
            }
        } catch (error) {
            console.error('Failed to initialize receipt printer:', error.message);
            this.status = 'error';
            this.ready = false;
        }
    }
    
    isReady() {
        return this.ready;
    }
    
    getStatus() {
        return this.status;
    }
    
    async printHtml(htmlContent, options = {}) {
        if (!this.ready) {
            throw new Error('Printer not ready');
        }
        
        try {
            if (this.status === 'mock_mode') {
                console.log('MOCK PRINT:', htmlContent.substring(0, 100) + '...');
                return;
            }
            
            // Конвертируем HTML в изображение
            const imageBuffer = await this.htmlToImage(htmlContent);
            
            // Печатаем изображение
            await this.printImage(imageBuffer);
            
            console.log('Receipt printed successfully');
        } catch (error) {
            console.error('Print error:', error);
            throw error;
        }
    }
    
    async htmlToImage(htmlContent) {
        let browser = null;
        
        try {
            browser = await puppeteer.launch({ 
                headless: 'new',
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
            
            const page = await browser.newPage();
            
            // Устанавливаем размер для чековой ленты (58мм ≈ 220px при 96 DPI)
            await page.setViewport({ 
                width: 220,
                height: 600,
                deviceScaleFactor: 2 // Для лучшего качества печати
            });
            
            await page.setContent(htmlContent, { 
                waitUntil: 'networkidle0' 
            });
            
            // Получаем высоту контента
            const bodyHeight = await page.evaluate(() => {
                return document.body.scrollHeight;
            });
            
            // Обновляем viewport под реальную высоту
            await page.setViewport({ 
                width: 220,
                height: Math.max(bodyHeight, 100),
                deviceScaleFactor: 2
            });
            
            // Делаем скриншот
            const imageBuffer = await page.screenshot({
                type: 'png',
                fullPage: true,
                omitBackground: false
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
                            .font('a')
                            .align('ct')
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
            throw new Error('Printer not ready');
        }
        
        if (this.status === 'mock_mode') {
            console.log('MOCK PRINT TEXT:', text);
            return;
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
                            .font('a')
                            .align(options.align || 'ct')
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
                console.error('Error closing printer device:', error);
            }
        }
        this.ready = false;
        this.status = 'disconnected';
    }
}

module.exports = ReceiptPrinter;