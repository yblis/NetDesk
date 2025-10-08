// Content script to inject RustDesk buttons into NetBird dashboard
// This script runs on the NetBird dashboard page

var osType = 'unknown';
var buttonStyle = 'icon';
var rustdeskEnabled = true;
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
chrome.storage.sync.get(['buttonStyle', 'servicePorts', 'rustdeskEnabled'], (result) => {
  if (result.buttonStyle) {
    buttonStyle = result.buttonStyle;
  }
  if (result.servicePorts) {
    servicePorts = sanitizePortArray(result.servicePorts);
  }
  // RustDesk enabled by default
  rustdeskEnabled = result.rustdeskEnabled !== false;
  console.log("Button style:", buttonStyle);
  console.log('Service ports:', servicePorts.join(', '));
  console.log('RustDesk enabled:', rustdeskEnabled);
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
  if (changes.rustdeskEnabled) {
    rustdeskEnabled = changes.rustdeskEnabled.newValue !== false;
    console.log('RustDesk enabled updated:', rustdeskEnabled);
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

function createRustDeskMenuItem(peerInfo) {
  const menuItem = document.createElement('div');
  menuItem.setAttribute('role', 'menuitem');
  menuItem.setAttribute('tabindex', '-1');
  menuItem.className = 'relative flex select-none items-center rounded-md pr-2 pl-3 py-1.5 text-sm outline-none transition-colors hover:bg-gray-100 hover:text-gray-900 focus:bg-gray-100 focus:text-gray-900 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 cursor-pointer dark:hover:bg-nb-gray-900 dark:hover:text-gray-50 dark:focus:bg-nb-gray-900 dark:focus:text-gray-50 netdesk-rustdesk-item';
  const inner = document.createElement('div');
  inner.className = 'flex gap-3 items-center w-full justify-between';
  
  // Create left side container with icon and label
  const leftSide = document.createElement('div');
  leftSide.className = 'flex items-center gap-2';
  
  // Add RustDesk icon
  const iconImg = document.createElement('img');
  try {
    iconImg.src = chrome.runtime.getURL('icons/icon32.png');
  } catch (e) {
    iconImg.src = 'icons/icon32.png';
  }
  iconImg.className = 'rustdesk-menu-icon';
  iconImg.style.cssText = 'width: 16px; height: 16px; display: block;';
  iconImg.alt = 'RustDesk';
  leftSide.appendChild(iconImg);
  
  const labelSpan = document.createElement('span');
  labelSpan.textContent = 'RustDesk';
  leftSide.appendChild(labelSpan);
  
  inner.appendChild(leftSide);
  
  const targetSpan = document.createElement('span');
  targetSpan.className = 'text-xs text-gray-500 dark:text-gray-400';
  const displayTarget = peerInfo.peerHost || peerInfo.peerIp || peerInfo.peerName || '';
  targetSpan.textContent = displayTarget;
  inner.appendChild(targetSpan);
  menuItem.appendChild(inner);
  
  menuItem.addEventListener('click', () => {
    const finalPeerIp = peerInfo.peerIp || '';
    const finalPeerHost = peerInfo.peerHost || '';
    if (!finalPeerHost && !finalPeerIp) {
      console.warn('No ADDRESS found for peer; aborting RustDesk launch');
      alert('Adresse introuvable. Impossible de lancer RustDesk.');
      return;
    }
    chrome.runtime.sendMessage({
      action: "launchRustDesk",
      peerId: peerInfo.peerName ? peerInfo.peerName.replace(/\s+/g, '-').toLowerCase() : '',
      peerIp: finalPeerIp,
      peerHost: finalPeerHost,
      os: osType
    }, (response) => {
      if (response && !response.success) {
        console.error("Failed to launch RustDesk:", response.error);
        alert(`Failed to launch RustDesk: ${response.error}`);
      }
    });
  });
  return menuItem;
}

function createPortMenuItem(peerInfo, port, targetUrl) {
  const menuItem = document.createElement('div');
  menuItem.setAttribute('role', 'menuitem');
  menuItem.setAttribute('tabindex', '-1');
  menuItem.className = 'relative flex select-none items-center rounded-md pr-2 pl-3 py-1.5 text-sm outline-none transition-colors hover:bg-gray-100 hover:text-gray-900 focus:bg-gray-100 focus:text-gray-900 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 cursor-pointer dark:hover:bg-nb-gray-900 dark:hover:text-gray-50 dark:focus:bg-nb-gray-900 dark:focus:text-gray-50 netdesk-port-item';
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
  
  const fragment = document.createDocumentFragment();
  
  // Add RustDesk menu item first (only for active peers and if enabled)
  if (rustdeskEnabled && isPeerActive(peerInfo.row)) {
    const rustdeskItem = createRustDeskMenuItem(peerInfo);
    fragment.appendChild(rustdeskItem);
  }
  
  // Add port items
  const ports = (Array.isArray(servicePorts) && servicePorts.length > 0) ? servicePorts : DEFAULT_SERVICE_PORTS;
  let itemsCount = 0;
  for (const port of ports) {
    const url = buildPortUrl(peerInfo, port);
    if (!url) continue;
    const item = createPortMenuItem(peerInfo, port, url);
    fragment.appendChild(item);
    itemsCount++;
  }
  
  if (itemsCount === 0 && fragment.childNodes.length === 0) return;
  
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

function isPeerDetailPage() {
  try {
    const path = (window.location && window.location.pathname) || '';
    const search = (window.location && window.location.search) || '';
    return path === '/peer' && search.includes('id=');
  } catch (e) {
    return false;
  }
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

  if (isPeersPage()) {
    setTimeout(cachePeerData, 100);
  } else if (isPeerDetailPage()) {
    setTimeout(injectPeerDetailButton, 500);
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

// Function to create RustDesk button for peer detail page
function createPeerDetailRustDeskButton(peerHost, peerIp, peerName) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'relative text-sm focus:z-10 focus:ring-2 font-medium focus:outline-none whitespace-nowrap shadow-sm inline-flex gap-2 items-center justify-center transition-colors focus:ring-offset-1 disabled:opacity-40 disabled:cursor-not-allowed disabled:dark:text-nb-gray-300 dark:ring-offset-neutral-950/50 bg-white hover:text-black focus:ring-zinc-200/50 hover:bg-gray-100 border-gray-200 text-gray-900 dark:ring-offset-neutral-950/50 dark:focus:ring-neutral-500/20 dark:bg-nb-gray-920 dark:text-gray-400 dark:border-gray-700/40 dark:hover:text-white dark:hover:bg-zinc-800/50 text-sm py-2.5 px-4 rounded-md border border-transparent netdesk-peer-detail-btn';
  
  // Add RustDesk icon
  const iconImg = document.createElement('img');
  try {
    iconImg.src = chrome.runtime.getURL('icons/icon32.png');
  } catch (e) {
    iconImg.src = 'icons/icon32.png';
  }
  iconImg.style.cssText = 'width: 16px; height: 16px; display: block;';
  iconImg.alt = 'RustDesk';
  button.appendChild(iconImg);
  
  // Add label
  const label = document.createTextNode('RustDesk');
  button.appendChild(label);
  
  button.addEventListener('click', () => {
    if (!peerHost && !peerIp) {
      console.warn('No ADDRESS found for peer; aborting RustDesk launch');
      alert('Adresse introuvable. Impossible de lancer RustDesk.');
      return;
    }
    chrome.runtime.sendMessage({
      action: "launchRustDesk",
      peerId: peerName ? peerName.replace(/\s+/g, '-').toLowerCase() : '',
      peerIp: peerIp || '',
      peerHost: peerHost || '',
      os: osType
    }, (response) => {
      if (response && !response.success) {
        console.error("Failed to launch RustDesk:", response.error);
        alert(`Failed to launch RustDesk: ${response.error}`);
      }
    });
  });
  
  return button;
}

// Function to inject RustDesk button on peer detail page
function injectPeerDetailButton() {
  console.log('Attempting to inject RustDesk button on peer detail page');
  
  if (!isPeerDetailPage()) {
    console.log('Not on peer detail page');
    return;
  }
  
  // Check if RustDesk is enabled
  if (!rustdeskEnabled) {
    console.log('RustDesk is disabled in settings');
    return;
  }
  
  // Check if button already exists
  if (document.querySelector('.netdesk-peer-detail-btn')) {
    console.log('RustDesk button already exists on peer detail page');
    return;
  }
  
  // Find the button container (div.flex.gap-3)
  // Look for buttons (RDP, SSH, etc.) to find the right container
  const allButtons = Array.from(document.querySelectorAll('button'));
  let buttonContainer = null;
  
  for (const btn of allButtons) {
    const text = (btn.textContent || '').toLowerCase();
    if (text.includes('rdp') || text.includes('ssh')) {
      // Found RDP or SSH button, get its container
      buttonContainer = btn.closest('div.flex.gap-3');
      if (buttonContainer) {
        console.log('Found button container via RDP/SSH button');
        break;
      }
    }
  }
  
  if (!buttonContainer) {
    console.log('Button container not found on peer detail page');
    return;
  }
  
  // Extract peer information from the page
  let peerName = '';
  let peerHost = '';
  let peerIp = '';
  
  // Try to find peer name from heading or title
  const heading = document.querySelector('h1, h2, h3');
  if (heading) {
    peerName = heading.textContent.trim();
  }
  
  // Try to find address information from the info list
  // Look for "NetBird IP Address" and "Domain Name" sections
  const listItems = Array.from(document.querySelectorAll('li.flex.justify-between'));
  
  for (const item of listItems) {
    const labelDiv = item.querySelector('div.flex.gap-2\\.5');
    if (!labelDiv) continue;
    
    const labelText = (labelDiv.textContent || '').toLowerCase();
    
    // Check for NetBird IP Address
    if (labelText.includes('netbird ip') || labelText.includes('ip address')) {
      const valueDiv = item.querySelector('.text-right .truncate');
      if (valueDiv) {
        const ipText = valueDiv.textContent.trim();
        const ipMatch = ipText.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/);
        if (ipMatch) {
          peerIp = ipMatch[0];
          console.log('Found NetBird IP:', peerIp);
        }
      }
    }
    
    // Check for Domain Name
    if (labelText.includes('domain name') || labelText.includes('hostname')) {
      const valueDiv = item.querySelector('.text-right .truncate');
      if (valueDiv) {
        const domainText = valueDiv.textContent.trim();
        // Extract domain/hostname (skip if it looks like "Hostname" or is empty)
        if (domainText && !domainText.toLowerCase().includes('hostname') && domainText.includes('.')) {
          peerHost = domainText;
          console.log('Found Domain Name:', peerHost);
        } else if (domainText && labelText.includes('hostname') && !domainText.includes('.')) {
          // If it's just a hostname without domain, still use it
          peerName = domainText;
          console.log('Found Hostname:', peerName);
        }
      }
    }
  }
  
  console.log('Peer detail info:', { peerName, peerHost, peerIp });
  
  // Create and inject the button
  const rustdeskButton = createPeerDetailRustDeskButton(peerHost, peerIp, peerName);
  
  // Create wrapper div matching the structure of existing buttons
  const wrapper = document.createElement('div');
  const innerWrapper = document.createElement('div');
  innerWrapper.className = 'inline-flex w-full';
  innerWrapper.appendChild(rustdeskButton);
  wrapper.appendChild(innerWrapper);
  
  // Insert at the end of the button container (next to RDP/SSH buttons)
  buttonContainer.appendChild(wrapper);
  
  console.log('RustDesk button injected on peer detail page');
}

// Function to cache peer data from table rows
function cachePeerData() {
  console.log('Caching peer data from table');

  if (!isPeersPage()) {
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
        processPeerRowData(row, index);
      });
      return;
    }
  }
  
  peerRows.forEach((row, index) => {
    processPeerRowData(row, index);
  });
}

// Helper function to cache peer data from a row
function processPeerRowData(row, index) {
  console.log(`Processing peer data for row ${index}:`, row);
  
  // Find the peer name cell using the data-testid attribute
  const peerNameCell = row.querySelector('[data-testid="peer-name-cell"]');
  
  if (peerNameCell) {
    const peerNameElement = peerNameCell.querySelector('.truncate');
    
    if (peerNameElement) {
      const peerName = peerNameElement.textContent.trim();
      console.log(`Row ${index} peer name:`, peerName);
      
      if (peerName) {
        const { host: peerHost, ip: peerIp } = extractAddressFromRow(row);
        console.log(`Row ${index} ADDRESS parsed: host='${peerHost}', ip='${peerIp}'`);
        row.dataset.netdeskPeerName = peerName;
        row.dataset.netdeskPeerHost = peerHost || '';
        row.dataset.netdeskPeerIp = peerIp || '';
      }
    }
  } else {
    // Try to find the peer name in the actual NetBird structure
    const nameDiv = row.querySelector('div.font-medium .truncate');
    if (nameDiv) {
      const peerName = nameDiv.textContent.trim();
      console.log(`Row ${index} found peer name in alternative structure:`, peerName);
      
      if (peerName) {
        const { host: peerHost, ip: peerIp } = extractAddressFromRow(row);
        console.log(`Row ${index} ADDRESS parsed (alt): host='${peerHost}', ip='${peerIp}'`);
        row.dataset.netdeskPeerName = peerName;
        row.dataset.netdeskPeerHost = peerHost || '';
        row.dataset.netdeskPeerIp = peerIp || '';
      }
    }
  }
}

// Function to observe changes in the DOM
function observeDashboard() {
  if (__netdeskObserverSetup) {
    console.log('NetDesk observer already set up; skipping re-init');
    return;
  }
  __netdeskObserverSetup = true;
  // Create a MutationObserver to watch for changes in the dashboard
  const observer = new MutationObserver((mutations) => {
    let shouldCache = false;
    let shouldInjectDetail = false;
    
    mutations.forEach((mutation) => {
      if (mutation.type === 'childList') {
        if (mutation.addedNodes.length > 0) {
          shouldCache = true;
          shouldInjectDetail = true;
          mutation.addedNodes.forEach((node) => handleMenuMutation(node));
        }
      }
      if (mutation.type === 'attributes') {
        const t = mutation.target;
        if (t && t.getAttribute && t.getAttribute('role') === 'menu' && t.getAttribute('data-state') === 'open') {
          injectPortsForMenuElement(t);
        }
        if (t && t.matches && (t.matches('span[data-cy="circle-icon"]') || t.matches('.bg-green-400, .bg-nb-gray-500'))) {
          shouldCache = true;
        }
      }
    });
    
    if (shouldCache && isPeersPage()) {
      // Small delay to ensure DOM is fully updated
      setTimeout(cachePeerData, 100);
    }
    
    if (shouldInjectDetail && isPeerDetailPage()) {
      setTimeout(injectPeerDetailButton, 100);
    }
  });
  
  // Start observing the document body for changes
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-cy-status', 'class']
  });
  
  // Initial actions based on current page
  if (isPeersPage()) {
    setTimeout(cachePeerData, 1000);
  } else if (isPeerDetailPage()) {
    setTimeout(injectPeerDetailButton, 1000);
  }
}

// Wait for the page to load before injecting buttons
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', observeDashboard);
} else {
  observeDashboard();
}

// Also run periodically in case the dashboard updates in a way that bypasses MutationObserver
if (!__netdeskIntervalSetup) {
  setInterval(cachePeerData, 5000);
  __netdeskIntervalSetup = true;
}
