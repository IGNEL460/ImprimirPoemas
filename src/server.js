import express from 'express';
import cors from 'cors';
import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { getRandomPoem } from './poems.js';

// Cargar variables de entorno
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cargar imagen de logo en Base64 para imprimir en terminales
let logoBase64 = '';
const logoPath = path.join(__dirname, 'logo.jpg');
try {
  if (fs.existsSync(logoPath)) {
    logoBase64 = fs.readFileSync(logoPath, 'base64');
    console.log('[Impresora] Imagen de logo cargada y convertida a Base64.');
  } else {
    console.warn('[Impresora] Advertencia: No se encontró la imagen de logo en:', logoPath);
  }
} catch (err) {
  console.error('[Impresora] Error al cargar la imagen de logo:', err);
}

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Función auxiliar para realizar ajuste de línea (Word Wrap) sin cortar palabras
function wrapText(text, limit = 30) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    if ((currentLine + (currentLine ? ' ' : '') + word).length <= limit) {
      currentLine += (currentLine ? ' ' : '') + word;
    } else {
      if (currentLine) {
        lines.push(currentLine);
      }
      currentLine = word;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  return lines;
}

// Formatear poema con las etiquetas nativas de impresión de Mercado Pago
function formatPoemForPoint(poem) {
  const originalLines = poem.split('\n');
  const formattedLines = [];

  for (const line of originalLines) {
    const trimmed = line.trim();
    if (trimmed === '') {
      formattedLines.push('{br}');
    } else {
      // Ajustar cada línea del poema a un máximo de 30 caracteres para evitar recortes en la ticketera
      const wrapped = wrapText(trimmed, 30);
      for (const wl of wrapped) {
        formattedLines.push(`{center}${wl}{/center}`);
      }
    }
  }

  let content = `{br}{center}{b}{w}✿ UN POEMA PARA TI ✿{/w}{/b}{/center}{br}{br}`;
  content += formattedLines.join('{br}');
  content += `{br}{br}{center}* * * * *{/center}{br}`;
  content += `{center}{s}Gracias por tu colaboración{/s}{/center}{br}`;
  content += `{center}{s}y por apoyar el arte.{/s}{/center}{br}`;
  content += `{center}{b}elpecado.ar{/b}{/center}{br}{br}{br}`;

  // La API requiere entre 100 y 4096 caracteres.
  // Si es muy corto, le agregamos saltos de línea al final para cumplir con el mínimo.
  while (content.length < 110) {
    content += '{br}';
  }

  return content;
}

