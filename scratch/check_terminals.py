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
print("=== DIAGNÓSTICO DE CREDENCIALES MERCADO PAGO ===")
print("Token cargado:", bool(token))

if token:
    print("Token (primeros 12 caracteres):", token[:12] + "...")
    if not token.startswith("APP_USR-") and not token.startswith("TEST-"):
        print("\n[ADVERTENCIA CRITICA]")
        print(f"El MP_ACCESS_TOKEN actual ('{token}') NO parece ser un Access Token de Mercado Pago Developers.")
        print("Los Access Tokens deben comenzar con 'APP_USR-' (Produccion) o 'TEST-' (Pruebas).")
        print("Parece que se ha ingresado un Numero de Serie de terminal en lugar del Access Token.\n")
    else:
        print("[OK] Formato de Access Token valido (comienza con APP_USR- o TEST-).")

if not token:
    print("[ERROR] No se encontro MP_ACCESS_TOKEN en .env")
    exit(0)

endpoints = [
    'https://api.mercadopago.com/pos',
    'https://api.mercadopago.com/point/integration-api/devices',
    'https://api.mercadopago.com/terminals/v1/list',
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

