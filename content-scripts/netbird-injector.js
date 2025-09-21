// Content script to inject RustDesk buttons into NetBird dashboard
// This script runs on the NetBird dashboard page

var osType = 'unknown';
var buttonStyle = 'icon';
const DEFAULT_SERVICE_PORTS = [80, 443, 8080, 3000];
var servicePorts = DEFAULT_SERVICE_PORTS.slice();

console.log('NetDesk content script loaded');

// Get the OS type from the background script
chrome.runtime.sendMessage({action: "getOS"}, (response) => {
  if (response && response.os) {
    osType = response.os;
    console.log("Detected OS:", osType);
  } else {
    console.log("Failed to detect OS");
  }
});

function sanitizePortArray(value) {
  if (!Array.isArray(value)) return DEFAULT_SERVICE_PORTS.slice();
  const seen = new Set();
  const ports = [];
  for (const entry of value) {
    const n = Number(entry);
    if (!Number.isInteger(n) || n < 1 || n > 65535) continue;
    if (!seen.has(n)) {
      seen.add(n);
      ports.push(n);
    }
  }
  return ports.length > 0 ? ports : DEFAULT_SERVICE_PORTS.slice();
}

// Get extension settings
chrome.storage.sync.get(['buttonStyle', 'servicePorts'], (result) => {
  if (result.buttonStyle) {
    buttonStyle = result.buttonStyle;
  }
  if (result.servicePorts) {
    servicePorts = sanitizePortArray(result.servicePorts);
  }
  console.log("Button style:", buttonStyle);
  console.log('Service ports:', servicePorts.join(', '));
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (changes.buttonStyle) {
    const nv = changes.buttonStyle.newValue;
    if (nv) buttonStyle = nv;
  }
  if (changes.servicePorts) {
    servicePorts = sanitizePortArray(changes.servicePorts.newValue);
    console.log('Service ports updated:', servicePorts.join(', '));
  }
});

var lastMenuTriggerInfo = null;

function resolvePeerContext(row) {
  if (!row) return { peerName: '', peerHost: '', peerIp: '' };
  let peerName = '';
  try {
    peerName = (row.dataset && row.dataset.netdeskPeerName) || '';
  } catch (e) {
    peerName = '';
  }
  if (!peerName) {
    const primaryName = row.querySelector && row.querySelector('[data-testid="peer-name-cell"] .truncate');
    if (primaryName && primaryName.textContent) {
      peerName = primaryName.textContent.trim();
    } else {
      const fallbackName = row.querySelector && row.querySelector('div.font-medium .truncate');
      if (fallbackName && fallbackName.textContent) {
        peerName = fallbackName.textContent.trim();
      }
    }
  }

  let peerHost = (row.dataset && row.dataset.netdeskPeerHost) || '';
  let peerIp = (row.dataset && row.dataset.netdeskPeerIp) || '';
  if (!peerHost && !peerIp) {
    const extracted = extractAddressFromRow(row) || {};
    peerHost = extracted.host || '';
    peerIp = extracted.ip || '';
  }

  if (row.dataset) {
    row.dataset.netdeskPeerName = peerName || '';
    row.dataset.netdeskPeerHost = peerHost || '';
    row.dataset.netdeskPeerIp = peerIp || '';
  }

  return { peerName, peerHost, peerIp };
}

function handleMenuTrigger(event) {
  if (!event || !event.target || typeof event.target.closest !== 'function') return;
  if (event.type === 'keydown') {
    const key = event.key || '';
    if (key !== 'Enter' && key !== ' ') return;
  }
  const trigger = event.target.closest('button[aria-haspopup="menu"], [role="button"][aria-haspopup="menu"]');
  if (!trigger) return;
  const row = trigger.closest && trigger.closest('tr[data-row-id]');
  if (!row) return;
  const context = resolvePeerContext(row);
  if (trigger.dataset) {
    trigger.dataset.netdeskPeerName = context.peerName || '';
    trigger.dataset.netdeskPeerHost = context.peerHost || '';
    trigger.dataset.netdeskPeerIp = context.peerIp || '';
  }
  lastMenuTriggerInfo = {
    trigger: trigger,
    row: row,
    peerName: context.peerName,
    peerHost: context.peerHost,
    peerIp: context.peerIp
  };
}

