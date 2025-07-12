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
    
    // Daily summary data
    let dailySummary = {
        pv: 0,
        batCharge: 0,
        batDischarge: 0,
        load: 0,
        grid: 0,
        essentialLoad: 0
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
    
    /**
     * Formats a date object to YYYY-MM-DD string format for input fields
     * @param {Date} date - Date object to format
     * @returns {string} Formatted date string in YYYY-MM-DD format
     */
    function formatDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are 0-based
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    
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
    /**
     * Safely destroys all chart instances to prevent "Canvas is already in use" errors
     * This ensures proper cleanup of Chart.js instances before creating new ones
     */
    function destroyCharts() {
        // Destroy each chart instance if it exists
        if (pvChart) {
            pvChart.destroy();
            pvChart = null;
        }
        if (batChart) {
            batChart.destroy();
            batChart = null;
        }
        if (loadChart) {
            loadChart.destroy();
            loadChart = null;
        }
        if (gridChart) {
            gridChart.destroy();
            gridChart = null;
        }
        if (essentialChart) {
            essentialChart.destroy();
            essentialChart = null;
        }
        
        // Clear any cached data to prevent memory leaks
        if (Chart.helpers && Chart.helpers.each) {
            Chart.helpers.each(Chart.instances || [], function(instance) {
                if (instance && typeof instance.destroy === 'function') {
                    instance.destroy();
                }
            });
        }
    }

    function initializeCharts() {
        // Destroy existing charts first
        destroyCharts();
        
        const chartSection = document.getElementById('chart-section');
        chartSection.classList.remove('hidden');
        
        try {
        
        // Configure Chart.js defaults
        Chart.defaults.global = Chart.defaults.global || {};
        Chart.defaults.global.defaultFontFamily = "'Inter', 'Segoe UI', 'Helvetica', 'Arial', sans-serif";
        Chart.defaults.global.defaultFontColor = '#64748b';
        
        // Common chart options
        const commonOptions = {
            responsive: true,
            maintainAspectRatio: false,
            elements: {
                point: {
                    radius: 0, // Hide points
                    hoverRadius: 4 // Show points on hover
                },
                line: {
                    borderWidth: 2, // Thinner line
                    tension: 0.2 // Less curve for clearer visualization
                }
            },
            plugins: {
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(50, 50, 50, 0.9)',
                    titleFont: {
                        size: 12
                    },
                    bodyFont: {
                        size: 11
                    },
                    padding: 8,
                    callbacks: {
                        title: function(tooltipItems) {
                            return tooltipItems[0].xLabel;
                        },
                        label: function(tooltipItem, data) {
                            return data.datasets[tooltipItem.datasetIndex].label + ': ' + tooltipItem.yLabel + ' W';
                        }
                    }
                },
                legend: {
                    position: 'top',
                    labels: {
                        boxWidth: 12,
                        padding: 10,
                        fontSize: 11
                    }
                }
            },
            scales: {
                xAxes: [{
                    type: 'time',
                    time: {
                        unit: 'hour',
                        displayFormats: {
                            hour: 'HH:mm'
                        },
                        tooltipFormat: 'HH:mm'
                    },
                    gridLines: {
                        display: true,
                        color: 'rgba(200, 200, 200, 0.2)'
                    },
                    ticks: {
                        maxRotation: 0,
                        autoSkip: true,
                        maxTicksLimit: 12,
                        // Fix for deprecated time.min/max - use ticks.min/max instead
                        min: function() {
                            const date = new Date(dateInput.value);
                            date.setHours(0, 0, 0, 0);
                            return date;
                        },
                        max: function() {
                            const date = new Date(dateInput.value);
                            date.setHours(23, 59, 59, 999);
                            return date;
                        }
                    }
                }],
                yAxes: [{
                    gridLines: {
                        display: true,
                        color: 'rgba(200, 200, 200, 0.2)'
                    },
                    ticks: {
                        beginAtZero: true,
                        // Use k suffix for thousands
                        callback: function(value) {
                            return formatYAxisLabel(value);
                        }
                    },
                    scaleLabel: {
                        display: true,
                        labelString: 'Watt',
                        fontSize: 11
                    }
                }]
            },
            legend: {
                display: true,
                position: 'top'
            },
            tooltips: {
                mode: 'index',
                intersect: false,
                callbacks: {
                    label: function(tooltipItem, data) {
                        const label = data.datasets[tooltipItem.datasetIndex].label || '';
                        const value = tooltipItem.yLabel;
                        return label + ': ' + value + ' W';
                    },
                    title: function(tooltipItems) {
                        return moment(tooltipItems[0].xLabel).format('HH:mm');
                    }
                }
            },
            hover: {
                mode: 'nearest',
                intersect: true
            }
        };
        
        // Initialize PV Chart
        const pvCtx = document.getElementById('pvChart').getContext('2d');
        pvChart = new Chart(pvCtx, {
            type: 'line',
            data: {
                datasets: [{
                    label: 'PV Production (W)',
                    data: [],
                    backgroundColor: 'rgba(255, 193, 7, 0.2)',
                    borderColor: 'rgb(255, 193, 7)',
                    fill: true
                }]
            },
            options: {
                ...commonOptions,
                title: {
                    display: true,
                    text: 'Solar Production'
                }
            }
        });
        
        // Initialize Battery Chart
        const batCtx = document.getElementById('batChart').getContext('2d');
        batChart = new Chart(batCtx, {
            type: 'line',
            data: {
                datasets: [
                    {
                        label: 'Charging (W)',
                        data: [],
                        backgroundColor: 'rgba(40, 167, 69, 0.2)',
                        borderColor: 'rgb(40, 167, 69)',
                        fill: true
                    },
                    {
                        label: 'Discharging (W)',
                        data: [],
                        backgroundColor: 'rgba(220, 53, 69, 0.2)',
                        borderColor: 'rgb(220, 53, 69)',
                        fill: true
                    }
                ]
            },
            options: {
                ...commonOptions,
                title: {
                    display: true,
                    text: 'Battery Power Flow'
                }
            }
        });
        
        // Initialize Load Chart
        const loadCtx = document.getElementById('loadChart').getContext('2d');
        loadChart = new Chart(loadCtx, {
            type: 'line',
            data: {
                datasets: [{
                    label: 'Load (W)',
                    data: [],
                    backgroundColor: 'rgba(0, 123, 255, 0.2)',
                    borderColor: 'rgb(0, 123, 255)',
                    fill: true
                }]
            },
            options: {
                ...commonOptions,
                title: {
                    display: true,
                    text: 'Total Consumption'
                }
            }
        });
        
        // Initialize Grid Chart
        const gridCtx = document.getElementById('gridChart').getContext('2d');
        gridChart = new Chart(gridCtx, {
            type: 'line',
            data: {
                datasets: [{
                    label: 'Grid (W)',
                    data: [],
                    backgroundColor: 'rgba(111, 66, 193, 0.2)',
                    borderColor: 'rgb(111, 66, 193)',
                    fill: true
                }]
            },
            options: {
                ...commonOptions,
                title: {
                    display: true,
                    text: 'Grid Import/Export'
                }
            }
        });
        
        // Initialize Essential Load Chart
        const essentialCtx = document.getElementById('essentialChart').getContext('2d');
        essentialChart = new Chart(essentialCtx, {
            type: 'line',
            data: {
                datasets: [{
                    label: 'Essential Load (W)',
                    data: [],
                    backgroundColor: 'rgba(108, 117, 125, 0.2)',
                    borderColor: 'rgb(108, 117, 125)',
                    fill: true
                }]
            },
            options: {
                ...commonOptions,
                title: {
                    display: true,
                    text: 'Essential Load'
                }
            }
        });
        
        console.log('All charts initialized successfully');
    } catch (error) {
        console.error('Error initializing charts:', error);
    }
}