// Enviar acción de impresión a la terminal de Mercado Pago (Texto personalizado)
async function printOnTerminal(text) {
  const accessToken = process.env.MP_ACCESS_TOKEN;
  const terminalId = process.env.MP_TERMINAL_ID;

  if (!accessToken || accessToken.includes('tu_access_token')) {
    throw new Error('Mercado Pago Access Token no configurado en el archivo .env');
  }
  if (!terminalId || terminalId.includes('tu_terminal_id')) {
    throw new Error('Mercado Pago Terminal ID no configurado en el archivo .env');
  }

  const formattedContent = formatPoemForPoint(text);
  const idempotencyKey = crypto.randomUUID();

  const payload = {
    type: 'print',
    external_reference: `poem_${Date.now()}`,
    config: {
      point: {
        terminal_id: terminalId,
        subtype: 'custom'
      }
    },
    content: formattedContent
  };

  console.log(`[Impresora] Enviando orden de impresión a la terminal: ${terminalId}...`);

  const response = await axios.post(
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

  return response.data;
}

// Enviar logotipo del Pecado a la terminal (Imagen Base64)
async function printImageOnTerminal() {
  if (!logoBase64) {
    console.warn('[Impresora] No hay imagen de logo disponible en Base64 para imprimir.');
    return null;
  }

  const accessToken = process.env.MP_ACCESS_TOKEN;
  const terminalId = process.env.MP_TERMINAL_ID;

  if (!accessToken || accessToken.includes('tu_access_token')) {
    throw new Error('Mercado Pago Access Token no configurado en el archivo .env');
  }
  if (!terminalId || terminalId.includes('tu_terminal_id')) {
    throw new Error('Mercado Pago Terminal ID no configurado en el archivo .env');
  }

  const idempotencyKey = crypto.randomUUID();

  const payload = {
    type: 'print',
    external_reference: `logo_${Date.now()}`,
    config: {
      point: {
        terminal_id: terminalId,
        subtype: 'image'
      }
    },
    content: logoBase64
  };

  console.log(`[Impresora] Enviando logotipo del Pecado a la terminal: ${terminalId}...`);

  const response = await axios.post(
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

  return response.data;
}

// Dashboard Web Premium
app.get('/', async (req, res) => {
  const accessToken = process.env.MP_ACCESS_TOKEN;
  const hasToken = accessToken && !accessToken.includes('tu_access_token');
  const hasTerminal = process.env.MP_TERMINAL_ID && !process.env.MP_TERMINAL_ID.includes('tu_terminal_id');

  let terminals = [];
  let terminalError = null;

  // Intentar cargar las terminales si hay token disponible
  if (hasToken) {
    try {
      const response = await axios.get('https://api.mercadopago.com/terminals/v1/list', {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });
      // La API oficial devuelve las terminales en data.terminals
      terminals = response.data.data?.terminals || response.data.results || [];
    } catch (err) {
      terminalError = err.response?.data?.message || err.message;
    }
  }

  // Generar HTML de las terminales de forma segura para evitar problemas de template literals anidados
  const terminalsHtml = terminals.map(term => {
    const isPdv = term.operating_mode === 'PDV';
    const statusColor = term.status === 'online' ? 'var(--success-color)' : 'var(--text-muted)';
    const statusLabel = (term.status || 'unknown').toUpperCase();
    const modeColor = isPdv ? 'var(--success-color)' : '#fbbf24';
    const modeLabel = term.operating_mode || 'STANDALONE';
    
    const actionButton = !isPdv ? 
      `<button class="btn btn-secondary" style="width: auto; margin-top: 0; padding: 0.5rem 1rem; font-size: 0.85rem; border-color: rgba(52, 211, 153, 0.3);" onclick="changeMode('${term.id}', 'PDV')">🔌 Activar Modo PDV</button>` :
      `<button class="btn btn-secondary" style="width: auto; margin-top: 0; padding: 0.5rem 1rem; font-size: 0.85rem; border-color: rgba(248, 113, 113, 0.3);" onclick="changeMode('${term.id}', 'STANDALONE')">🔄 Cambiar a Autónomo (STANDALONE)</button>`;

    return `
      <div class="terminal-item">
        <div class="terminal-header">
          <span>ID de Terminal (N/S): <strong style="color: var(--primary-color); font-family: monospace;">${term.id}</strong></span>
          <span style="color: ${statusColor}">
            ${statusLabel}
          </span>
        </div>
        <div style="font-size: 0.9rem; color: var(--text-muted)">
          <span>Dispositivo: ${term.device_name || 'Point Smart'}</span> | 
          <span>Tienda: ${term.store_id || 'Principal'}</span> |
          <span>Modo: <strong style="color: ${modeColor}">${modeLabel}</strong></span>
        </div>
        <div style="margin-top: 0.8rem; display: flex; gap: 0.5rem;">
          ${actionButton}
        </div>
      </div>
    `;
  }).join('');

  // Leer poemas disponibles
  let poemsCount = 0;
  try {
    const poemsDir = path.join(__dirname, '../poemas');
    if (fs.existsSync(poemsDir)) {
      const files = fs.readdirSync(poemsDir);
      poemsCount = files.filter(f => f.endsWith('.txt')).length;
    }
  } catch (e) {
    console.error('Error contando poemas:', e);
  }

  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Poemas en Point Smart - Dashboard</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&family=Playfair+Display:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
      <style>
        :root {
          --bg-color: #0b0f19;
          --panel-bg: rgba(20, 28, 48, 0.6);
          --border-color: rgba(255, 255, 255, 0.08);
          --text-color: #f3f4f6;
          --text-muted: #9ca3af;
          --primary-color: #c084fc;
          --primary-hover: #a855f7;
          --success-color: #34d399;
          --error-color: #f87171;
        }
        
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        body {
          font-family: 'Outfit', sans-serif;
          background-color: var(--bg-color);
          background-image: 
            radial-gradient(circle at 10% 20%, rgba(192, 132, 252, 0.1) 0%, transparent 40%),
            radial-gradient(circle at 90% 80%, rgba(52, 211, 153, 0.08) 0%, transparent 40%);
          color: var(--text-color);
          min-height: 100vh;
          padding: 2rem 1rem;
          line-height: 1.6;
        }

        .container {
          max-width: 1000px;
          margin: 0 auto;
        }

        header {
          text-align: center;
          margin-bottom: 3rem;
        }

        h1 {
          font-family: 'Playfair Display', serif;
          font-size: 3rem;
          font-weight: 700;
          margin-bottom: 0.5rem;
          background: linear-gradient(135deg, #c084fc 0%, #34d399 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .subtitle {
          color: var(--text-muted);
          font-size: 1.1rem;
        }

        .grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 2rem;
        }

        @media (min-width: 768px) {
          .grid {
            grid-template-columns: 1fr 1fr;
          }
          .full-width {
            grid-column: span 2;
          }
        }

        .card {
          background: var(--panel-bg);
          backdrop-filter: blur(12px);
          border: 1px solid var(--border-color);
          border-radius: 20px;
          padding: 2rem;
          box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.3);
          transition: transform 0.2s, border-color 0.2s;
        }

        .card:hover {
          transform: translateY(-2px);
          border-color: rgba(192, 132, 252, 0.2);
        }

        .card h2 {
          font-family: 'Playfair Display', serif;
          font-size: 1.5rem;
          margin-bottom: 1.5rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .status-indicator {
          display: inline-block;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          margin-right: 0.5rem;
        }

        .status-ok { background-color: var(--success-color); box-shadow: 0 0 10px var(--success-color); }
        .status-warning { background-color: #fbbf24; box-shadow: 0 0 10px #fbbf24; }
        .status-error { background-color: var(--error-color); box-shadow: 0 0 10px var(--error-color); }

        .btn {
          display: inline-block;
          width: 100%;
          padding: 0.8rem 1.5rem;
          background: linear-gradient(135deg, var(--primary-color) 0%, #a855f7 100%);
          border: none;
          border-radius: 10px;
          color: white;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
          transition: opacity 0.2s, transform 0.1s;
          text-align: center;
          text-decoration: none;
          margin-top: 1rem;
        }

        .btn:hover {
          opacity: 0.9;
        }

        .btn:active {
          transform: scale(0.98);
        }

        .btn-secondary {
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid var(--border-color);
        }

        .btn-secondary:hover {
          background: rgba(255, 255, 255, 0.12);
        }

        .info-item {
          display: flex;
          justify-content: space-between;
          padding: 0.8rem 0;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }

        .info-label {
          color: var(--text-muted);
        }

        .info-value {
          font-weight: 600;
          font-family: monospace;
          color: #e5e7eb;
        }

        .code-block {
          background: rgba(0, 0, 0, 0.4);
          padding: 1rem;
          border-radius: 10px;
          font-family: monospace;
          font-size: 0.9rem;
          overflow-x: auto;
          margin-top: 0.5rem;
          border: 1px solid rgba(255, 255, 255, 0.05);
          color: #38bdf8;
        }

        ul {
          list-style: none;
        }

        li {
          padding: 0.5rem 0;
          border-bottom: 1px solid rgba(255, 255, 255, 0.03);
        }

        .terminal-item {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid var(--border-color);
          border-radius: 10px;
          padding: 1rem;
          margin-bottom: 1rem;
        }

        .terminal-header {
          display: flex;
          justify-content: space-between;
          margin-bottom: 0.5rem;
          font-weight: 600;
        }

        .toast {
          position: fixed;
          bottom: 20px;
          right: 20px;
          background: #202b3c;
          border-left: 4px solid var(--primary-color);
          color: white;
          padding: 1rem 1.5rem;
          border-radius: 8px;
          box-shadow: 0 10px 25px rgba(0,0,0,0.5);
          display: none;
          z-index: 100;
          animation: slideIn 0.3s ease-out;
        }

        @keyframes slideIn {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <header>
          <h1>✿ Poemas al Viento ✿</h1>
          <p class="subtitle">Integración de Mercado Pago Point Smart & Impresión de Poemas</p>
        </header>

        <div class="grid">
          <!-- CARD DE ESTADO -->
          <div class="card">
            <h2>
              <span class="status-indicator ${hasToken && hasTerminal ? 'status-ok' : 'status-warning'}"></span>
              Estado del Servidor
            </h2>
            <div class="info-item">
              <span class="info-label">Servidor Online</span>
              <span class="info-value text-success">SÍ</span>
            </div>
            <div class="info-item">
              <span class="info-label">Poemas cargados</span>
              <span class="info-value">${poemsCount} poemas</span>
            </div>
            <div class="info-item">
              <span class="info-label">Token Configurado</span>
              <span class="info-value">${hasToken ? 'ACTIVO (✓)' : 'FALTA (✗)'}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Terminal ID Configurado</span>
              <span class="info-value">${hasTerminal ? 'CONFIGURADO (✓)' : 'FALTA (✗)'}</span>
            </div>

            <button id="btnTest" class="btn" ${!hasToken || !hasTerminal ? 'disabled' : ''}>
              ✨ Imprimir Poema de Prueba
            </button>
          </div>

          <!-- CARD DE CONFIGURACIÓN WEBHOOK -->
          <div class="card">
            <h2>⚙ Configuración de Webhook</h2>
            <p style="color: var(--text-muted); font-size: 0.95rem; margin-bottom: 1rem;">
              Mercado Pago enviará señales automáticas a este servidor cuando tus clientes realicen un pago. Configura este endpoint en tu panel de desarrollador:
            </p>
            <span class="info-label">Dirección Webhook (URL pública):</span>
            <div class="code-block" id="webhookUrl">Cargando...</div>
            
            <p style="color: var(--text-muted); font-size: 0.85rem; margin-top: 1rem;">
              * Nota: Cuando despliegues en <strong>Render</strong>, reemplaza la parte inicial de esta URL con el enlace que te asigne Render.
            </p>
          </div>

          <!-- CARD DE SIMULADOR DE COBRO -->
          <div class="card" ${!hasToken || !hasTerminal ? 'style="display:none;"' : ''}>
            <h2>💸 Iniciar Cobro en Terminal</h2>
            <p style="color: var(--text-muted); font-size: 0.95rem; margin-bottom: 1rem;">
              Envía un monto a cobrar a tu Point Smart. La terminal saldrá del modo espera y solicitará la tarjeta.
            </p>
            <div style="display: flex; gap: 0.5rem; align-items: center;">
              <span style="font-size: 1.2rem; font-weight: bold; color: var(--primary-color);">$</span>
              <input type="number" id="chargeAmount" value="15.00" step="0.01" min="15.00" style="flex: 1; padding: 0.8rem; border-radius: 10px; border: 1px solid var(--border-color); background: rgba(0, 0, 0, 0.4); color: white; font-family: Outfit, sans-serif; font-size: 1rem;">
            </div>
            <button id="btnCharge" class="btn" style="background: linear-gradient(135deg, #34d399 0%, #10b981 100%);">
              💳 Enviar Cobro a Point
            </button>
          </div>

          <!-- CARD DE TERMINALES -->
          <div class="card full-width">
            <h2>POS/Terminales Asociadas</h2>
            ${terminalError ? `
              <p style="color: var(--error-color)">Error al consultar terminales: ${terminalError}</p>
            ` : ''}

            ${terminals.length === 0 && !terminalError ? `
              <p style="color: var(--text-muted)">
                ${hasToken ? 'No se encontraron terminales Point Smart vinculadas a esta cuenta.' : 'Configura tu Access Token en el archivo .env para listar tus terminales.'}
              </p>
            ` : ''}

            ${terminalsHtml}
          </div>
        </div>
      </div>

      <div id="toast" class="toast">¡Imprimiendo poema de prueba!</div>

      <script>
        // Rellenar dinámicamente la URL del webhook basada en el navegador actual
        document.getElementById('webhookUrl').textContent = window.location.origin + '/webhook';

        // Manejar botón de prueba de impresión
        const btnTest = document.getElementById('btnTest');
        const toast = document.getElementById('toast');

        if (btnTest) {
          btnTest.addEventListener('click', async () => {
            btnTest.disabled = true;
            btnTest.textContent = 'Enviando...';
            
            try {
              const response = await fetch('/test-print', { method: 'POST' });
              const data = await response.json();
              
              if (response.ok) {
                showToast('¡Poema enviado correctamente a la ticketera!');
              } else {
                showToast('Error: ' + data.error);
              }
            } catch (err) {
              showToast('Error de red al intentar imprimir.');
            } finally {
              btnTest.disabled = false;
              btnTest.textContent = '✨ Imprimir Poema de Prueba';
            }
          });
        }

        // Manejar botón de simular cobro
        const btnCharge = document.getElementById('btnCharge');
        const chargeAmount = document.getElementById('chargeAmount');

        if (btnCharge) {
          btnCharge.addEventListener('click', async () => {
            const amount = parseFloat(chargeAmount.value);
            if (isNaN(amount) || amount <= 0) {
              showToast('Error: Ingresa un monto válido mayor a 0.');
              return;
            }

            btnCharge.disabled = true;
            btnCharge.textContent = 'Enviando cobro...';
            
            try {
              const response = await fetch('/create-order', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  amount: amount,
                  notificationUrl: window.location.origin + '/webhook'
                })
              });
              const data = await response.json();
              
              if (response.ok) {
                showToast('¡Cobro de $' + amount + ' enviado al Point Smart! Pasa la tarjeta.');
              } else {
                showToast('Error: ' + data.error);
              }
            } catch (err) {
              showToast('Error de red al intentar iniciar el cobro.');
            } finally {
              btnCharge.disabled = false;
              btnCharge.textContent = '💳 Enviar Cobro a Point';
            }
          });
        }

        async function changeMode(terminalId, mode) {
          if (!confirm('¿Estás seguro de que deseas cambiar el modo de la terminal ' + terminalId + ' a ' + mode + '?')) {
            return;
          }
          
          showToast('Configurando terminal en modo ' + mode + '...');
          
          try {
            const response = await fetch('/change-terminal-mode', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ terminalId, mode })
            });
            const data = await response.json();
            
            if (response.ok) {
              showToast('¡Terminal configurada en modo ' + mode + ' con éxito! Reinicia tu terminal física.');
              setTimeout(() => {
                window.location.reload();
              }, 2000);
            } else {
              showToast('Error: ' + data.error);
            }
          } catch (err) {
            showToast('Error de red al configurar la terminal.');
          }
        }

        function showToast(message) {
          toast.textContent = message;
          toast.style.display = 'block';
          setTimeout(() => {
            toast.style.display = 'none';
          }, 4000);
        }
      </script>
    </body>
    </html>
  `);
});

// Endpoint de Prueba de Impresión Manual
app.post('/test-print', async (req, res) => {
  try {
    console.log('[Prueba] Solicitando impresión de prueba manual...');
    const poem = await getRandomPoem();
    const result = await printOnTerminal(poem);
    return res.status(200).json({ success: true, message: 'Impresión de prueba enviada', result });
  } catch (error) {
    const errorDetails = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    console.error('[Prueba] Error en la impresión de prueba:', errorDetails);
    const errorMessage = error.response?.data?.message || (error.response?.data?.error_messages ? error.response.data.error_messages.join(', ') : null) || error.message;
    return res.status(500).json({ error: errorMessage });
  }
});

// Endpoint para crear una orden de cobro en la terminal Point
app.post('/create-order', async (req, res) => {
  const { amount, notificationUrl } = req.body;
  const accessToken = process.env.MP_ACCESS_TOKEN;
  const terminalId = process.env.MP_TERMINAL_ID;

  if (!accessToken || accessToken.includes('tu_access_token')) {
    return res.status(400).json({ error: 'Mercado Pago Access Token no configurado en el archivo .env' });
  }
  if (!terminalId || terminalId.includes('tu_terminal_id')) {
    return res.status(400).json({ error: 'Mercado Pago Terminal ID no configurado en el archivo .env' });
  }

  const numericAmount = parseFloat(amount);
  if (isNaN(numericAmount) || numericAmount < 15.00) {
    return res.status(400).json({ error: 'El monto mínimo de cobro en Mercado Pago es de $15.00 ARS' });
  }

  const idempotencyKey = crypto.randomUUID();
  const externalReference = `payment_${Date.now()}`;

  const payload = {
    external_reference: externalReference,
    type: 'point',
    config: {
      point: {
        terminal_id: terminalId
      }
    },
    transactions: {
      payments: [
        {
          amount: numericAmount.toFixed(2)
        }
      ]
    }
  };

  try {
    console.log(`[Cobro] Iniciando cobro de $${numericAmount} en terminal: ${terminalId}...`);
    const response = await axios.post(
      'https://api.mercadopago.com/v1/orders',
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'X-Idempotency-Key': idempotencyKey
        }
      }
    );

    // Obtener el ID de la orden creada para iniciar polling en segundo plano
    const orderId = response.data.id;
    if (orderId) {
      startOrderPolling(orderId);
    } else {
      console.warn('[Cobro] La API de Mercado Pago no devolvió un ID de orden. No se iniciará polling.');
    }

    return res.status(200).json({ success: true, message: 'Orden de cobro enviada a la terminal', data: response.data });
  } catch (error) {
    console.error('[Cobro] Error al crear la orden de cobro:', JSON.stringify(error.response?.data, null, 2) || error.message);
    const apiError = error.response?.data?.message || (error.response?.data?.error_messages ? error.response.data.error_messages.join(', ') : null) || error.message;
    return res.status(500).json({ error: apiError });
  }
});

// Endpoint para configurar la terminal en modo PDV o STANDALONE
app.post('/change-terminal-mode', async (req, res) => {
  const { terminalId, mode } = req.body;
  const accessToken = process.env.MP_ACCESS_TOKEN;

  if (!accessToken || accessToken.includes('tu_access_token')) {
    return res.status(400).json({ error: 'Mercado Pago Access Token no configurado en el archivo .env' });
  }

  if (!terminalId || !mode) {
    return res.status(400).json({ error: 'Faltan parámetros obligatorios: terminalId o mode' });
  }

  try {
    console.log(`[Configuración] Configurando terminal ${terminalId} en modo: ${mode}...`);
    
    // Llamado PATCH a la API de Mercado Pago
    const response = await axios.patch(
      'https://api.mercadopago.com/terminals/v1/setup',
      {
        terminals: [
          {
            id: terminalId,
            operating_mode: mode
          }
        ]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        }
      }
    );

    return res.status(200).json({ success: true, message: `Modo de operación configurado a ${mode}`, data: response.data });
  } catch (error) {
    console.error('[Configuración] Error al configurar la terminal:', error.response?.data || error.message);
    const apiError = error.response?.data?.message || (error.response?.data?.error_messages ? error.response.data.error_messages.join(', ') : null) || error.message;
    return res.status(500).json({ error: apiError });
  }
});

// --- Idempotencia de Impresión de Poemas ---
const PRINTED_PAYMENTS_FILE = path.join(__dirname, '../printed_payments.json');
const printedPaymentsCache = new Set();

// Cargar caché inicial desde el archivo si existe
try {
  if (fs.existsSync(PRINTED_PAYMENTS_FILE)) {
    const data = JSON.parse(fs.readFileSync(PRINTED_PAYMENTS_FILE, 'utf8'));
    if (Array.isArray(data)) {
      data.forEach(id => printedPaymentsCache.add(id.toString()));
    }
    console.log(`[Caché] Historial de pagos impresos cargado: ${printedPaymentsCache.size} pagos.`);
  }
} catch (err) {
  console.error('[Caché] Error cargando historial de pagos impresos:', err);
}

function isPaymentAlreadyPrinted(paymentId) {
  if (!paymentId) return false;
  return printedPaymentsCache.has(paymentId.toString());
}

function markPaymentAsPrinted(paymentId) {
  if (!paymentId) return;
  const idStr = paymentId.toString();
  if (printedPaymentsCache.has(idStr)) return;

  printedPaymentsCache.add(idStr);
  
  try {
    const data = Array.from(printedPaymentsCache);
    fs.writeFileSync(PRINTED_PAYMENTS_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('[Caché] Error guardando historial de pagos impresos:', err);
  }
}

// Función genérica para ejecutar una acción de impresión en la terminal con reintentos si está ocupada
async function executePrintActionWithRetry(printFn, actionName, maxAttempts = 10, delayMs = 3000) {
  let attempts = 0;
  while (attempts < maxAttempts) {
    attempts++;
    try {
      console.log(`[Impresora] [${actionName}] Intento ${attempts}/${maxAttempts} de enviar a la terminal...`);
      const result = await printFn();
      console.log(`[Impresora] [${actionName}] Impresión enviada correctamente en el intento ${attempts}.`);
      return result;
    } catch (error) {
      const errorDetails = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      console.warn(`[Impresora] [${actionName}] Intento ${attempts} falló. Detalles del error:`, errorDetails);
      
      if (attempts >= maxAttempts) {
        throw error;
      }
      
      console.log(`[Impresora] [${actionName}] La terminal podría estar ocupada. Reintentando en ${delayMs / 1000} segundos...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

// Función global para procesar un pago aprobado, imprimir logo y poema
async function processApprovedPayment(paymentId, amount) {
  if (!paymentId) return;
  
  const paymentIdStr = paymentId.toString();
  if (isPaymentAlreadyPrinted(paymentIdStr)) {
    console.log(`[Impresora] El pago ${paymentIdStr} ya fue procesado e impreso. Evitando duplicado.`);
    return;
  }

  console.log(`[Impresora] ¡Pago aprobado confirmado! ID: ${paymentIdStr}, Monto: $${amount}.`);
  
  // 1. Intentar imprimir la imagen del logo con reintentos
  try {
    if (logoBase64) {
      console.log('[Impresora] Encolando impresión de logotipo...');
      await executePrintActionWithRetry(
        () => printImageOnTerminal(),
        'Logo'
      );
      // Pausa reducida de 2.2 segundos dado que el logo es ahora pequeño (200px) y se imprime casi instantáneamente
      await new Promise(resolve => setTimeout(resolve, 2200));
    }
  } catch (imgError) {
    console.error('[Impresora] Falló definitivamente la impresión del logotipo:', imgError.message);
  }

  // 2. Imprimir el poema con reintentos
  try {
    console.log('[Impresora] Encolando impresión de poema...');
    const poem = await getRandomPoem();
    const customText = `${poem}\n\n[ Colaboración: $${amount} ]`;
    
    await executePrintActionWithRetry(
      () => printOnTerminal(customText),
      'Poema'
    );
    
    // Registrar en el archivo de control
    markPaymentAsPrinted(paymentIdStr);
  } catch (poemError) {
    console.error('[Impresora] Falló definitivamente la impresión del poema:', poemError.message);
  }
}

// Función para realizar polling del estado de una orden de cobro
async function startOrderPolling(orderId, maxAttempts = 100, intervalMs = 3000) {
  const accessToken = process.env.MP_ACCESS_TOKEN;
  console.log(`[Polling] Iniciando consulta de estado para la orden ${orderId} (${maxAttempts} intentos, cada ${intervalMs}ms)...`);
  
  let attempts = 0;
  const timer = setInterval(async () => {
    attempts++;
    if (attempts > maxAttempts) {
      console.log(`[Polling] Se alcanzó el límite de tiempo para la orden ${orderId}. Finalizando consulta.`);
      clearInterval(timer);
      return;
    }
    
    try {
      const response = await axios.get(
        `https://api.mercadopago.com/v1/orders/${orderId}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        }
      );
      
      const orderData = response.data;
      const status = orderData.status;
      
      console.log(`[Polling] Orden ${orderId} (Intento ${attempts}/${maxAttempts}) -> Estado actual: ${status}`);
      
      if (status === 'processed') {
        console.log(`[Polling] ¡Orden ${orderId} ha sido procesada correctamente (Pago Aprobado)!`);
        clearInterval(timer);
        
        // Buscar el ID de pago y monto en la orden
        const payments = orderData.payments || [];
        const amount = orderData.amount || (payments.length > 0 ? payments[0].transaction_amount : 0);
        
        if (payments.length > 0) {
          for (const payment of payments) {
            if (payment.status === 'approved' || payment.status === 'processed') {
              console.log(`[Polling] Encontrado pago aprobado en la orden. ID: ${payment.id}, Monto: $${payment.transaction_amount}`);
              await processApprovedPayment(payment.id, payment.transaction_amount);
            }
          }
        } else {
          // Fallback con ID virtual si no viene la lista detallada de pagos pero está 'processed'
          const virtualPaymentId = `order_${orderId}`;
          console.log(`[Polling] Sin pagos explícitos en la respuesta. Utilizando ID virtual: ${virtualPaymentId}`);
          await processApprovedPayment(virtualPaymentId, amount);
        }
      } else if (status === 'failed' || status === 'cancelled') {
        console.log(`[Polling] La orden ${orderId} terminó con estado fallido o cancelado (${status}). Deteniendo polling.`);
        clearInterval(timer);
      }
    } catch (err) {
      console.error(`[Polling] Error consultando estado de orden ${orderId}:`, err.response?.data || err.message);
      // No detenemos el polling en caso de un error temporal de red (timeout, etc.)
    }
  }, intervalMs);
}

// Endpoint de Webhooks para Mercado Pago
app.post('/webhook', async (req, res) => {
  try {
    const { action, type, data, resource, id } = req.body;
    const topic = type || req.body.topic;
    
    console.log(`[Webhook] Recibida notificación. Tipo/Tema: ${topic}, Acción: ${action}`);
    console.log(`[Webhook] Cuerpo completo de la notificación:`, JSON.stringify(req.body, null, 2));

    const accessToken = process.env.MP_ACCESS_TOKEN;

    // Extraer el ID del recurso (soporta data.id, id, o la URL del resource)
    let resourceId = data?.id || id;
    if (!resourceId && resource) {
      const parts = resource.split('/');
      resourceId = parts[parts.length - 1];
    }

    // Caso 1: Notificación de tipo 'payment' (incluyendo point_integration_wh)
    if (topic === 'payment' || topic === 'point_integration_wh') {
      if (!resourceId) {
        console.warn('[Webhook] Notificación de pago recibida pero sin ID de recurso');
        return res.status(200).send('Falta ID de recurso');
      }

      console.log(`[Webhook] Consultando detalles del pago ${resourceId}...`);
      
      try {
        const paymentResponse = await axios.get(
          `https://api.mercadopago.com/v1/payments/${resourceId}`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`
            }
          }
        );

        const paymentData = paymentResponse.data;
        const status = paymentData.status;
        const statusDetail = paymentData.status_detail;
        const amount = paymentData.transaction_amount;

        console.log(`[Webhook] Detalles de pago ${resourceId} -> Estado: ${status} (${statusDetail}), Monto: $${amount}`);

        if (status === 'approved') {
          await processApprovedPayment(resourceId, amount);
        } else {
          console.log(`[Webhook] El pago ${resourceId} aún no está aprobado. Estado actual: ${status}`);
        }
      } catch (err) {
        console.error(`[Webhook] Error al consultar pago ${resourceId}:`, err.response?.data || err.message);
      }
    } 
    // Caso 2: Notificación de tipo 'merchant_order'
    else if (topic === 'merchant_order') {
      if (!resourceId) {
        console.warn('[Webhook] Notificación de orden comercial recibida pero sin ID de recurso');
        return res.status(200).send('Falta ID de recurso');
      }

      console.log(`[Webhook] Consultando detalles de la orden comercial ${resourceId}...`);
      
      try {
        const orderResponse = await axios.get(
          `https://api.mercadopago.com/merchant_orders/${resourceId}`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`
            }
          }
        );

        const orderData = orderResponse.data;
        const payments = orderData.payments || [];
        console.log(`[Webhook] Orden comercial ${resourceId} tiene ${payments.length} pagos registrados.`);

        for (const payment of payments) {
          if (payment.status === 'approved') {
            console.log(`[Webhook] Encontrado pago aprobado en orden ${resourceId}. ID de pago: ${payment.id}, Monto: $${payment.transaction_amount}`);
            await processApprovedPayment(payment.id, payment.transaction_amount);
          }
        }
      } catch (err) {
        console.error(`[Webhook] Error al consultar orden comercial ${resourceId}:`, err.response?.data || err.message);
      }
    } 
    // Caso 3: Notificación de otro tipo no esperado
    else {
      console.log(`[Webhook] Notificación recibida para tema no configurado directamente (${topic}). Omitiendo.`);
    }

    // Mercado Pago requiere responder siempre con un 200 OK para confirmar recepción
    return res.status(200).send('Webhook recibido');
  } catch (error) {
    console.error('[Webhook] Error crítico procesando webhook:', error.message);
    // Respondemos con 200 de todas formas para evitar reintentos infinitos de MP
    return res.status(200).send('Webhook manejado con error interno');
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 Servidor ejecutándose en http://localhost:${PORT}`);
  console.log(`📂 Carpeta de poemas activa en e:/POEMAS/poemas`);
  console.log(`====================================================`);
});