['pointerdown', 'keydown'].forEach((eventName) => {
  try {
    document.addEventListener(eventName, handleMenuTrigger, true);
  } catch (e) {
    console.warn('Failed to register menu trigger listener for', eventName, e);
  }
});

function cssEscapeValue(value) {
  if (typeof value !== 'string') return '';
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/([!"#$%&'()*+,./:;<=>?@[\\]^`{|}~])/g, '\\$1');
}

function findTriggerForMenu(menuEl) {
  if (!menuEl) return null;
  const menuId = menuEl.id;
  if (menuId) {
    const escapedId = cssEscapeValue(menuId);
    const viaControls = document.querySelector(`[aria-controls="${escapedId}"]`);
    if (viaControls) return viaControls;
  }
  const labelledBy = menuEl.getAttribute && menuEl.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelledTrigger = document.getElementById(labelledBy);
    if (labelledTrigger) return labelledTrigger;
  }
  if (lastMenuTriggerInfo && lastMenuTriggerInfo.trigger) {
    return lastMenuTriggerInfo.trigger;
  }
  return null;
}

function getPeerInfoFromTrigger(trigger) {
  if (!trigger) return null;
  const row = (trigger.closest && trigger.closest('tr[data-row-id]')) || (lastMenuTriggerInfo && lastMenuTriggerInfo.row) || null;
  const peerName = (trigger.dataset && trigger.dataset.netdeskPeerName) || (row && row.dataset && row.dataset.netdeskPeerName) || '';
  const peerHost = (trigger.dataset && trigger.dataset.netdeskPeerHost) || (row && row.dataset && row.dataset.netdeskPeerHost) || '';
  const peerIp = (trigger.dataset && trigger.dataset.netdeskPeerIp) || (row && row.dataset && row.dataset.netdeskPeerIp) || '';
  return { trigger, row, peerName, peerHost, peerIp };
}

function buildPortUrl(peerInfo, port) {
  if (!peerInfo) return null;
  const rawTarget = (peerInfo.peerHost && peerInfo.peerHost.trim()) || (peerInfo.peerIp && peerInfo.peerIp.trim());
  if (!rawTarget) return null;
  const portNumber = Number(port);
  if (!Number.isInteger(portNumber)) return null;
  const cleanTarget = rawTarget.replace(/^https?:\/\//i, '').replace(/\/+$/g, '');
  const needsBrackets = cleanTarget.includes(':') && !cleanTarget.includes(']');
  const hostPart = needsBrackets ? `[${cleanTarget}]` : cleanTarget;
  const protocol = portNumber === 443 ? 'https' : 'http';
  return `${protocol}://${hostPart}:${portNumber}`;
}

function createPortMenuItem(peerInfo, port, targetUrl) {
  const menuItem = document.createElement('div');
  menuItem.setAttribute('role', 'menuitem');
  menuItem.setAttribute('tabindex', '-1');
  menuItem.className = 'relative flex select-none items-center rounded-md pr-2 pl-3 py-1.5 text-sm outline-none transition-colors focus:bg-gray-100 focus:text-gray-900 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 cursor-pointer dark:focus:bg-nb-gray-900 dark:focus:text-gray-50 netdesk-port-item';
  const inner = document.createElement('div');
  inner.className = 'flex gap-3 items-center w-full justify-between';
  const labelSpan = document.createElement('span');
  labelSpan.textContent = `Open port ${port}`;
  inner.appendChild(labelSpan);
  const targetSpan = document.createElement('span');
  targetSpan.className = 'text-xs text-gray-500 dark:text-gray-400';
  const displayTarget = peerInfo.peerHost || peerInfo.peerIp || peerInfo.peerName || '';
  targetSpan.textContent = displayTarget;
  inner.appendChild(targetSpan);
  menuItem.appendChild(inner);
  menuItem.addEventListener('click', () => {
    if (!targetUrl) return;
    chrome.runtime.sendMessage({ action: 'openPortTab', url: targetUrl }, (response) => {
      if (chrome.runtime && chrome.runtime.lastError) {
        console.warn('Failed to open port tab:', chrome.runtime.lastError.message);
      } else if (response && response.error) {
        console.warn('Failed to open port tab:', response.error);
      }
    });
  });
  return menuItem;
}

function findPortInsertAnchor(menuEl) {
  const separators = Array.from(menuEl.querySelectorAll('div[role="separator"]')).filter((node) => !node.classList.contains('netdesk-port-separator'));
  if (separators.length > 0) {
    return separators[separators.length - 1];
  }
  const deleteCandidate = Array.from(menuEl.children || []).find((child) => {
    if (!child || child.getAttribute('role') !== 'menuitem') return false;
    const text = (child.textContent || '').toLowerCase();
    return text.includes('delete') || text.includes('remove');
  });
  return deleteCandidate || null;
}

function injectPortLinks(menuEl, peerInfo) {
  if (!menuEl || menuEl.dataset.netdeskPortsInjected === '1') return;
  if (!peerInfo || !peerInfo.row) return;
  const targetExists = (peerInfo.peerHost && peerInfo.peerHost.trim()) || (peerInfo.peerIp && peerInfo.peerIp.trim());
  if (!targetExists) return;
  const ports = (Array.isArray(servicePorts) && servicePorts.length > 0) ? servicePorts : DEFAULT_SERVICE_PORTS;
  const fragment = document.createDocumentFragment();
  let itemsCount = 0;
  for (const port of ports) {
    const url = buildPortUrl(peerInfo, port);
    if (!url) continue;
    const item = createPortMenuItem(peerInfo, port, url);
    fragment.appendChild(item);
    itemsCount++;
  }
  if (itemsCount === 0) return;
  const separator = document.createElement('div');
  separator.setAttribute('role', 'separator');
  separator.setAttribute('aria-orientation', 'horizontal');
  separator.className = '-mx-1 my-1 h-px bg-gray-100 dark:bg-nb-gray-910 netdesk-port-separator';
  fragment.insertBefore(separator, fragment.firstChild);
  const anchor = findPortInsertAnchor(menuEl);
  if (anchor && anchor.parentNode === menuEl) {
    menuEl.insertBefore(fragment, anchor);
  } else {
    menuEl.appendChild(fragment);
  }
  menuEl.dataset.netdeskPortsInjected = '1';
}

function injectPortsForMenuElement(menuEl) {
  if (!menuEl || menuEl.dataset.netdeskPortsInjected === '1') return;
  const trigger = findTriggerForMenu(menuEl);
  let peerInfo = getPeerInfoFromTrigger(trigger);
  if ((!peerInfo || !peerInfo.row) && lastMenuTriggerInfo) {
    peerInfo = lastMenuTriggerInfo;
  }
  if (!peerInfo || !peerInfo.row) return;
  if ((!peerInfo.peerHost || !peerInfo.peerHost.trim()) && (!peerInfo.peerIp || !peerInfo.peerIp.trim())) {
    const resolved = resolvePeerContext(peerInfo.row);
    peerInfo.peerHost = resolved.peerHost;
    peerInfo.peerIp = resolved.peerIp;
    peerInfo.peerName = peerInfo.peerName || resolved.peerName;
  }
  injectPortLinks(menuEl, peerInfo);
}

function handleMenuMutation(node) {
  if (!node || node.nodeType !== 1) return;
  const el = node;
  if (el.getAttribute && el.getAttribute('role') === 'menu') {
    injectPortsForMenuElement(el);
  }
  const childMenus = el.querySelectorAll ? el.querySelectorAll('[role="menu"]') : [];
  childMenus.forEach((menu) => injectPortsForMenuElement(menu));
}

var addressColIndex = -1;
var __netdeskObserverSetup = false;
var __netdeskIntervalSetup = false;
var __netdeskHistoryHooked = false;
var lastKnownPath = (typeof window !== 'undefined' && window.location && window.location.pathname) || '';

function isPeersPage() {
  try {
    const path = (window.location && window.location.pathname) || '';
    if (!path) return false;
    if (path === '/peers') return true;
    return path.startsWith('/peers/');
  } catch (e) {
    return false;
  }
}

function removeRustDeskButtons() {
  if (typeof document === 'undefined') return;
  const nodes = document.querySelectorAll('.rustdesk-button-container');
  nodes.forEach((node) => {
    if (!node) return;
    if (typeof node.remove === 'function') {
      node.remove();
    } else if (node.parentElement) {
      node.parentElement.removeChild(node);
    }
  });
}

function handleRouteChange() {
  try {
    const currentPath = (window.location && window.location.pathname) || '';
    if (currentPath === lastKnownPath) return;
    lastKnownPath = currentPath;
  } catch (e) {
    // Bail if we cannot read window.location
    return;
  }

  addressColIndex = -1;
  removeRustDeskButtons();

  if (isPeersPage()) {
    setTimeout(injectRustDeskButtons, 100);
  }
}

function setupRouteObserver() {
  if (__netdeskHistoryHooked) return;
  __netdeskHistoryHooked = true;
  try {
    if (typeof window !== 'undefined') {
      window.addEventListener('popstate', handleRouteChange);
    }
    if (typeof history !== 'undefined') {
      ['pushState', 'replaceState'].forEach((method) => {
        const original = history[method];
        if (typeof original === 'function') {
          history[method] = function(...args) {
            const result = original.apply(this, args);
            handleRouteChange();
            return result;
          };
        }
      });
    }
  } catch (e) {
    console.warn('NetDesk route observer setup failed:', e);
  }
}

setupRouteObserver();
function detectAddressColumnIndex() {
  try {
    const headerRow = document.querySelector('thead tr');
    if (!headerRow) return -1;
    const headers = Array.from(headerRow.querySelectorAll('th'));
    const want = ['address', 'adresse', 'ip address', 'ip'];
    for (let i = 0; i < headers.length; i++) {
      const txt = (headers[i].innerText || headers[i].textContent || '').trim().toLowerCase();
      if (!txt) continue;
      for (const w of want) {
        if (txt.includes(w)) {
          console.log('Detected ADDRESS column at index', i, 'header text =', txt);
          return i;
        }
      }
    }
  } catch (e) {
    console.warn('Failed to detect address column index:', e);
  }
  return -1;
}

// Try to reliably locate the ADDRESS cell within a row and extract host/IP
function extractAddressFromRow(row) {
  const parseCell = (cell) => {
    let host = '';
    let ip = '';
    const full = (cell.textContent || '').trim();
    // Extract first IPv4 in the cell text
    const ipMatch = full.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/);
    if (ipMatch) ip = ipMatch[0];
    // Prefer dedicated hostname element
    const hostEl = cell.querySelector('span.font-normal, .font-normal.truncate, .truncate.font-normal');
    if (hostEl) host = (hostEl.textContent || '').trim();
    if (!host) {
      let textForHost = full;
      if (ip) textForHost = textForHost.replace(ip, ' ').trim();
      const domMatch = textForHost.match(/[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+/);
      if (domMatch) host = domMatch[0];
    }
    // If host accidentally contains IP, strip it
    if (host && ip && host.includes(ip)) host = host.replace(ip, '').trim();
    host = host.replace(/\s+/g, ' ').trim();
    ip = ip.trim();
    return { host, ip };
  };

  const cells = Array.from(row.querySelectorAll('td'));
  // Try detected ADDRESS column first
  if (addressColIndex < 0) addressColIndex = detectAddressColumnIndex();
  if (addressColIndex >= 0 && cells[addressColIndex]) {
    const res = parseCell(cells[addressColIndex]);
    if (res.host || res.ip) return res;
  }
  // Fallback: scan all cells
  for (const cell of cells) {
    const res = parseCell(cell);
    if (res.host || res.ip) return res;
  }
  return { host: '', ip: '' };
}

// Determine whether a peer row is online (green dot)
function isPeerActive(row) {
  try {
    // Prefer explicit data attributes if present
    const activeBadge = row.querySelector('span[data-cy="circle-icon"][data-cy-status="active"]');
    if (activeBadge) return true;
    const inactiveBadge = row.querySelector('span[data-cy="circle-icon"][data-cy-status="inactive"]');
    if (inactiveBadge) return false;
    // Fallback to class-based color detection
    const greenDot = row.querySelector('.bg-green-400');
    if (greenDot) return true;
    const grayDot = row.querySelector('.bg-nb-gray-500');
    if (grayDot) return false;
  } catch (e) {
    // ignore
  }
  // Default: treat as inactive if we cannot determine
  return false;
}

// Function to create a RustDesk button
function createRustDeskButton(peerId, peerName, peerIp, peerHost = '') {
  const button = document.createElement('button');
  button.className = 'rustdesk-connect-btn';
  
  // Apply selected style
  if (buttonStyle === 'icon') {
    button.classList.add('icon-style');
    // Use the packaged icon for RustDesk
    const img = document.createElement('img');
    try {
      img.src = chrome.runtime.getURL('icons/icon32.png');
    } catch (e) {
      img.src = 'icons/icon32.png';
    }
    img.addEventListener('error', () => {
      // Fallback if CSP or access blocks the icon
      button.textContent = 'R';
    });
    img.alt = 'RustDesk';
    button.appendChild(img);
  } else {
    button.innerHTML = 'RustDesk';
  }
  
  button.title = `Connect to ${peerName} via RustDesk`;
  button.dataset.peerId = peerId;
  button.dataset.peerName = peerName;
  button.dataset.peerIp = peerIp;
  if (peerHost) {
    button.dataset.peerHost = peerHost;
  }
  
  button.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();

    // Read values from the button dataset to avoid scope issues
    const { peerId: idFromDs, peerIp: ipFromDs, peerHost: hostFromDs } = (e.currentTarget && e.currentTarget.dataset) || {};
    const finalPeerId = idFromDs || peerId;
    const finalPeerIp = ipFromDs || peerIp;
    const finalPeerHost = hostFromDs || '';

    if (!finalPeerHost && !finalPeerIp) {
      console.warn('No ADDRESS found for row; aborting RustDesk launch');
      alert('Adresse introuvable dans la colonne ADDRESS. Impossible de lancer RustDesk.');
      return;
    }

    // Send message to background script to launch RustDesk
    chrome.runtime.sendMessage({
      action: "launchRustDesk",
      peerId: finalPeerId,
      peerIp: finalPeerIp,
      peerHost: finalPeerHost,
      os: osType
    }, (response) => {
      if (response && !response.success) {
        console.error("Failed to launch RustDesk:", response.error);
        // Show error to user
        alert(`Failed to launch RustDesk: ${response.error}`);
      }
    });
  });
  
  return button;
}