/**
 * Updates all charts with real-time data from the device
 * @param {Object} data - Parsed device data
 */
function updateChartsWithRealtimeData(data) {
    try {
        // Check if any chart instance is invalid or missing
        if (!pvChart || !batChart || !loadChart || !gridChart || !essentialChart) {
            console.log('Initializing charts - some chart instances were missing');
            initializeCharts();
        }
        
        const now = new Date();
        
        // Add data points to historical data - using t/y format for Chart.js v2.9.4
        historicalData.pv.push({ t: now, y: data.pvTotalPower });
        historicalData.batCharge.push({ t: now, y: data.batteryStatus === 'Charging' ? data.batteryValue : 0 });
        historicalData.batDischarge.push({ t: now, y: data.batteryStatus === 'Discharging' ? data.batteryValue : 0 });
        historicalData.load.push({ t: now, y: data.loadValue });
        historicalData.grid.push({ t: now, y: Math.abs(data.gridValue) });
        historicalData.essentialLoad.push({ t: now, y: data.loadValue }); // Assuming essential load is same as total load
        
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
    } catch (error) {
        console.error('Error updating charts:', error);
        // Attempt recovery by reinitializing charts
        try {
            destroyCharts();
            initializeCharts();
        } catch (recoveryError) {
            console.error('Failed to recover charts:', recoveryError);
        }
    }
}
    
    /**
     * Update charts with historical data for the entire day
     * This function creates data points for the entire day (5-minute intervals)
     */
    function updateChartsWithHistoricalData() {
        try {
            // Check if any chart instance is invalid or missing
            if (!pvChart || !batChart || !loadChart || !gridChart || !essentialChart) {
                console.log('Initializing charts - some chart instances were missing');
                initializeCharts();
            }
            
            // Generate time labels for the entire day (5-minute intervals)
            const timeLabels = generateTimeLabels();
            
            // Create empty data arrays with the same length as timeLabels
            const emptyData = timeLabels.map(() => 0);
            
            // Create datasets for each chart
            const datasets = {
                pv: timeLabels.map((time, i) => ({ t: time, y: historicalData.pv[i] || 0 })),
                batCharge: timeLabels.map((time, i) => ({ t: time, y: historicalData.batCharge[i] || 0 })),
                batDischarge: timeLabels.map((time, i) => ({ t: time, y: historicalData.batDischarge[i] || 0 })),
                load: timeLabels.map((time, i) => ({ t: time, y: historicalData.load[i] || 0 })),
                grid: timeLabels.map((time, i) => ({ t: time, y: historicalData.grid[i] || 0 })),
                essentialLoad: timeLabels.map((time, i) => ({ t: time, y: historicalData.essentialLoad[i] || 0 }))
            };
            
            // Update charts
            pvChart.data.datasets[0].data = datasets.pv;
            batChart.data.datasets[0].data = datasets.batCharge;
            batChart.data.datasets[1].data = datasets.batDischarge;
            loadChart.data.datasets[0].data = datasets.load;
            gridChart.data.datasets[0].data = datasets.grid;
            essentialChart.data.datasets[0].data = datasets.essentialLoad;
            
            // Update all charts
            pvChart.update();
            batChart.update();
            loadChart.update();
            gridChart.update();
            essentialChart.update();
            
            // Update summary statistics
            updateSummaryStatistics();
            
        } catch (error) {
            console.error('Error updating charts with historical data:', error);
            // Attempt recovery by reinitializing charts
            try {
                destroyCharts();
                initializeCharts();
            } catch (recoveryError) {
                console.error('Failed to recover charts:', recoveryError);
            }
        }
    }
    
    /**
     * Update the summary statistics based on the historical data
     */
    function updateSummaryStatistics() {
        // Calculate daily totals (in kW)
        dailySummary.pv = calculateDailyTotal(historicalData.pv) / 10;
        dailySummary.batCharge = calculateDailyTotal(historicalData.batCharge) / 10;
        dailySummary.batDischarge = calculateDailyTotal(historicalData.batDischarge) / 10;
        dailySummary.load = calculateDailyTotal(historicalData.load) / 10;
        dailySummary.grid = calculateDailyTotal(historicalData.grid) / 10;
        dailySummary.essentialLoad = calculateDailyTotal(historicalData.essentialLoad) / 10;
        
        // Update UI elements
        document.getElementById('pv-total').textContent = dailySummary.pv.toFixed(1) + ' kW';
        document.getElementById('bat-charge').textContent = dailySummary.batCharge.toFixed(1) + ' kW';
        document.getElementById('bat-discharge').textContent = dailySummary.batDischarge.toFixed(1) + ' kW';
        document.getElementById('load-total').textContent = dailySummary.load.toFixed(1) + ' kW';
        document.getElementById('grid-total').textContent = dailySummary.grid.toFixed(1) + ' kW';
        document.getElementById('essential-total').textContent = dailySummary.essentialLoad.toFixed(1) + ' kW';
        
        // Show summary stats section
        document.getElementById('summaryStats').classList.remove('hidden');
    }
    
    /**
     * Calculate the daily total from an array of data points
     * @param {Array} dataArray - Array of data points
     * @returns {number} The daily total
     */
    function calculateDailyTotal(dataArray) {
        return dataArray.reduce((sum, point) => sum + (typeof point === 'object' ? point.y : point), 0);
    }
    
    /**
     * Format number for y-axis (e.g., 3000 -> 3k)
     * @param {number} value - The value to format
     * @returns {string|number} Formatted value
     */
    function formatYAxisLabel(value) {
        if (value >= 1000) {
            return (value / 1000).toFixed(1) + 'k';
        }
        return value;
    }

    /**
     * Generate time labels for x-axis (5-minute intervals for the entire day)
     * @returns {Array} Array of time objects for Chart.js
     */
    function generateTimeLabels() {
        const labels = [];
        const selectedDate = new Date(dateInput.value);
        
        for (let hour = 0; hour < 24; hour++) {
            for (let minute = 0; minute < 60; minute += 5) {
                const timePoint = new Date(selectedDate);
                timePoint.setHours(hour, minute, 0, 0);
                labels.push(timePoint);
            }
        }
        return labels;
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
        // Show loading indicator
        loading.classList.remove('hidden');
        
        // Clear existing historical data
        Object.keys(historicalData).forEach(key => {
            historicalData[key] = [];
        });
        
        // Reset daily summary
        Object.keys(dailySummary).forEach(key => {
            dailySummary[key] = 0;
        });
        
        // Generate data for the entire day (5-minute intervals)
        const timeLabels = generateTimeLabels();
        
        // In a real implementation, this would fetch from an API using the MQTT broker
        // For now, we'll simulate data for the entire day based on the MQTT configuration
        console.log(`Fetching historical data for ${deviceId} on ${formatDate(date)}`);
        
        // Generate simulated data for the entire day
        timeLabels.forEach((time, index) => {
            // Create patterns that resemble real solar/battery/load data
            const hour = time.getHours();
            
            // PV production follows a bell curve (daylight hours only)
            let pvValue = 0;
            if (hour >= 6 && hour <= 18) {
                // Bell curve peaking at noon
                const normalizedHour = (hour - 6) / 12; // 0 to 1 over daylight hours
                pvValue = Math.sin(normalizedHour * Math.PI) * 3000 * (0.8 + Math.random() * 0.4);
            }
            
            // Battery charging during daylight, discharging at night
            let batChargeValue = 0;
            let batDischargeValue = 0;
            
            if (hour >= 8 && hour <= 16 && pvValue > 1000) {
                // Charging during peak sun hours when PV exceeds typical load
                batChargeValue = Math.max(0, pvValue - 1000) * 0.7 * (0.8 + Math.random() * 0.4);
                batDischargeValue = 0;
            } else if (hour >= 18 || hour <= 6) {
                // Discharging during evening/night
                batChargeValue = 0;
                batDischargeValue = 800 * (0.8 + Math.random() * 0.4);
            }
            
            // Load is higher in morning and evening
            let loadValue = 500; // Base load
            if ((hour >= 6 && hour <= 9) || (hour >= 17 && hour <= 22)) {
                // Peak usage times
                loadValue = 1500 * (0.8 + Math.random() * 0.4);
            } else {
                loadValue = 800 * (0.8 + Math.random() * 0.4);
            }
            
            // Grid usage fills the gap when PV + battery discharge < load
            let gridValue = Math.max(0, loadValue - pvValue - batDischargeValue);
            
            // Essential load is a portion of total load
            let essentialLoadValue = loadValue * 0.6 * (0.8 + Math.random() * 0.4);
            
            // Add data points
            historicalData.pv.push({ t: new Date(time), y: Math.round(pvValue) });
            historicalData.batCharge.push({ t: new Date(time), y: Math.round(batChargeValue) });
            historicalData.batDischarge.push({ t: new Date(time), y: Math.round(batDischargeValue) });
            historicalData.load.push({ t: new Date(time), y: Math.round(loadValue) });
            historicalData.grid.push({ t: new Date(time), y: Math.round(gridValue) });
            historicalData.essentialLoad.push({ t: new Date(time), y: Math.round(essentialLoadValue) });
        });
        
        // Update charts with the new historical data
        updateChartsWithHistoricalData();
        
        // Hide loading indicator
        loading.classList.add('hidden');
    }
    
    /**
     * Updates charts with historical data
     * Safely handles chart initialization and updates
     */
    function updateChartsWithHistoricalData() {
        try {
            // Check if any chart instance is invalid or missing
            if (!pvChart || !batChart || !loadChart || !gridChart || !essentialChart) {
                console.log('Initializing charts for historical data');
                initializeCharts();
            }
            
            // Update charts with historical data
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
        } catch (error) {
            console.error('Error updating charts with historical data:', error);
            // Attempt recovery by reinitializing charts
            try {
                destroyCharts();
                initializeCharts();
            } catch (recoveryError) {
                console.error('Failed to recover charts:', recoveryError);
            }
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
