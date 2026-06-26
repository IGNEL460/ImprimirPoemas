import axios from 'axios';
import dotenv from 'dotenv';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config({ path: '../.env' });

const accessToken = process.env.MP_ACCESS_TOKEN;
const terminalId = process.env.MP_TERMINAL_ID;

if (!accessToken || !terminalId) {
  console.error('Missing MP_ACCESS_TOKEN or MP_TERMINAL_ID in .env');
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logoPath = path.join(__dirname, '../src/logo.jpg');

if (!fs.existsSync(logoPath)) {
  console.error('Logo file not found at:', logoPath);
  process.exit(1);
}

const logoBase64 = fs.readFileSync(logoPath, 'base64');
console.log('Logo image loaded. Base64 length:', logoBase64.length);

async function run() {
  const idempotencyKey = crypto.randomUUID();
  const payload = {
    type: 'print',
    external_reference: `logo_test_${Date.now()}`,
    config: {
      point: {
        terminal_id: terminalId,
        subtype: 'image'
      }
    },
    content: logoBase64
  };

  console.log('Sending POST to https://api.mercadopago.com/terminals/v1/actions for image printing...');
  
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
    console.log('Body (truncated content):', JSON.stringify({
      ...postResponse.data,
      content: postResponse.data.content ? '[TRUNCATED]' : undefined
    }, null, 2));

    const actionId = postResponse.data.id;
    if (actionId) {
      console.log(`\nPolling status of action ${actionId} in 5 seconds...`);
      await new Promise(resolve => setTimeout(resolve, 5000));

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
