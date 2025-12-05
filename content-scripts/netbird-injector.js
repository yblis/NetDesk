// Content script to inject RustDesk buttons into NetBird dashboard
// This script runs on the NetBird dashboard page

var osType = 'unknown';
var buttonStyle = 'icon';
var rustdeskEnabled = true;
const DEFAULT_SERVICE_PORTS = [80, 443, 8080, 3000];
var servicePorts = DEFAULT_SERVICE_PORTS.slice();

console.log('NetDesk content script loaded');

// Get the OS type from the background script
chrome.runtime.sendMessage({ action: "getOS" }, (response) => {
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

  // Add RustDesk icon (SVG)
  const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  iconSvg.setAttribute('width', '16');
  iconSvg.setAttribute('height', '16');
  iconSvg.setAttribute('viewBox', '0 0 24 24');
  iconSvg.setAttribute('fill', 'none');
  iconSvg.setAttribute('stroke', 'currentColor');
  iconSvg.setAttribute('stroke-width', '2');
  iconSvg.setAttribute('stroke-linecap', 'round');
  iconSvg.setAttribute('stroke-linejoin', 'round');
  iconSvg.innerHTML = '<rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line>';
  leftSide.appendChild(iconSvg);

  const labelSpan = document.createElement('span');
  labelSpan.textContent = 'Remote Desktop (RustDesk)';
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

// Create Terminal menu item for dropdown
function createTerminalMenuItem(peerInfo) {
  const menuItem = document.createElement('div');
  menuItem.setAttribute('role', 'menuitem');
  menuItem.setAttribute('tabindex', '-1');
  menuItem.className = 'relative flex select-none items-center rounded-md pr-2 pl-3 py-1.5 text-sm outline-none transition-colors hover:bg-gray-100 hover:text-gray-900 focus:bg-gray-100 focus:text-gray-900 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 cursor-pointer dark:hover:bg-nb-gray-900 dark:hover:text-gray-50 dark:focus:bg-nb-gray-900 dark:focus:text-gray-50 netdesk-terminal-item';
  const inner = document.createElement('div');
  inner.className = 'flex gap-3 items-center w-full justify-between';

  const leftSide = document.createElement('div');
  leftSide.className = 'flex items-center gap-2';

  // Terminal SVG icon
  const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  iconSvg.setAttribute('width', '16');
  iconSvg.setAttribute('height', '16');
  iconSvg.setAttribute('viewBox', '0 0 24 24');
  iconSvg.setAttribute('fill', 'none');
  iconSvg.setAttribute('stroke', 'currentColor');
  iconSvg.setAttribute('stroke-width', '2');
  iconSvg.setAttribute('stroke-linecap', 'round');
  iconSvg.setAttribute('stroke-linejoin', 'round');
  iconSvg.innerHTML = '<polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line>';
  leftSide.appendChild(iconSvg);

  const labelSpan = document.createElement('span');
  labelSpan.textContent = 'Terminal (RustDesk)';
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
      alert('Adresse introuvable. Impossible de lancer le terminal.');
      return;
    }
    chrome.runtime.sendMessage({
      action: "launchRustDeskTerminal",
      peerIp: finalPeerIp,
      peerHost: finalPeerHost
    }, (response) => {
      if (response && !response.success) {
        alert(`Échec du lancement du terminal: ${response.error}`);
      }
    });
  });
  return menuItem;
}

