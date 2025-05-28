const express = require('express');
const axios = require('axios');
const io = require('socket.io-client');
const ReceiptPrinter = require('./devices/receipt-printer');
const CardScanner = require('./devices/card-scanner');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;
const ELIXIR_SERVER_URL = process.env.ELIXIR_SERVER_URL || 'http://localhost:4001';

app.use(express.json());
app.use(express.static('public'));

let authToken = null;
let socket = null;
let deviceProxyId = null;
let receiptPrinter = null;
let cardScanner = null;

// Инициализация устройств
async function initializeDevices() {
    try {
        console.log('Initializing devices...');
        
        receiptPrinter = new ReceiptPrinter();
        cardScanner = new CardScanner();
        
        // Обработчик сканирования карт
        cardScanner.on('cardScanned', (cardData) => {
            if (socket && socket.connected) {
                console.log('Card scanned:', cardData.card_id);
                socket.emit('card_scanned', { card_data: cardData });
            } else {
                console.warn('Card scanned but not connected to server');
            }
        });
        
        console.log('Devices initialized successfully');
    } catch (error) {
        console.error('Failed to initialize devices:', error.message);
    }
}

// Аутентификация с Elixir сервером по 6-значному коду
app.post('/authenticate', async (req, res) => {
    const { auth_code, server_host } = req.body;
    
    if (!auth_code || auth_code.length !== 6) {
        return res.status(400).json({ 
            success: false, 
            error: 'Authorization code must be 6 digits long' 
        });
    }
    
    const elixirServerUrl = server_host || ELIXIR_SERVER_URL;
    
    try {
        console.log(`Attempting authentication with 6-digit code: ${auth_code}`);
        console.log(`Server: ${elixirServerUrl}`);
        
        const response = await axios.post(`${elixirServerUrl}/api/device-proxy/authenticate`, {
            auth_code: auth_code
        });
        
        if (response.data.success) {
            authToken = response.data.token;
            deviceProxyId = response.data.device_id;
            ELIXIR_SERVER_URL = elixirServerUrl; // Update server URL
            
            console.log(`Authentication successful. Device: ${response.data.name} (ID: ${deviceProxyId})`);
            
            // Подключаемся к WebSocket
            await connectToWebSocket();
            
            res.json({ 
                success: true, 
                message: 'Authenticated successfully',
                device_id: deviceProxyId,
                device_name: response.data.name
            });
        } else {
            console.log('Authentication failed: Invalid or expired code');
            res.status(401).json({ 
                success: false, 
                error: 'Invalid or expired authorization code' 
            });
        }
    } catch (error) {
        console.error('Authentication error:', error.message);
        
        if (error.response) {
            res.status(error.response.status).json({ 
                success: false, 
                error: error.response.data.error || 'Authentication failed' 
            });
        } else {
            res.status(500).json({ 
                success: false, 
                error: 'Connection to server failed' 
            });
        }
    }
});

// Получение статуса устройств
app.get('/status', async (req, res) => {
    const status = {
        authenticated: !!authToken,
        connected: socket ? socket.connected : false,
        device_id: deviceProxyId,
        printer: {
            available: !!receiptPrinter,
            ready: receiptPrinter ? receiptPrinter.isReady() : false,
            status: receiptPrinter ? receiptPrinter.getStatus() : 'not_initialized'
        },
        scanner: {
            available: !!cardScanner,
            ready: cardScanner ? cardScanner.isReady() : false,
            status: cardScanner ? cardScanner.getStatus() : 'not_initialized'
        },
        server_url: ELIXIR_SERVER_URL
    };
    
    res.json(status);
});

// Отключение от сервера
app.post('/disconnect', (req, res) => {
    if (socket) {
        socket.disconnect();
        socket = null;
    }
    
    authToken = null;
    deviceProxyId = null;
    
    console.log('Disconnected from server');
    res.json({ success: true, message: 'Disconnected successfully' });
});

