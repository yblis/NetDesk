// Options script for NetDesk Chrome Extension

// Load saved settings when the page loads
document.addEventListener('DOMContentLoaded', () => {
  // Load saved settings
  chrome.storage.sync.get(['customUrl', 'buttonStyle', 'rustdeskPort'], (result) => {
    if (result.customUrl) {
      document.getElementById('custom-url').value = result.customUrl;
    }
    
    if (result.buttonStyle) {
      document.getElementById('button-style').value = result.buttonStyle;
    }

    if (typeof result.rustdeskPort !== 'undefined' && result.rustdeskPort !== null && result.rustdeskPort !== '') {
      document.getElementById('rustdesk-port').value = result.rustdeskPort;
    } else {
      document.getElementById('rustdesk-port').value = '';
    }
  });
});

// Save settings when the save button is clicked
document.getElementById('save-btn').addEventListener('click', () => {
  const customUrl = document.getElementById('custom-url').value;
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
  
  // Save settings
  chrome.storage.sync.set({
    customUrl: customUrl,
    buttonStyle: buttonStyle,
    rustdeskPort: rustdeskPort
  }, () => {
    // Show success message
    showStatusMessage('Settings saved successfully!', 'success');
    
    // Clear message after 3 seconds
    setTimeout(() => {
      document.getElementById('status-message').textContent = '';
      document.getElementById('status-message').className = 'status';
    }, 3000);
  });
});

// Reset to defaults when the reset button is clicked
document.getElementById('reset-btn').addEventListener('click', () => {
  // Reset form fields
  document.getElementById('custom-url').value = '';
  document.getElementById('button-style').value = 'default';
  document.getElementById('rustdesk-port').value = '';
  
  // Remove saved settings
  chrome.storage.sync.remove(['customUrl', 'buttonStyle', 'rustdeskPort'], () => {
    showStatusMessage('Settings reset to defaults!', 'success');
    
    // Clear message after 3 seconds
    setTimeout(() => {
      document.getElementById('status-message').textContent = '';
      document.getElementById('status-message').className = 'status';
    }, 3000);
  });
});

// Function to show status messages
function showStatusMessage(message, type) {
  const statusElement = document.getElementById('status-message');
  statusElement.textContent = message;
  statusElement.className = 'status ' + type;
}

// Validate URL input
document.getElementById('custom-url').addEventListener('input', (e) => {
  const url = e.target.value;
  if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
    e.target.value = 'https://' + url;
  }
});

// Ensure only numeric input in port field
document.getElementById('rustdesk-port').addEventListener('input', (e) => {
  const val = e.target.value;
  if (val === '') return; // allow empty
  // strip non-digits
  const digits = val.replace(/\D+/g, '');
  e.target.value = digits;
});
