import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const token = process.env.MP_ACCESS_TOKEN;

console.log('=== DIAGNÓSTICO DE CREDENCIALES MERCADO PAGO ===');
console.log('Token presente:', !!token);

if (token) {
  console.log('Token (primeros 12 caracteres):', token.substring(0, 12) + '...');
  if (!token.startsWith('APP_USR-') && !token.startsWith('TEST-')) {
    console.warn('\n⚠️ ADVERTENCIA CRÍTICA:');
    console.warn(`El MP_ACCESS_TOKEN actual ("${token}") NO parece ser un Access Token de Mercado Pago Developers.`);
    console.warn('Los Access Tokens deben comenzar con "APP_USR-" (Producción) o "TEST-" (Pruebas).');
    console.warn('Parece que se ha ingresado un Número de Serie de terminal en lugar del Access Token.\n');
  } else {
    console.log('✅ Formato de Access Token válido (comienza con APP_USR- o TEST-).');
  }
}

async function checkDevices() {
  if (!token) {
    console.log('❌ No hay MP_ACCESS_TOKEN en el archivo .env');
    return;
  }

  const headers = { Authorization: `Bearer ${token}` };

  const endpoints = [
    'https://api.mercadopago.com/pos',
    'https://api.mercadopago.com/point/integration-api/devices',
    'https://api.mercadopago.com/terminals/v1/list',
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