// Function to inject buttons into the peer table
function injectRustDeskButtons() {
  console.log('Attempting to inject RustDesk buttons');

  if (!isPeersPage()) {
    removeRustDeskButtons();
    return;
  }
  
  // Try to find the peer table rows in NetBird dashboard
  const peerRows = document.querySelectorAll('tbody tr[data-row-id]');
  console.log('Found peer rows:', peerRows.length);
  
  if (peerRows.length === 0) {
    // Try alternative selectors for the actual NetBird structure
    const altRows = document.querySelectorAll('tr.group\\/table-row[data-row-id]');
    console.log('Alternative selector found rows:', altRows.length);
    
    if (altRows.length > 0) {
      altRows.forEach((row, index) => {
        processPeerRow(row, index);
      });
      return;
    }
  }
  
  peerRows.forEach((row, index) => {
    processPeerRow(row, index);
  });
}

// Helper function to process a peer row
function processPeerRow(row, index) {
  console.log(`Processing row ${index}:`, row);

  // Only show button for active peers
  if (!isPeerActive(row)) {
    // Remove existing button if present (status may have changed)
    const existing = row.querySelector('.rustdesk-button-container');
    if (existing && existing.parentElement) {
      existing.parentElement.removeChild(existing);
      console.log(`Row ${index} is inactive; removed RustDesk button`);
    } else {
      console.log(`Row ${index} is inactive; skipping button`);
    }
    return;
  }

  // Skip rows that already have a RustDesk button
  if (row.querySelector('.rustdesk-connect-btn')) {
    console.log(`Row ${index} already has RustDesk button`);
    return;
  }
  
  // Find the peer name cell using the data-testid attribute
  const peerNameCell = row.querySelector('[data-testid="peer-name-cell"]');
  console.log(`Row ${index} peer name cell:`, peerNameCell);
  
  if (peerNameCell) {
    // Extract peer name from the nested structure
    // Look for the truncate div that contains the actual peer name
    const peerNameElement = peerNameCell.querySelector('.truncate');
    console.log(`Row ${index} peer name element:`, peerNameElement);
    
    if (peerNameElement) {
      const peerName = peerNameElement.textContent.trim();
      console.log(`Row ${index} peer name:`, peerName);
      
      // Create a unique ID based on the peer name
      const peerId = peerName.replace(/\s+/g, '-').toLowerCase();
      console.log(`Row ${index} peer ID:`, peerId);
      
      if (peerName && peerId) {
        const { host: peerHost, ip: peerIp } = extractAddressFromRow(row);
        console.log(`Row ${index} ADDRESS parsed: host='${peerHost}', ip='${peerIp}'`);
        row.dataset.netdeskPeerName = peerName;
        row.dataset.netdeskPeerHost = peerHost || '';
        row.dataset.netdeskPeerIp = peerIp || '';
        
        const button = createRustDeskButton(peerId, peerName, peerIp, peerHost);
        
        // Find a suitable place to insert the button
        // We'll add it to the peer name cell
        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'rustdesk-button-container';
        buttonContainer.style.cssText = 'display: inline-flex; align-items: center; margin-left: 10px;';
        buttonContainer.appendChild(button);
        
        // Insert the button to the left of the peer name
        const fontMedium = peerNameCell.querySelector('.font-medium');
        if (fontMedium) {
          fontMedium.insertBefore(buttonContainer, fontMedium.firstChild);
        } else {
          peerNameCell.insertBefore(buttonContainer, peerNameCell.firstChild);
        }
        console.log(`Successfully added RustDesk button for ${peerName} with target ${peerHost || peerIp}`);
      }
    }
  } else {
    console.log(`Row ${index} does not have peer name cell with data-testid="peer-name-cell"`);
    
    // Try to find the peer name in the actual NetBird structure
    const nameDiv = row.querySelector('div.font-medium .truncate');
    if (nameDiv) {
      const peerName = nameDiv.textContent.trim();
      console.log(`Row ${index} found peer name in alternative structure:`, peerName);
      
      // Create a unique ID based on the peer name
      const peerId = peerName.replace(/\s+/g, '-').toLowerCase();
      console.log(`Row ${index} peer ID:`, peerId);
      
      if (peerName && peerId) {
        const { host: peerHost, ip: peerIp } = extractAddressFromRow(row);
        console.log(`Row ${index} ADDRESS parsed (alt): host='${peerHost}', ip='${peerIp}'`);
        row.dataset.netdeskPeerName = peerName;
        row.dataset.netdeskPeerHost = peerHost || '';
        row.dataset.netdeskPeerIp = peerIp || '';
        
        const button = createRustDeskButton(peerId, peerName, peerIp, peerHost);
        
        // Create a container for the button
        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'rustdesk-button-container';
        buttonContainer.style.cssText = 'display: inline-flex; align-items: center; margin-left: 10px;';
        buttonContainer.appendChild(button);
        
        // Insert the button to the left of the peer name
        const fontMedium = nameDiv.closest('.font-medium') || nameDiv.parentElement;
        if (fontMedium && fontMedium.parentElement) {
          fontMedium.insertBefore(buttonContainer, fontMedium.firstChild);
        } else {
          nameDiv.parentElement.parentElement.insertBefore(buttonContainer, nameDiv.parentElement.parentElement.firstChild);
        }
        console.log(`Successfully added RustDesk button for ${peerName} with target ${peerHost || peerIp}`);
      }
    }
  }
}

