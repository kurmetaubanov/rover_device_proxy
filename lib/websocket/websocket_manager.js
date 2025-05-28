const PhoenixClient = require('./phoenix_client');

class WebSocketManager {
    constructor(authManager, deviceManager) {
        this.authManager = authManager;
        this.deviceManager = deviceManager;
        this.phoenixClient = null;
        this.reconnectInterval = null;
        this.maxRetries = 5;
        this.initialDelay = 2000;
    }

    async connect() {
        const { authToken, deviceProxyId, serverUrl } = this.authManager.getAuthData();
        
        if (!authToken || !deviceProxyId) {
            throw new Error('Authentication required before connecting');
        }

        try {
            this.phoenixClient = new PhoenixClient(serverUrl, authToken, deviceProxyId);
            
            // Setup message handlers
            this.phoenixClient.on('print_html', (payload) => {
                this.handlePrintCommand(payload);
            });

            this.phoenixClient.on('card_scanned', (cardData) => {
                this.phoenixClient.sendMessage('card_scanned', { card_data: cardData });
            });

            this.phoenixClient.on('disconnect', () => {
                this.startAutoReconnect();
            });

            await this.phoenixClient.connect();
            console.log('WebSocket connection established successfully');
            return true;
        } catch (error) {
            console.error('WebSocket connection failed:', error);
            throw error;
        }
    }

    async connectWithRetry() {
        for (let i = 0; i < this.maxRetries; i++) {
            try {
                const delay = this.initialDelay * Math.pow(1.5, i);
                if (i > 0) {
                    console.log(`WebSocket retry attempt ${i + 1}/${this.maxRetries} in ${delay/1000}s...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    console.log(`WebSocket connection attempt ${i + 1}/${this.maxRetries}`);
                }
                
                await this.connect();
                return true;
            } catch (error) {
                console.error(`WebSocket attempt ${i + 1} failed:`, error.message);
            }
        }
        
        console.error('All WebSocket connection attempts failed');
        this.startAutoReconnect();
        return false;
    }

    startAutoReconnect() {
        if (this.reconnectInterval) {
            clearInterval(this.reconnectInterval);
        }
        
        console.log('Starting automatic WebSocket reconnection (every 30 seconds)');
        this.reconnectInterval = setInterval(async () => {
            if (this.authManager.isAuthenticated() && (!this.phoenixClient || !this.phoenixClient.isConnected())) {
                console.log('Attempting automatic WebSocket reconnection...');
                try {
                    await this.connect();
                    console.log('Automatic reconnection successful');
                    this.stopAutoReconnect();
                } catch (error) {
                    console.error('Automatic reconnection failed:', error.message);
                }
            } else if (this.phoenixClient && this.phoenixClient.isConnected()) {
                console.log('WebSocket already connected, stopping auto-reconnect');
                this.stopAutoReconnect();
            }
        }, 30000);
    }

    stopAutoReconnect() {
        if (this.reconnectInterval) {
            clearInterval(this.reconnectInterval);
            this.reconnectInterval = null;
        }
    }

    async handlePrintCommand(payload) {
        console.log(`Received print command. Print ID: ${payload.print_id}`);
        
        const printer = this.deviceManager.getPrinter();
        
        if (printer && printer.isReady()) {
            try {
                await printer.printHtml(payload.html, payload.options || {});
                
                this.phoenixClient.sendMessage('print_completed', {
                    print_id: payload.print_id,
                    status: 'success',
                    timestamp: new Date().toISOString()
                });
                
                console.log(`Print completed successfully. Print ID: ${payload.print_id}`);
            } catch (error) {
                console.error('Print failed:', error);
                
                this.phoenixClient.sendMessage('print_completed', {
                    print_id: payload.print_id,
                    status: 'failed',
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
            }
        } else {
            console.warn('Print command received but printer not ready');
            
            this.phoenixClient.sendMessage('print_completed', {
                print_id: payload.print_id,
                status: 'failed',
                error: 'Printer not ready',
                timestamp: new Date().toISOString()
            });
        }
    }

    sendCardScanned(cardData) {
        if (this.phoenixClient && this.phoenixClient.isConnected()) {
            this.phoenixClient.sendMessage('card_scanned', { card_data: cardData });
        } else {
            console.warn('Card scanned but not connected to server');
        }
    }

    disconnect() {
        this.stopAutoReconnect();
        
        if (this.phoenixClient) {
            this.phoenixClient.disconnect();
            this.phoenixClient = null;
        }
    }

    isConnected() {
        return this.phoenixClient ? this.phoenixClient.isConnected() : false;
    }

    getStatus() {
        return {
            connected: this.isConnected(),
            auto_reconnect_active: !!this.reconnectInterval
        };
    }
}

module.exports = WebSocketManager;