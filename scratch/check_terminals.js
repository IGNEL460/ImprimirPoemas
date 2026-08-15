import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const token = process.env.MP_ACCESS_TOKEN;

console.log('Token presente:', !!token);
if (token) {
  console.log('Token prefix:', token.substring(0, 10) + '...');
}

async function checkDevices() {
  if (!token) {
    console.log('No hay MP_ACCESS_TOKEN en .env');
    return;
  }

  const headers = { Authorization: `Bearer ${token}` };

  // Try endpoints
  const endpoints = [
    'https://api.mercadopago.com/pos',
    'https://api.mercadopago.com/point/integration-api/devices',
    'https://api.mercadopago.com/terminals/v1/devices'
  ];

  for (const ep of endpoints) {
    try {
      console.log(`\nConsultando endpoint: ${ep}`);
      const res = await axios.get(ep, { headers });
      console.log(`STATUS: ${res.status}`);
      console.log('DATA:', JSON.stringify(res.data, null, 2));
    } catch (err) {
      console.log(`ERROR (${ep}):`, err.response ? `${err.response.status} - ${JSON.stringify(err.response.data)}` : err.message);
    }
  }
}

checkDevices();
