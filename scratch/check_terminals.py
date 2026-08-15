import os
import urllib.request
import urllib.error
import json

env_vars = {}
env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
if os.path.exists(env_path):
    with open(env_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, val = line.split('=', 1)
                env_vars[key.strip()] = val.strip()

token = env_vars.get('MP_ACCESS_TOKEN', '')
print("Token loaded:", bool(token))

if not token:
    print("No MP_ACCESS_TOKEN found in .env")
    exit(0)

endpoints = [
    'https://api.mercadopago.com/pos',
    'https://api.mercadopago.com/point/integration-api/devices',
    'https://api.mercadopago.com/terminals/v1/devices'
]

for ep in endpoints:
    print(f"\n--- GET {ep} ---")
    req = urllib.request.Request(ep, headers={'Authorization': f'Bearer {token}'})
    try:
        with urllib.request.urlopen(req) as response:
            res_body = response.read().decode('utf-8')
            print(f"Status: {response.status}")
            print("Response:", res_body[:1000])
    except urllib.error.HTTPError as e:
        print(f"HTTPError: {e.code}")
        print("Error Body:", e.read().decode('utf-8')[:1000])
    except Exception as e:
        print("Error:", e)
