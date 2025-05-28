const express = require('express');
const axios = require('axios');
const { Socket } = require('phoenix');
const ReceiptPrinter = require('./devices/receipt-printer');
const CardScanner = require('./devices/card-scanner');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;
let ELIXIR_SERVER_URL = process.env.ELIXIR_SERVER_URL || 'http://localhost:4000';

app.use(express.json());
app.use(express.static('public'));

let authToken = null;
let socket = null;
let channel = null;
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
            if (channel && socket && socket.isConnected()) {
                console.log('Card scanned:', cardData.card_id);
                channel.push('card_scanned', { card_data: cardData });
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
    
    const httpServerUrl = server_host || ELIXIR_SERVER_URL;
    
    try {
        console.log(`Attempting authentication with 6-digit code: ${auth_code}`);
        console.log(`Server: ${httpServerUrl}`);
        
        const response = await axios.post(`${httpServerUrl}/api/device-proxy/authenticate`, {
            auth_code: auth_code
        });
        
        if (response.data.success) {
            // Сначала устанавливаем все переменные
            authToken = response.data.token;
            deviceProxyId = response.data.device_id;
            ELIXIR_SERVER_URL = httpServerUrl;
            
            console.log(`Authentication successful. Device: ${response.data.name} (ID: ${deviceProxyId})`);
            console.log(`Auth token: ${authToken}`);
            
            // Теперь подключаемся к Phoenix Channel
            try {
                await connectToPhoenixChannel();
                
                res.json({ 
                    success: true, 
                    message: 'Authenticated successfully',
                    device_id: deviceProxyId,
                    device_name: response.data.name
                });
            } catch (wsError) {
                console.error('WebSocket connection failed:', wsError.message);
                // Очищаем токены если подключение не удалось
                authToken = null;
                deviceProxyId = null;
                
                res.status(500).json({
                    success: false,
                    error: 'Authentication successful but WebSocket connection failed: ' + wsError.message
                });
            }
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
        connected: socket ? socket.isConnected() : false,
        device_id: deviceProxyId,
        auth_token: authToken ? 'present' : 'missing',
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
    if (channel) {
        console.log('Leaving channel...');
        channel.leave();
        channel = null;
    }
    
    if (socket) {
        console.log('Disconnecting socket...');
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

// Подключение к Phoenix Channel
async function connectToPhoenixChannel() {
    // Проверяем наличие токена и ID устройства
    if (!authToken) {
        throw new Error('Auth token is missing');
    }
    
    if (!deviceProxyId) {
        throw new Error('Device ID is missing');
    }
    
    try {
        console.log('Connecting to Phoenix Channel...');
        console.log(`Device ID: ${deviceProxyId}`);
        console.log(`Auth token: ${authToken.substring(0, 10)}...`);
        
        // Конвертируем HTTP URL в WebSocket URL для Phoenix
        const wsUrl = ELIXIR_SERVER_URL
            .replace('http://', 'ws://')
            .replace('https://', 'wss://') + '/socket';
        
        console.log('WebSocket URL:', wsUrl);
        
        // Создаем Phoenix Socket
        socket = new Socket(wsUrl, {
            params: { token: authToken },
            timeout: 10000,
            logger: (kind, msg, data) => {
                console.log(`Phoenix ${kind}: ${msg}`, data);
            }
        });
        
        // Обработчики состояния подключения
        socket.onOpen(() => {
            console.log('Phoenix socket connected');
        });
        
        socket.onClose(() => {
            console.log('Phoenix socket disconnected');
        });
        
        socket.onError((error) => {
            console.error('Phoenix socket error:', error);
        });
        
        // Подключаемся к сокету
        socket.connect();
        
        // Ждем подключения сокета
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Socket connection timeout'));
            }, 10000);
            
            if (socket.isConnected()) {
                clearTimeout(timeout);
                resolve();
            } else {
                socket.onOpen(() => {
                    clearTimeout(timeout);
                    resolve();
                });
                
                socket.onError((error) => {
                    clearTimeout(timeout);
                    reject(error);
                });
            }
        });
        
        console.log('Socket connected, joining channel...');
        
        // Присоединяемся к каналу устройства
        const channelTopic = `device:${deviceProxyId}`;
        console.log(`Joining channel: ${channelTopic}`);
        
        channel = socket.channel(channelTopic, { token: authToken });
        
        // Обработчики событий канала
        channel.on('print_html', async (payload) => {
            console.log(`Received print command. Print ID: ${payload.print_id}`);
            
            if (receiptPrinter && receiptPrinter.isReady()) {
                try {
                    await receiptPrinter.printHtml(payload.html, payload.options || {});
                    
                    // Уведомляем сервер о успешной печати
                    channel.push('print_completed', {
                        print_id: payload.print_id,
                        status: 'success',
                        timestamp: new Date().toISOString()
                    });
                    
                    console.log(`Print completed successfully. Print ID: ${payload.print_id}`);
                } catch (error) {
                    console.error('Print failed:', error);
                    
                    // Уведомляем сервер об ошибке печати
                    channel.push('print_completed', {
                        print_id: payload.print_id,
                        status: 'failed',
                        error: error.message,
                        timestamp: new Date().toISOString()
                    });
                }
            } else {
                console.warn('Print command received but printer not ready');
                
                channel.push('print_completed', {
                    print_id: payload.print_id,
                    status: 'failed',
                    error: 'Printer not ready',
                    timestamp: new Date().toISOString()
                });
            }
        });
        
        // Присоединяемся к каналу
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Channel join timeout'));
            }, 10000);
            
            channel.join()
                .receive('ok', (response) => {
                    clearTimeout(timeout);
                    console.log('Successfully joined device channel:', response);
                    resolve(response);
                })
                .receive('error', (error) => {
                    clearTimeout(timeout);
                    console.error('Failed to join device channel:', error);
                    reject(new Error(`Channel join failed: ${JSON.stringify(error)}`));
                })
                .receive('timeout', () => {
                    clearTimeout(timeout);
                    reject(new Error('Channel join timeout'));
                });
        });
        
        // Отправляем heartbeat каждые 30 секунд
        const heartbeatInterval = setInterval(() => {
            if (channel && socket && socket.isConnected()) {
                channel.push('heartbeat', { 
                    timestamp: Date.now(),
                    device_id: deviceProxyId 
                });
            } else {
                clearInterval(heartbeatInterval);
            }
        }, 30000);
        
        console.log('Phoenix Channel connection established successfully');
        
    } catch (error) {
        console.error('Failed to connect to Phoenix Channel:', error);
        
        // Очищаем соединения в случае ошибки
        if (channel) {
            channel.leave();
            channel = null;
        }
        
        if (socket) {
            socket.disconnect();
            socket = null;
        }
        
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
                Connection: ${socket && socket.isConnected() ? 'OK' : 'N/A'}
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
    
    if (channel) {
        channel.leave();
    }
    
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
        console.log(`Will connect to Phoenix server at: ${ELIXIR_SERVER_URL}`);
        console.log('Waiting for authentication...');
    });
}).catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
});