// Debug script to help troubleshoot NetDesk extension issues
// This script can be run in the browser console to test selectors

console.log('=== NetDesk Debug Script ===');

// Check if we're on a NetBird page
console.log('Current page:', window.location.href);
console.log('Page includes "netbird":', window.location.href.includes('netbird'));

// Try to find peer rows
console.log('\n--- Looking for peer rows ---');
const peerRows = document.querySelectorAll('tbody tr[data-row-id]');
console.log('Found peer rows with tbody selector:', peerRows.length);

const altRows = document.querySelectorAll('tr[data-row-id]');
console.log('Found peer rows with general selector:', altRows.length);

const groupRows = document.querySelectorAll('tr.group\\/table-row[data-row-id]');
console.log('Found peer rows with group selector:', groupRows.length);

// Try to find peer name cells
console.log('\n--- Looking for peer name cells ---');
const peerNameCells = document.querySelectorAll('[data-testid="peer-name-cell"]');
console.log('Found peer name cells:', peerNameCells.length);

// Try to find IP address cells
console.log('\n--- Looking for IP address cells ---');
const ipCells = document.querySelectorAll('td');
console.log('Total table cells found:', ipCells.length);

// Examine the structure of the first few rows
if (peerRows.length > 0) {
  console.log('\n--- Examining first peer row ---');
  const firstRow = peerRows[0];
  console.log('First row:', firstRow);
  console.log('First row attributes:', firstRow.attributes);
  
  // Look for the peer name cell in this row
  const nameCell = firstRow.querySelector('[data-testid="peer-name-cell"]');
  console.log('Name cell in first row:', nameCell);
  
  if (nameCell) {
    const truncateElement = nameCell.querySelector('.truncate');
    console.log('Truncate element:', truncateElement);
    if (truncateElement) {
      console.log('Peer name:', truncateElement.textContent);
    }
  }
  
  // Look for IP address in this row
  console.log('\n--- Looking for IP in first row ---');
  const cells = firstRow.querySelectorAll('td');
  console.log('Number of cells in first row:', cells.length);
  
  cells.forEach((cell, index) => {
    console.log(`Cell ${index}:`, cell);
    const fontMonoElement = cell.querySelector('.font-mono');
    if (fontMonoElement) {
      console.log(`Found font-mono element in cell ${index}:`, fontMonoElement.textContent.trim());
    }
  });
} else if (altRows.length > 0) {
  console.log('\n--- Examining first alternative row ---');
  const firstRow = altRows[0];
  console.log('First row:', firstRow);
  
  // Look for the peer name cell in this row
  const nameCell = firstRow.querySelector('[data-testid="peer-name-cell"]');
  console.log('Name cell in first row:', nameCell);
  
  if (nameCell) {
    const truncateElement = nameCell.querySelector('.truncate');
    console.log('Truncate element:', truncateElement);
    if (truncateElement) {
      console.log('Peer name:', truncateElement.textContent);
    }
  }
  
  // Look for IP address in this row
  console.log('\n--- Looking for IP in first row ---');
  const cells = firstRow.querySelectorAll('td');
  console.log('Number of cells in first row:', cells.length);
  
  cells.forEach((cell, index) => {
    console.log(`Cell ${index}:`, cell);
    const fontMonoElement = cell.querySelector('.font-mono');
    if (fontMonoElement) {
      console.log(`Found font-mono element in cell ${index}:`, fontMonoElement.textContent.trim());
    }
  });
}

// Try to find the actual structure from the example
console.log('\n--- Looking for specific NetBird structure ---');
const fontMediumElements = document.querySelectorAll('.font-medium .truncate');
console.log('Found font-medium truncate elements:', fontMediumElements.length);

if (fontMediumElements.length > 0) {
  fontMediumElements.forEach((el, index) => {
    console.log(`Element ${index}:`, el.textContent.trim());
  });
}

// Test the new IP extraction logic
console.log('\n--- Testing new IP extraction logic ---');
const testRows = document.querySelectorAll('tbody tr[data-row-id], tr[data-row-id]');
testRows.forEach((row, index) => {
  if (index < 3) { // Only test first 3 rows
    console.log(`\nRow ${index}:`);
    const ipCell = row.querySelector('td:nth-child(3)');
    if (ipCell) {
      console.log('IP cell found:', ipCell);
      const ipElement = ipCell.querySelector('.font-mono');
      if (ipElement) {
        console.log('IP element found:', ipElement.textContent.trim());
      } else {
        console.log('No font-mono element found in IP cell');
      }
    } else {
      console.log('No IP cell found (3rd column)');
    }
  }
});

console.log('\n=== Debug Script Complete ===');
