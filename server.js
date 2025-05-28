require('dotenv').config();
const express = require('express');

// Add WebSocket support for Phoenix client
const WebSocket = require('ws');
global.WebSocket = WebSocket;

const AuthManager = require('./lib/auth/auth_manager');
const DeviceManager = require('./lib/device_manager');
const WebSocketManager = require('./lib/websocket/websocket_manager');
const { createRoutes } = require('./lib/api/routes');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(express.static('public'));

// Initialize managers
const authManager = new AuthManager();
const deviceManager = new DeviceManager();
const webSocketManager = new WebSocketManager(authManager, deviceManager);

// Setup API routes
const apiRoutes = createRoutes(authManager, webSocketManager, deviceManager);
app.use('/', apiRoutes);

// Try auto-reconnect on startup
async function tryAutoReconnect() {
    if (authManager.hasAutoAuth()) {
        const authData = authManager.getAuthData();
        console.log(`Found saved authentication for device: ${authData.deviceName || authData.deviceProxyId}`);
        console.log('Attempting auto-reconnect...');
        
        try {
            const success = await webSocketManager.connectWithRetry();
            if (success) {
                console.log('Auto-reconnected successfully with saved credentials');
                return true;
            } else {
                console.warn('Auto-reconnect failed, but credentials are still valid');
                return true;
            }
        } catch (error) {
            console.error('Auto-reconnect failed:', error.message);
            console.log('Saved credentials may be invalid. Please re-authenticate.');
            
            authManager.disconnect();
            return false;
        }
    }
    
    console.log('No saved authentication found. Waiting for manual authentication...');
    return false;
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down gracefully...');
    
    webSocketManager.disconnect();
    deviceManager.disconnect();
    
    process.exit(0);
});

// Start server
async function startServer() {
    try {
        // Initialize devices
        await deviceManager.initialize();
        
        // Setup card scanner callback
        deviceManager.setupCardScannerCallback((cardData) => {
            webSocketManager.sendCardScanned(cardData);
        });
        
        // Start HTTP server
        app.listen(PORT, async () => {
            console.log(`Device Proxy Server running on http://localhost:${PORT}`);
            console.log(`Will connect to Phoenix server at: ${authManager.getAuthData().serverUrl}`);
            
            // Try to auto-reconnect with saved credentials
            const autoConnected = await tryAutoReconnect();
            
            if (!autoConnected) {
                console.log('Waiting for manual authentication...');
            }
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();