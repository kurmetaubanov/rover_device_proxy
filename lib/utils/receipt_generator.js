class ReceiptGenerator {
    static generateTestReceipt(authData, deviceStatus, isConnected) {
        const now = new Date();
        
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { 
                        font-family: monospace; 
                        width: 58mm; 
                        margin: 0; 
                        padding: 10px; 
                        font-size: 12px;
                    }
                    .center { text-align: center; }
                    .bold { font-weight: bold; }
                    .line { border-top: 1px dashed #000; margin: 5px 0; }
                </style>
            </head>
            <body>
                <div class="center bold">
                    DEVICE PROXY TEST
                </div>
                <div class="line"></div>
                <div>Date: ${now.toLocaleDateString()}</div>
                <div>Time: ${now.toLocaleTimeString()}</div>
                <div>Device: ${authData.deviceName || 'Unknown'}</div>
                <div>Device ID: ${authData.deviceProxyId || 'Unknown'}</div>
                <div class="line"></div>
                <div class="center">
                    Printer: ${deviceStatus.printer.ready ? 'OK' : 'N/A'}<br>
                    Scanner: ${deviceStatus.scanner.ready ? 'OK' : 'N/A'}<br>
                    Connection: ${isConnected ? 'OK' : 'N/A'}
                </div>
                <div class="line"></div>
                <div class="center">
                    Test completed successfully
                </div>
            </body>
            </html>
        `;
    }
}

module.exports = ReceiptGenerator;