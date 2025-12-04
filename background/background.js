// Background script for NetDesk Chrome Extension
// Handles OS detection and communication with content script

// Detect the user's operating system
function detectOS() {
  const userAgent = navigator.userAgent;
  const platform = navigator.platform;

  if (userAgent.includes('Win')) return 'windows';
  if (userAgent.includes('Mac')) return 'mac';
  if (userAgent.includes('Linux') || userAgent.includes('X11')) return 'linux';
  if (/iPad|iPhone|iPod/.test(userAgent)) return 'ios';
  if (userAgent.includes('Android')) return 'android';

  return 'unknown';
}

let cachedCustomUrl = '';
let cachedRustdeskPort = 21118; // default

// Initialize cached custom URL from storage
chrome.storage.sync.get(['customUrl', 'rustdeskPort'], (res) => {
  if (res && res.customUrl) {
    cachedCustomUrl = res.customUrl.trim();
    console.log('[NetDesk] Loaded custom URL:', cachedCustomUrl);
  }
  if (res && typeof res.rustdeskPort !== 'undefined' && res.rustdeskPort !== null && res.rustdeskPort !== '') {
    const n = Number(res.rustdeskPort);
    if (Number.isInteger(n) && n >= 1 && n <= 65535) {
      cachedRustdeskPort = n;
    }
  }
  console.log('[NetDesk] Using RustDesk port:', cachedRustdeskPort);
});

// Keep cached URL in sync when options change
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.customUrl) {
    cachedCustomUrl = (changes.customUrl.newValue || '').trim();
    console.log('[NetDesk] Custom URL updated:', cachedCustomUrl);
  }
  if (area === 'sync' && changes.rustdeskPort) {
    const nv = changes.rustdeskPort.newValue;
    const n = Number(nv);
    cachedRustdeskPort = (Number.isInteger(n) && n >= 1 && n <= 65535) ? n : 21118;
    console.log('[NetDesk] RustDesk port updated:', cachedRustdeskPort);
  }
});

// Helper: should we inject on this URL via programmatic injection?
function shouldInjectForCustom(url) {
  if (!cachedCustomUrl) return false;
  try {
    // Normalize and compare prefix
    const u = url || '';
    const target = cachedCustomUrl;
    return u.startsWith(target);
  } catch (e) {
    return false;
  }
}

// Programmatically inject content script for custom NetBird instances
try {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete') return;
    const url = tab && tab.url ? tab.url : changeInfo.url;
    if (!url) return;
    if (!shouldInjectForCustom(url)) return;

    // Inject CSS and JS (MV3 scripting API)
    chrome.scripting.insertCSS({
      target: { tabId },
      files: ['content-scripts/styles.css']
    }).catch(() => { });

    chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-scripts/netbird-injector.js']
    }).catch((e) => console.warn('[NetDesk] Inject failed:', e));
  });
} catch (e) {
  console.warn('[NetDesk] tabs.onUpdated wiring failed:', e);
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getOS") {
    sendResponse({ os: detectOS() });
  } else if (request.action === "launchRustDesk") {
    // Attempt to launch RustDesk with the provided connection info
    const { peerId, peerIp, peerHost, os } = request;

    // Choose target: prefer hostname, then IP. Do NOT fallback to peer name/id to avoid mistakes.
    const targetBase = (peerHost && peerHost.trim()) || (peerIp && peerIp.trim()) || '';
    if (!targetBase) {
      sendResponse({ success: false, error: 'No ADDRESS found (host or IP) for this peer.' });
      return true;
    }

    // Ensure port 21118 is present if target looks like host/IP without a port
    const hasPort = /:[0-9]{2,5}$/.test(targetBase);
    const looksLikeHostOrIp = /^(?:\d+\.\d+\.\d+\.\d+|[a-zA-Z0-9.-]+)$/.test(targetBase);
    const connectTarget = hasPort || !looksLikeHostOrIp ? targetBase : `${targetBase}:${cachedRustdeskPort}`;

    // Build helpful info for debugging (we cannot exec binaries from extension)
    const command = os === 'windows'
      ? `"C:\\Program Files\\RustDesk\\rustdesk.exe" --connect ${connectTarget}`
      : `rustdesk --connect ${connectTarget}`;

    // Use the rustdesk:// URL scheme to trigger the app
    // Known working pattern: rustdesk://<id or host> optionally with ?password=...
    // We pass host/ip:port so RustDesk opens directly.
    const launchUrl = `rustdesk://${encodeURI(connectTarget)}`;

    // Try to launch the URL in the current tab
    chrome.tabs.update(sender.tab.id, { url: launchUrl })
      .then(() => {
        sendResponse({ success: true, command, url: launchUrl });
      })
      .catch(error => {
        console.error("Failed to launch RustDesk:", error);
        sendResponse({ success: false, error: error.message, command, url: launchUrl });
      });
  } else if (request.action === "launchRustDeskTerminal") {
    // Launch RustDesk in terminal mode
    const { peerIp, peerHost } = request;
    // Prefer IP over hostname for terminal mode
    const targetBase = (peerIp && peerIp.trim()) || (peerHost && peerHost.trim()) || '';
    if (!targetBase) {
      sendResponse({ success: false, error: 'No ADDRESS found (host or IP) for this peer.' });
      return true;
    }

    // Use rustdesk://terminal/<IP> format (without port)
    const launchUrl = `rustdesk://terminal/${encodeURI(targetBase)}`;

    chrome.tabs.update(sender.tab.id, { url: launchUrl })
      .then(() => {
        sendResponse({ success: true, url: launchUrl });
      })
      .catch(error => {
        console.error("Failed to launch RustDesk Terminal:", error);
        sendResponse({ success: false, error: error.message, url: launchUrl });
      });
  } else if (request.action === "launchRustDeskFileTransfer") {
    // Launch RustDesk in file transfer mode
    const { peerIp, peerHost } = request;
    // Prefer IP over hostname for file transfer mode
    const targetBase = (peerIp && peerIp.trim()) || (peerHost && peerHost.trim()) || '';
    if (!targetBase) {
      sendResponse({ success: false, error: 'No ADDRESS found (host or IP) for this peer.' });
      return true;
    }

    // Use rustdesk://file-transfer/<IP> format (without port)
    const launchUrl = `rustdesk://file-transfer/${encodeURI(targetBase)}`;

    chrome.tabs.update(sender.tab.id, { url: launchUrl })
      .then(() => {
        sendResponse({ success: true, url: launchUrl });
      })
      .catch(error => {
        console.error("Failed to launch RustDesk File Transfer:", error);
        sendResponse({ success: false, error: error.message, url: launchUrl });
      });
  } else if (request.action === "openPortTab") {
    const targetUrl = typeof request.url === 'string' ? request.url : '';
    if (!targetUrl) {
      sendResponse({ success: false, error: 'Missing URL for port tab.' });
      return true;
    }
    try {
      chrome.tabs.create({ url: targetUrl }, (tab) => {
        const err = chrome.runtime.lastError;
        if (err) {
          console.warn('[NetDesk] Failed to open port tab:', err.message);
          sendResponse({ success: false, error: err.message });
          return;
        }
        sendResponse({ success: true, tabId: tab && tab.id ? tab.id : undefined });
      });
    } catch (e) {
      console.warn('[NetDesk] tabs.create failed:', e);
      sendResponse({ success: false, error: e.message || String(e) });
    }
  }

  // Return true to indicate we'll send a response asynchronously
  return true;
});
