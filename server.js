require('dotenv').config();
const express = require('express');
const axios = require('axios');

// Add WebSocket support for Phoenix client
const WebSocket = require('ws');
global.WebSocket = WebSocket;

const ReceiptPrinter = require('./devices/receipt-printer');
const CardScanner = require('./devices/card-scanner');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;
let ELIXIR_SERVER_URL = process.env.ELIXIR_SERVER_URL || 'http://localhost:4001';

app.use(express.json());
app.use(express.static('public'));

let authToken = process.env.AUTH_TOKEN || null;
let socket = null;
let channel = null;
let deviceProxyId = process.env.DEVICE_ID || null;
let deviceName = process.env.DEVICE_NAME || null;
let receiptPrinter = null;
let cardScanner = null;
let reconnectInterval = null;

// Function to update .env file
function updateEnvFile(updates) {
    try {
        const envPath = path.join(__dirname, '.env');
        let envContent = '';
        
        // Read existing .env if it exists
        if (fs.existsSync(envPath)) {
            envContent = fs.readFileSync(envPath, 'utf8');
        }
        
        // Parse existing env vars
        const envVars = {};
        envContent.split('\n').forEach(line => {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
                const [key, ...valueParts] = trimmed.split('=');
                if (key) {
                    envVars[key.trim()] = valueParts.join('=').trim();
                }
            }
        });
        
        // Apply updates
        Object.assign(envVars, updates);

        console.log(updates);
        
        // Rebuild .env content
        const newContent = [
            '# Server Configuration',
            `PORT=${envVars.PORT || '3001'}`,
            `ELIXIR_SERVER_URL=${envVars.ELIXIR_SERVER_URL || 'http://localhost:4001'}`,
            '',
            '# Persistent Authentication (auto-populated after successful auth)',
            `AUTH_TOKEN=${envVars.AUTH_TOKEN || ''}`,
            `DEVICE_ID=${envVars.DEVICE_ID || ''}`,
            `DEVICE_NAME=${envVars.DEVICE_NAME || ''}`,
            `SERVER_HOST=${envVars.SERVER_HOST || ''}`,
            ''
        ].join('\n');

        console.log(newContent);
        
        fs.writeFileSync(envPath, newContent);
        console.log('Updated .env file with authentication data');
        
        // Update process.env for current session
        Object.assign(process.env, updates);
        
    } catch (error) {
        console.error('Failed to update .env file:', error);
    }
}

// Function to clear authentication from .env
function clearAuthFromEnv() {
    updateEnvFile({
        AUTH_TOKEN: '',
        DEVICE_ID: '',
        DEVICE_NAME: '',
        SERVER_HOST: ''
    });
}

