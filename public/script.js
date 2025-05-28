let isAuthenticated = false;
let currentServerHost = 'http://localhost:4000';

async function authenticate() {
    const authCode = document.getElementById('auth-code').value;
    const serverHost = document.getElementById('server-host').value;
    const statusDiv = document.getElementById('auth-status');
    const connectBtn = document.getElementById('connect-btn');
    
    if (authCode.length !== 6 || !/^\d{6}$/.test(authCode)) {
        statusDiv.innerHTML = '<span class="error">Code must be exactly 6 digits</span>';
        return;
    }
    
    connectBtn.disabled = true;
    connectBtn.textContent = 'Connecting...';
    statusDiv.innerHTML = '<span class="info">Connecting to server...</span>';
    
    try {
        const response = await fetch('/authenticate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                auth_code: authCode,
                server_host: serverHost
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            statusDiv.innerHTML = '<span class="success">Connected successfully!</span>';
            isAuthenticated = true;
            currentServerHost = serverHost;
            
            // Update device info
            document.getElementById('device-name').textContent = result.device_name || 'Unknown';
            document.getElementById('device-id').textContent = result.device_id || 'Unknown';
            
            showDeviceSection();
            refreshStatus();
            updateConnectionStatus(true);
        } else {
            statusDiv.innerHTML = `<span class="error">${result.error}</span>`;
        }
    } catch (error) {
        statusDiv.innerHTML = '<span class="error">Connection error. Check server host.</span>';
        console.error('Authentication error:', error);
    } finally {
        connectBtn.disabled = false;
        connectBtn.textContent = 'Connect to Server';
    }
}

function showDeviceSection() {
    document.getElementById('auth-section').style.display = 'none';
    document.getElementById('device-section').style.display = 'block';
}

function showAuthSection() {
    document.getElementById('auth-section').style.display = 'block';
    document.getElementById('device-section').style.display = 'none';
}

async function refreshStatus() {
    if (!isAuthenticated) return;
    
    try {
        const response = await fetch('/status');
        const data = await response.json();
        
        // Update printer status
        const printerDot = document.getElementById('printer-dot');
        const printerStatus = document.getElementById('printer-status');
        const testPrintBtn = document.getElementById('test-print-btn');
        
        if (data.printer.ready) {
            printerDot.className = 'dot connected';
            printerStatus.textContent = 'Ready';
            testPrintBtn.disabled = false;
        } else {
            printerDot.className = 'dot disconnected';
            printerStatus.textContent = data.printer.status || 'Not Ready';
            testPrintBtn.disabled = true;
        }
        
        // Update scanner status
        const scannerDot = document.getElementById('scanner-dot');
        const scannerStatus = document.getElementById('scanner-status');
        
        if (data.scanner.ready) {
            scannerDot.className = 'dot connected';
            scannerStatus.textContent = 'Ready';
        } else {
            scannerDot.className = 'dot disconnected';
            scannerStatus.textContent = data.scanner.status || 'Not Ready';
        }
        
        updateConnectionStatus(data.connected);
        
    } catch (error) {
        console.error('Status refresh error:', error);
        updateConnectionStatus(false);
    }
}

function updateConnectionStatus(connected) {
    const statusElement = document.getElementById('connection-status');
    const dot = statusElement.querySelector('.dot');
    const text = statusElement.querySelector('span:last-child');
    
    if (connected) {
        dot.className = 'dot connected';
        text.textContent = 'Connected';
    } else {
        dot.className = 'dot disconnected';
        text.textContent = 'Disconnected';
    }
}

async function testPrint() {
    try {
        const response = await fetch('/test-print', {
            method: 'POST'
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert('Test print sent successfully!');
        } else {
            alert('Print error: ' + result.error);
        }
    } catch (error) {
        alert('Connection error');
        console.error('Test print error:', error);
    }
}

async function disconnect() {
    try {
        await fetch('/disconnect', { method: 'POST' });
        
        isAuthenticated = false;
        showAuthSection();
        updateConnectionStatus(false);
        
        // Clear auth code
        document.getElementById('auth-code').value = '';
        document.getElementById('auth-status').innerHTML = '';
        
    } catch (error) {
        console.error('Disconnect error:', error);
    }
}

// Auto-refresh status every 5 seconds when authenticated
setInterval(() => {
    if (isAuthenticated) {
        refreshStatus();
    }
}, 5000);

// Auto-format auth code input
document.getElementById('auth-code').addEventListener('input', function(e) {
    // Remove non-digits
    this.value = this.value.replace(/\D/g, '');
});

// Allow Enter key to authenticate
document.getElementById('auth-code').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        authenticate();
    }
});

document.getElementById('server-host').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        authenticate();
    }
});