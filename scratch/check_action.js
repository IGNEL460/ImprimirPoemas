import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config({ path: '../.env' });

const accessToken = process.env.MP_ACCESS_TOKEN;
const actionId = process.argv[2] || 'de001ab1-b7aa-45ba-916a-3e5d84b66777';

if (!accessToken) {
  console.error('Missing MP_ACCESS_TOKEN in .env');
  process.exit(1);
}

async function run() {
  console.log(`Checking status of action ${actionId}...`);
  try {
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