// Create File Transfer menu item for dropdown
function createFileTransferMenuItem(peerInfo) {
  const menuItem = document.createElement('div');
  menuItem.setAttribute('role', 'menuitem');
  menuItem.setAttribute('tabindex', '-1');
  menuItem.className = 'relative flex select-none items-center rounded-md pr-2 pl-3 py-1.5 text-sm outline-none transition-colors hover:bg-gray-100 hover:text-gray-900 focus:bg-gray-100 focus:text-gray-900 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 cursor-pointer dark:hover:bg-nb-gray-900 dark:hover:text-gray-50 dark:focus:bg-nb-gray-900 dark:focus:text-gray-50 netdesk-filetransfer-item';
  const inner = document.createElement('div');
  inner.className = 'flex gap-3 items-center w-full justify-between';

  const leftSide = document.createElement('div');
  leftSide.className = 'flex items-center gap-2';

  // File Transfer SVG icon
  const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  iconSvg.setAttribute('width', '16');
  iconSvg.setAttribute('height', '16');
  iconSvg.setAttribute('viewBox', '0 0 24 24');
  iconSvg.setAttribute('fill', 'none');
  iconSvg.setAttribute('stroke', 'currentColor');
  iconSvg.setAttribute('stroke-width', '2');
  iconSvg.setAttribute('stroke-linecap', 'round');
  iconSvg.setAttribute('stroke-linejoin', 'round');
  iconSvg.innerHTML = '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><line x1="12" y1="11" x2="12" y2="17"></line><polyline points="9 14 12 11 15 14"></polyline>';
  leftSide.appendChild(iconSvg);

  const labelSpan = document.createElement('span');
  labelSpan.textContent = 'Transfert (RustDesk)';
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
      alert('Adresse introuvable. Impossible de lancer le transfert.');
      return;
    }
    chrome.runtime.sendMessage({
      action: "launchRustDeskFileTransfer",
      peerIp: finalPeerIp,
      peerHost: finalPeerHost
    }, (response) => {
      if (response && !response.success) {
        alert(`Échec du lancement du transfert: ${response.error}`);
      }
    });
  });
  return menuItem;
}

