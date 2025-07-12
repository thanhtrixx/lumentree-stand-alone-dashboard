/**
 * Lumentree Standalone Viewer - Frontend JavaScript
 *
 * This script handles:
 * 1. Connecting directly to the Lumentree MQTT broker for real-time data.
 * 2. Fetching historical data directly from the Lumentree Web API.
 * 3. Parsing data and updating the UI, including charts and summary statistics.
 */
document.addEventListener('DOMContentLoaded', function () {
    // --- Chart Objects ---
    let pvChart, batChart, loadChart, gridChart, essentialChart;

    // --- UI Elements ---
    const viewBtn = document.getElementById('connectBtn');
    const deviceIdInput = document.getElementById('deviceId');
    const dateInput = document.getElementById('dateInput');
    const realTimeFlow = document.getElementById('realTimeFlow');
    const connectionStatus = document.getElementById('connectionStatus');
    const connectionIndicator = document.getElementById('connectionIndicator');
    const loading = document.getElementById('loading');
    const errorMessage = document.getElementById('errorMessage');
    const errorText = document.getElementById('errorText');

    // --- State & Constants ---
    let mqttClient = null;
    let currentDeviceId = '';
    let dataRequestInterval = null;
    let apiToken = null;
    let tokenCache = {};

    const API_BASE_URL = "http://lesvr.suntcn.com/lesvr";

    // MQTT Configuration
    const mqttConfig = {
        host: 'lesvr.suntcn.com',
        port: 8083,
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
        connectTimeout: 10000
    };

    // --- Initialization ---
    const log = (message, ...args) => console.log(`[${new Date().toISOString()}] ${message}`, ...args);

    // Set up today's date as default
    dateInput.value = formatDate(new Date());

    // Check for deviceId in URL query parameters
    const urlParams = new URLSearchParams(window.location.search);
    const deviceIdFromUrl = urlParams.get('deviceId');
    if (deviceIdFromUrl) {
        deviceIdInput.value = deviceIdFromUrl;
        setTimeout(() => handleConnection(), 500);
    }

    // --- Event Listeners ---
    viewBtn.addEventListener('click', handleConnection);
    deviceIdInput.addEventListener('keypress', (e) => e.key === 'Enter' && handleConnection());
    document.getElementById('prevDay').addEventListener('click', () => changeDate(-1));
    document.getElementById('nextDay').addEventListener('click', () => changeDate(1));
    dateInput.addEventListener('change', () => {
        if (currentDeviceId) {
            fetchHistoricalData(currentDeviceId, new Date(dateInput.value));
        }
    });

    // Add click event listeners for summary cards to scroll to charts
    document.getElementById('pv-card').addEventListener('click', () => scrollToElement('pv-section'));
    document.getElementById('bat-charge-card').addEventListener('click', () => scrollToElement('bat-section'));
    document.getElementById('bat-discharge-card').addEventListener('click', () => scrollToElement('bat-section'));
    document.getElementById('load-card').addEventListener('click', () => scrollToElement('load-section'));
    document.getElementById('grid-card').addEventListener('click', () => scrollToElement('grid-section'));

    // --- Main Connection & Data Fetching Logic ---
    function handleConnection() {
        const deviceId = deviceIdInput.value.trim();
        if (!deviceId) {
            showError('Please enter a Device ID.');
            return;
        }

        // If it's a new device, disconnect the old MQTT client
        if (mqttClient && mqttClient.connected && deviceId !== currentDeviceId) {
            disconnectFromMqtt();
        }

        currentDeviceId = deviceId;
        viewBtn.textContent = 'View'; // Change button text

        // Update URL without reloading
        const url = new URL(window.location);
        url.searchParams.set('deviceId', deviceId);
        window.history.pushState({}, '', url);
        document.title = `Lumentree - ${deviceId}`;

        // Start both MQTT connection and historical data fetching
        if (!mqttClient || !mqttClient.connected) {
            connectToMqtt(deviceId);
        }
        fetchHistoricalData(deviceId, new Date(dateInput.value));
    }

    // --- Lumentree Web API Functions ---
    async function generateToken(deviceId) {
        const cacheKey = `token_${deviceId}`;
        if (tokenCache[cacheKey] && (tokenCache[cacheKey].expires > Date.now())) {
            log("Using cached token for device", deviceId);
            return tokenCache[cacheKey].token;
        }

        log("Generating new token for device", deviceId);
        try {
            // 1. Get Server Time
            const timeResponse = await fetch(`${API_BASE_URL}/getServerTime`);
            if (!timeResponse.ok) throw new Error('Failed to get server time');
            const timeData = await timeResponse.json();
            const serverTime = timeData.data.serverTime;

            // 2. Get Token
            const tokenResponse = await fetch(`${API_BASE_URL}/shareDevices`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `deviceIds=${deviceId}&serverTime=${serverTime}`
            });
            if (!tokenResponse.ok) throw new Error('Failed to get token');
            const tokenData = await tokenResponse.json();
            apiToken = tokenData.data.token;

            if (!apiToken) throw new Error('Token was not returned from API');

            // Cache the token (e.g., for 10 minutes)
            tokenCache[cacheKey] = {
                token: apiToken,
                expires: Date.now() + 10 * 60 * 1000
            };

            return apiToken;
        } catch (error) {
            log("Error generating token:", error);
            showError(`API Token Error: ${error.message}`);
            return null;
        }
    }

    async function fetchHistoricalData(deviceId, date) {
        showLoading(true);
        hideError();
        log(`Fetching historical data for ${deviceId} on ${formatDate(date)}`);

        const token = await generateToken(deviceId);
        if (!token) {
            showLoading(false);
            return;
        }

        const queryDate = formatDate(date);
        const endpoints = {
            deviceInfo: `${API_BASE_URL}/getDevice`,
            pv: `${API_BASE_URL}/getPVDayData?deviceId=${deviceId}&queryDate=${queryDate}`,
            bat: `${API_BASE_URL}/getBatDayData?deviceId=${deviceId}&queryDate=${queryDate}`,
            other: `${API_BASE_URL}/getOtherDayData?deviceId=${deviceId}&queryDate=${queryDate}`
        };

        try {
            const fetchData = async (url, isPost = false) => {
                const options = {
                    headers: { 'Authorization': token }
                };
                if (isPost) {
                    options.method = 'POST';
                    options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
                    options.body = `snName=${deviceId}&onlineStatus=1`;
                }
                const response = await fetch(url, options);
                if (!response.ok) throw new Error(`Request failed for ${url.split('/').pop().split('?')[0]}`);
                return response.json();
            };

            const [deviceInfoRes, pvRes, batRes, otherRes] = await Promise.all([
                fetchData(endpoints.deviceInfo, true),
                fetchData(endpoints.pv),
                fetchData(endpoints.bat),
                fetchData(endpoints.other)
            ]);

            const allData = {
                deviceInfo: deviceInfoRes.data.devices[0],
                pv: pvRes.data.pv,
                bat: batRes.data,
                // essentialLoad removed
                grid: otherRes.data.grid,
                load: otherRes.data.homeload
            };

            log("Processed historical data:", allData);
            processAndDisplayData(allData);

        } catch (error) {
            log("Error fetching historical data:", error);
            showError(`API Fetch Error: ${error.message}`);
        } finally {
            showLoading(false);
        }
    }

    function processAndDisplayData(data) {
        // Show summary stats section
        const summaryStats = document.getElementById('summaryStats');
        if (summaryStats) summaryStats.classList.remove('hidden');
        
        // Show chart section
        const chartSection = document.getElementById('chart-section');
        if (chartSection) chartSection.classList.remove('hidden');

        // Update Summary Stats (convert 0.1kWh to kWh) with null checks
        const pvTotal = document.getElementById('pv-total');
        const batCharge = document.getElementById('bat-charge');
        const batDischarge = document.getElementById('bat-discharge');
        const loadTotal = document.getElementById('load-total');
        const gridTotal = document.getElementById('grid-total');
        
        if (pvTotal) pvTotal.textContent = `${(data.pv.tableValue / 10).toFixed(1)} kWh`;
        if (batCharge) batCharge.textContent = `${(data.bat.bats[0].tableValue / 10).toFixed(1)} kWh`;
        if (batDischarge) batDischarge.textContent = `${(data.bat.bats[1].tableValue / 10).toFixed(1)} kWh`;
        if (loadTotal) loadTotal.textContent = `${(data.load.tableValue / 10).toFixed(1)} kWh`;
        if (gridTotal) gridTotal.textContent = `${(data.grid.tableValue / 10).toFixed(1)} kWh`;
        
        // Essential Load element was removed, so we skip updating it
        // const essentialTotal = document.getElementById('essential-total');
        // if (essentialTotal) essentialTotal.textContent = `${(data.essentialLoad.tableValue / 10).toFixed(1)} kWh`;

        // Update Charts
        updateAllCharts(data);
    }

    // --- MQTT Client Functions ---
    function connectToMqtt(deviceId) {
        updateConnectionStatus('connecting', 'MQTT...');
        const brokerUrl = `ws://${mqttConfig.host}:${mqttConfig.port}${mqttConfig.wsPath}`;
        const options = {
            clientId: mqttConfig.clientIdFormat.replace('{device_id}', deviceId).replace('{timestamp}', Date.now()),
            username: mqttConfig.username,
            password: mqttConfig.password,
            clean: true,
            keepalive: mqttConfig.keepalive,
            connectTimeout: mqttConfig.connectTimeout
        };

        mqttClient = mqtt.connect(brokerUrl, options);

        mqttClient.on('connect', () => {
            log('MQTT client connected.');
            updateConnectionStatus('connected', 'Real-time');
            const subTopic = mqttConfig.subscribeTopicFormat.replace('{device_id}', deviceId);
            mqttClient.subscribe(subTopic, { qos: 1 }, (err) => {
                if (err) {
                    log('MQTT subscription error:', err);
                    showError('MQTT Subscribe Failed');
                } else {
                    log(`Subscribed to: ${subTopic}`);
                    if (dataRequestInterval) clearInterval(dataRequestInterval);
                    requestRealtimeData();
                    dataRequestInterval = setInterval(requestRealtimeData, 5000);
                }
            });
        });

        mqttClient.on('message', (_topic, payload) => parseRealtimeData(payload));
        mqttClient.on('error', (err) => {
            log('MQTT Connection Error:', err);
            updateConnectionStatus('error', 'MQTT Failed');
        });
        mqttClient.on('close', () => {
            log('MQTT connection closed.');
            updateConnectionStatus('disconnected', 'Real-time');
        });
    }

    function disconnectFromMqtt() {
        if (dataRequestInterval) clearInterval(dataRequestInterval);
        if (mqttClient) mqttClient.end();
        dataRequestInterval = null;
        mqttClient = null;
        updateConnectionStatus('disconnected', 'Real-time');
    }

    function requestRealtimeData() {
        if (!mqttClient || !mqttClient.connected || !currentDeviceId) return;
        const pubTopic = mqttConfig.publishTopicFormat.replace('{device_id}', currentDeviceId);
        const command = createReadCommand(0, 95);
        mqttClient.publish(pubTopic, command, { qos: 1 });
    }

    // --- Data Parsing ---
    function parseRealtimeData(payload) {
        try {
            // Convert payload to hex string
            let hexPayload = '';
            for (let i = 0; i < payload.length; i++) {
                hexPayload += ('0' + payload[i].toString(16)).slice(-2);
            }
            
            // Check for valid data format
            let dataPartHex = hexPayload.includes('2b2b2b2b') ? hexPayload.split('2b2b2b2b')[1] : hexPayload;
            if (!dataPartHex || !dataPartHex.startsWith('0103')) {
                console.log('Invalid data format');
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
                console.log('Register data too short');
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
            
            // Add getSignedValue function
            const getSignedValue = (dataView) => {
                // Convert Uint8Array to signed 16-bit value
                if (dataView.length < 2) return 0;
                
                // Create a DataView from the Uint8Array
                const buffer = new ArrayBuffer(2);
                const view = new DataView(buffer);
                view.setUint8(0, dataView[0]);
                view.setUint8(1, dataView[1]);
                
                return view.getInt16(0, false); // false = big-endian
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
                batteryVoltage: readUInt16BE(getReg(51)) / 10.0, // Battery voltage at register 51, divided by 10
                deviceTempValue: (readUInt16BE(getReg(24)) - 1000) / 10.0,
                loadValue: readUInt16BE(getReg(67)),
            };
            
            data.pvTotalPower = data.pv1Power + (data.pv2Voltage > 0 ? data.pv2Power : 0);
            data.batteryStatus = data.batteryValue < 0 ? "Charging" : "Discharging";
            data.batteryValue = Math.abs(data.batteryValue);
            
            console.log('Parsed device data:', data);
            updateRealTimeDisplay(data);
        } catch (err) {
            console.log('Error parsing device data:', err);
        }
    }

    // --- UI Update Functions ---
    function updateRealTimeDisplay(data) {
        // Get elements with null checks
        const pvPower = document.getElementById('pv-power');
        const pvDesc = document.getElementById('pv-desc');
        const gridPower = document.getElementById('grid-power');
        const gridVoltage = document.getElementById('grid-voltage');
        const batteryPower = document.getElementById('battery-power');
        const batteryPercentage = document.getElementById('battery-percentage');
        const deviceTemp = document.getElementById('device-temp');
        const loadPower = document.getElementById('load-power');
        const essentialPower = document.getElementById('essential-power');
        const batteryIcon = document.getElementById('battery-icon');
        
        // Display the real-time section
        if (realTimeFlow) realTimeFlow.classList.remove('hidden');
        
        // Update device ID if available
        if (currentDeviceId) {
            const inverterType = document.getElementById('inverter-type');
            if (inverterType) inverterType.textContent = currentDeviceId;
        }
        
        // Update elements with null checks
        if (pvPower) pvPower.textContent = `${data.pvTotalPower}W`;
        if (pvDesc) pvDesc.textContent = `${data.pv1Voltage}V`;
        if (gridPower) gridPower.textContent = `${data.gridValue}W`;
        if (gridVoltage) gridVoltage.textContent = `${data.gridVoltageValue}V`;
        if (batteryPercentage) batteryPercentage.textContent = `${data.batteryPercent}%`;
        
        if (batteryPower) {
            batteryPower.innerHTML = `<span class="text-${data.batteryStatus === 'Charging' ? 'green' : 'red'}-600 dark:text-${data.batteryStatus === 'Charging' ? 'green' : 'red'}-300">${data.batteryStatus === 'Charging' ? '+' : '-'}${data.batteryValue}W</span>`;
        }
        
        // Battery voltage and amperage
        const batteryVoltage = document.getElementById('battery-voltage');
        const batteryAmperage = document.getElementById('battery-amperage');
        
        // Add null checks for batteryVoltage
        if (batteryVoltage && data.batteryVoltage !== undefined) {
            batteryVoltage.textContent = `${data.batteryVoltage.toFixed(1)}V`;
        } else if (batteryVoltage) {
            batteryVoltage.textContent = 'N/A';
        }
        
        // Calculate amperage (P = V * I, so I = P/V) with null checks
        if (batteryAmperage && data.batteryVoltage !== undefined && data.batteryVoltage > 0) {
            const amps = data.batteryValue / data.batteryVoltage;
            batteryAmperage.textContent = `${amps.toFixed(1)}A`;
        } else if (batteryAmperage) {
            batteryAmperage.textContent = 'N/A';
        }
        
        if (deviceTemp) deviceTemp.textContent = `${data.deviceTempValue.toFixed(1)}\u00b0C`;
        if (loadPower) loadPower.textContent = `${data.loadValue}W`;
        if (essentialPower) essentialPower.textContent = `${data.loadValue}W`; // Use loadValue for essential power
        
        // Update battery icon based on percentage
        if (batteryIcon) {
            if (data.batteryPercent < 20) batteryIcon.src = "images/icons/bat_low.png";
            else if (data.batteryPercent < 80) batteryIcon.src = "images/icons/bat_medium.png";
            else batteryIcon.src = "images/icons/bat_green.png";
        }
        
        // Update device info panel
        updateDeviceInfo(data, currentDeviceId);
    }
    
    // --- Device Info Panel ---
    function updateDeviceInfo(data, deviceId) {
        const deviceInfoPanel = document.getElementById('deviceInfo');
        if (deviceInfoPanel) deviceInfoPanel.classList.remove('hidden');
        
        const deviceIdElement = document.getElementById('device-id');
        const deviceTypeElement = document.getElementById('device-type');
        const deviceStatusElement = document.getElementById('device-status');
        
        if (deviceIdElement) deviceIdElement.textContent = deviceId;
        if (deviceTypeElement) deviceTypeElement.textContent = 'Lumentree Hybrid Inverter';
        if (deviceStatusElement) deviceStatusElement.textContent = mqttClient && mqttClient.connected ? 'Online' : 'Offline';
    }

    // ... (rest of the code remains the same)
    // ... (rest of the code remains the same)
    function updateAllCharts(data) {
        const timeLabels = generateTimeLabels(new Date(dateInput.value));

        const chartData = {
            pv: data.pv.tableValueInfo,
            batCharge: processBatteryData(data.bat.tableValueInfo, 'charge'),
            batDischarge: processBatteryData(data.bat.tableValueInfo, 'discharge'),
            load: data.load.tableValueInfo,
            grid: data.grid.tableValueInfo
            // Essential Load removed
        };

        const datasets = Object.keys(chartData).reduce((acc, key) => {
            acc[key] = timeLabels.map((time, i) => ({ t: time, y: chartData[key][i] || 0 }));
            return acc;
        }, {});

        destroyCharts(); // Clear previous charts before creating new ones

        pvChart = createChart('pvChart', [{ label: 'PV Production (W)', data: datasets.pv, color: 'rgb(255, 193, 7)' }]);
        batChart = createChart('batChart', [
            { label: 'Charging (W)', data: datasets.batCharge, color: 'rgb(40, 167, 69)' },
            { label: 'Discharging (W)', data: datasets.batDischarge, color: 'rgb(220, 53, 69)' }
        ]);
        loadChart = createChart('loadChart', [{ label: 'Load (W)', data: datasets.load, color: 'rgb(0, 123, 255)' }]);
        gridChart = createChart('gridChart', [{ label: 'Grid (W)', data: datasets.grid, color: 'rgb(111, 66, 193)' }]);
        // Essential Load chart removed
    }

    function createChart(canvasId, chartDatasets) {
        const ctx = document.getElementById(canvasId).getContext('2d');
        // Using window.Chart to make TypeScript happy
        return new window.Chart(ctx, {
            type: 'line',
            data: {
                datasets: chartDatasets.map(d => ({
                    label: d.label,
                    data: d.data,
                    backgroundColor: d.color.replace('rgb', 'rgba').replace(')', ', 0.2)'),
                    borderColor: d.color,
                    fill: true,
                    pointRadius: 0,
                    borderWidth: 2,
                    tension: 0.2
                }))
            },
            options: getCommonChartOptions()
        });
    }

    function getCommonChartOptions() {
        return {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                xAxes: [{
                    type: 'time',
                    time: { unit: 'hour', tooltipFormat: 'HH:mm', displayFormats: { hour: 'HH:mm' } },
                    gridLines: { color: 'rgba(200, 200, 200, 0.1)' },
                    ticks: { maxRotation: 0, autoSkip: true, autoSkipPadding: 30 }
                }],
                yAxes: [{
                    ticks: { beginAtZero: true, callback: (v) => v >= 1000 ? `${v / 1000}k` : v },
                    gridLines: { color: 'rgba(200, 200, 200, 0.1)' },
                    scaleLabel: { display: true, labelString: 'Watt' }
                }]
            },
            tooltips: { mode: 'index', intersect: false },
            hover: { mode: 'nearest', intersect: true }
        };
    }

    function processBatteryData(data, type) {
        return data.map(value => {
            if (type === 'charge' && value < 0) return Math.abs(value);
            if (type === 'discharge' && value > 0) return value;
            return 0;
        });
    }

    // --- Helper Functions ---
    function formatDate(date) {
        return date.toISOString().split('T')[0];
    }

    function changeDate(offset) {
        const currentDate = new Date(dateInput.value);
        currentDate.setDate(currentDate.getDate() + offset);
        dateInput.value = formatDate(currentDate);
        if (currentDeviceId) {
            fetchHistoricalData(currentDeviceId, currentDate);
        }
    }

    function generateTimeLabels(baseDate) {
        const labels = [];
        for (let i = 0; i < 288; i++) { // 24 * 60 / 5 = 288 intervals
            const d = new Date(baseDate);
            d.setHours(0, 0, 0, 0);
            d.setMinutes(i * 5);
            labels.push(d);
        }
        return labels;
    }

    function destroyCharts() {
        [pvChart, batChart, loadChart, gridChart].forEach(chart => {
            if (chart) chart.destroy();
        });
    }

    function showLoading(show) { loading.classList.toggle('hidden', !show); }
    function showError(message) {
        errorText.textContent = message;
        errorMessage.classList.remove('hidden');
    }
    function hideError() { errorMessage.classList.add('hidden'); }
    function scrollToElement(id) { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }); }
    function updateConnectionStatus(status, message) {
        connectionStatus.classList.remove('hidden');
        let colorClass = 'bg-red-500';
        if (status === 'connecting') colorClass = 'bg-yellow-500';
        else if (status === 'connected') colorClass = 'bg-green-500';
        connectionIndicator.className = `w-3 h-3 rounded-full ${colorClass}`;
    }

    // --- CRC for MQTT command ---
    function crc16Modbus(data) {
        let crc = 0xFFFF;
        for (let byte of data) {
            crc ^= byte;
            for (let i = 0; i < 8; i++) {
                crc = (crc & 1) ? (crc >> 1) ^ 0xA001 : crc >> 1;
            }
        }
        const crcArray = new Uint8Array(2);
        crcArray[0] = crc & 0xFF;
        crcArray[1] = (crc >> 8) & 0xFF;
        return crcArray;
    }

    function createReadCommand(startAddr, count) {
        const cmd = new Uint8Array(6);
        const dv = new DataView(cmd.buffer);
        dv.setUint8(0, 0x01);
        dv.setUint8(1, 0x03);
        dv.setUint16(2, startAddr, false);
        dv.setUint16(4, count, false);
        const crc = crc16Modbus(cmd);
        const result = new Uint8Array(8);
        result.set(cmd, 0);
        result.set(crc, 6);
        return result;
    }
});