// Тестовая печать
app.post('/test-print', async (req, res) => {
    if (!receiptPrinter || !receiptPrinter.isReady()) {
        return res.status(400).json({ 
            success: false, 
            error: 'Printer not ready' 
        });
    }
    
    const testHtml = generateTestReceiptHtml();
    
    try {
        await receiptPrinter.printHtml(testHtml);
        res.json({ 
            success: true, 
            message: 'Test receipt printed successfully' 
        });
    } catch (error) {
        console.error('Test print failed:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Подключение к WebSocket серверу
async function connectToWebSocket() {
    if (!authToken) {
        throw new Error('No auth token available');
    }
    
    try {
        console.log('Connecting to WebSocket...');
        
        socket = io(ELIXIR_SERVER_URL, {
            timeout: 5000,
            transports: ['websocket', 'polling']
        });
        
        // Присоединяемся к каналу устройства
        socket.emit('phx_join', {
            topic: `device:${authToken}`,
            event: 'phx_join',
            payload: {},
            ref: Date.now()
        });
        
        socket.on('connect', () => {
            console.log('Connected to Elixir server via WebSocket');
        });
        
        // Получение команды печати от сервера
        socket.on('print_html', async (data) => {
            console.log(`Received print command. Print ID: ${data.print_id}`);
            
            if (receiptPrinter && receiptPrinter.isReady()) {
                try {
                    await receiptPrinter.printHtml(data.html, data.options || {});
                    
                    // Уведомляем сервер о успешной печати
                    socket.emit('print_completed', {
                        print_id: data.print_id,
                        status: 'success',
                        timestamp: new Date().toISOString()
                    });
                    
                    console.log(`Print completed successfully. Print ID: ${data.print_id}`);
                } catch (error) {
                    console.error('Print failed:', error);
                    
                    // Уведомляем сервер об ошибке печати
                    socket.emit('print_completed', {
                        print_id: data.print_id,
                        status: 'failed',
                        error: error.message,
                        timestamp: new Date().toISOString()
                    });
                }
            } else {
                console.warn('Print command received but printer not ready');
                
                socket.emit('print_completed', {
                    print_id: data.print_id,
                    status: 'failed',
                    error: 'Printer not ready',
                    timestamp: new Date().toISOString()
                });
            }
        });
        
        socket.on('disconnect', (reason) => {
            console.log('Disconnected from Elixir server:', reason);
        });
        
        socket.on('connect_error', (error) => {
            console.error('WebSocket connection error:', error.message);
        });
        
        // Пинг для поддержания соединения
        const pingInterval = setInterval(() => {
            if (socket && socket.connected) {
                socket.emit('ping', { timestamp: Date.now() });
            } else {
                clearInterval(pingInterval);
            }
        }, 30000);
        
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('WebSocket connection timeout'));
            }, 5000);
            
            socket.on('connect', () => {
                clearTimeout(timeout);
                resolve();
            });
            
            socket.on('connect_error', (error) => {
                clearTimeout(timeout);
                reject(error);
            });
        });
        
    } catch (error) {
        console.error('Failed to connect to WebSocket:', error);
        throw error;
    }
}

// Генерация тестового чека
function generateTestReceiptHtml() {
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
            <div>Device ID: ${deviceProxyId || 'Unknown'}</div>
            <div class="line"></div>
            <div class="center">
                Printer: OK<br>
                Scanner: ${cardScanner && cardScanner.isReady() ? 'OK' : 'N/A'}<br>
                Connection: ${socket && socket.connected ? 'OK' : 'N/A'}
            </div>
            <div class="line"></div>
            <div class="center">
                Test completed successfully
            </div>
        </body>
        </html>
    `;
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down gracefully...');
    
    if (socket) {
        socket.disconnect();
    }
    
    if (receiptPrinter) {
        receiptPrinter.disconnect();
    }
    
    if (cardScanner) {
        cardScanner.disconnect();
    }
    
    process.exit(0);
});

// Запуск сервера
initializeDevices().then(() => {
    app.listen(PORT, () => {
        console.log(`Device Proxy Server running on http://localhost:${PORT}`);
        console.log(`Connecting to Elixir server at: ${ELIXIR_SERVER_URL}`);
        console.log('Waiting for authentication...');
    });
}).catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
});