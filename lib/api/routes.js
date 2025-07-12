const express = require('express');
const ReceiptGenerator = require('../utils/receipt_generator');

function createRoutes(authManager, webSocketManager, deviceManager) {
    const router = express.Router();

    // Authentication endpoint
    router.post('/authenticate', async (req, res) => {
        const { auth_code, server_host } = req.body;
        
        if (!auth_code || auth_code.length !== 6) {
            return res.status(400).json({ 
                success: false, 
                error: 'Authorization code must be 6 digits long' 
            });
        }
        
        try {
            const authResult = await authManager.authenticate(auth_code, server_host);
            
            // Try to connect to Phoenix Channel with retry logic
            const wsConnected = await webSocketManager.connectWithRetry();
            
            res.json({ 
                success: true, 
                message: 'Authenticated successfully',
                device_id: authResult.deviceId,
                device_name: authResult.deviceName,
                auto_saved: true,
                websocket_connected: wsConnected,
                warning: wsConnected ? null : 'WebSocket connection failed - will retry automatically'
            });
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
    router.get('/auth-status', (req, res) => {
        const authData = authManager.getAuthData();
        
        res.json({
            authenticated: authManager.isAuthenticated(),
            device_id: authData.deviceProxyId,
            device_name: authData.deviceName,
            server_host: authData.serverUrl,
            auto_connected: authManager.hasAutoAuth(),
            websocket_connected: webSocketManager.isConnected()
        });
    });

    // Get device status
    router.get('/status', (req, res) => {
        const authData = authManager.getAuthData();
        const deviceStatus = deviceManager.getStatus();
        const wsStatus = webSocketManager.getStatus();
        
        const status = {
            authenticated: authManager.isAuthenticated(),
            connected: wsStatus.connected,
            device_id: authData.deviceProxyId,
            device_name: authData.deviceName,
            auth_token: authData.authToken ? 'present' : 'missing',
            ...deviceStatus,
            server_url: authData.serverUrl,
            auto_connected: authManager.hasAutoAuth(),
            auto_reconnect_active: wsStatus.auto_reconnect_active
        };
        
        res.json(status);
    });

    // Manual WebSocket reconnection endpoint
    router.post('/reconnect', async (req, res) => {
        if (!authManager.isAuthenticated()) {
            return res.status(400).json({
                success: false,
                error: 'Not authenticated'
            });
        }
        
        try {
            const success = await webSocketManager.connectWithRetry();
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

    // Disconnect from server
    router.post('/disconnect', (req, res) => {
        webSocketManager.disconnect();
        authManager.disconnect();
        
        res.json({ success: true, message: 'Disconnected successfully' });
    });

    // Test print
    router.post('/test-print', async (req, res) => {
        const printer = deviceManager.getPrinter();
        
        if (!printer || !printer.isReady()) {
            return res.status(400).json({ 
                success: false, 
                error: 'Printer not ready' 
            });
        }
        
        // const authData = authManager.getAuthData();
        // const deviceStatus = deviceManager.getStatus();
        const testHtml = `
<html><head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Receipt</title>
  <style>
  @page {
    size: 80mm auto;
    margin: 0;
  }

  body {
    font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', 'Source Code Pro', 'Menlo', 'Consolas', monospace;
    font-size: 14px;
    line-height: 1.3;
    margin: 0;
    padding: 0;
    color: #000;
    background: #fff;
    width: 42ch;  /* Уменьшили ширину из-за большего размера шрифта */
    max-width: 42ch;
  }

  .receipt {
    width: 42ch;
    max-width: 42ch;
    white-space: pre-wrap;
    word-break: break-all;
    padding: 8px 0;
  }

  /* Убираем отступы у span элементов по умолчанию */
  .receipt span {
    margin: 0;
    padding: 0;
  }

  /* Clearfix для float элементов */
  .receipt::after {
    content: "";
    display: table;
    clear: both;
  }

  @media print {
    body {
      width: 80mm;
      max-width: 80mm;
    }
  }
</style>

</head>
<body>
  <div class="receipt">Ресторан Вкусно - Центр
Сеть Вкусно
ул. Абая, 150, Алматы
Тел: +7 (727) 123-45-67
БИН: 123456789012
==========================================
Чек № ORD-12345
30.06.2025 14:30
Стол: T12
Официант: Базарбаев А.К.
==========================================
Наурыз коже
2 x 5500.00 ₸<span style="float: right; margin: 0; padding: 0;">11000.00 ₸</span>
+ Без лука
+ Дополнительный соус (+200.00 ₸)

Скидка постоянного клиента: <span style="float: right; margin: 0; padding: 0;">550.00 ₸</span>
------------------------------------------
Бешбармак
1 x 4500.00 ₸<span style="float: right; margin: 0; padding: 0;">4500.00 ₸</span>
------------------------------------------

Итого:<span style="float: right; margin: 0; padding: 0;">14000.00 ₸</span>
Скидка:<span style="float: right; margin: 0; padding: 0;">1000.00 ₸</span>
Обслуживание:<span style="float: right; margin: 0; padding: 0;">500.00 ₸</span>
Всего к оплате:<span style="float: right; margin: 0; padding: 0;">13500.00 ₸</span>
Оплата: Карта
==========================================
Спасибо за визит!

Меню:
<span style="display: block; text-align: center; font-size: 12px; margin: 0; padding: 0;">[QR: https://menu.vkusno.kz/pl...]</span>
</div>


</body></html>
        `;
        
        try {
            await printer.printHtml(testHtml);
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

    return router;
}

module.exports = { createRoutes };