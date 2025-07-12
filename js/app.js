/**
 * Lumentree Standalone Viewer - Frontend JavaScript (v4 - Direct MQTT Connection)
 *
 * This script handles:
 * 1. Connecting directly to the Lumentree MQTT broker using the provided configuration.
 * 2. Sending commands and parsing data to update the UI.
 * 3. Providing detailed connection status and error reporting.
 */
document.addEventListener('DOMContentLoaded', function () {
    // Charts objects
    let pvChart, batChart, loadChart, gridChart, essentialChart;
    
    // Historical data storage
    let historicalData = {
        pv: [],
        batCharge: [],
        batDischarge: [],
        load: [],
        grid: [],
        essentialLoad: []
    };
    
    // --- UI Elements ---
    const connectBtn = document.getElementById('connectBtn');
    const deviceIdInput = document.getElementById('deviceId');
    const realTimeFlow = document.getElementById('realTimeFlow');
    const connectionStatus = document.getElementById('connectionStatus');
    const connectionIndicator = document.getElementById('connectionIndicator');
    const connectionText = document.getElementById('connectionText');
    const loading = document.getElementById('loading');
    const errorMessage = document.getElementById('errorMessage');
    const errorText = document.getElementById('errorText');
    
    // Set up today's date as default
    const today = new Date();
    const dateInput = document.getElementById('dateInput');
    dateInput.value = formatDate(today);
    
    // Check for deviceId in URL query parameters
    const urlParams = new URLSearchParams(window.location.search);
    const deviceIdFromUrl = urlParams.get('deviceId');
    if (deviceIdFromUrl) {
        deviceIdInput.value = deviceIdFromUrl;
        // Auto-connect after a short delay to ensure DOM is fully loaded
        setTimeout(() => startFullConnectionProcess(), 500);
    }

    // --- State & Constants ---
    let mqttClient = null;
    let currentDeviceId = '';
    let dataRequestInterval = null;
    let connectionAttempts = 0;
    
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
    
    // --- Chart Configuration ---
    function configureChartDefaults() {
        Chart.defaults.font.family = "'Inter', 'Segoe UI', 'Helvetica', 'Arial', sans-serif";
        Chart.defaults.color = '#64748b'; // Text color for better contrast
        Chart.defaults.elements.line.borderWidth = 2;
        Chart.defaults.elements.point.hitRadius = 8; // Larger hit area for tooltips on mobile

        // Apply consistent color palette for dark/light mode
        const isDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

        // Set grid colors based on theme
        Chart.defaults.scale.grid.color = isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';
        Chart.defaults.scale.ticks.color = isDarkMode ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.7)';
    }
    
    const log = (message, ...args) => console.log(`[${new Date().toISOString()}] ${message}`, ...args);

    // --- Event Listeners ---
    connectBtn.addEventListener('click', handleConnection);
    deviceIdInput.addEventListener('keypress', (e) => e.key === 'Enter' && handleConnection());
    
    // Date navigation
    document.getElementById('prevDay').addEventListener('click', () => changeDate(-1));
    document.getElementById('nextDay').addEventListener('click', () => changeDate(1));
    document.getElementById('dateInput').addEventListener('change', () => {
        const selectedDate = new Date(dateInput.value);
        if (mqttClient && mqttClient.connected) {
            fetchHistoricalData(selectedDate, currentDeviceId);
        }
    });
    
    // Add click event listeners for summary cards
    document.getElementById('pv-card').addEventListener('click', () => scrollToElement('pv-section'));
    document.getElementById('bat-charge-card').addEventListener('click', () => scrollToElement('bat-section'));
    document.getElementById('bat-discharge-card').addEventListener('click', () => scrollToElement('bat-section'));
    document.getElementById('load-card').addEventListener('click', () => scrollToElement('load-section'));
    document.getElementById('grid-card').addEventListener('click', () => scrollToElement('grid-section'));
    document.getElementById('essential-card').addEventListener('click', () => scrollToElement('essential-section'));

    function handleConnection() {
        if (mqttClient && mqttClient.connected) {
            disconnectFromMqtt();
        } else {
            startFullConnectionProcess();
        }
    }

    // --- UI Update Functions ---
    const showError = (message) => {
        errorText.textContent = message;
        errorMessage.classList.remove('hidden');
        loading.classList.add('hidden');
        connectBtn.disabled = false;
    };
    const hideError = () => errorMessage.classList.add('hidden');
    const updateConnectionStatus = (status, message) => {
        connectionStatus.classList.remove('hidden');
        let colorClass = 'bg-red-500'; // error/disconnected
        if (status === 'connecting') colorClass = 'bg-yellow-500';
        else if (status === 'connected') colorClass = 'bg-green-500';
        connectionIndicator.className = `w-3 h-3 rounded-full ${colorClass}`;
        connectionText.textContent = message;
    };

    // --- Main Connection Logic ---
    async function startFullConnectionProcess() {
        const deviceId = deviceIdInput.value.trim();
        if (!deviceId) {
            showError('Please enter a Device ID.');
            return;
        }

        hideError();
        loading.classList.remove('hidden');
        connectBtn.disabled = true;
        currentDeviceId = deviceId;

        try {
            log('--- Starting MQTT Connection ---');
            updateConnectionStatus('connecting', 'MQTT Connect...');
            await connectToMqtt(deviceId);
        } catch (err) {
            log('Connection process failed:', err);
            showError(err.message);
            disconnectFromMqtt();
        }
    }

    // --- Connection Diagnostics ---
    function getMQTTBrokerUrl(useTLS = false) {
        const protocol = mqttConfig.useWebSocket ? (useTLS ? 'wss' : 'ws') : (useTLS ? 'mqtts' : 'mqtt');
        const port = useTLS ? 8084 : mqttConfig.port;
        const wsPath = mqttConfig.useWebSocket ? mqttConfig.wsPath : '';
        return `${protocol}://${mqttConfig.host}:${port}${wsPath}`;
    }

    // --- MQTT Client ---
    function connectToMqtt(deviceId) {
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

            // Try WebSocket connection first
            const brokerUrl = getMQTTBrokerUrl(mqttConfig.useTLS);
            log(`Connecting to MQTT broker: ${brokerUrl} (Attempt #${connectionAttempts})`);
            log('Connection options:', { ...options, password: '***' });
            
            mqttClient = mqtt.connect(brokerUrl, options);

            mqttClient.on('connect', () => {
                log('MQTT client connected successfully.');
                loading.classList.add('hidden');
                connectBtn.disabled = false;
                connectBtn.textContent = 'Disconnect';
                connectBtn.classList.replace('bg-blue-600', 'bg-red-600');
                updateConnectionStatus('connected', `Connected to ${deviceId}`);
                realTimeFlow.classList.remove('hidden');
                document.getElementById('inverter-type').textContent = deviceId;

                const subTopic = mqttConfig.subscribeTopicFormat.replace('{device_id}', deviceId);
                mqttClient.subscribe(subTopic, { qos: 1 }, (err) => {
                    if (err) {
                        log('MQTT subscription error:', err);
                        reject(new Error('Failed to subscribe to device topic.'));
                    } else {
                        log(`Subscribed to: ${subTopic}`);
                        if (dataRequestInterval) clearInterval(dataRequestInterval);
                        requestData();
                        dataRequestInterval = setInterval(requestData, 5000);
                        resolve();
                    }
                });
            });

            mqttClient.on('message', (topic, payload) => {
                log(`Message on topic ${topic}, size: ${payload.length} bytes.`);
                parseDeviceData(payload, deviceId);
            });

            mqttClient.on('error', (err) => {
                log('MQTT Connection Error:', err);
                reject(new Error('MQTT connection failed. Check console for details.'));
            });

            mqttClient.on('close', () => log('MQTT connection closed.'));
        });
    }

    function disconnectFromMqtt() {
        log('Disconnecting...');
        if (dataRequestInterval) clearInterval(dataRequestInterval);
        if (mqttClient) mqttClient.end();
        dataRequestInterval = null;
        mqttClient = null;
        connectBtn.disabled = false;
        connectBtn.textContent = 'Connect';
        connectBtn.classList.replace('bg-red-600', 'bg-blue-600');
        realTimeFlow.classList.add('hidden');
        loading.classList.add('hidden');
        updateConnectionStatus('disconnected', 'Disconnected');
        currentDeviceId = '';
    }

    function requestData() {
        if (!mqttClient || !mqttClient.connected || !currentDeviceId) {
            log('Skipping data request: MQTT client not ready.');
            return;
        }
        const pubTopic = mqttConfig.publishTopicFormat.replace('{device_id}', currentDeviceId);
        const command = createReadCommand(0, 95);
        log(`Publishing request to ${pubTopic}`);
        mqttClient.publish(pubTopic, command, { qos: 1 });
    }

    // --- Data Parsing & Command Generation ---
    function crc16Modbus(data) {
        let crc = 0xFFFF;
        for (let i = 0; i < data.length; i++) {
            crc ^= data[i];
            for (let j = 0; j < 8; j++) {
                crc = (crc & 1) ? (crc >> 1) ^ 0xA001 : crc >> 1;
            }
        }
        
        // Return CRC as a Uint8Array (2 bytes, little-endian)
        const crcArray = new Uint8Array(2);
        crcArray[0] = crc & 0xFF;         // Low byte
        crcArray[1] = (crc >> 8) & 0xFF;  // High byte
        return crcArray;
    }
    
    function createReadCommand(startAddr, count) {
        // Create command buffer (6 bytes)
        const cmd = new Uint8Array(6);
        cmd[0] = 0x01;  // Device address
        cmd[1] = 0x03;  // Function code (read holding registers)
        
        // Write start address (big-endian)
        cmd[2] = (startAddr >> 8) & 0xFF;  // High byte
        cmd[3] = startAddr & 0xFF;         // Low byte
        
        // Write register count (big-endian)
        cmd[4] = (count >> 8) & 0xFF;  // High byte
        cmd[5] = count & 0xFF;         // Low byte
        
        // Calculate CRC
        const crc = crc16Modbus(cmd);
        
        // Combine command and CRC
        const result = new Uint8Array(8);
        result.set(cmd, 0);
        result.set(crc, 6);
        
        return result;
    }
    
    function getSignedValue(dataView) {
        // Convert Uint8Array to signed 16-bit value
        if (dataView.length < 2) return 0;
        
        // Create a DataView from the Uint8Array
        const buffer = new ArrayBuffer(2);
        const view = new DataView(buffer);
        view.setUint8(0, dataView[0]);
        view.setUint8(1, dataView[1]);
        
        return view.getInt16(0, false); // false = big-endian
    }
    
    function parseDeviceData(payload, deviceId) {
        try {
            // Convert payload to hex string
            let hexPayload = '';
            for (let i = 0; i < payload.length; i++) {
                hexPayload += ('0' + payload[i].toString(16)).slice(-2);
            }
            
            // Check for valid data format
            let dataPartHex = hexPayload.includes('2b2b2b2b') ? hexPayload.split('2b2b2b2b')[1] : hexPayload;
            if (!dataPartHex || !dataPartHex.startsWith('0103')) {
                log('Invalid data format');
                return;
            }
            
            const dataLength = parseInt(dataPartHex.substring(4, 6), 16);
            
            // Convert hex string to Uint8Array
            const registerHex = dataPartHex.substring(6, 6 + dataLength * 2);
            const registers = new Uint8Array(dataLength);
            for (let i = 0; i < dataLength; i++) {
                registers[i] = parseInt(registerHex.substr(i * 2, 2), 16);
            }
            
            if (registers.length < dataLength) {
                log('Register data too short');
                return;
            }
            
            // Function to get register data (2 bytes)
            const getReg = (addr) => {
                const offset = addr * 2;
                if (offset + 1 >= registers.length) return new Uint8Array([0, 0]);
                return new Uint8Array([registers[offset], registers[offset + 1]]);
            };
            
            // Function to read unsigned 16-bit value (big-endian)
            const readUInt16BE = (arr) => {
                if (arr.length < 2) return 0;
                return (arr[0] << 8) | arr[1];
            };
            
            const data = {
                pv1Power: readUInt16BE(getReg(22)),
                pv1Voltage: readUInt16BE(getReg(20)),
                pv2Power: readUInt16BE(getReg(74)),
                pv2Voltage: readUInt16BE(getReg(72)),
                gridValue: getSignedValue(getReg(59)),
                gridVoltageValue: readUInt16BE(getReg(15)) / 10.0,
                batteryValue: getSignedValue(getReg(61)),
                batteryPercent: readUInt16BE(getReg(50)),
                deviceTempValue: (readUInt16BE(getReg(24)) - 1000) / 10.0,
                loadValue: readUInt16BE(getReg(67)),
            };
            
            data.pvTotalPower = data.pv1Power + (data.pv2Voltage > 0 ? data.pv2Power : 0);
            data.batteryStatus = data.batteryValue < 0 ? "Charging" : "Discharging";
            data.batteryValue = Math.abs(data.batteryValue);
            
            log('Parsed device data:', data);
            updateRealTimeDisplay(data);
        } catch (err) {
            log('Error parsing device data:', err);
        }
    }

    // --- UI Update Logic ---
    function updateRealTimeDisplay(data) {
        document.getElementById('pv-power').textContent = `${data.pvTotalPower}W`;
        document.getElementById('pv-desc').textContent = `${data.pv1Voltage}V`;
        document.getElementById('grid-power').textContent = `${data.gridValue}W`;
        document.getElementById('grid-voltage').textContent = `${data.gridVoltageValue}V`;
        document.getElementById('battery-percentage').textContent = `${data.batteryPercent}%`;
        const batteryPowerEl = document.getElementById('battery-power');
        batteryPowerEl.innerHTML = `<span class="text-${data.batteryStatus === 'Charging' ? 'green' : 'red'}-600 dark:text-${data.batteryStatus === 'Charging' ? 'green' : 'red'}-300">${data.batteryStatus === 'Charging' ? '+' : '-'}${data.batteryValue}W</span>`;
        document.getElementById('device-temp').textContent = `${data.deviceTempValue.toFixed(1)}°C`;
        document.getElementById('load-power').textContent = `${data.loadValue}W`;

        const batteryIcon = document.getElementById('battery-icon');
        if (data.batteryPercent < 20) batteryIcon.src = "images/icons/bat_low.png";
        else if (data.batteryPercent < 80) batteryIcon.src = "images/icons/bat_medium.png";
        else batteryIcon.src = "images/icons/bat_green.png";
        
        // Update device info panel
        updateDeviceInfo(data, currentDeviceId);
        
        // Update summary statistics
        updateSummaryStats(data);
        
        // Update charts with real-time data
        updateChartsWithRealtimeData(data);
    }
    
    // --- Device Info Panel ---
    function updateDeviceInfo(data, deviceId) {
        const deviceInfoPanel = document.getElementById('deviceInfo');
        deviceInfoPanel.classList.remove('hidden');
        
        document.getElementById('device-id').textContent = deviceId;
        document.getElementById('device-type').textContent = 'Lumentree Hybrid Inverter';
        document.getElementById('device-status').textContent = mqttClient && mqttClient.connected ? 'Online' : 'Offline';
    }
    
    // --- Summary Statistics ---
    function updateSummaryStats(data) {
        const summaryStats = document.getElementById('summaryStats');
        summaryStats.classList.remove('hidden');
        
        document.getElementById('pv-total').textContent = `${data.pvTotalPower}W`;
        document.getElementById('bat-charge').textContent = data.batteryStatus === 'Charging' ? `${data.batteryValue}W` : '0W';
        document.getElementById('bat-discharge').textContent = data.batteryStatus === 'Discharging' ? `${data.batteryValue}W` : '0W';
        document.getElementById('load-total').textContent = `${data.loadValue}W`;
        document.getElementById('grid-total').textContent = `${Math.abs(data.gridValue)}W`;
        document.getElementById('essential-total').textContent = `${data.loadValue}W`; // Assuming essential load is same as total load
    }
    
    // --- Chart Functions ---
    function initializeCharts() {
        const chartSection = document.getElementById('chart-section');
        chartSection.classList.remove('hidden');
        
        // Common chart options
        const commonOptions = {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        usePointStyle: true,
                        boxWidth: 6
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.7)',
                    padding: 10,
                    cornerRadius: 4,
                    boxPadding: 3
                }
            },
            scales: {
                x: {
                    type: 'time',
                    time: {
                        unit: 'hour',
                        displayFormats: {
                            hour: 'HH:mm'
                        },
                        tooltipFormat: 'HH:mm'
                    },
                    title: {
                        display: true,
                        text: 'Time'
                    }
                },
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Power (W)'
                    }
                }
            },
            elements: {
                line: {
                    tension: 0.2 // Smoother curves
                },
                point: {
                    radius: 0, // Hide points
                    hitRadius: 10 // But keep hit area for tooltips
                }
            }
        };
        
        // Create PV Chart
        pvChart = new Chart(document.getElementById('pvChart'), {
            type: 'line',
            data: {
                datasets: [{
                    label: 'PV Production',
                    data: [],
                    borderColor: '#EAB308', // Yellow
                    backgroundColor: 'rgba(234, 179, 8, 0.2)',
                    fill: true
                }]
            },
            options: commonOptions
        });
        
        // Create Battery Chart
        batChart = new Chart(document.getElementById('batChart'), {
            type: 'line',
            data: {
                datasets: [{
                    label: 'Charging',
                    data: [],
                    borderColor: '#22C55E', // Green
                    backgroundColor: 'rgba(34, 197, 94, 0.2)',
                    fill: true
                }, {
                    label: 'Discharging',
                    data: [],
                    borderColor: '#EF4444', // Red
                    backgroundColor: 'rgba(239, 68, 68, 0.2)',
                    fill: true
                }]
            },
            options: commonOptions
        });
        
        // Create Load Chart
        loadChart = new Chart(document.getElementById('loadChart'), {
            type: 'line',
            data: {
                datasets: [{
                    label: 'Home Load',
                    data: [],
                    borderColor: '#3B82F6', // Blue
                    backgroundColor: 'rgba(59, 130, 246, 0.2)',
                    fill: true
                }]
            },
            options: commonOptions
        });
        
        // Create Grid Chart
        gridChart = new Chart(document.getElementById('gridChart'), {
            type: 'line',
            data: {
                datasets: [{
                    label: 'Grid Usage',
                    data: [],
                    borderColor: '#8B5CF6', // Purple
                    backgroundColor: 'rgba(139, 92, 246, 0.2)',
                    fill: true
                }]
            },
            options: commonOptions
        });
        
        // Create Essential Load Chart
        essentialChart = new Chart(document.getElementById('essentialChart'), {
            type: 'line',
            data: {
                datasets: [{
                    label: 'Essential Load',
                    data: [],
                    borderColor: '#6B7280', // Gray
                    backgroundColor: 'rgba(107, 114, 128, 0.2)',
                    fill: true
                }]
            },
            options: commonOptions
        });
    }
    
    function updateChartsWithRealtimeData(data) {
        // Initialize charts if they don't exist yet
        if (!pvChart) {
            initializeCharts();
        }
        
        const now = new Date();
        
        // Add data points to historical data
        historicalData.pv.push({ x: now, y: data.pvTotalPower });
        historicalData.batCharge.push({ x: now, y: data.batteryStatus === 'Charging' ? data.batteryValue : 0 });
        historicalData.batDischarge.push({ x: now, y: data.batteryStatus === 'Discharging' ? data.batteryValue : 0 });
        historicalData.load.push({ x: now, y: data.loadValue });
        historicalData.grid.push({ x: now, y: Math.abs(data.gridValue) });
        historicalData.essentialLoad.push({ x: now, y: data.loadValue }); // Assuming essential load is same as total load
        
        // Limit data points to prevent memory issues (keep last 100 points)
        const maxDataPoints = 100;
        Object.keys(historicalData).forEach(key => {
            if (historicalData[key].length > maxDataPoints) {
                historicalData[key] = historicalData[key].slice(-maxDataPoints);
            }
        });
        
        // Update charts
        pvChart.data.datasets[0].data = historicalData.pv;
        batChart.data.datasets[0].data = historicalData.batCharge;
        batChart.data.datasets[1].data = historicalData.batDischarge;
        loadChart.data.datasets[0].data = historicalData.load;
        gridChart.data.datasets[0].data = historicalData.grid;
        essentialChart.data.datasets[0].data = historicalData.essentialLoad;
        
        // Update all charts
        pvChart.update();
        batChart.update();
        loadChart.update();
        gridChart.update();
        essentialChart.update();
    }
    
    // --- Date Navigation Functions ---
    function formatDate(date) {
        return date.toISOString().split('T')[0];
    }
    
    function changeDate(days) {
        const currentDate = new Date(dateInput.value);
        currentDate.setDate(currentDate.getDate() + days);
        dateInput.value = formatDate(currentDate);
        
        // If connected, fetch historical data for the new date
        if (mqttClient && mqttClient.connected) {
            fetchHistoricalData(currentDate, currentDeviceId);
        }
    }
    
    function fetchHistoricalData(date, deviceId) {
        // In a real implementation, this would fetch historical data from an API
        // For now, we'll just show a message that this would fetch data for the selected date
        console.log(`Would fetch historical data for ${deviceId} on ${formatDate(date)}`);
        
        // For demo purposes, generate some random historical data
        generateDemoHistoricalData(date);
    }
    
    function generateDemoHistoricalData(date) {
        // Clear existing historical data
        Object.keys(historicalData).forEach(key => {
            historicalData[key] = [];
        });
        
        // Generate data points for every hour of the selected day
        const startTime = new Date(date);
        startTime.setHours(0, 0, 0, 0);
        
        for (let hour = 0; hour < 24; hour++) {
            const time = new Date(startTime);
            time.setHours(hour);
            
            // Generate random values based on typical patterns
            const pvValue = hour >= 6 && hour <= 18 ? Math.floor(Math.random() * 3000) * Math.sin((hour - 6) * Math.PI / 12) : 0;
            const loadValue = 500 + Math.floor(Math.random() * 1000);
            const gridValue = Math.floor(Math.random() * 1000);
            const essentialValue = 300 + Math.floor(Math.random() * 500);
            
            // Battery tends to charge during day and discharge at night
            const batChargeValue = hour >= 8 && hour <= 16 ? Math.floor(Math.random() * 1500) : 0;
            const batDischargeValue = hour < 8 || hour > 16 ? Math.floor(Math.random() * 1000) : 0;
            
            historicalData.pv.push({ x: time, y: pvValue > 0 ? pvValue : 0 });
            historicalData.batCharge.push({ x: time, y: batChargeValue });
            historicalData.batDischarge.push({ x: time, y: batDischargeValue });
            historicalData.load.push({ x: time, y: loadValue });
            historicalData.grid.push({ x: time, y: gridValue });
            historicalData.essentialLoad.push({ x: time, y: essentialValue });
        }
        
        // Update charts if they exist
        if (pvChart) {
            pvChart.data.datasets[0].data = historicalData.pv;
            batChart.data.datasets[0].data = historicalData.batCharge;
            batChart.data.datasets[1].data = historicalData.batDischarge;
            loadChart.data.datasets[0].data = historicalData.load;
            gridChart.data.datasets[0].data = historicalData.grid;
            essentialChart.data.datasets[0].data = historicalData.essentialLoad;
            
            // Update all charts
            pvChart.update();
            batChart.update();
            loadChart.update();
            gridChart.update();
            essentialChart.update();
        } else {
            // Initialize charts if they don't exist yet
            initializeCharts();
        }
    }
    
    // Helper function to scroll to a section
    function scrollToElement(elementId) {
        const element = document.getElementById(elementId);
        if (element) {
            element.scrollIntoView({ behavior: 'smooth' });
        }
    }
});
