// Popup script for NetDesk Chrome Extension

// Get OS information from background script
chrome.runtime.sendMessage({action: "getOS"}, (response) => {
  if (response && response.os) {
    document.getElementById('os-info').textContent = response.os.charAt(0).toUpperCase() + response.os.slice(1);
  } else {
    document.getElementById('os-info').textContent = 'Unknown';
  }
});

// Add event listeners to buttons
document.getElementById('options-btn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById('help-btn').addEventListener('click', () => {
  // Open help documentation in a new tab
  chrome.tabs.create({url: 'https://github.com/yblis/NetDesk'});
});