// Function to observe changes in the DOM and inject buttons when needed
function observeDashboard() {
  if (__netdeskObserverSetup) {
    console.log('NetDesk observer already set up; skipping re-init');
    return;
  }
  __netdeskObserverSetup = true;
  // Create a MutationObserver to watch for changes in the dashboard
  const observer = new MutationObserver((mutations) => {
    let shouldInject = false;
    
    mutations.forEach((mutation) => {
      if (mutation.type === 'childList') {
        if (mutation.addedNodes.length > 0) {
          shouldInject = true;
          mutation.addedNodes.forEach((node) => handleMenuMutation(node));
        }
      }
      if (mutation.type === 'attributes') {
        const t = mutation.target;
        if (t && t.getAttribute && t.getAttribute('role') === 'menu' && t.getAttribute('data-state') === 'open') {
          injectPortsForMenuElement(t);
        }
        if (t && t.matches && (t.matches('span[data-cy="circle-icon"]') || t.matches('.bg-green-400, .bg-nb-gray-500'))) {
          shouldInject = true;
        }
      }
    });
    
    if (shouldInject) {
      // Small delay to ensure DOM is fully updated
      setTimeout(injectRustDeskButtons, 100);
    }
  });
  
  // Start observing the document body for changes
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-cy-status', 'class']
  });
  
  // Initial injection
  setTimeout(injectRustDeskButtons, 1000);
}

// Wait for the page to load before injecting buttons
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', observeDashboard);
} else {
  observeDashboard();
}

// Also run periodically in case the dashboard updates in a way that bypasses MutationObserver
if (!__netdeskIntervalSetup) {
  setInterval(injectRustDeskButtons, 5000);
  __netdeskIntervalSetup = true;
}
