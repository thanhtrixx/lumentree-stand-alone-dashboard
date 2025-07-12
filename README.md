# Lumentree StandAlone Viewer

A browser-based real-time monitoring application for Lumentree Hybrid Inverters that connects directly to the MQTT broker without requiring a backend server.

![Lumentree StandAlone Viewer](images/screenshot.png)

## Overview

The Lumentree StandAlone Viewer is a lightweight, browser-based application that provides real-time monitoring and historical data visualization for Lumentree Hybrid Inverters. It connects directly to the Lumentree MQTT broker using WebSockets, eliminating the need for a backend server or complex infrastructure.

### Key Features

- **Direct MQTT Connection**: Connects directly to the Lumentree MQTT broker via WebSockets
- **Real-time Energy Flow Display**: Visualizes energy flow between PV, battery, grid, and loads
- **Device Information Panel**: Shows device ID, type, and connection status
- **Summary Statistics Cards**: Provides quick overview of key metrics
- **Interactive Charts**: Displays real-time and historical data for all energy components
- **Date Navigation**: Allows viewing historical data for different days
- **URL Parameter Support**: Enables auto-connection via URL parameters
- **Responsive Design**: Works on desktop and mobile devices

## Project Structure

```
StandAlone/
├── css/                  # Stylesheets
│   └── style.css         # Main stylesheet with chart and UI styling
├── images/               # Image assets
│   └── icons/            # Energy flow icons
│       ├── bat_green.png # Battery icons in different states
│       ├── bat_low.png
│       ├── bat_medium.png
│       ├── device.png    # Device icon
│       ├── essential_load.png
│       ├── grid.png
│       ├── home_load.png
│       └── pv.png
├── js/                   # JavaScript files
│   └── app.js            # Main application logic
├── index.html            # Main HTML file
└── README.md             # This documentation file
```

## Technical Details

### MQTT Configuration

The application connects to the Lumentree MQTT broker with the following configuration:

```javascript
const mqttConfig = {
    host: 'lesvr.suntcn.com',
    port: 8083,  // WebSocket port
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
```

### Data Flow

1. **Connection**: The application connects to the MQTT broker using the provided device ID
2. **Subscription**: It subscribes to the device-specific topic (`reportApp/{device_id}`)
3. **Data Request**: Every 5 seconds, it sends a Modbus command to request data
4. **Data Processing**: Received binary data is parsed to extract metrics
5. **UI Update**: The UI is updated with the latest data, including:
   - Real-time energy flow display
   - Device information panel
   - Summary statistics cards
   - Interactive charts

### Modbus Command Structure

The application sends Modbus commands to read registers from the inverter:

```javascript
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
```

### Register Map

The application reads the following registers from the inverter:

| Register | Description | Unit |
|----------|-------------|------|
| 15 | Grid Voltage | V/10 |
| 20 | PV1 Voltage | V |
| 22 | PV1 Power | W |
| 24 | Device Temperature | (Value-1000)/10 °C |
| 50 | Battery Percentage | % |
| 59 | Grid Power | W (signed) |
| 61 | Battery Power | W (signed) |
| 67 | Load Power | W |
| 72 | PV2 Voltage | V |
| 74 | PV2 Power | W |

### Chart System

The application uses Chart.js to visualize data with the following charts:

1. **PV Production Chart**: Shows solar panel production over time
2. **Battery Chart**: Displays battery charging and discharging patterns
3. **Load Chart**: Shows home energy consumption
4. **Grid Chart**: Displays grid power usage/feed-in
5. **Essential Load Chart**: Shows power consumption of essential loads

Each chart is configured with responsive options and time-based X-axis:

```javascript
const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
        mode: 'index',
        intersect: false,
    },
    scales: {
        x: {
            type: 'time',
            time: {
                unit: 'hour',
                displayFormats: {
                    hour: 'HH:mm'
                }
            }
        },
        y: {
            beginAtZero: true,
            title: {
                display: true,
                text: 'Power (W)'
            }
        }
    }
};
```

## Usage Examples

### Basic Connection

Open `index.html` in a browser and enter your device ID:

```
H241224050
```

### URL Parameter Connection

Connect automatically by specifying the device ID in the URL:

```
index.html?deviceId=H241224050
```

### Alternative Connection Methods

If the primary connection method fails, you can modify the configuration in the browser console:

```javascript
// Try secure WebSocket connection
mqttConfig.useTLS = true;
mqttConfig.port = 8084;

// Try TCP connection (may not work in all browsers)
mqttConfig.useWebSocket = false;
mqttConfig.port = 1886;
```

## Development

### Adding New Features

The modular structure makes it easy to add new features:

1. **New Charts**: Add new canvas elements in `index.html` and create corresponding chart instances in `app.js`
2. **Additional Metrics**: Extend the `parseDeviceData` function to extract more metrics from the Modbus registers
3. **UI Components**: Add new UI components in `index.html` and update them in the `updateRealTimeDisplay` function

### Browser Compatibility

The application uses modern browser APIs including:

- WebSockets for MQTT communication
- Typed Arrays (Uint8Array, DataView) for binary data handling
- ES6+ JavaScript features
- Chart.js for data visualization

Supported browsers include:
- Chrome 60+
- Firefox 55+
- Safari 11+
- Edge 79+

## Future Enhancements

Planned enhancements for future versions:

1. **Offline Mode**: Cache data for offline viewing
2. **Export Functionality**: Export data as CSV or JSON
3. **Custom Alerts**: Set up alerts for specific conditions
4. **Multiple Device Support**: Monitor multiple inverters simultaneously
5. **Advanced Analytics**: Add statistical analysis and predictions
6. **Theme Support**: Add light/dark mode toggle
7. **Localization**: Support for multiple languages

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- MQTT.js for browser-based MQTT communication
- Chart.js for interactive data visualization
- Tailwind CSS for responsive styling