function injectPortLinks(menuEl, peerInfo) {
  if (!menuEl || menuEl.dataset.netdeskPortsInjected === '1') return;
  if (!peerInfo || !peerInfo.row) return;
  const targetExists = (peerInfo.peerHost && peerInfo.peerHost.trim()) || (peerInfo.peerIp && peerInfo.peerIp.trim());
  if (!targetExists) return;

  const fragment = document.createDocumentFragment();

  // Add RustDesk menu items (only for active peers and if enabled)
  if (rustdeskEnabled && isPeerActive(peerInfo.row)) {
    const rustdeskItem = createRustDeskMenuItem(peerInfo);
    fragment.appendChild(rustdeskItem);

    // Add Terminal menu item
    const terminalItem = createTerminalMenuItem(peerInfo);
    fragment.appendChild(terminalItem);

    // Add File Transfer menu item
    const fileTransferItem = createFileTransferMenuItem(peerInfo);
    fragment.appendChild(fileTransferItem);
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
          history[method] = function (...args) {
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
  let foundHost = '';
  let foundIp = '';

  // Try detected ADDRESS column first
  if (addressColIndex < 0) addressColIndex = detectAddressColumnIndex();
  if (addressColIndex >= 0 && cells[addressColIndex]) {
    const res = parseCell(cells[addressColIndex]);
    if (res.host) foundHost = res.host;
    if (res.ip) foundIp = res.ip;
  }

  // If we didn't find IP, scan all cells
  if (!foundIp) {
    for (const cell of cells) {
      const res = parseCell(cell);
      if (!foundHost && res.host) foundHost = res.host;
      if (!foundIp && res.ip) foundIp = res.ip;
      if (foundHost && foundIp) break;
    }
  }

  // Last resort: extract IP from entire row text (use innerText as it seems more reliable here)
  if (!foundIp) {
    const rowText = (row.innerText || row.textContent || '').trim();
    const ipMatch = rowText.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/);
    if (ipMatch) {
      foundIp = ipMatch[0];
    }
  }

  return { host: foundHost, ip: foundIp };
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

  // Add RustDesk icon (SVG)
  const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  iconSvg.setAttribute('width', '16');
  iconSvg.setAttribute('height', '16');
  iconSvg.setAttribute('viewBox', '0 0 24 24');
  iconSvg.setAttribute('fill', 'none');
  iconSvg.setAttribute('stroke', 'currentColor');
  iconSvg.setAttribute('stroke-width', '2');
  iconSvg.setAttribute('stroke-linecap', 'round');
  iconSvg.setAttribute('stroke-linejoin', 'round');
  iconSvg.innerHTML = '<rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line>';
  button.appendChild(iconSvg);

  // Add label
  const label = document.createTextNode('Remote Desktop');
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

// Function to create Terminal button for peer detail page
function createPeerDetailTerminalButton(peerHost, peerIp) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'relative text-sm focus:z-10 focus:ring-2 font-medium focus:outline-none whitespace-nowrap shadow-sm inline-flex gap-2 items-center justify-center transition-colors focus:ring-offset-1 disabled:opacity-40 disabled:cursor-not-allowed disabled:dark:text-nb-gray-300 dark:ring-offset-neutral-950/50 bg-white hover:text-black focus:ring-zinc-200/50 hover:bg-gray-100 border-gray-200 text-gray-900 dark:ring-offset-neutral-950/50 dark:focus:ring-neutral-500/20 dark:bg-nb-gray-920 dark:text-gray-400 dark:border-gray-700/40 dark:hover:text-white dark:hover:bg-zinc-800/50 text-sm py-2.5 px-4 rounded-md border border-transparent netdesk-peer-detail-terminal-btn';

  // Terminal SVG icon
  const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  iconSvg.setAttribute('width', '16');
  iconSvg.setAttribute('height', '16');
  iconSvg.setAttribute('viewBox', '0 0 24 24');
  iconSvg.setAttribute('fill', 'none');
  iconSvg.setAttribute('stroke', 'currentColor');
  iconSvg.setAttribute('stroke-width', '2');
  iconSvg.setAttribute('stroke-linecap', 'round');
  iconSvg.setAttribute('stroke-linejoin', 'round');
  iconSvg.innerHTML = '<polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line>';
  button.appendChild(iconSvg);

  // Add label
  const label = document.createTextNode('Terminal');
  button.appendChild(label);

  button.addEventListener('click', () => {
    if (!peerHost && !peerIp) {
      console.warn('No ADDRESS found for peer; aborting Terminal launch');
      alert('Adresse introuvable. Impossible de lancer le terminal.');
      return;
    }
    chrome.runtime.sendMessage({
      action: "launchRustDeskTerminal",
      peerIp: peerIp || '',
      peerHost: peerHost || ''
    }, (response) => {
      if (response && !response.success) {
        console.error("Failed to launch Terminal:", response.error);
        alert(`Échec du lancement du terminal: ${response.error}`);
      }
    });
  });

  return button;
}

// Function to create File Transfer button for peer detail page
function createPeerDetailFileTransferButton(peerHost, peerIp) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'relative text-sm focus:z-10 focus:ring-2 font-medium focus:outline-none whitespace-nowrap shadow-sm inline-flex gap-2 items-center justify-center transition-colors focus:ring-offset-1 disabled:opacity-40 disabled:cursor-not-allowed disabled:dark:text-nb-gray-300 dark:ring-offset-neutral-950/50 bg-white hover:text-black focus:ring-zinc-200/50 hover:bg-gray-100 border-gray-200 text-gray-900 dark:ring-offset-neutral-950/50 dark:focus:ring-neutral-500/20 dark:bg-nb-gray-920 dark:text-gray-400 dark:border-gray-700/40 dark:hover:text-white dark:hover:bg-zinc-800/50 text-sm py-2.5 px-4 rounded-md border border-transparent netdesk-peer-detail-filetransfer-btn';

  // File Transfer SVG icon (folder with arrow)
  const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  iconSvg.setAttribute('width', '16');
  iconSvg.setAttribute('height', '16');
  iconSvg.setAttribute('viewBox', '0 0 24 24');
  iconSvg.setAttribute('fill', 'none');
  iconSvg.setAttribute('stroke', 'currentColor');
  iconSvg.setAttribute('stroke-width', '2');
  iconSvg.setAttribute('stroke-linecap', 'round');
  iconSvg.setAttribute('stroke-linejoin', 'round');
  iconSvg.innerHTML = '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><line x1="12" y1="11" x2="12" y2="17"></line><polyline points="9 14 12 11 15 14"></polyline>';
  button.appendChild(iconSvg);

  // Add label
  const label = document.createTextNode('Transfert');
  button.appendChild(label);

  button.addEventListener('click', () => {
    if (!peerHost && !peerIp) {
      console.warn('No ADDRESS found for peer; aborting File Transfer launch');
      alert('Adresse introuvable. Impossible de lancer le transfert de fichiers.');
      return;
    }
    chrome.runtime.sendMessage({
      action: "launchRustDeskFileTransfer",
      peerIp: peerIp || '',
      peerHost: peerHost || ''
    }, (response) => {
      if (response && !response.success) {
        console.error("Failed to launch File Transfer:", response.error);
        alert(`Échec du lancement du transfert: ${response.error}`);
      }
    });
  });

  return button;
}

