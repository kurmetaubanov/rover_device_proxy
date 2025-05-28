const WebSocket = require('ws');
const EventEmitter = require('events');

class PhoenixClient extends EventEmitter {
    constructor(serverUrl, authToken, deviceId) {
        super();
        this.serverUrl = serverUrl;
        this.authToken = authToken;
        this.deviceId = deviceId;
        this.socket = null;
        this.connected = false;
        this.heartbeatInterval = null;
    }

    async connect() {
        // Convert HTTP URL to WebSocket URL for Phoenix
        const wsUrl = this.serverUrl
            .replace('http://', 'ws://')
            .replace('https://', 'wss://') + '/socket/websocket';

        console.log('WebSocket URL:', wsUrl);

        // Create raw WebSocket connection
        this.socket = new WebSocket(wsUrl);

        // Setup event handlers
        this.setupSocketHandlers();

        // Wait for connection
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Socket connection timeout'));
            }, 10000);

            this.socket.on('open', () => {
                clearTimeout(timeout);
                resolve();
            });

            this.socket.on('error', (error) => {
                clearTimeout(timeout);
                reject(error);
            });
        });

        // Join the device channel
        await this.joinChannel();

        // Start heartbeat
        this.startHeartbeat();

        console.log('Phoenix Channel connection established successfully');
    }

    setupSocketHandlers() {
        this.socket.on('open', () => {
            console.log('Phoenix socket connected');
        });

        this.socket.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());
                console.log('📨 Received message:', JSON.stringify(message, null, 2));
                
                this.handleMessage(message);
            } catch (error) {
                console.log('Raw message (not JSON):', data.toString());
            }
        });

        this.socket.on('close', () => {
            console.log('Phoenix socket disconnected');
            this.connected = false;
            this.stopHeartbeat();
            this.emit('disconnect');
        });

        this.socket.on('error', (error) => {
            console.error('Phoenix socket error:', error);
            this.emit('error', error);
        });
    }

    async joinChannel() {
        const joinMsg = {
            topic: `device:${this.deviceId}`,
            event: "phx_join",
            payload: { token: this.authToken },
            ref: "join_ref_1"
        };

        console.log(`Joining channel: device:${this.deviceId}`);
        this.socket.send(JSON.stringify(joinMsg));

        // Wait for join reply
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Channel join timeout'));
            }, 5000);

            const messageHandler = (message) => {
                if (message.event === 'phx_reply' && message.ref === 'join_ref_1') {
                    clearTimeout(timeout);
                    if (message.payload.status === 'ok') {
                        console.log('✅ Join successful!', message.payload.response);
                        this.connected = true;
                        resolve();
                    } else {
                        console.error('❌ Join failed:', message.payload);
                        reject(new Error(`Channel join failed: ${JSON.stringify(message.payload)}`));
                    }
                }
            };

            this.once('message', messageHandler);
        });
    }

    handleMessage(message) {
        this.emit('message', message);

        if (message.event === 'phx_reply') {
            // Handle replies
            return;
        } else if (message.event === 'print_html') {
            this.emit('print_html', message.payload);
        }
        // Add other event handlers as needed
    }

    sendMessage(event, payload) {
        if (!this.isConnected()) {
            console.warn(`Cannot send message: not connected`);
            return;
        }

        const message = {
            topic: `device:${this.deviceId}`,
            event: event,
            payload: payload,
            ref: `${event}_${Date.now()}`
        };

        this.socket.send(JSON.stringify(message));
    }

    startHeartbeat() {
        this.heartbeatInterval = setInterval(() => {
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                const heartbeat = {
                    topic: "phoenix",
                    event: "heartbeat",
                    payload: {},
                    ref: `hb_${Date.now()}`
                };
                this.socket.send(JSON.stringify(heartbeat));
            } else {
                this.stopHeartbeat();
            }
        }, 30000);
    }

    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    disconnect() {
        this.stopHeartbeat();
        
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
        
        this.connected = false;
    }

    isConnected() {
        return this.connected && this.socket && this.socket.readyState === WebSocket.OPEN;
    }
}

module.exports = PhoenixClient;