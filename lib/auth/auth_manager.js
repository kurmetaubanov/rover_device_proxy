const axios = require('axios');
const EnvManager = require('./env_manager');

class AuthManager {
    constructor() {
        this.envManager = new EnvManager();
        this.authToken = process.env.AUTH_TOKEN || null;
        this.deviceProxyId = process.env.DEVICE_ID || null;
        this.deviceName = process.env.DEVICE_NAME || null;
        this.serverUrl = process.env.ELIXIR_SERVER_URL || 'http://localhost:4001';
    }

    async authenticate(authCode, serverHost) {
        if (!authCode || authCode.length !== 6) {
            throw new Error('Authorization code must be 6 digits long');
        }

        const httpServerUrl = serverHost || this.serverUrl;

        try {
            console.log(`Attempting authentication with 6-digit code: ${authCode}`);
            console.log(`Server: ${httpServerUrl}`);

            const response = await axios.post(`${httpServerUrl}/api/device-proxy/authenticate`, {
                auth_code: authCode
            });

            if (response.data.success) {
                // Store authentication data
                this.authToken = response.data.token;
                this.deviceProxyId = response.data.device_id;
                this.deviceName = response.data.name;
                this.serverUrl = httpServerUrl;

                console.log(`Authentication successful. Device: ${this.deviceName} (ID: ${this.deviceProxyId})`);

                // Save to .env file
                this.envManager.updateEnvFile({
                    AUTH_TOKEN: this.authToken,
                    DEVICE_ID: this.deviceProxyId,
                    DEVICE_NAME: this.deviceName,
                    SERVER_HOST: httpServerUrl
                });

                return {
                    success: true,
                    token: this.authToken,
                    deviceId: this.deviceProxyId,
                    deviceName: this.deviceName
                };
            } else {
                throw new Error('Invalid or expired authorization code');
            }
        } catch (error) {
            console.error('Authentication error:', error.message);
            throw error;
        }
    }

    disconnect() {
        this.authToken = null;
        this.deviceProxyId = null;
        this.deviceName = null;
        this.envManager.clearAuthFromEnv();
        console.log('Disconnected from server and cleared saved credentials');
    }

    getAuthData() {
        return {
            authToken: this.authToken,
            deviceProxyId: this.deviceProxyId,
            deviceName: this.deviceName,
            serverUrl: this.serverUrl
        };
    }

    isAuthenticated() {
        return !!this.authToken && !!this.deviceProxyId;
    }

    hasAutoAuth() {
        return !!process.env.AUTH_TOKEN && !!process.env.DEVICE_ID;
    }
}

module.exports = AuthManager;