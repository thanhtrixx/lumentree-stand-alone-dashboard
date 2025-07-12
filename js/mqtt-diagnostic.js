/**
 * Lumentree MQTT Connection Diagnostics
 * 
 * This script provides tools for testing and troubleshooting MQTT connections
 * to the Lumentree broker using various connection methods and configurations.
 */
document.addEventListener('DOMContentLoaded', function () {
    // --- UI Elements ---
    const deviceIdInput = document.getElementById('deviceId');
    const connectBtn = document.getElementById('connectBtn');
    const statusIndicator = document.getElementById('statusIndicator');
    const statusText = document.getElementById('statusText');
    const currentMethod = document.getElementById('currentMethod');
    const methodsGrid = document.getElementById('methodsGrid');
    const logsBody = document.getElementById('logsBody');
    const clearLogsBtn = document.getElementById('clearLogsBtn');
    const configDisplay = document.getElementById('configDisplay');
    const dataSection = document.getElementById('dataSection');
    const dataGrid = document.getElementById('dataGrid');

    // --- State & Constants ---
    let mqttClient = null;
    let currentDeviceId = '';
    let dataRequestInterval = null;
    let connectionAttempts = 0;
    let activeMethodIndex = -1;
    let testingInProgress = false;
    
    // MQTT Configuration
    const mqttConfig = {
        host: 'lesvr.suntcn.com',
        port: 8083,  // WebSocket port that works with WebMonitor
        username: 'appuser',
        password: 'app666',
        clientIdFormat: 'android-{device_id}-{timestamp}',
        subscribeTopicFormat: 'reportApp/{device_id}',
        publishTopicFormat: 'listenApp/{device_id}',
        useWebSocket: true,
        wsPath: '/mqtt',
        useTLS: false,
        keepalive: 20,
        reconnectPeriod: 5000,
        connectTimeout: 30000
    };
    
    // Connection methods to test
    const connectionMethods = [
        {
            name: "WebSocket (ws)",
            description: "Non-secure WebSocket connection on port 8083",
            config: { useWebSocket: true, useTLS: false, port: 8083 },
            status: "pending"
        },
        {
            name: "WebSocket Secure (wss)",
            description: "Secure WebSocket connection on port 8084",
            config: { useWebSocket: true, useTLS: true, port: 8084 },
            status: "pending"
        },
        {
            name: "MQTT (TCP)",
            description: "Direct MQTT connection on port 1886 (may not work in browsers)",
            config: { useWebSocket: false, useTLS: false, port: 1886 },
            status: "pending"
        }
    ];

    // --- Event Listeners ---
    connectBtn.addEventListener('click', startDiagnostics);
    clearLogsBtn.addEventListener('click', clearLogs);

    // --- Initialization ---
    initMethodsGrid();
    updateConfigDisplay();
    logMessage("info", "Diagnostic tool initialized. Enter a Device ID and click 'Start Diagnostics'.");

    // --- Functions ---
    function initMethodsGrid() {
        methodsGrid.innerHTML = '';
        connectionMethods.forEach((method, index) => {
            const methodCard = document.createElement('div');
            methodCard.className = 'border rounded-md p-3 bg-gray-50 dark:bg-gray-700';
            methodCard.innerHTML = `
                <div class="flex items-center justify-between mb-2">
                    <h3 class="font-medium">${method.name}</h3>
                    <span class="px-2 py-1 text-xs rounded-full method-status-${index} bg-gray-200 dark:bg-gray-600">Pending</span>
                </div>
                <p class="text-sm text-gray-600 dark:text-gray-400 mb-2">${method.description}</p>
                <button class="test-method-btn w-full px-3 py-1 text-sm bg-blue-500 text-white rounded-md hover:bg-blue-600" data-index="${index}">
                    Test Connection
                </button>
            `;
            methodsGrid.appendChild(methodCard);
        });

        // Add event listeners to test buttons
        document.querySelectorAll('.test-method-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (!testingInProgress) {
                    const methodIndex = parseInt(btn.getAttribute('data-index'));
                    testConnectionMethod(methodIndex);
                } else {
                    logMessage("warn", "Please wait for the current test to complete.");
                }
            });
        });
    }

    function updateMethodStatus(index, status, message = '') {
        const statusElement = document.querySelector(`.method-status-${index}`);
        if (!statusElement) return;
        
        statusElement.textContent = status.charAt(0).toUpperCase() + status.slice(1);
        statusElement.className = `px-2 py-1 text-xs rounded-full method-status-${index} `;
        
        switch (status) {
            case 'success':
                statusElement.className += 'bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200';
                break;
            case 'failed':
                statusElement.className += 'bg-red-200 dark:bg-red-800 text-red-800 dark:text-red-200';
                break;
            case 'testing':
                statusElement.className += 'bg-yellow-200 dark:bg-yellow-800 text-yellow-800 dark:text-yellow-200';
                break;
            default:
                statusElement.className += 'bg-gray-200 dark:bg-gray-600';
        }
        
        connectionMethods[index].status = status;
        if (message) {
            connectionMethods[index].message = message;
        }
    }

    function updateConfigDisplay() {
        // Create a copy of the config without the password
        const displayConfig = { ...mqttConfig, password: '******' };
        configDisplay.textContent = JSON.stringify(displayConfig, null, 2);
    }

    function updateConnectionStatus(status, message = '') {
        switch (status) {
            case 'connected':
                statusIndicator.className = 'w-4 h-4 rounded-full bg-green-500 mr-2';
                statusText.textContent = 'Connected';
                break;
            case 'connecting':
                statusIndicator.className = 'w-4 h-4 rounded-full bg-yellow-500 mr-2';
                statusText.textContent = 'Connecting...';
                break;
            case 'disconnected':
                statusIndicator.className = 'w-4 h-4 rounded-full bg-red-500 mr-2';
                statusText.textContent = 'Disconnected';
                break;
            case 'error':
                statusIndicator.className = 'w-4 h-4 rounded-full bg-red-500 mr-2';
                statusText.textContent = 'Error';
                break;
            default:
                statusIndicator.className = 'w-4 h-4 rounded-full bg-gray-400 mr-2';
                statusText.textContent = 'Not Connected';
        }
        
        if (message) {
            currentMethod.textContent = message;
        }
    }

    function logMessage(level, message, data = null) {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-US', { hour12: false });
        
        const row = document.createElement('tr');
        row.className = level === 'error' ? 'text-red-600 dark:text-red-400' : 
                        level === 'warn' ? 'text-yellow-600 dark:text-yellow-400' : '';
        
        const timeCell = document.createElement('td');
        timeCell.className = 'px-2 py-1';
        timeCell.textContent = timeStr;
        
        const levelCell = document.createElement('td');
        levelCell.className = 'px-2 py-1';
        levelCell.textContent = level.toUpperCase();
        
        const messageCell = document.createElement('td');
        messageCell.className = 'px-2 py-1';
        messageCell.textContent = message;
        
        row.appendChild(timeCell);
        row.appendChild(levelCell);
        row.appendChild(messageCell);
        logsBody.appendChild(row);
        
        // Scroll to bottom
        logsBody.parentElement.scrollTop = logsBody.parentElement.scrollHeight;
        
        // Also log to console with data if available
        if (data) {
            console.log(`[${timeStr}] [${level.toUpperCase()}] ${message}`, data);
        } else {
            console.log(`[${timeStr}] [${level.toUpperCase()}] ${message}`);
        }
    }

    function clearLogs() {
        logsBody.innerHTML = '';
        logMessage("info", "Logs cleared.");
    }

    // --- Main Diagnostic Logic ---
    function startDiagnostics() {
        const deviceId = deviceIdInput.value.trim();
        if (!deviceId) {
            logMessage("error", "Please enter a Device ID.");
            return;
        }

        currentDeviceId = deviceId;
        logMessage("info", `Starting diagnostics for Device ID: ${deviceId}`);
        
        // Reset all method statuses
        connectionMethods.forEach((_, index) => {
            updateMethodStatus(index, 'pending');
        });
        
        // Start with the first method
        testConnectionMethod(0);
    }

    function testConnectionMethod(methodIndex) {
        if (methodIndex >= connectionMethods.length) {
            logMessage("info", "All connection methods tested.");
            testingInProgress = false;
            return;
        }
        
        // Disconnect any existing connection
        disconnectFromMqtt();
        
        const method = connectionMethods[methodIndex];
        activeMethodIndex = methodIndex;
        testingInProgress = true;
        
        logMessage("info", `Testing connection method: ${method.name}`);
        updateMethodStatus(methodIndex, 'testing');
        
        // Apply method configuration
        Object.assign(mqttConfig, method.config);
        updateConfigDisplay();
        
        // Try to connect
        connectToMqtt(currentDeviceId, methodIndex)
            .then(() => {
                // Connection successful - will be handled by MQTT events
            })
            .catch(err => {
                logMessage("error", `Connection failed: ${err.message}`);
                updateMethodStatus(methodIndex, 'failed', err.message);
                updateConnectionStatus('error', `Failed: ${method.name}`);
                
                // Move to next method after a delay
                setTimeout(() => {
                    testConnectionMethod(methodIndex + 1);
                }, 2000);
            });
    }

    function getMQTTBrokerUrl(useTLS = false) {
        const protocol = mqttConfig.useWebSocket ? (useTLS ? 'wss' : 'ws') : (useTLS ? 'mqtts' : 'mqtt');
        const port = useTLS ? 8084 : mqttConfig.port;
        const wsPath = mqttConfig.useWebSocket ? mqttConfig.wsPath : '';
        return `${protocol}://${mqttConfig.host}:${port}${wsPath}`;
    }

    // --- MQTT Client ---
    function connectToMqtt(deviceId, methodIndex) {
        return new Promise((resolve, reject) => {
            connectionAttempts++;
            const timestamp = Date.now();
            const clientId = mqttConfig.clientIdFormat
                .replace('{device_id}', deviceId)
                .replace('{timestamp}', timestamp);
                
            const options = {
                clientId: clientId,
                username: mqttConfig.username,
                password: mqttConfig.password,
                clean: true,
                keepalive: mqttConfig.keepalive,
                connectTimeout: mqttConfig.connectTimeout,
                reconnectPeriod: mqttConfig.reconnectPeriod
            };

            // Get broker URL based on current config
            const brokerUrl = getMQTTBrokerUrl(mqttConfig.useTLS);
            logMessage("info", `Connecting to MQTT broker: ${brokerUrl} (Attempt #${connectionAttempts})`);
            updateConnectionStatus('connecting', `Connecting to ${brokerUrl}`);
            
            try {
                mqttClient = mqtt.connect(brokerUrl, options);
            } catch (err) {
                reject(err);
                return;
            }

            // Set connection timeout
            const connectionTimeout = setTimeout(() => {
                if (mqttClient && !mqttClient.connected) {
                    logMessage("error", "Connection timeout");
                    mqttClient.end(true);
                    reject(new Error("Connection timeout"));
                }
            }, mqttConfig.connectTimeout);

            mqttClient.on('connect', () => {
                clearTimeout(connectionTimeout);
                logMessage("info", "MQTT client connected successfully.");
                updateConnectionStatus('connected', `Connected to ${brokerUrl}`);
                updateMethodStatus(methodIndex, 'success');
                
                const subTopic = mqttConfig.subscribeTopicFormat.replace('{device_id}', deviceId);
                mqttClient.subscribe(subTopic, { qos: 1 }, (err) => {
                    if (err) {
                        logMessage("error", `MQTT subscription error: ${err.message}`);
                    } else {
                        logMessage("info", `Subscribed to topic: ${subTopic}`);
                        
                        // Start data request interval
                        startDataRequests();
                    }
                });
                
                resolve();
            });

            mqttClient.on('error', (err) => {
                clearTimeout(connectionTimeout);
                logMessage("error", `MQTT error: ${err.message}`);
                reject(err);
            });

            mqttClient.on('close', () => {
                logMessage("info", "MQTT connection closed.");
                updateConnectionStatus('disconnected');
            });

            mqttClient.on('message', (topic, payload) => {
                logMessage("info", `Message received on topic: ${topic}`, { length: payload.length });
                try {
                    parseDeviceData(payload, deviceId);
                } catch (err) {
                    logMessage("error", `Error parsing message: ${err.message}`);
                }
            });
        });
    }

    function disconnectFromMqtt() {
        if (dataRequestInterval) {
            clearInterval(dataRequestInterval);
            dataRequestInterval = null;
        }
        
        if (mqttClient) {
            mqttClient.end(true);
            mqttClient = null;
            logMessage("info", "Disconnected from MQTT broker.");
        }
    }

    function startDataRequests() {
        if (dataRequestInterval) {
            clearInterval(dataRequestInterval);
        }
        
        // Send initial request
        requestDeviceData();
        
        // Set up interval for regular requests
        dataRequestInterval = setInterval(requestDeviceData, 5000);
        logMessage("info", "Started data request interval (every 5 seconds).");
    }

    function requestDeviceData() {
        if (!mqttClient || !mqttClient.connected) {
            logMessage("warn", "Skipping data request: MQTT client not ready.");
            return;
        }
        
        const pubTopic = mqttConfig.publishTopicFormat.replace('{device_id}', currentDeviceId);
        const command = createReadCommand(0, 95);
        logMessage("info", `Publishing request to ${pubTopic}`);
        mqttClient.publish(pubTopic, command, { qos: 1 });
    }

    function createReadCommand(start, count) {
        // Create a buffer for the Modbus-like read command
        const buffer = Buffer.alloc(13);
        buffer.writeUInt8(0x01, 0);      // Function code
        buffer.writeUInt8(0x03, 1);      // Read holding registers
        buffer.writeUInt16BE(start, 2);  // Starting address
        buffer.writeUInt16BE(count, 4);  // Quantity of registers
        buffer.writeUInt32BE(0, 6);      // Padding
        buffer.writeUInt32BE(0, 10);     // More padding
        return buffer;
    }

    function parseDeviceData(payload, deviceId) {
        if (payload.length < 200) {
            logMessage("warn", "Payload too short to be valid data.");
            return;
        }

        try {
            // Function to get a specific register (16-bit value) from the payload
            const getReg = (index) => {
                const offset = 9 + (index * 2);
                if (offset + 1 >= payload.length) {
                    throw new Error(`Register index ${index} out of bounds`);
                }
                return payload.slice(offset, offset + 2);
            };

            // Extract key metrics
            const data = {
                pv1Voltage: getReg(20).readUInt16BE(0) / 10,
                pv1Current: getReg(21).readUInt16BE(0) / 10,
                pv1Power: getReg(22).readUInt16BE(0),
                pv2Voltage: getReg(23).readUInt16BE(0) / 10,
                pv2Current: getReg(24).readUInt16BE(0) / 10,
                pv2Power: getReg(25).readUInt16BE(0),
                pvTotalPower: getReg(28).readUInt16BE(0),
                gridVoltage: getReg(29).readUInt16BE(0) / 10,
                gridCurrent: getReg(30).readUInt16BE(0) / 10,
                gridPower: getReg(31).readUInt16BE(0),
                batteryVoltage: getReg(47).readUInt16BE(0) / 10,
                batteryCurrent: getReg(48).readUInt16BE(0) / 10,
                batteryPower: getReg(49).readUInt16BE(0),
                batteryPercent: getReg(50).readUInt16BE(0),
                loadPower: getReg(53).readUInt16BE(0),
                inverterTemp: getReg(90).readUInt16BE(0) / 10
            };

            // Calculate additional metrics
            data.pvTotalPower = data.pv1Power + data.pv2Power;
            
            // Show data section
            dataSection.classList.remove('hidden');
            
            // Update data display
            updateDataDisplay(data);
            
            logMessage("info", "Successfully parsed device data", data);
            return data;
        } catch (err) {
            logMessage("error", `Error parsing device data: ${err.message}`);
            return null;
        }
    }

    function updateDataDisplay(data) {
        // Clear existing data
        dataGrid.innerHTML = '';
        
        // Add each data point
        Object.entries(data).forEach(([key, value]) => {
            const dataCard = document.createElement('div');
            dataCard.className = 'border rounded-md p-3 bg-gray-50 dark:bg-gray-700';
            
            // Format the key for display
            const formattedKey = key
                .replace(/([A-Z])/g, ' $1') // Add space before capital letters
                .replace(/^./, str => str.toUpperCase()); // Capitalize first letter
            
            // Format the value with units
            let formattedValue = value;
            let unit = '';
            
            if (key.includes('Voltage')) unit = 'V';
            else if (key.includes('Current')) unit = 'A';
            else if (key.includes('Power')) unit = 'W';
            else if (key.includes('Percent')) {
                unit = '%';
                formattedValue = Math.min(100, Math.max(0, value)); // Clamp between 0-100
            }
            else if (key.includes('Temp')) unit = '°C';
            
            dataCard.innerHTML = `
                <div class="text-sm text-gray-600 dark:text-gray-400">${formattedKey}</div>
                <div class="text-xl font-semibold">${formattedValue}${unit}</div>
            `;
            
            dataGrid.appendChild(dataCard);
        });
    }
});