// Function to inject RustDesk buttons on peer detail page
function injectPeerDetailButton() {
  console.log('Attempting to inject RustDesk buttons on peer detail page');

  if (!isPeerDetailPage()) {
    console.log('Not on peer detail page');
    return;
  }

  // Check if RustDesk is enabled
  if (!rustdeskEnabled) {
    console.log('RustDesk is disabled in settings');
    return;
  }

  // Check if buttons already exist
  if (document.querySelector('.netdesk-peer-detail-btn')) {
    console.log('RustDesk buttons already exist on peer detail page');
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
  // Try to find address information from the info list
  // Look for "NetBird IP Address" and "Domain Name" sections
  // We scan all LI elements to be robust against layout changes
  const listItems = Array.from(document.querySelectorAll('li'));

  for (const item of listItems) {
    const itemText = (item.innerText || item.textContent || '').trim();
    if (!itemText) continue;

    // Normalize text for checking labels
    const lowerText = itemText.toLowerCase();

    // Check for NetBird IP Address
    // We look for the label, then try to extract an IP from the same row's text
    if (lowerText.includes('netbird ip') || lowerText.includes('ip address')) {
      const ipMatch = itemText.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/);
      if (ipMatch) {
        peerIp = ipMatch[0];
        console.log('Found NetBird IP (robust scan):', peerIp);
      }
    }

    // Check for Domain Name / Hostname
    if (lowerText.includes('domain name') || (lowerText.includes('hostname') && !lowerText.includes('system'))) {
      // First try: look for a distinct value element (often 'truncate' or just the last div)
      const possibleValues = Array.from(item.querySelectorAll('div, span, p'));
      let foundValue = '';

      // Reverse iterate to find the last contentful element that isn't the label
      for (let i = possibleValues.length - 1; i >= 0; i--) {
        const t = (possibleValues[i].textContent || '').trim();
        if (t && !t.toLowerCase().includes('domain name') && !t.toLowerCase().includes('hostname')) {
          foundValue = t;
          break;
        }
      }

      // Fallback: if no distinct element found, try to strip the label from the full text
      if (!foundValue) {
        foundValue = itemText.replace(/domain name|hostname/gi, '').replace(/[:]/g, '').trim();
      }

      // Sanity check the found value
      if (foundValue && foundValue.length > 1) {
        peerHost = foundValue;
        console.log('Found Domain/Host (robust scan):', peerHost);
      }
    }
  }

  console.log('Peer detail info:', { peerName, peerHost, peerIp });

  // Create wrapper for all RustDesk buttons
  const wrapper = document.createElement('div');
  const innerWrapper = document.createElement('div');
  innerWrapper.className = 'inline-flex gap-2 w-full';

  // Create and add the main RustDesk button
  const rustdeskButton = createPeerDetailRustDeskButton(peerHost, peerIp, peerName);
  innerWrapper.appendChild(rustdeskButton);

  // Create and add Terminal button
  const terminalButton = createPeerDetailTerminalButton(peerHost, peerIp);
  innerWrapper.appendChild(terminalButton);

  // Create and add File Transfer button
  const fileTransferButton = createPeerDetailFileTransferButton(peerHost, peerIp);
  innerWrapper.appendChild(fileTransferButton);

  wrapper.appendChild(innerWrapper);

  // Find the 'Remote Access' card to insert after
  // Strategy: Traverse up from the button container until we find the element 
  // whose next sibling is the "Assigned Groups" card (or just the card below it).
  let remoteAccessCard = null;

  if (buttonContainer) {
    let current = buttonContainer.parentElement;
    // Safety limit for traversal
    for (let i = 0; i < 15; i++) {
      if (!current || current === document.body) break;

      // Check siblings to see if we are at the "Card" level
      const nextSib = current.nextElementSibling;

      const nextText = nextSib ? (nextSib.innerText || '').toLowerCase() : '';

      // "Assigned Groups" is typically the card immediately following "Remote Access"
      if (nextText.includes('assigned groups')) {
        remoteAccessCard = current;
        console.log('Found Remote Access card by "Assigned Groups" sibling check');
        break;
      }

      // Also check if valid card classes are present just in case "Assigned Groups" isn't there
      // But we rely mainly on structure
      current = current.parentElement;
    }

    // Secondary check: if we didn't find "Assigned Groups" (maybe last item?), 
    // check if we are below "SSH Access"
    if (!remoteAccessCard) {
      current = buttonContainer.parentElement;
      for (let i = 0; i < 15; i++) {
        if (!current || current === document.body) break;
        const prevSib = current.previousElementSibling;
        const prevText = prevSib ? (prevSib.innerText || '').toLowerCase() : '';

        // "SSH Access" or "Session Expiration" are usually above
        if (prevText.includes('ssh access') || prevText.includes('session expiration')) {
          remoteAccessCard = current;
          console.log('Found Remote Access card by "SSH Access" sibling check');
          break;
        }
        current = current.parentElement;
      }
    }
  }

  if (remoteAccessCard) {
    console.log('Cloning Remote Access card for RustDesk section');

    // Clone the card to preserve exact styling (border, radius, shadow, bg)
    const rustDeskCard = remoteAccessCard.cloneNode(true);
    rustDeskCard.removeAttribute('id');
    rustDeskCard.className += ' netdesk-rustdesk-section mt-2'; // Reduced margin

    // --- CONTENT UPDATE START ---

    // 1. Update Title "Remote Access" -> "RustDesk"
    // We look for the element containing "Remote Access" and replace it.
    let titleReplaced = false;
    const cardAllElements = rustDeskCard.querySelectorAll('*');
    for (const el of cardAllElements) {
      // Check direct text node content if possible, or just innerText matches strictly
      // We avoid replacing the container's text if it has children
      if (el.children.length === 0 && (el.textContent === 'Remote Access' || el.textContent === 'Remote Access ')) {
        el.textContent = 'RustDesk';
        titleReplaced = true;
        break;
      }
    }
    // Fallback: TreeWalker
    if (!titleReplaced) {
      const walker = document.createTreeWalker(rustDeskCard, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        if (walker.currentNode.nodeValue.trim() === 'Remote Access') {
          walker.currentNode.nodeValue = 'RustDesk';
          break;
        }
      }
    }

    // 2. Update Description
    // Look for text describing SSH/RDP and replace with generic RustDesk text
    const descWalker = document.createTreeWalker(rustDeskCard, NodeFilter.SHOW_TEXT);
    while (descWalker.nextNode()) {
      const val = descWalker.currentNode.nodeValue;
      if (val.includes('SSH') || val.includes('RDP')) {
        descWalker.currentNode.nodeValue = 'Connect directly to this peer via RustDesk';
        // Typically only one such text exists
        break;
      }
    }

    // 3. Clear existing buttons in the clone and insert ours
    // We need to find the specific container where buttons were. 
    // It should be the parent of the cloned buttons.
    const clonedButtons = rustDeskCard.querySelectorAll('button');
    if (clonedButtons.length > 0) {
      const btnParent = clonedButtons[0].parentElement;
      btnParent.innerHTML = ''; // Start clean
      btnParent.appendChild(wrapper); // Insert our RustDesk buttons wrapper
    } else {
      // If no buttons found in clone (unexpected), just append to main card
      rustDeskCard.appendChild(wrapper);
    }

    // --- CONTENT UPDATE END ---

    // Insert the new card AFTER the Remote Access card
    remoteAccessCard.parentNode.insertBefore(rustDeskCard, remoteAccessCard.nextSibling);

  } else {
    console.warn('Could not find Remote Access card via sibling check. Using fallback injection.');
    // Fallback: Create a simple container and append to the buttonContainer's parent's parent (Hoping to be outside the row)
    // Or just inline if all else fails.

    // Let's try to be a bit smarter than just inline.
    // If we can't find the card, we might be inside it. 
    // Let's try to append to the end of the `buttonContainer`'s parent (the card content wrapper)
    // This usually puts it below the buttons but inside the card.
    if (buttonContainer && buttonContainer.parentElement) {
      const container = document.createElement('div');
      container.className = 'mt-4 pt-4 border-t border-gray-100 dark:border-gray-700'; // Add separator

      const title = document.createElement('h3');
      title.className = 'text-sm font-medium text-gray-900 dark:text-gray-200 mb-1';
      title.textContent = 'RustDesk';
      container.appendChild(title);

      const desc = document.createElement('p');
      desc.className = 'text-sm text-gray-500 dark:text-gray-400 mb-4';
      desc.textContent = 'Connect directly to this peer via RustDesk';
      container.appendChild(desc);

      container.appendChild(wrapper);

      buttonContainer.parentElement.appendChild(container);
    } else {
      buttonContainer.appendChild(wrapper);
    }
  }

  console.log('RustDesk buttons injected on peer detail page');
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
