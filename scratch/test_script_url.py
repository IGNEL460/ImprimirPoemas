import urllib.request
import json

url = "https://script.google.com/macros/s/AKfycbyJ-8rR04jdk57eU5fjhr7lp5qTq-GKhO2AYP2esn0lmWjhF8ibXrQRRM6fPUPV9jre7g/exec"

payload_auditoria = {
    "sheetTab": "Auditoria",
    "row": [
        "11/08/2026 21:30:00",
        "TEST_CASH_001",
        "Evento Prueba",
        "$500.00",
        "Esto papeludo",
        "Goyo.art3",
        "Autor Vivo / Reservado",
        "$0.00",
        "$25.00",
        "$20.00",
        "$455.00",
        "$273.00"
    ]
}

payload_autores_vivos = {
    "sheetTab": "Autores_Vivos",
    "row": [
        "11/08/2026 21:30:00",
        "TEST_CASH_001",
        "Evento Prueba",
        "Goyo.art3",
        "Esto papeludo",
        "goyo.txt",
        "$500.00",
        "$455.00",
        "$273.00",
        "Autor Vivo / Reservado"
    ]
}

for payload, tab_name in [(payload_auditoria, "Auditoria"), (payload_autores_vivos, "Autores_Vivos")]:
    print(f"Enviando prueba a pestaña '{tab_name}'...")
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers={'Content-Type': 'text/plain;charset=utf-8'})
    try:
        with urllib.request.urlopen(req) as response:
            res_text = response.read().decode('utf-8')
            print(f"Respuesta de Google Apps Script ({tab_name}):", res_text)
    except Exception as e:
        print(f"Error ({tab_name}):", e)