// Function to retry WebSocket connection
async function retryWebSocketConnection(maxRetries = 5, initialDelay = 2000) {
    if (!authToken || !deviceProxyId) {
        console.error('Cannot retry WebSocket: missing auth token or device ID');
        return false;
    }

    for (let i = 0; i < maxRetries; i++) {
        try {
            const delay = initialDelay * Math.pow(1.5, i); // Exponential backoff
            if (i > 0) {
                console.log(`WebSocket retry attempt ${i + 1}/${maxRetries} in ${delay/1000}s...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                console.log(`WebSocket connection attempt ${i + 1}/${maxRetries}`);
            }
            
            await connectToPhoenixChannel();
            console.log('WebSocket connection established successfully');
            return true;
        } catch (error) {
            console.error(`WebSocket attempt ${i + 1} failed:`, error.message);
        }
    }
    
    console.error('All WebSocket connection attempts failed');
    // Start automatic reconnection every 30 seconds
    startAutoReconnect();
    return false;
}

// Function to start automatic reconnection
function startAutoReconnect() {
    if (reconnectInterval) {
        clearInterval(reconnectInterval);
    }
    
    console.log('Starting automatic WebSocket reconnection (every 30 seconds)');
    reconnectInterval = setInterval(async () => {
        if (authToken && deviceProxyId && (!socket || !socket.isConnected())) {
            console.log('Attempting automatic WebSocket reconnection...');
            try {
                await connectToPhoenixChannel();
                console.log('Automatic reconnection successful');
                clearInterval(reconnectInterval);
                reconnectInterval = null;
            } catch (error) {
                console.error('Automatic reconnection failed:', error.message);
            }
        } else if (socket && socket.isConnected()) {
            console.log('WebSocket already connected, stopping auto-reconnect');
            clearInterval(reconnectInterval);
            reconnectInterval = null;
        }
    }, 30000);
}

// Function to try auto-reconnect on startup
async function tryAutoReconnect() {
    if (authToken && deviceProxyId) {
        console.log(`Found saved authentication for device: ${deviceName || deviceProxyId}`);
        console.log('Attempting auto-reconnect...');
        
        try {
            // Update server URL if saved
            if (process.env.SERVER_HOST) {
                ELIXIR_SERVER_URL = process.env.SERVER_HOST;
            }
            
            const success = await retryWebSocketConnection();
            if (success) {
                console.log('Auto-reconnected successfully with saved credentials');
                return true;
            } else {
                console.warn('Auto-reconnect failed, but credentials are still valid');
                return true; // Still return true because auth is valid
            }
        } catch (error) {
            console.error('Auto-reconnect failed:', error.message);
            console.log('Saved credentials may be invalid. Please re-authenticate.');
            
            // Clear invalid credentials
            authToken = null;
            deviceProxyId = null;
            deviceName = null;
            clearAuthFromEnv();
            return false;
        }
    }
    
    console.log('No saved authentication found. Waiting for manual authentication...');
    return false;
}

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
            // Store authentication data
            authToken = response.data.token;
            deviceProxyId = response.data.device_id;
            deviceName = response.data.name;
            ELIXIR_SERVER_URL = httpServerUrl;
            
            console.log(`Authentication successful. Device: ${deviceName} (ID: ${deviceProxyId})`);
            console.log(authToken);
            
            // Save to .env file
            updateEnvFile({
                AUTH_TOKEN: authToken,
                DEVICE_ID: deviceProxyId,
                DEVICE_NAME: deviceName,
                SERVER_HOST: httpServerUrl
            });
            
            // Try to connect to Phoenix Channel with retry logic
            const wsConnected = await retryWebSocketConnection();
            
            res.json({ 
                success: true, 
                message: 'Authenticated successfully',
                device_id: deviceProxyId,
                device_name: deviceName,
                auto_saved: true,
                websocket_connected: wsConnected,
                warning: wsConnected ? null : 'WebSocket connection failed - will retry automatically'
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

// Get current authentication status
app.get('/auth-status', (req, res) => {
    res.json({
        authenticated: !!authToken,
        device_id: deviceProxyId,
        device_name: deviceName,
        server_host: process.env.SERVER_HOST || ELIXIR_SERVER_URL,
        auto_connected: !!authToken && !!deviceProxyId,
        websocket_connected: socket ? socket.isConnected() : false
    });
});

// Получение статуса устройств
app.get('/status', async (req, res) => {
    const status = {
        authenticated: !!authToken,
        connected: socket ? socket.isConnected() : false,
        device_id: deviceProxyId,
        device_name: deviceName,
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
        server_url: ELIXIR_SERVER_URL,
        auto_connected: process.env.AUTH_TOKEN ? true : false,
        auto_reconnect_active: !!reconnectInterval
    };
    
    res.json(status);
});

// Manual WebSocket reconnection endpoint
app.post('/reconnect', async (req, res) => {
    if (!authToken || !deviceProxyId) {
        return res.status(400).json({
            success: false,
            error: 'Not authenticated'
        });
    }
    
    try {
        const success = await retryWebSocketConnection();
        res.json({
            success: success,
            message: success ? 'WebSocket reconnected successfully' : 'WebSocket reconnection failed - automatic retry active'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Отключение от сервера
app.post('/disconnect', (req, res) => {
    // Clear reconnection interval
    if (reconnectInterval) {
        clearInterval(reconnectInterval);
        reconnectInterval = null;
    }
    
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
    deviceName = null;
    
    // Clear from .env file
    clearAuthFromEnv();
    
    console.log('Disconnected from server and cleared saved credentials');
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
    
    // Disconnect existing connection if any
    if (socket) {
        socket.close();
        socket = null;
    }
    
    try {
        console.log('Connecting to Phoenix Channel...');
        console.log(`Device ID: ${deviceProxyId}`);
        console.log(`Auth token: ${authToken.substring(0, 10)}...`);
        
        // Конвертируем HTTP URL в WebSocket URL для Phoenix
        const wsUrl = ELIXIR_SERVER_URL
            .replace('http://', 'ws://')
            .replace('https://', 'wss://') + '/socket/websocket';
        
        console.log('WebSocket URL:', wsUrl);
        
        // Create raw WebSocket connection
        socket = new WebSocket(wsUrl);
        
        // Connection handlers
        socket.on('open', () => {
            console.log('Phoenix socket connected');
            
            // Send join message
            const joinMsg = {
                topic: `device:${deviceProxyId}`,
                event: "phx_join",
                payload: { token: authToken },
                ref: "join_ref_1"
            };
            
            console.log(`Joining channel: device:${deviceProxyId}`);
            socket.send(JSON.stringify(joinMsg));
        });
        
        socket.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());
                console.log('📨 Received message:', JSON.stringify(message, null, 2));
                
                if (message.event === 'phx_reply') {
                    if (message.payload.status === 'ok') {
                        console.log('✅ Join successful!', message.payload.response);
                        channel = { connected: true }; // Simple flag
                    } else {
                        console.error('❌ Join failed:', message.payload);
                        throw new Error(`Channel join failed: ${JSON.stringify(message.payload)}`);
                    }
                } else if (message.event === 'print_html') {
                    // Handle print commands
                    handlePrintCommand(message.payload);
                }
            } catch (error) {
                console.log('Raw message (not JSON):', data.toString());
            }
        });
        
        socket.on('close', () => {
            console.log('Phoenix socket disconnected');
            channel = null;
            // Start auto-reconnect if we have valid auth
            if (authToken && deviceProxyId) {
                startAutoReconnect();
            }
        });
        
        socket.on('error', (error) => {
            console.error('Phoenix socket error:', error);
            throw error;
        });
        
        // Wait for connection
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Socket connection timeout'));
            }, 10000);
            
            socket.on('open', () => {
                clearTimeout(timeout);
                resolve();
            });
            
            socket.on('error', (error) => {
                clearTimeout(timeout);
                reject(error);
            });
        });
        
        // Send heartbeat every 30 seconds
        const heartbeatInterval = setInterval(() => {
            if (socket && socket.readyState === WebSocket.OPEN) {
                const heartbeat = {
                    topic: "phoenix",
                    event: "heartbeat",
                    payload: {},
                    ref: `hb_${Date.now()}`
                };
                socket.send(JSON.stringify(heartbeat));
            } else {
                clearInterval(heartbeatInterval);
            }
        }, 30000);
        
        console.log('Phoenix Channel connection established successfully');
        
    } catch (error) {
        console.error('Failed to connect to Phoenix Channel:', error);
        
        if (socket) {
            socket.close();
            socket = null;
        }
        
        throw error;
    }
}

// Add this helper function for handling print commands
async function handlePrintCommand(payload) {
    console.log(`Received print command. Print ID: ${payload.print_id}`);
    
    if (receiptPrinter && receiptPrinter.isReady()) {
        try {
            await receiptPrinter.printHtml(payload.html, payload.options || {});
            
            // Send print completed message
            const completedMsg = {
                topic: `device:${deviceProxyId}`,
                event: "print_completed",
                payload: {
                    print_id: payload.print_id,
                    status: 'success',
                    timestamp: new Date().toISOString()
                },
                ref: `print_${Date.now()}`
            };
            socket.send(JSON.stringify(completedMsg));
            
            console.log(`Print completed successfully. Print ID: ${payload.print_id}`);
        } catch (error) {
            console.error('Print failed:', error);
            
            // Send print failed message
            const failedMsg = {
                topic: `device:${deviceProxyId}`,
                event: "print_completed",
                payload: {
                    print_id: payload.print_id,
                    status: 'failed',
                    error: error.message,
                    timestamp: new Date().toISOString()
                },
                ref: `print_${Date.now()}`
            };
            socket.send(JSON.stringify(failedMsg));
        }
    } else {
        console.warn('Print command received but printer not ready');
        
        const failedMsg = {
            topic: `device:${deviceProxyId}`,
            event: "print_completed",
            payload: {
                print_id: payload.print_id,
                status: 'failed',
                error: 'Printer not ready',
                timestamp: new Date().toISOString()
            },
            ref: `print_${Date.now()}`
        };
        socket.send(JSON.stringify(failedMsg));
    }
}

// Also update the status endpoint to check WebSocket state correctly
app.get('/status', async (req, res) => {
    const status = {
        authenticated: !!authToken,
        connected: socket ? socket.readyState === WebSocket.OPEN : false,
        device_id: deviceProxyId,
        device_name: deviceName,
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
        server_url: ELIXIR_SERVER_URL,
        auto_connected: process.env.AUTH_TOKEN ? true : false,
        auto_reconnect_active: !!reconnectInterval
    };
    
    res.json(status);
});

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
            <div>Device: ${deviceName || 'Unknown'}</div>
            <div>Device ID: ${deviceProxyId || 'Unknown'}</div>
            <div class="line"></div>
            <div class="center">
                Printer: ${receiptPrinter && receiptPrinter.isReady() ? 'OK' : 'N/A'}<br>
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
    
    if (reconnectInterval) {
        clearInterval(reconnectInterval);
    }
    
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
initializeDevices().then(async () => {
    app.listen(PORT, async () => {
        console.log(`Device Proxy Server running on http://localhost:${PORT}`);
        console.log(`Will connect to Phoenix server at: ${ELIXIR_SERVER_URL}`);
        
        // Try to auto-reconnect with saved credentials
        const autoConnected = await tryAutoReconnect();
        
        if (!autoConnected) {
            console.log('Waiting for manual authentication...');
        }
    });
}).catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
});