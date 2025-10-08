// Options script for NetDesk Chrome Extension

const DEFAULT_SERVICE_PORTS = [80, 443, 8080, 3000];

function normalizePortList(raw) {
  const tokens = (raw || '').split(/[\n,]+/);
  const seen = new Set();
  const ports = [];

  for (const token of tokens) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    if (!/^\d+$/.test(trimmed)) {
      return { ok: false, error: `Port invalide "${trimmed}". Utilise uniquement des nombres entiers.` };
    }
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      return { ok: false, error: `Port hors plage : ${trimmed}. Choisis un nombre entre 1 et 65535.` };
    }
    if (!seen.has(n)) {
      seen.add(n);
      ports.push(n);
    }
  }

  if (ports.length === 0) {
    return { ok: true, ports: DEFAULT_SERVICE_PORTS.slice(), usedDefault: true };
  }

  return { ok: true, ports };
}

function formatPortList(ports) {
  const list = Array.isArray(ports) && ports.length > 0 ? ports : DEFAULT_SERVICE_PORTS;
  return list.join('\n');
}

// Load saved settings when the page loads
document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.sync.get(['customUrl', 'buttonStyle', 'rustdeskPort', 'servicePorts', 'rustdeskEnabled'], (result) => {
    if (result.customUrl) {
      document.getElementById('custom-url').value = result.customUrl;
    }

    // RustDesk enabled by default
    document.getElementById('rustdesk-enabled').checked = result.rustdeskEnabled !== false;

    document.getElementById('button-style').value = result.buttonStyle || 'icon';

    if (typeof result.rustdeskPort !== 'undefined' && result.rustdeskPort !== null && result.rustdeskPort !== '') {
      document.getElementById('rustdesk-port').value = result.rustdeskPort;
    } else {
      document.getElementById('rustdesk-port').value = '';
    }

    document.getElementById('service-ports').value = formatPortList(result.servicePorts);
  });
});

// Save settings when the save button is clicked
document.getElementById('save-btn').addEventListener('click', () => {
  const customUrl = document.getElementById('custom-url').value;
  const rustdeskEnabled = document.getElementById('rustdesk-enabled').checked;
  const buttonStyle = document.getElementById('button-style').value;
  const portRaw = document.getElementById('rustdesk-port').value.trim();
  let rustdeskPort = undefined;
  if (portRaw !== '') {
    const n = Number(portRaw);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      showStatusMessage('Invalid port. Enter a value between 1 and 65535, or leave blank for default.', 'error');
      return;
    }
    rustdeskPort = n;
  }

  const parsedPorts = normalizePortList(document.getElementById('service-ports').value);
  if (!parsedPorts.ok) {
    showStatusMessage(parsedPorts.error, 'error');
    return;
  }

  chrome.storage.sync.set({
    customUrl: customUrl,
    rustdeskEnabled: rustdeskEnabled,
    buttonStyle: buttonStyle,
    rustdeskPort: rustdeskPort,
    servicePorts: parsedPorts.ports
  }, () => {
    showStatusMessage('Settings saved successfully!', 'success');

    setTimeout(() => {
      document.getElementById('status-message').textContent = '';
      document.getElementById('status-message').className = 'status';
    }, 3000);
  });
});

// Reset to defaults when the reset button is clicked
document.getElementById('reset-btn').addEventListener('click', () => {
  document.getElementById('custom-url').value = '';
  document.getElementById('rustdesk-enabled').checked = true;
  document.getElementById('button-style').value = 'icon';
  document.getElementById('rustdesk-port').value = '';
  document.getElementById('service-ports').value = formatPortList(DEFAULT_SERVICE_PORTS);

  chrome.storage.sync.remove(['customUrl', 'rustdeskEnabled', 'buttonStyle', 'rustdeskPort', 'servicePorts'], () => {
    showStatusMessage('Settings reset to defaults!', 'success');

    setTimeout(() => {
      document.getElementById('status-message').textContent = '';
      document.getElementById('status-message').className = 'status';
    }, 3000);
  });
});

function showStatusMessage(message, type) {
  const statusElement = document.getElementById('status-message');
  statusElement.textContent = message;
  statusElement.className = 'status ' + type;
}

document.getElementById('custom-url').addEventListener('input', (e) => {
  const url = e.target.value;
  if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
    e.target.value = 'https://' + url;
  }
});

document.getElementById('rustdesk-port').addEventListener('input', (e) => {
  const val = e.target.value;
  if (val === '') return;
  const digits = val.replace(/\D+/g, '');
  e.target.value = digits;
});
