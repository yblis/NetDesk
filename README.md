# NetDesk - NetBird to RustDesk Connector

A Chrome extension that adds RustDesk connection buttons to the NetBird dashboard.

<img width="1367" height="757" alt="image" src="https://github.com/user-attachments/assets/68d1db5e-779a-4243-9dc0-62b329507ec6" />


## Features

- Adds a "RustDesk" button next to each peer in the NetBird dashboard
- Automatically detects your operating system (Windows, macOS, Linux, iOS, Android)
- Launches the appropriate RustDesk client for your OS
- Supports custom NetBird dashboard URLs
- Configurable button styles (text or icon)
- Injects configurable "Open port" links in the peer action menu to launch service tabs quickly

## Installation

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions`
3. Enable "Developer mode" in the top right corner
4. Click "Load unpacked" and select the extension directory
5. The extension icon should now appear in your Chrome toolbar

## Usage

1. Navigate to your NetBird dashboard (https://app.netbird.io or your custom URL)
2. The extension will automatically inject RustDesk buttons next to each peer
3. Click the "RustDesk" button to initiate a connection to that peer
4. The appropriate RustDesk client for your OS will launch

## Configuration

You can configure the extension by clicking the extension icon and selecting "Options":

- Set a custom NetBird dashboard URL
- Choose between text or icon-only button styles
- Configure the list of ports that appear in the peer action menu (defaults: 80, 443, 8080, 3000)

## How It Works

- The extension uses content scripts to modify the NetBird dashboard page
- It detects peer information directly from the dashboard table
- OS detection is performed to launch the correct RustDesk client
- Peer IDs are assumed to be the same in both NetBird and RustDesk

## Requirements

- Chrome browser
- RustDesk client installed on your device
- Access to NetBird dashboard

## Limitations

- This extension assumes that peers have the same ID in both NetBird and RustDesk
- The button injection may need adjustment based on the actual NetBird dashboard structure
- Some security settings may prevent the extension from launching external applications

## Troubleshooting

If the RustDesk buttons are not appearing on the NetBird dashboard:

1. Check that the extension is enabled in Chrome
2. Verify you're on the correct NetBird dashboard URL (https://app.netbird.io or your custom URL)
3. Open the browser's developer console (F12) and check for any error messages
4. Try running the debug script provided in `debug-content-script.js` in the console
5. Reload the NetBird dashboard page

## Support

For issues or feature requests, please open an issue on this repository.
