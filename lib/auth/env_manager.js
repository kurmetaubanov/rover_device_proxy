const fs = require('fs');
const path = require('path');

class EnvManager {
    constructor() {
        this.envPath = path.join(process.cwd(), '.env');
    }

    updateEnvFile(updates) {
        try {
            let envContent = '';
            
            // Read existing .env if it exists
            if (fs.existsSync(this.envPath)) {
                envContent = fs.readFileSync(this.envPath, 'utf8');
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
            
            fs.writeFileSync(this.envPath, newContent);
            console.log('Updated .env file with authentication data');
            
            // Update process.env for current session
            Object.assign(process.env, updates);
            
        } catch (error) {
            console.error('Failed to update .env file:', error);
        }
    }

    clearAuthFromEnv() {
        this.updateEnvFile({
            AUTH_TOKEN: '',
            DEVICE_ID: '',
            DEVICE_NAME: '',
            SERVER_HOST: ''
        });
    }
}

module.exports = EnvManager;