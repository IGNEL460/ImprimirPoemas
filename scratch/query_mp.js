import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config({ path: '../.env' });

const accessToken = process.env.MP_ACCESS_TOKEN;
const terminalId = process.env.MP_TERMINAL_ID;

console.log('Access Token:', accessToken);
console.log('Terminal ID:', terminalId);

if (!accessToken) {
  console.error('No Access Token found in .env');
  process.exit(1);
}

function logError(label, error) {
  if (error.response) {
    console.error(`[${label}] Error Status:`, error.response.status);
    console.error(`[${label}] Error Data:`, JSON.stringify(error.response.data, null, 2));
  } else {
    console.error(`[${label}] Error Message:`, error.message);
  }
}

async function getTerminalDetails() {
  try {
    console.log('\n--- Fetching Terminal List ---');
    const response = await axios.get('https://api.mercadopago.com/terminals/v1/list', {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    console.log('Terminal List Response:', JSON.stringify(response.data, null, 2));
  } catch (error) {
    logError('Terminal List', error);
  }
}

async function getActionById(id) {
  try {
    console.log(`\n--- Fetching Action ID ${id} ---`);
    const response = await axios.get(`https://api.mercadopago.com/terminals/v1/actions/${id}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    console.log(`Action ${id} Response:`, JSON.stringify(response.data, null, 2));
  } catch (error) {
    logError(`Action ${id}`, error);
  }
}

async function tryVariousActionsEndpoints() {
  const endpoints = [
    { method: 'GET', url: 'https://api.mercadopago.com/terminals/v1/actions' },
    { method: 'GET', url: 'https://api.mercadopago.com/terminals/v1/actions/search' },
    { method: 'GET', url: `https://api.mercadopago.com/terminals/v1/actions?terminal_id=${terminalId}` },
    { method: 'GET', url: `https://api.mercadopago.com/terminals/v1/actions/search?terminal_id=${terminalId}` }
  ];

  for (const ep of endpoints) {
    try {
      console.log(`\n--- Trying ${ep.method} ${ep.url} ---`);
      const response = await axios({
        method: ep.method,
        url: ep.url,
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });
      console.log(`Response from ${ep.url}:`, JSON.stringify(response.data, null, 2));
    } catch (error) {
      logError(ep.url, error);
    }
  }
}

await getTerminalDetails();
await tryVariousActionsEndpoints();

