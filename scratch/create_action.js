import axios from 'axios';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config({ path: '../.env' });

const accessToken = process.env.MP_ACCESS_TOKEN;
const terminalId = process.env.MP_TERMINAL_ID;

if (!accessToken || !terminalId) {
  console.error('Missing MP_ACCESS_TOKEN or MP_TERMINAL_ID in .env');
  process.exit(1);
}

// Simple test content that is at least 110 characters
const testContent = `{br}{center}{b}{w}✿ PRUEBA DE SOPORTE ✿{/w}{/b}{/center}{br}{br}` +
  `{center}Esta es una impresion de prueba{/center}{br}` +
  `{center}para verificar el estado{/center}{br}` +
  `{center}de la terminal en conexion 4G.{/center}{br}{br}` +
  `{center}* * * * *{/center}{br}{br}{br}`;

async function run() {
  const idempotencyKey = crypto.randomUUID();
  const payload = {
    type: 'print',
    external_reference: `support_test_${Date.now()}`,
    config: {
      point: {
        terminal_id: terminalId,
        subtype: 'custom'
      }
    },
    content: testContent
  };

  console.log('Sending POST to https://api.mercadopago.com/terminals/v1/actions...');
  console.log('Headers:', JSON.stringify({
    'Content-Type': 'application/json',
    'Authorization': `Bearer [REDACTED]`,
    'X-Idempotency-Key': idempotencyKey
  }, null, 2));
  console.log('Payload:', JSON.stringify(payload, null, 2));

  try {
    const postResponse = await axios.post(
      'https://api.mercadopago.com/terminals/v1/actions',
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'X-Idempotency-Key': idempotencyKey
        }
      }
    );

    console.log('\n=== POST RESPONSE ===');
    console.log('Status:', postResponse.status);
    console.log('Body:', JSON.stringify(postResponse.data, null, 2));

    const actionId = postResponse.data.id;
    if (actionId) {
      console.log(`\nPolling status of action ${actionId} in 3 seconds...`);
      await new Promise(resolve => setTimeout(resolve, 3000));

      const getResponse = await axios.get(
        `https://api.mercadopago.com/terminals/v1/actions/${actionId}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        }
      );

      console.log('\n=== GET RESPONSE ===');
      console.log('Status:', getResponse.status);
      console.log('Body:', JSON.stringify(getResponse.data, null, 2));
    }
  } catch (error) {
    if (error.response) {
      console.error('\n=== API ERROR ===');
      console.error('Status:', error.response.status);
      console.error('Body:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('\n=== ERROR ===', error.message);
    }
  }
}

run();
