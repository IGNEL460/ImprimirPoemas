import express from 'express';
import cors from 'cors';
import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { getRandomPoem, parsePoemMetadata } from './poems.js';

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

  if (hasToken) {
    try {
      const response = await axios.get('https://api.mercadopago.com/terminals/v1/list', {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });
      terminals = response.data.data?.terminals || response.data.results || [];
    } catch (err) {
      terminalError = err.response?.data?.message || err.message;
    }
  }

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
      <div class="terminal-item" style="background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-color); border-radius: 10px; padding: 1rem; margin-bottom: 1rem;">
        <div class="terminal-header" style="display: flex; justify-content: space-between; margin-bottom: 0.5rem; font-weight: 600;">
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

  const registry = await getAuthorRegistry();
  const econ = await calculateEconomicStats(registry);
  const config = await getTaxesConfig();

  let poemsCount = 0;
  try {
    const poemsDir = path.join(__dirname, '../poemas');
    if (fs.existsSync(poemsDir)) {
      const files = fs.readdirSync(poemsDir);
      poemsCount = files.filter(f => f.endsWith('.txt')).length;
    }
  } catch (e) {}

  let stats = {};
  try {
    if (fs.existsSync(STATS_FILE)) {
      stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
    }
  } catch (e) {}

  let statsList = [];
  try {
    const poemsDir = path.join(__dirname, '../poemas');
    if (fs.existsSync(poemsDir)) {
      const files = fs.readdirSync(poemsDir).filter(f => f.endsWith('.txt'));
      for (const file of files) {
        const filePath = path.join(poemsDir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const { title, author } = parsePoemMetadata(file, content);
        const prints = stats[file] || 0;
        const status = getCopyrightStatus(author);
        statsList.push({ file, title, author, prints, status });
      }
    }
  } catch (e) {}

  statsList.sort((a, b) => b.prints - a.prints);

  const statsHtml = statsList.map(item => {
    const statusStyle = item.status.isAlive 
      ? `background: rgba(251, 191, 36, 0.1); color: #fbbf24; border: 1px solid rgba(251, 191, 36, 0.2);`
      : `background: rgba(52, 211, 153, 0.1); color: var(--success-color); border: 1px solid rgba(52, 211, 153, 0.2);`;

    return `
      <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.05);">
        <td style="padding: 0.8rem; font-weight: 600; color: #fff;">${item.title}</td>
        <td style="padding: 0.8rem; color: var(--text-muted);">${item.author}</td>
        <td style="padding: 0.8rem;">
          <span style="display: inline-block; padding: 0.2rem 0.6rem; border-radius: 20px; font-size: 0.8rem; font-weight: 600; ${statusStyle}">
            ${item.status.label}
          </span>
        </td>
        <td style="padding: 0.8rem; text-align: right; font-weight: bold; font-family: monospace; color: #fff; font-size: 1.05rem;">
          ${item.prints}
        </td>
      </tr>
    `;
  }).join('');

  const authorsHtml = econ.authorsList.map(auth => {
    const eligibleClass = auth.balanceRFC >= 10 ? 'style="color: var(--success-color); font-weight: bold;"' : 'style="color: var(--text-muted);"';
    const walletDisplay = auth.wallet ? `<span style="font-family: monospace; font-size: 0.85rem; color: var(--primary-color);">${auth.wallet.slice(0, 6)}...${auth.wallet.slice(-4)}</span>` : '<span style="color: var(--text-muted); font-style: italic;">Sin vincular</span>';
    const equivalentPesos = auth.balanceRFC * econ.rfcShareValue;

    return `
      <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.05);">
        <td style="padding: 0.8rem; font-weight: 600; color: #fff;">${auth.penName}</td>
        <td style="padding: 0.8rem; color: #fff;">${auth.legalName}</td>
        <td style="padding: 0.8rem; font-family: monospace; color: var(--text-muted);">${auth.cuitCuil}</td>
        <td style="padding: 0.8rem;" title="${auth.wallet || 'Sin billetera'}">${walletDisplay}</td>
        <td style="padding: 0.8rem; text-align: center; font-family: monospace;">${auth.prints}</td>
        <td style="padding: 0.8rem; text-align: center; font-family: monospace; color: var(--text-muted);">$${auth.pricePerUse}</td>
        <td style="padding: 0.8rem; text-align: right; font-family: monospace; color: var(--success-color);">${auth.balanceRFC.toFixed(2)} RFC</td>
        <td style="padding: 0.8rem; text-align: right; font-family: monospace;" ${eligibleClass}>$${equivalentPesos.toFixed(2)} ARS</td>
      </tr>
    `;
  }).join('');

  const transTransactionsHtml = [...econ.payments].reverse().slice(0, 100).map(p => {
    const dateFormatted = new Date(p.timestamp).toLocaleString('es-AR');
    const isCash = p.type === 'cash';
    const typeLabel = isCash ? '💵 Efectivo' : '💳 Point';
    const typeColor = isCash ? 'color: var(--success-color);' : 'color: var(--primary-color);';

    return `
      <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.05);">
        <td style="padding: 0.8rem; color: var(--text-muted); font-size: 0.85rem;">${dateFormatted}</td>
        <td style="padding: 0.8rem; font-family: monospace; color: var(--text-muted); font-size: 0.85rem;" title="${p.paymentId}">${p.paymentId.slice(0, 12)}...</td>
        <td style="padding: 0.8rem; font-weight: 600; color: #fff;">${p.vendor || 'Sin Evento'}</td>
        <td style="padding: 0.8rem; font-weight: 600; ${typeColor}">${typeLabel}</td>
        <td style="padding: 0.8rem; font-family: monospace; text-align: right; color: #fff;">$${p.amount.toFixed(2)}</td>
        <td style="padding: 0.8rem; font-family: monospace; text-align: right; color: var(--text-muted); font-size: 0.85rem;">-$${(p.mpFee || 0).toFixed(2)}</td>
        <td style="padding: 0.8rem; font-family: monospace; text-align: right; color: var(--text-muted); font-size: 0.85rem;">-$${(p.taxValue || 0).toFixed(2)}</td>
        <td style="padding: 0.8rem; font-family: monospace; text-align: right; color: var(--text-muted); font-size: 0.85rem;">-$${(p.paperCost || 0).toFixed(2)}</td>
        <td style="padding: 0.8rem; font-family: monospace; text-align: right; color: var(--success-color); font-weight: bold;">$${(p.netAmount || p.amount).toFixed(2)}</td>
        <td style="padding: 0.8rem; font-family: monospace; text-align: right; color: #fbbf24; font-weight: bold;">$${(p.reserveAllocated || 0).toFixed(2)}</td>
      </tr>
    `;
  }).join('');

  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Poemas en Point Smart - Dashboard de Finanzas y Control</title>
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
          --accent-color: #fbbf24;
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
          max-width: 1100px;
          margin: 0 auto;
        }

        header {
          text-align: center;
          margin-bottom: 2rem;
        }

        h1 {
          font-family: 'Playfair Display', serif;
          font-size: 2.8rem;
          font-weight: 700;
          margin-bottom: 0.5rem;
          background: linear-gradient(135deg, #c084fc 0%, #34d399 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .subtitle {
          color: var(--text-muted);
          font-size: 1rem;
          letter-spacing: 1px;
          text-transform: uppercase;
        }

        .nav-tabs {
          display: flex;
          gap: 0.5rem;
          margin-bottom: 2rem;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          padding-bottom: 0.8rem;
          overflow-x: auto;
        }

        .tab-btn {
          padding: 0.8rem 1.3rem;
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 12px;
          color: var(--text-muted);
          font-family: 'Outfit', sans-serif;
          font-weight: 600;
          font-size: 0.9rem;
          cursor: pointer;
          transition: all 0.2s ease;
          white-space: nowrap;
        }

        .tab-btn:hover {
          background: rgba(192, 132, 252, 0.1);
          color: #fff;
        }

        .tab-btn.active {
          background: linear-gradient(135deg, var(--primary-color) 0%, #a855f7 100%);
          border-color: var(--primary-color);
          color: #fff;
          box-shadow: 0 4px 15px rgba(192, 132, 252, 0.35);
        }

        .tab-content {
          display: none;
          animation: fadeIn 0.3s ease-out;
        }

        .tab-content.active {
          display: block;
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
          margin-bottom: 2rem;
        }

        .card h2 {
          font-family: 'Playfair Display', serif;
          font-size: 1.5rem;
          margin-bottom: 1.5rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 1.2rem;
          margin-bottom: 1.5rem;
        }

        .stat-card {
          background: rgba(0, 0, 0, 0.4);
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 14px;
          padding: 1.25rem;
          text-align: center;
        }

        .stat-value {
          font-size: 2rem;
          font-weight: 800;
          font-family: monospace;
          color: var(--accent-color);
          margin-top: 0.3rem;
        }

        .stat-label {
          font-size: 0.8rem;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .form-group {
          margin-bottom: 1.2rem;
          text-align: left;
        }

        .form-group label {
          display: block;
          font-size: 0.85rem;
          color: var(--text-muted);
          margin-bottom: 0.4rem;
          font-weight: 600;
        }

        .form-control {
          width: 100%;
          padding: 0.8rem 1rem;
          border-radius: 10px;
          border: 1px solid var(--border-color);
          background: rgba(0, 0, 0, 0.45);
          color: white;
          font-family: 'Outfit', sans-serif;
          font-size: 1rem;
          outline: none;
        }

        .form-control:focus {
          border-color: var(--primary-color);
        }

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

        .btn:hover { opacity: 0.9; }
        .btn:active { transform: scale(0.98); }

        .btn-secondary {
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid var(--border-color);
        }
        .btn-secondary:hover { background: rgba(255, 255, 255, 0.12); }

        .info-item {
          display: flex;
          justify-content: space-between;
          padding: 0.8rem 0;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }

        .info-label { color: var(--text-muted); }
        .info-value { font-weight: 600; font-family: monospace; color: #e5e7eb; }

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

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-6px); }
          to { opacity: 1; transform: translateY(0); }
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
          <p class="subtitle">AUDITORÍA Y CONTROL FINANCIERO DEL FONDO</p>
        </header>

        <!-- Navegación por pestañas -->
        <div class="nav-tabs">
          <button class="tab-btn active" onclick="switchTab('tab-terminales')">🔌 Terminales Point</button>
          <button class="tab-btn" onclick="switchTab('tab-config')">⚙️ Configuración Financiera</button>
          <button class="tab-btn" onclick="switchTab('tab-rendimiento')">📊 Rendimiento y Reservas</button>
          <button class="tab-btn" onclick="switchTab('tab-escritores')">👥 Escritores y Saldos</button>
          <button class="tab-btn" onclick="switchTab('tab-transacciones')">💳 Historial de Cobros</button>
          <button class="tab-btn" onclick="switchTab('tab-obras')">📜 Informe de Obras</button>
        </div>

        <!-- PESTAÑA 1: TERMINALES -->
        <div id="tab-terminales" class="tab-content active">
          <div class="grid">
            <div class="card">
              <h2>🔌 Estado de Terminal y Webhooks</h2>
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
              <button id="btnTestLogo" class="btn btn-secondary" ${!hasToken || !hasTerminal ? 'disabled' : ''} style="margin-top: 0.5rem; border-color: rgba(192, 132, 252, 0.3);">
                🖼️ Imprimir Logo de Prueba
              </button>
            </div>

            <div class="card">
              <h2>⚙ Endpoint de Webhook</h2>
              <p style="color: var(--text-muted); font-size: 0.95rem; margin-bottom: 1rem;">
                Configure esta URL de notificación en su panel de desarrollador de Mercado Pago para procesar cobros de Point Smart automáticamente:
              </p>
              <span class="info-label">Dirección Webhook (URL pública):</span>
              <div class="code-block" id="webhookUrl">Cargando...</div>
            </div>

            <div class="card">
              <h2>💸 Simular Envío de Cobro</h2>
              <p style="color: var(--text-muted); font-size: 0.95rem; margin-bottom: 1rem;">
                Pruebe enviando una orden de cobro temporal a su dispositivo Point Smart:
              </p>
              <div style="display: flex; gap: 0.5rem; align-items: center;">
                <span style="font-size: 1.2rem; font-weight: bold; color: var(--primary-color);">$</span>
                <input type="number" id="chargeAmount" value="200.00" step="1.00" min="15.00" class="form-control" style="flex: 1;">
              </div>
              <button id="btnCharge" class="btn" style="background: linear-gradient(135deg, #34d399 0%, #10b981 100%);">
                💳 Enviar Cobro a Point
              </button>
            </div>

            <div class="card full-width">
              <h2> POS / Terminales Asociadas</h2>
              ${terminalError ? `<p style="color: var(--error-color)">Error al consultar terminales: ${terminalError}</p>` : ''}
              ${terminals.length === 0 && !terminalError ? `<p style="color: var(--text-muted)">No se encontraron terminales Point vinculadas.</p>` : ''}
              ${terminalsHtml}
            </div>
          </div>
        </div>

        <!-- PESTAÑA 2: CONFIGURACIÓN FINANCIERA -->
        <div id="tab-config" class="tab-content">
          <div class="card">
            <h2>⚙️ Parámetros Financieros (Impuestos y Costos)</h2>
            <p style="color: var(--text-muted); font-size: 0.95rem; margin-bottom: 1.5rem;">
              Configure las retenciones y costos impositivos de la ticketera para que el sistema calcule el ingreso neto real y la porción asignada al Fondo de Reserva.
            </p>
            <form id="formConfig" onsubmit="handleSaveConfig(event)">
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.5rem;">
                <div class="form-group">
                  <label for="cfgMpPercent">Comisión Mercado Pago (%)</label>
                  <input type="number" id="cfgMpPercent" value="${config.mpFeePercent}" step="0.01" class="form-control" required>
                </div>
                <div class="form-group">
                  <label for="cfgMpFixed">Comisión Fija Mercado Pago ($ ARS)</label>
                  <input type="number" id="cfgMpFixed" value="${config.mpFeeFixed}" step="0.01" class="form-control" required>
                </div>
                <div class="form-group">
                  <label for="cfgTaxPercent">Otros Impuestos y Retenciones (%)</label>
                  <input type="number" id="cfgTaxPercent" value="${config.taxPercent}" step="0.01" class="form-control" required>
                </div>
                <div class="form-group">
                  <label for="cfgPaperCost">Costo Insumo Papel / Ticket ($ ARS)</label>
                  <input type="number" id="cfgPaperCost" value="${config.paperCostFixed}" step="0.01" class="form-control" required>
                </div>
                <div class="form-group">
                  <label for="cfgReservePercent">Asignación al Fondo de Reserva (%)</label>
                  <input type="number" id="cfgReservePercent" value="${config.reservePercent}" step="1" max="100" class="form-control" required>
                  <span style="font-size: 0.75rem; color: var(--text-muted);">Porcentaje del ingreso neto destinado a respaldar el RFC.</span>
                </div>
              </div>
              <button type="submit" class="btn" style="width: auto; padding: 0.8rem 2.5rem; margin-top: 1.5rem;">Guardar Cambios Financieros</button>
            </form>
          </div>
        </div>

        <!-- PESTAÑA 3: RENDIMIENTO Y RESERVAS -->
        <div id="tab-rendimiento" class="tab-content">
          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-label">Recaudación Bruta</div>
              <div class="stat-value">$${econ.totalCollected.toFixed(2)}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Costos e Impuestos</div>
              <div class="stat-value" style="color: var(--error-color);">-$${econ.totalCostsAndTaxes.toFixed(2)}</div>
            </div>
            <div class="stat-card" style="border-color: #fbbf24;">
              <div class="stat-label">Fondo de Reserva</div>
              <div class="stat-value" style="color: #fbbf24;">$${econ.totalReservesPool.toFixed(2)}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">RFC en Circulación</div>
              <div class="stat-value" style="color: var(--primary-color);">${econ.totalRFCDistributed.toFixed(2)} RFC</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Valor de Rescate / RFC</div>
              <div class="stat-value" style="color: var(--success-color);">$${econ.rfcShareValue.toFixed(4)}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Margen Operativo</div>
              <div class="stat-value" style="color: var(--success-color);">$${econ.operatingSurplus.toFixed(2)}</div>
            </div>
          </div>

          <div class="card">
            <h2>🛡️ Sostenibilidad del Fondo (Modelo de Cuotaparte)</h2>
            <p style="color: var(--text-muted); line-height: 1.6; margin-bottom: 1rem;">
              En lugar de liquidar regalías a tasa fija 1:1, los tokens RFC acumulados por los escritores funcionan como <strong>cuotapartes del Fondo de Reserva</strong>.
            </p>
            <p style="color: var(--text-muted); line-height: 1.6; margin-bottom: 1rem;">
              El valor líquido en pesos de cada RFC se calcula en tiempo real dividiendo el dinero resguardado en el Fondo de Reserva por el total de tokens RFC emitidos. Si aumentan los costos del papel o los impuestos retenidos, el valor del RFC se ajusta a la realidad de caja, garantizando que el proyecto <strong>nunca sea insolvente</strong> y que los autores cobren regalías debidamente respaldadas por el excedente neto de caja.
            </p>
          </div>
        </div>

        <!-- PESTAÑA 4: ESCRITORES -->
        <div id="tab-escritores" class="tab-content">
          <div class="card">
            <h2>👥 Registro de Escritores Autorizados</h2>
            <div style="overflow-x: auto;">
              <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.95rem;">
                <thead>
                  <tr style="border-bottom: 2px solid var(--border-color); color: var(--primary-color);">
                    <th style="padding: 0.8rem;">Firma</th>
                    <th style="padding: 0.8rem;">Nombre Legal</th>
                    <th style="padding: 0.8rem;">CUIT/CUIL</th>
                    <th style="padding: 0.8rem;">Billetera EVM</th>
                    <th style="padding: 0.8rem; text-align: center;">Prints</th>
                    <th style="padding: 0.8rem; text-align: center;">Regalía/Print</th>
                    <th style="padding: 0.8rem; text-align: right;">Saldos RFC</th>
                    <th style="padding: 0.8rem; text-align: right;">Rescate Pesos</th>
                  </tr>
                </thead>
                <tbody>
                  ${authorsHtml || '<tr><td colspan="8" style="text-align:center; padding: 1.5rem; color: var(--text-muted);">No hay escritores registrados.</td></tr>'}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- PESTAÑA 5: TRANSACCIONES -->
        <div id="tab-transacciones" class="tab-content">
          <div class="card">
            <h2>💳 Registro Completo de Cobros (Últimas 100)</h2>
            <div style="overflow-x: auto;">
              <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.85rem;">
                <thead>
                  <tr style="border-bottom: 2px solid var(--border-color); color: var(--primary-color);">
                    <th style="padding: 0.8rem;">Fecha/Hora</th>
                    <th style="padding: 0.8rem;">ID Pago</th>
                    <th style="padding: 0.8rem;">Evento/Vendedor</th>
                    <th style="padding: 0.8rem;">Tipo</th>
                    <th style="padding: 0.8rem; text-align: right;">Cobro Bruto</th>
                    <th style="padding: 0.8rem; text-align: right;">Comisión MP</th>
                    <th style="padding: 0.8rem; text-align: right;">Impuesto</th>
                    <th style="padding: 0.8rem; text-align: right;">Papel</th>
                    <th style="padding: 0.8rem; text-align: right;">Ingreso Neto</th>
                    <th style="padding: 0.8rem; text-align: right;">F. Reserva</th>
                  </tr>
                </thead>
                <tbody>
                  ${transTransactionsHtml || '<tr><td colspan="10" style="text-align:center; padding: 1.5rem; color: var(--text-muted);">No hay transacciones de cobro registradas.</td></tr>'}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- PESTAÑA 6: INFORME DE OBRAS -->
        <div id="tab-obras" class="tab-content">
          <div class="card">
            <h2>📊 Historial de Impresiones por Obra</h2>
            <div style="overflow-x: auto;">
              <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.95rem;">
                <thead>
                  <tr style="border-bottom: 2px solid var(--border-color); color: var(--primary-color);">
                    <th style="padding: 0.8rem;">Poema</th>
                    <th style="padding: 0.8rem;">Autor</th>
                    <th style="padding: 0.8rem;">Estado Legal</th>
                    <th style="padding: 0.8rem; text-align: right;">Impresiones</th>
                  </tr>
                </thead>
                <tbody>
                  ${statsHtml}
                </tbody>
              </table>
            </div>
            <div style="margin-top: 1.5rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
              <span style="font-size: 0.85rem; color: var(--text-muted);">
                * Nota: Reiniciar los contadores vaciará el contador acumulado de impresiones en el archivo stats.
              </span>
              <button id="btnResetStats" class="btn btn-secondary" style="width: auto; margin-top: 0; padding: 0.5rem 1rem; font-size: 0.85rem; border-color: rgba(248, 113, 113, 0.3); color: var(--error-color);">
                🗑️ Reiniciar Contadores
              </button>
            </div>
          </div>
        </div>
      </div>

      <div id="toast" class="toast">¡Procesando!</div>

      <script>
        document.getElementById('webhookUrl').textContent = window.location.origin + '/webhook';

        const toast = document.getElementById('toast');
        function showToast(message) {
          toast.textContent = message;
          toast.style.display = 'block';
          setTimeout(() => { toast.style.display = 'none'; }, 4000);
        }

        function switchTab(tabId) {
          document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
          document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));

          const target = document.getElementById(tabId);
          if (target) target.classList.add('active');

          const btns = document.querySelectorAll('.tab-btn');
          btns.forEach(btn => {
            if (btn.getAttribute('onclick').includes(tabId)) {
              btn.classList.add('active');
            }
          });
        }

        // Guardar configuración
        async function handleSaveConfig(event) {
          event.preventDefault();
          const mpFeePercent = parseFloat(document.getElementById('cfgMpPercent').value);
          const mpFeeFixed = parseFloat(document.getElementById('cfgMpFixed').value);
          const taxPercent = parseFloat(document.getElementById('cfgTaxPercent').value);
          const paperCostFixed = parseFloat(document.getElementById('cfgPaperCost').value);
          const reservePercent = parseFloat(document.getElementById('cfgReservePercent').value);

          try {
            const res = await fetch('/api/admin/save-config', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ mpFeePercent, mpFeeFixed, taxPercent, paperCostFixed, reservePercent })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Error al guardar');
            showToast('¡Configuración financiera guardada con éxito! Recargando...');
            setTimeout(() => window.location.reload(), 1500);
          } catch (e) {
            showToast(e.message);
          }
        }

        // Terminales y Pruebas
        const btnTest = document.getElementById('btnTest');
        if (btnTest) {
          btnTest.addEventListener('click', async () => {
            btnTest.disabled = true;
            btnTest.textContent = 'Enviando...';
            try {
              const res = await fetch('/test-print', { method: 'POST' });
              if (res.ok) showToast('¡Poema enviado a la ticketera!');
              else showToast('Error al imprimir');
            } catch (err) {
              showToast('Error de red.');
            } finally {
              btnTest.disabled = false;
              btnTest.textContent = '✨ Imprimir Poema de Prueba';
            }
          });
        }

        const btnTestLogo = document.getElementById('btnTestLogo');
        if (btnTestLogo) {
          btnTestLogo.addEventListener('click', async () => {
            btnTestLogo.disabled = true;
            btnTestLogo.textContent = 'Enviando logo...';
            try {
              const res = await fetch('/test-print-logo', { method: 'POST' });
              if (res.ok) showToast('¡Logo de prueba enviado!');
              else showToast('Error al imprimir logo');
            } catch (err) {
              showToast('Error de red.');
            } finally {
              btnTestLogo.disabled = false;
              btnTestLogo.textContent = '🖼️ Imprimir Logo de Prueba';
            }
          });
        }

        const btnCharge = document.getElementById('btnCharge');
        const chargeAmount = document.getElementById('chargeAmount');
        if (btnCharge) {
          btnCharge.addEventListener('click', async () => {
            const amount = parseFloat(chargeAmount.value);
            if (isNaN(amount) || amount <= 0) return showToast('Monto inválido.');
            btnCharge.disabled = true;
            btnCharge.textContent = 'Enviando...';
            try {
              const res = await fetch('/create-order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount, notificationUrl: window.location.origin + '/webhook' })
              });
              if (res.ok) showToast('¡Orden de $' + amount + ' enviada al Point!');
              else showToast('Error enviando cobro.');
            } catch (err) {
              showToast('Error de red.');
            } finally {
              btnCharge.disabled = false;
              btnCharge.textContent = '💳 Enviar Cobro a Point';
            }
          });
        }

        async function changeMode(terminalId, mode) {
          if (!confirm('¿Cambiar modo de terminal ' + terminalId + ' a ' + mode + '?')) return;
          try {
            const res = await fetch('/change-terminal-mode', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ terminalId, mode })
            });
            if (res.ok) {
              showToast('¡Modo cambiado con éxito! Recargando...');
              setTimeout(() => window.location.reload(), 2000);
            }
          } catch(e) {
            showToast('Error.');
          }
        }

        const btnResetStats = document.getElementById('btnResetStats');
        if (btnResetStats) {
          btnResetStats.addEventListener('click', async () => {
            if (!confirm('¿Reiniciar estadísticas?')) return;
            try {
              const res = await fetch('/reset-stats', { method: 'POST' });
              if (res.ok) {
                showToast('Reiniciado con éxito.');
                setTimeout(() => window.location.reload(), 1500);
              }
            } catch (err) {
              showToast('Error.');
            }
          });
        }
      </script>
    </body>
    </html>
  `);
});

// Ruta para servir la imagen del logotipo de El Pecado
app.get('/logo.jpg', (req, res) => {
  res.sendFile(path.join(__dirname, 'logo.jpg'));
});

// Ruta para servir el Manifiesto de la PWA
app.get('/manifest.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'manifest.json'));
});

// Ruta para servir el Service Worker de la PWA
app.get('/sw.js', (req, res) => {
  res.set('Content-Type', 'application/javascript');
  res.sendFile(path.join(__dirname, 'sw.js'));
});

// Ruta para la interfaz móvil simplificada de El Pecado ("Pecar con Tarjeta")
app.get('/pecar', (req, res) => {
  const vendorName = getVendorFromCookie(req);

  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>El Pecado - Colaborar</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&family=Playfair+Display:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
      <style>
        :root {
          --bg-color: #0b0303;
          --card-bg: rgba(22, 10, 10, 0.7);
          --border-color: rgba(220, 38, 38, 0.15);
          --text-color: #fbecec;
          --text-muted: #cda2a2;
          --primary-color: #ef4444;
          --primary-hover: #dc2626;
          --accent-color: #fbbf24;
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
            radial-gradient(circle at 50% 20%, rgba(239, 68, 68, 0.15) 0%, transparent 50%),
            radial-gradient(circle at 50% 80%, rgba(251, 191, 36, 0.04) 0%, transparent 50%);
          color: var(--text-color);
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 1.5rem;
          overflow-x: hidden;
        }

        .container {
          width: 100%;
          max-width: 400px;
          text-align: center;
        }

        .logo-container {
          margin-bottom: 1.2rem;
        }

        .logo-img {
          width: 110px;
          height: auto;
          border-radius: 50%;
          border: 2px solid var(--border-color);
          box-shadow: 0 0 25px rgba(239, 68, 68, 0.25);
          animation: float 4s ease-in-out infinite;
        }

        @keyframes float {
          0%, 100% { transform: translateY(0px) rotate(0deg); }
          50% { transform: translateY(-6px) rotate(1deg); }
        }

        h1 {
          font-family: 'Playfair Display', serif;
          font-size: 2.3rem;
          font-weight: 700;
          margin-bottom: 0.3rem;
          color: #fff;
          text-shadow: 0 2px 10px rgba(239, 68, 68, 0.2);
        }

        .tagline {
          color: var(--text-muted);
          font-size: 0.95rem;
          font-style: italic;
          margin-bottom: 2rem;
        }

        .card {
          background: var(--card-bg);
          backdrop-filter: blur(16px);
          border: 1px solid var(--border-color);
          border-radius: 24px;
          padding: 2rem 1.5rem;
          box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
        }

        .instructions {
          font-size: 0.9rem;
          color: var(--text-muted);
          margin-bottom: 1.5rem;
          line-height: 1.5;
        }

        .amount-display {
          font-size: 3rem;
          font-weight: 800;
          color: var(--accent-color);
          margin-bottom: 1.5rem;
          font-family: 'Outfit', sans-serif;
          text-shadow: 0 0 15px rgba(251, 191, 36, 0.25);
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.2rem;
        }

        .presets {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 0.6rem;
          margin-bottom: 1.5rem;
        }

        .preset-btn {
          padding: 0.8rem 0.3rem;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
          color: #fff;
          font-weight: 600;
          font-size: 0.95rem;
          cursor: pointer;
          transition: all 0.15s ease;
          outline: none;
          touch-action: manipulation;
          -webkit-tap-highlight-color: transparent;
          user-select: none;
        }

        .preset-btn:hover {
          background: rgba(239, 68, 68, 0.12);
          border-color: rgba(239, 68, 68, 0.3);
        }

        .preset-btn:active {
          transform: scale(0.94);
        }

        .preset-btn.active {
          background: var(--primary-color);
          border-color: var(--primary-color);
          color: white;
          box-shadow: 0 0 12px rgba(239, 68, 68, 0.3);
        }

        .custom-input-container {
          display: flex;
          background: rgba(0, 0, 0, 0.35);
          border: 1px solid var(--border-color);
          border-radius: 12px;
          overflow: hidden;
          margin-bottom: 1.5rem;
          align-items: center;
          padding-left: 1rem;
        }

        .custom-input-symbol {
          color: var(--text-muted);
          font-weight: 600;
          font-size: 1rem;
        }

        .custom-input {
          width: 100%;
          padding: 0.8rem;
          border: none;
          background: transparent;
          color: white;
          font-family: 'Outfit', sans-serif;
          font-size: 1rem;
          outline: none;
        }

        .btn-action {
          display: inline-block;
          width: 100%;
          padding: 1.1rem;
          background: linear-gradient(135deg, var(--primary-color) 0%, #b91c1c 100%);
          border: none;
          border-radius: 14px;
          color: white;
          font-size: 1.1rem;
          font-weight: 800;
          letter-spacing: 0.5px;
          cursor: pointer;
          transition: all 0.15s ease;
          box-shadow: 0 4px 20px rgba(239, 68, 68, 0.25);
          text-transform: uppercase;
          outline: none;
          touch-action: manipulation;
          -webkit-tap-highlight-color: transparent;
          user-select: none;
        }

        .btn-action:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 6px 25px rgba(239, 68, 68, 0.45);
        }

        .btn-action:active:not(:disabled) {
          transform: scale(0.96);
        }

        .btn-action:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          box-shadow: none;
        }

        .footer {
          margin-top: 2rem;
          font-size: 0.75rem;
          color: var(--text-muted);
          letter-spacing: 1px;
        }

        .toast {
          position: fixed;
          bottom: 25px;
          left: 50%;
          transform: translateX(-50%);
          background: #190606;
          border: 1px solid var(--primary-color);
          color: #fff;
          padding: 0.8rem 1.2rem;
          border-radius: 12px;
          box-shadow: 0 8px 30px rgba(0, 0, 0, 0.6);
          display: none;
          z-index: 100;
          animation: fadeInUp 0.3s ease-out;
          font-size: 0.85rem;
          text-align: center;
          width: 90%;
          max-width: 350px;
        }

        @keyframes fadeInUp {
          from { transform: translate(-50%, 15px); opacity: 0; }
          to { transform: translate(-50%, 0); opacity: 1; }
        }

        .event-badge {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          background: rgba(251, 191, 36, 0.08);
          border: 1px solid rgba(251, 191, 36, 0.2);
          color: var(--accent-color);
          padding: 0.4rem 1rem;
          border-radius: 12px;
          font-size: 0.85rem;
          font-weight: 600;
          margin-bottom: 1.5rem;
        }

        .form-group {
          margin-bottom: 1.2rem;
          text-align: left;
        }

        .form-group label {
          display: block;
          font-size: 0.85rem;
          color: var(--text-muted);
          margin-bottom: 0.4rem;
          font-weight: 600;
        }

        .form-control {
          width: 100%;
          padding: 0.85rem 1rem;
          border-radius: 12px;
          border: 1px solid var(--border-color);
          background: rgba(0, 0, 0, 0.45);
          color: white;
          font-family: 'Outfit', sans-serif;
          font-size: 1rem;
          outline: none;
        }

        .form-control:focus {
          border-color: var(--primary-color);
          box-shadow: 0 0 12px rgba(239, 68, 68, 0.2);
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="logo-container">
          <img src="/logo.jpg" alt="El Pecado Logo" class="logo-img" onerror="this.src='https://img.icons8.com/color/120/apple.png'">
        </div>
        
        <h1>El Pecado</h1>
        <div class="tagline">¿Cuál será tu tentación esta noche?</div>

        ${!vendorName ? `
          <!-- PANTALLA DE ACCESO DE VENDEDOR / EVENTO -->
          <div class="card">
            <div class="instructions">
              Ingresa el nombre del evento o punto de venta (ej: <strong>Feria del Libro 2026</strong>) para habilitar el cobro Point.
            </div>

            <form id="formVendorAuth" onsubmit="handleVendorAuth(event)">
              <div class="form-group">
                <label for="vendorNameInput">Nombre del Evento / Vendedor</label>
                <input type="text" id="vendorNameInput" class="form-control" placeholder="Ej: Feria del Libro" required autocomplete="off">
              </div>

              <button type="submit" id="btnVendorAuth" class="btn-action">Iniciar Sesión de Evento</button>
            </form>

            <div style="margin-top: 1.5rem; text-align: center; font-size: 0.85rem;">
              <a href="#" onclick="showRegisterForm(event)" style="color: var(--accent-color); text-decoration: none;">¿Es un evento nuevo? Regístralo aquí</a>
            </div>

            <!-- Registro de nuevo vendedor -->
            <div id="vendorRegisterSection" style="display: none; margin-top: 1.5rem; border-top: 1px dashed var(--border-color); padding-top: 1.5rem;">
              <h3 style="font-family: 'Playfair Display', serif; color: #fff; margin-bottom: 1rem; font-size: 1.2rem;">Registrar Nuevo Evento</h3>
              
              <div class="form-group">
                <label for="regVendorName">Nombre del Evento (Firma única)</label>
                <input type="text" id="regVendorName" class="form-control" placeholder="Ej: Teatro El Pecado">
              </div>

              <div class="form-group">
                <label for="regVendorDesc">Descripción / Detalles (Opcional)</label>
                <input type="text" id="regVendorDesc" class="form-control" placeholder="Ej: Función del 4 de Julio">
              </div>

              <button type="button" onclick="handleVendorRegister()" class="btn-action" style="background: linear-gradient(135deg, var(--accent-color) 0%, #d97706 100%); color: #0b0303; box-shadow: none;">Crear e Iniciar Sesión</button>
            </div>
          </div>
        ` : `
          <!-- INTERFAZ DE COBRO ACTIVA -->
          <div class="card">
            <div class="event-badge">
              📍 Evento: <strong>${vendorName}</strong>
            </div>

            <div class="instructions">
              Elige o digita el monto de tu colaboración para recibir tu ticket poético en el Point.
            </div>

            <div class="amount-display">
              <span>$</span><span id="amountVal">200.00</span>
            </div>

            <div class="presets">
              <button class="preset-btn" onclick="selectPreset(50)">$50</button>
              <button class="preset-btn" onclick="selectPreset(100)">$100</button>
              <button class="preset-btn active" onclick="selectPreset(200)">$200</button>
              <button class="preset-btn" onclick="selectPreset(500)">$500</button>
              <button class="preset-btn" onclick="selectPreset(1000)">$1000</button>
              <button class="preset-btn" onclick="selectPreset(2000)">$2000</button>
            </div>

            <div class="custom-input-container">
              <span class="custom-input-symbol">Otro monto: $</span>
              <input type="number" id="customAmount" class="custom-input" placeholder="Ej: 150" min="15" step="5" oninput="handleCustomInput()">
            </div>

            <button id="btnPecar" class="btn-action" onclick="enviarCobro()">
              🍎 Pecar... digo Pagar
            </button>

            <button id="btnImprimirEfectivo" class="btn-action" style="margin-top: 1rem; background: linear-gradient(135deg, #10b981 0%, #059669 100%); box-shadow: 0 4px 20px rgba(16, 185, 129, 0.25);" onclick="imprimirEfectivo()">
              💵 Imprimir Poema (Efectivo)
            </button>

            <div style="margin-top: 1.5rem; text-align: center;">
              <button onclick="handleVendorLogout()" style="background: none; border: none; color: var(--text-muted); cursor: pointer; text-decoration: underline; font-size: 0.85rem;">Cerrar sesión de evento</button>
            </div>
          </div>
        `}

        <div class="footer">
          EL PECADO TEATRO &bull; ELPECADO.AR
        </div>
      </div>

      <div id="toast" class="toast"></div>

      <script>
        let activeAmount = 200;

        function triggerVibration() {
          if (navigator.vibrate) {
            try { navigator.vibrate(15); } catch(e) {}
          }
        }

        // Acceso de vendedor
        async function handleVendorAuth(event) {
          event.preventDefault();
          const vendorName = document.getElementById('vendorNameInput').value.trim();
          if (!vendorName) return;

          const btn = document.getElementById('btnVendorAuth');
          btn.disabled = true;
          btn.textContent = 'Verificando...';

          try {
            const res = await fetch('/api/vendedores/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ vendorName })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Error al autenticar');

            if (data.success) {
              window.location.reload();
            } else if (data.notRegistered) {
              showToast('El evento/vendedor no está registrado. Regístralo abajo.');
              document.getElementById('vendorRegisterSection').style.display = 'block';
            }
          } catch(e) {
            showToast(e.message);
          } finally {
            btn.disabled = false;
            btn.textContent = 'Iniciar Sesión de Evento';
          }
        }

        function showRegisterForm(event) {
          event.preventDefault();
          const section = document.getElementById('vendorRegisterSection');
          section.style.display = (section.style.display === 'block') ? 'none' : 'block';
        }

        async function handleVendorRegister() {
          const vendorName = document.getElementById('regVendorName').value.trim();
          const description = document.getElementById('regVendorDesc').value.trim();

          if (!vendorName) {
            showToast('El nombre del evento es obligatorio.');
            return;
          }

          try {
            const res = await fetch('/api/vendedores/register', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ vendorName, description })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Error al registrar evento');

            window.location.reload();
          } catch (e) {
            showToast(e.message);
          }
        }

        async function handleVendorLogout() {
          try {
            await fetch('/api/vendedores/logout', { method: 'POST' });
            window.location.reload();
          } catch (e) {
            window.location.reload();
          }
        }

        // Operaciones de cobro
        function selectPreset(amount) {
          triggerVibration();
          activeAmount = amount;
          document.getElementById('amountVal').textContent = amount.toFixed(2);
          document.getElementById('customAmount').value = '';
          
          const buttons = document.querySelectorAll('.preset-btn');
          buttons.forEach(btn => {
            if (btn.textContent === '$' + amount) {
              btn.classList.add('active');
            } else {
              btn.classList.remove('active');
            }
          });
        }

        function handleCustomInput() {
          const val = parseFloat(document.getElementById('customAmount').value);
          
          const buttons = document.querySelectorAll('.preset-btn');
          buttons.forEach(btn => btn.classList.remove('active'));

          if (!isNaN(val) && val >= 15) {
            activeAmount = val;
            document.getElementById('amountVal').textContent = val.toFixed(2);
          } else {
            activeAmount = 0;
            document.getElementById('amountVal').textContent = '0.00';
          }
        }

        async function enviarCobro() {
          triggerVibration();
          if (activeAmount < 15) {
            showToast('El monto mínimo para pecar es de $15.00 ARS');
            return;
          }

          const btn = document.getElementById('btnPecar');
          btn.disabled = true;
          btn.textContent = '🍎 Tentando al Point...';

          try {
            const response = await fetch('/create-order', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                amount: activeAmount,
                notificationUrl: window.location.origin + '/webhook'
              })
            });

            const data = await response.json();

            if (response.ok) {
              showToast('¡Monto enviado! Pasá la tarjeta en la terminal Point.');
            } else {
              showToast('Error: ' + data.error);
            }
          } catch (err) {
            showToast('Error de conexión con el servidor.');
          } finally {
            setTimeout(() => {
              btn.disabled = false;
              btn.textContent = '🍎 Pecar... digo Pagar';
            }, 2000);
          }
        }

        async function imprimirEfectivo() {
          triggerVibration();
          const btn = document.getElementById('btnImprimirEfectivo');
          btn.disabled = true;
          btn.textContent = '💵 Enviando a ticketera...';

          try {
            const response = await fetch('/print-logo-and-poem', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                amount: activeAmount
              })
            });

            const data = await response.json();

            if (response.ok) {
              showToast('✨ Impresión enviada. La ticketera imprimirá logo y poema en segundo plano.');
            } else {
              showToast('Error: ' + data.error);
            }
          } catch (err) {
            showToast('Error de conexión con el servidor.');
          } finally {
            setTimeout(() => {
              btn.disabled = false;
              btn.textContent = '💵 Imprimir Poema (Efectivo)';
            }, 2500);
          }
        }

        let toastTimer = null;
        function showToast(msg) {
          const toast = document.getElementById('toast');
          toast.textContent = msg;
          toast.style.display = 'block';
          if (toastTimer) clearTimeout(toastTimer);
          toastTimer = setTimeout(() => {
            toast.style.display = 'none';
          }, 4500);
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
    const { filename, content } = await getRandomPoem();
    const result = await printOnTerminal(content);
    await incrementPoemPrint(filename);
    return res.status(200).json({ success: true, message: 'Impresión de prueba enviada', result });
  } catch (error) {
    const errorDetails = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    console.error('[Prueba] Error en la impresión de prueba:', errorDetails);
    const errorMessage = error.response?.data?.message || (error.response?.data?.error_messages ? error.response.data.error_messages.join(', ') : null) || error.message;
    return res.status(500).json({ error: errorMessage });
  }
});

// Endpoint de Prueba de Impresión de Logo Manual
app.post('/test-print-logo', async (req, res) => {
  try {
    console.log('[Prueba] Solicitando impresión de logo de prueba manual...');
    const result = await printImageOnTerminal();
    return res.status(200).json({ success: true, message: 'Impresión de logo enviada', result });
  } catch (error) {
    const errorDetails = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    console.error('[Prueba] Error en la impresión de logo:', errorDetails);
    const errorMessage = error.response?.data?.message || (error.response?.data?.error_messages ? error.response.data.error_messages.join(', ') : null) || error.message;
    return res.status(500).json({ error: errorMessage });
  }
});

async function processBackgroundPrintJob(content, filename) {
  try {
    // 1. Logotipo
    try {
      if (logoBase64) {
        console.log('[Impresora-Fondo] Encolando logotipo...');
        await executePrintActionWithRetry(
          () => printImageOnTerminal(),
          'Logo'
        );
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    } catch (imgError) {
      console.error('[Impresora-Fondo] Falló logotipo:', imgError.message);
    }

    // 2. Poema
    try {
      if (content) {
        console.log('[Impresora-Fondo] Encolando poema...');
        await executePrintActionWithRetry(
          () => printOnTerminal(content),
          'Poema'
        );
        await incrementPoemPrint(filename);
        console.log('[Impresora-Fondo] Impresión finalizada con éxito.');
      }
    } catch (poemError) {
      console.error('[Impresora-Fondo] Falló poema:', poemError.message);
    }
  } catch (err) {
    console.error('[Impresora-Fondo] Error crítico:', err.message);
  }
}

// Endpoint para imprimir logo + poema en efectivo (sin transacción de cobro)
app.post('/print-logo-and-poem', async (req, res) => {
  const { amount } = req.body;
  const numericAmount = parseFloat(amount) || 200;
  const vendorName = getVendorFromCookie(req) || 'Sin Evento';

  console.log(`[Efectivo] Solicitud por $${numericAmount} de vendedor "${vendorName}".`);

  let filename = 'desconocido.txt';
  let authorName = 'Desconocido';
  let poemTitle = 'Sin Título';
  let content = '';

  try {
    const randomPoem = await getRandomPoem();
    filename = randomPoem.filename;
    content = randomPoem.content;
    const meta = parsePoemMetadata(filename, content);
    authorName = meta.author;
    poemTitle = meta.title;
  } catch (err) {
    console.error('[Efectivo] Error obteniendo poema para registrar:', err.message);
  }

  // Registrar el cobro aprobado de inmediato en el historial
  const virtualPaymentId = `cash_${Date.now()}`;
  try {
    await recordPayment(virtualPaymentId, numericAmount, filename, authorName, poemTitle, vendorName);
    console.log(`[Efectivo] Pago registrado: ${virtualPaymentId}`);
  } catch (recError) {
    console.error('[Efectivo] Error registrando pago:', recError.message);
  }

  // Lanzar la impresión física en segundo plano sin esperar
  processBackgroundPrintJob(content, filename);

  return res.status(200).json({ success: true, message: 'Impresión iniciada en segundo plano' });
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

  const vendorName = getVendorFromCookie(req) || 'Sin Evento';
  lastActiveVendor = vendorName; // Guardar el fallback para webhooks asíncronos

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
    console.log(`[Cobro] Iniciando cobro de $${numericAmount} en terminal: ${terminalId} (Vendedor: ${vendorName})...`);
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
      activeOrdersVendors[orderId] = vendorName; // Mapear el ID de orden al vendedor/evento creador
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

// Endpoint para reiniciar las estadísticas de impresión
app.post('/reset-stats', async (req, res) => {
  try {
    console.log('[Estadísticas] Reiniciando contadores de impresiones...');
    if (fs.existsSync(STATS_FILE)) {
      await fs.promises.writeFile(STATS_FILE, JSON.stringify({}, null, 2), 'utf8');
    }
    return res.status(200).json({ success: true, message: 'Estadísticas reiniciadas con éxito' });
  } catch (error) {
    console.error('[Estadísticas] Error al reiniciar estadísticas:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

// --- Control de Impresiones de Poemas (Estadísticas y Regalías) ---
const STATS_FILE = path.join(__dirname, '../poem_stats.json');

async function incrementPoemPrint(filename) {
  let stats = {};
  try {
    if (fs.existsSync(STATS_FILE)) {
      const fileContent = await fs.promises.readFile(STATS_FILE, 'utf8');
      stats = JSON.parse(fileContent);
    }
  } catch (err) {
    console.error('[Estadísticas] Error al leer estadísticas:', err);
  }

  stats[filename] = (stats[filename] || 0) + 1;

  try {
    await fs.promises.writeFile(STATS_FILE, JSON.stringify(stats, null, 2), 'utf8');
    console.log(`[Estadísticas] Contador incrementado para ${filename}. Total: ${stats[filename]}`);
  } catch (err) {
    console.error('[Estadísticas] Error al guardar estadísticas:', err);
  }
}

const HISTORICAL_AUTHORS = [
  'jose marti', 'josé martí',
  'gustavo adolfo becquer', 'gustavo adolfo bécquer',
  'alfonsina storni',
  'baldomero fernandez moreno', 'baldomero fernández moreno',
  'antonio machado',
  'almafuerte',
  'federico garcia lorca', 'federico garcía lorca',
  'delmira agustini',
  'sor juana ines de la cruz', 'sor juana inés de la cruz',
  'rosalia de castro', 'rosalía de castro'
];

function getCopyrightStatus(author) {
  const norm = author.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  if (norm === 'anonimo' || norm === 'anonima') {
    return { label: 'Anónimo (Libre)', isAlive: false };
  }
  
  const isHistorical = HISTORICAL_AUTHORS.some(hist => {
    const normHist = hist.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return norm.includes(normHist) || normHist.includes(norm);
  });

  if (isHistorical) {
    return { label: 'Dominio Público (Exento)', isAlive: false };
  } else {
    return { label: 'Autor Vivo / Reservado', isAlive: true };
  }
}

// --- Idempotencia de Impresión de Poemas ---
const PRINTED_PAYMENTS_FILE = path.join(__dirname, '../printed_payments.json');
const printedPaymentsCache = new Set();
const activeOrdersVendors = {};
let lastActiveVendor = 'Sin Evento';

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

// --- Historial de Transacciones y Liquidaciones ---
const PAYMENT_HISTORY_FILE = path.join(__dirname, '../payment_history.json');

async function recordPayment(paymentId, amount, filename, author, title, vendor = 'Sin Evento') {
  try {
    let history = [];
    if (fs.existsSync(PAYMENT_HISTORY_FILE)) {
      const fileContent = await fs.promises.readFile(PAYMENT_HISTORY_FILE, 'utf8');
      history = JSON.parse(fileContent);
    }
    
    // Calcular costos basándose en taxes_config.json
    const config = await getTaxesConfig();
    const grossAmount = parseFloat(amount) || 0;
    
    const isCash = paymentId.toString().startsWith('cash_');
    const mpFee = isCash ? 0 : ((grossAmount * config.mpFeePercent / 100) + config.mpFeeFixed);
    const taxValue = grossAmount * config.taxPercent / 100;
    const paperCost = config.paperCostFixed;
    
    const netAmount = grossAmount - mpFee - taxValue - paperCost;
    const reserveAllocated = Math.max(0, netAmount * (config.reservePercent / 100));
    
    history.push({
      paymentId: paymentId.toString(),
      amount: grossAmount,
      timestamp: new Date().toISOString(),
      filename,
      author,
      title,
      vendor: vendor || 'Sin Evento',
      type: isCash ? 'cash' : 'card',
      mpFee,
      taxValue,
      paperCost,
      netAmount,
      reserveAllocated
    });
    
    // Limitar el historial a 1000 transacciones para evitar saturar el disco
    if (history.length > 1000) {
      history = history.slice(-1000);
    }
    await fs.promises.writeFile(PAYMENT_HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
    console.log(`[Historial] Pago ${paymentId} ($${grossAmount}) registrado correctamente (Vendedor: ${vendor}, Neto: $${netAmount}, Reserva: $${reserveAllocated}).`);
  } catch (err) {
    console.error('[Historial] Error al registrar pago en el historial de transacciones:', err);
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

// Función global para procesar un pago aprobado, registrar historial, imprimir logo y poema
async function processApprovedPayment(paymentId, amount, orderId = null) {
  if (!paymentId) return;
  
  const paymentIdStr = paymentId.toString();
  if (isPaymentAlreadyPrinted(paymentIdStr)) {
    console.log(`[Impresora] El pago ${paymentIdStr} ya fue procesado e impreso. Evitando duplicado.`);
    return;
  }

  let vendorName = 'Sin Evento';
  if (orderId && activeOrdersVendors[orderId]) {
    vendorName = activeOrdersVendors[orderId];
  } else {
    vendorName = lastActiveVendor;
  }

  console.log(`[Impresora] ¡Pago aprobado confirmado! ID: ${paymentIdStr}, Monto: $${amount}, Vendedor: ${vendorName}.`);
  
  // Obtener poema y metadatos antes para registrarlos en el historial de cobros
  let filename = 'default.txt';
  let content = '¡Muchas gracias por apoyar nuestro arte!';
  let author = 'Anónimo';
  let title = 'Colaboración';
  try {
    const poemData = await getRandomPoem();
    filename = poemData.filename;
    content = poemData.content;
    const meta = parsePoemMetadata(filename, content);
    author = meta.author;
    title = meta.title;
  } catch (err) {
    console.error('[Impresora] Error al obtener poema para procesar pago:', err);
  }

  // Registrar el cobro aprobado en el archivo de historial de fondos
  await recordPayment(paymentIdStr, amount, filename, author, title, vendorName);

  // 1. Intentar imprimir la imagen del logo con reintentos
  try {
    if (logoBase64) {
      console.log('[Impresora] Encolando impresión de logotipo...');
      await executePrintActionWithRetry(
        () => printImageOnTerminal(),
        'Logo'
      );
      // Pausa de 5 segundos para asegurar que el papel del logotipo termine de salir antes de enviar el poema
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  } catch (imgError) {
    console.error('[Impresora] Falló definitivamente la impresión del logotipo:', imgError.message);
  }

  // 2. Imprimir el poema con reintentos
  try {
    console.log('[Impresora] Encolando impresión de poema...');
    
    await executePrintActionWithRetry(
      () => printOnTerminal(content),
      'Poema'
    );
    
    await incrementPoemPrint(filename);
    
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
              await processApprovedPayment(payment.id, payment.transaction_amount, orderId);
            }
          }
        } else {
          // Fallback con ID virtual si no viene la lista detallada de pagos pero está 'processed'
          const virtualPaymentId = `order_${orderId}`;
          console.log(`[Polling] Sin pagos explícitos en la respuesta. Utilizando ID virtual: ${virtualPaymentId}`);
          await processApprovedPayment(virtualPaymentId, amount, orderId);
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
    if (topic === 'payment' || action === 'payment.created' || action === 'payment.updated') {
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
        console.log(`[Webhook] Pago ${resourceId} obtenido. Estado: ${paymentData.status}, Monto: $${paymentData.transaction_amount}`);

        if (paymentData.status === 'approved') {
          let orderId = null;
          if (paymentData.order) {
            orderId = paymentData.order.id;
          }
          await processApprovedPayment(resourceId, paymentData.transaction_amount, orderId);
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
            await processApprovedPayment(payment.id, payment.transaction_amount, orderData.id);
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

// --- PORTAL DE ESCRITORES (/escritores) ---
const AUTHOR_REGISTRY_FILE = path.join(__dirname, '../author_registry.json');

function getAuthorFromCookie(req) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').reduce((acc, c) => {
    const [name, ...val] = c.trim().split('=');
    acc[name] = val.join('=');
    return acc;
  }, {});
  return cookies.author_session ? decodeURIComponent(cookies.author_session) : null;
}

async function getAuthorRegistry() {
  try {
    if (fs.existsSync(AUTHOR_REGISTRY_FILE)) {
      const data = await fs.promises.readFile(AUTHOR_REGISTRY_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('Error leyendo registro de autores:', e);
  }
  return {};
}

async function saveAuthorRegistry(registry) {
  try {
    await fs.promises.writeFile(AUTHOR_REGISTRY_FILE, JSON.stringify(registry, null, 2), 'utf8');
  } catch (e) {
    console.error('Error guardando registro de autores:', e);
  }
}

// --- CONFIGURACIÓN DE VENDEDORES (EVENTOS) Y COSTOS ---
const VENDOR_REGISTRY_FILE = path.join(__dirname, '../vendor_registry.json');
const TAXES_CONFIG_FILE = path.join(__dirname, '../taxes_config.json');

function getVendorFromCookie(req) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').reduce((acc, c) => {
    const [name, ...val] = c.trim().split('=');
    acc[name] = val.join('=');
    return acc;
  }, {});
  return cookies.vendor_session ? decodeURIComponent(cookies.vendor_session) : null;
}

async function getVendorRegistry() {
  try {
    if (fs.existsSync(VENDOR_REGISTRY_FILE)) {
      const data = await fs.promises.readFile(VENDOR_REGISTRY_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('Error leyendo registro de vendedores:', e);
  }
  return {};
}

async function saveVendorRegistry(registry) {
  try {
    await fs.promises.writeFile(VENDOR_REGISTRY_FILE, JSON.stringify(registry, null, 2), 'utf8');
  } catch (e) {
    console.error('Error guardando registro de vendedores:', e);
  }
}

async function getTaxesConfig() {
  try {
    if (fs.existsSync(TAXES_CONFIG_FILE)) {
      const data = await fs.promises.readFile(TAXES_CONFIG_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('Error leyendo config de impuestos:', e);
  }
  return {
    mpFeePercent: 4.4,
    mpFeeFixed: 0,
    taxPercent: 5,
    paperCostFixed: 15,
    reservePercent: 60
  };
}

async function saveTaxesConfig(config) {
  try {
    await fs.promises.writeFile(TAXES_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  } catch (e) {
    console.error('Error guardando config de impuestos:', e);
  }
}

// APIs del Portal de Vendedores
app.post('/api/vendedores/login', async (req, res) => {
  const { vendorName } = req.body;
  if (!vendorName) return res.status(400).json({ error: 'Nombre de vendedor/evento requerido' });

  const registry = await getVendorRegistry();
  const trimmedName = vendorName.trim();

  if (registry[trimmedName]) {
    res.cookie('vendor_session', trimmedName, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: false, path: '/' });
    return res.json({ success: true, registered: true });
  } else {
    return res.json({ success: false, notRegistered: true });
  }
});

app.post('/api/vendedores/register', async (req, res) => {
  const { vendorName, description } = req.body;
  if (!vendorName) return res.status(400).json({ error: 'El nombre de vendedor/evento es obligatorio' });

  const registry = await getVendorRegistry();
  const trimmedName = vendorName.trim();

  registry[trimmedName] = {
    description: description ? description.trim() : '',
    createdAt: new Date().toISOString()
  };

  await saveVendorRegistry(registry);
  res.cookie('vendor_session', trimmedName, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: false, path: '/' });
  return res.json({ success: true });
});

app.post('/api/vendedores/logout', (req, res) => {
  res.clearCookie('vendor_session', { path: '/' });
  return res.json({ success: true });
});

// --- Cuentas con privilegios de Administrador ---
const ADMIN_ACCOUNTS = ['vendedor de poemas', 'elpecado', 'admin'];

// APIs del Portal de Escritores
app.post('/api/escritores/login', async (req, res) => {
  const { penName } = req.body;
  if (!penName) return res.status(400).json({ error: 'Firma artística requerida' });

  const registry = await getAuthorRegistry();
  const trimmedName = penName.trim();
  const isAdmin = ADMIN_ACCOUNTS.includes(trimmedName.toLowerCase());

  if (isAdmin || registry[trimmedName]) {
    res.cookie('author_session', trimmedName, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: false, path: '/' });
    return res.json({ success: true, registered: true });
  } else {
    return res.json({ success: false, notRegistered: true });
  }
});

app.post('/api/escritores/register', async (req, res) => {
  const { penName, legalName, cuitCuil, wallet, pricePerUse, nationality, acceptedTerms } = req.body;
  if (!penName || !legalName || !cuitCuil) {
    return res.status(400).json({ error: 'Por favor completa los campos obligatorios' });
  }
  if (!acceptedTerms) {
    return res.status(400).json({ error: 'Debes aceptar los términos de la licencia' });
  }

  const registry = await getAuthorRegistry();
  const trimmedName = penName.trim();

  registry[trimmedName] = {
    legalName: legalName.trim(),
    cuitCuil: cuitCuil.trim(),
    wallet: wallet ? wallet.trim() : '',
    pricePerUse: parseFloat(pricePerUse) || 1,
    nationality: nationality || 'Argentino',
    acceptedTerms: true,
    createdAt: new Date().toISOString()
  };

  await saveAuthorRegistry(registry);
    res.cookie('author_session', trimmedName, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: false, path: '/' });
  return res.json({ success: true });
});

app.post('/api/escritores/logout', (req, res) => {
  res.clearCookie('author_session', { path: '/' });
  return res.json({ success: true });
});

async function calculateEconomicStats(registry) {
  let stats = {};
  try {
    if (fs.existsSync(STATS_FILE)) {
      stats = JSON.parse(await fs.promises.readFile(STATS_FILE, 'utf8'));
    }
  } catch (e) {}

  let payments = [];
  try {
    if (fs.existsSync(PAYMENT_HISTORY_FILE)) {
      payments = JSON.parse(await fs.promises.readFile(PAYMENT_HISTORY_FILE, 'utf8'));
    }
  } catch (e) {}

  // 1. Recaudación bruta (tarjetas + efectivo registrados)
  const totalCollected = payments.reduce((acc, curr) => acc + (curr.amount || 0), 0);
  
  // 2. Costos e Impuestos Totales
  const totalCostsAndTaxes = payments.reduce((acc, curr) => {
    return acc + (curr.mpFee || 0) + (curr.taxValue || 0) + (curr.paperCost || 0);
  }, 0);

  // 3. Fondo de Reserva de Respaldo (acumulado de cada transacción)
  const totalReservesPool = payments.reduce((acc, curr) => acc + (curr.reserveAllocated || 0), 0);

  // 4. Calcular el total RFC distributed
  const poemsDir = path.join(__dirname, '../poemas');
  const authorsList = [];
  for (const penName in registry) {
    const authorInfo = registry[penName];
    let authorPrints = 0;
    try {
      if (fs.existsSync(poemsDir)) {
        const files = await fs.promises.readdir(poemsDir);
        for (const file of files.filter(f => f.endsWith('.txt'))) {
          const filePath = path.join(poemsDir, file);
          const content = await fs.promises.readFile(filePath, 'utf8');
          const meta = parsePoemMetadata(file, content);
          if (meta.author.toLowerCase().trim() === penName.toLowerCase().trim()) {
            authorPrints += stats[file] || 0;
          }
        }
      }
    } catch (e) {}

    const earnedRFC = authorPrints * (authorInfo.pricePerUse || 1);
    authorsList.push({
      penName,
      legalName: authorInfo.legalName,
      cuitCuil: authorInfo.cuitCuil,
      wallet: authorInfo.wallet,
      prints: authorPrints,
      pricePerUse: authorInfo.pricePerUse || 1,
      balanceRFC: earnedRFC
    });
  }

  const totalRFCDistributed = authorsList.reduce((acc, curr) => acc + curr.balanceRFC, 0);
  
  // Margen operativo = Recaudación bruta - Costos/Tasas - Reservas
  const operatingSurplus = Math.max(0, totalCollected - totalCostsAndTaxes - totalReservesPool);

  // 5. Valor de rescate de 1 RFC
  const rfcShareValue = totalRFCDistributed > 0 ? (totalReservesPool / totalRFCDistributed) : 1.0;

  return {
    totalCollected,
    totalCostsAndTaxes,
    totalReservesPool,
    totalRFCDistributed,
    operatingSurplus,
    rfcShareValue,
    authorsList,
    payments
  };
}

app.get('/api/escritores/dashboard-data', async (req, res) => {
  const authorName = getAuthorFromCookie(req);
  if (!authorName) return res.status(401).json({ error: 'No autenticado' });

  const trimmedName = authorName.trim();
  const registry = await getAuthorRegistry();
  const authorData = registry[trimmedName];
  if (!authorData) return res.status(404).json({ error: 'Autor no registrado' });

  // Calcular métricas globales para obtener el valor de rescate del RFC
  const econ = await calculateEconomicStats(registry);

  let stats = {};
  try {
    if (fs.existsSync(STATS_FILE)) {
      stats = JSON.parse(await fs.promises.readFile(STATS_FILE, 'utf8'));
    }
  } catch (e) {}

  let authorPoems = [];
  let totalPrints = 0;
  const poemsDir = path.join(__dirname, '../poemas');

  try {
    if (fs.existsSync(poemsDir)) {
      const files = await fs.promises.readdir(poemsDir);
      for (const file of files.filter(f => f.endsWith('.txt'))) {
        const filePath = path.join(poemsDir, file);
        const content = await fs.promises.readFile(filePath, 'utf8');
        const meta = parsePoemMetadata(file, content);

        if (meta.author.toLowerCase().trim() === trimmedName.toLowerCase().trim()) {
          const prints = stats[file] || 0;
          totalPrints += prints;
          authorPoems.push({
            file,
            title: meta.title,
            prints,
            earnedRFC: prints * (authorData.pricePerUse || 1)
          });
        }
      }
    }
  } catch (e) {}

  const totalEarnedRFC = totalPrints * (authorData.pricePerUse || 1);
  const estimatedPesosVal = totalEarnedRFC * econ.rfcShareValue;

  return res.json({
    authorName: trimmedName,
    authorData,
    poems: authorPoems,
    stats: {
      totalPoems: authorPoems.length,
      totalPrints,
      totalEarnedRFC,
      rfcShareValue: econ.rfcShareValue,
      estimatedPesosVal,
      minWithdrawalThreshold: 10
    }
  });
});

// APIs de Administración (Ruta Raíz /)
app.get('/api/admin/dashboard-data', async (req, res) => {
  const registry = await getAuthorRegistry();
  const econ = await calculateEconomicStats(registry);

  let totalPoems = 0;
  const poemsDir = path.join(__dirname, '../poemas');
  try {
    if (fs.existsSync(poemsDir)) {
      const files = await fs.promises.readdir(poemsDir);
      totalPoems = files.filter(f => f.endsWith('.txt')).length;
    }
  } catch (e) {}

  const config = await getTaxesConfig();

  return res.json({
    config,
    stats: {
      totalPoems,
      totalPrints: econ.authorsList.reduce((acc, curr) => acc + curr.prints, 0),
      totalCollected: econ.totalCollected,
      totalCostsAndTaxes: econ.totalCostsAndTaxes,
      totalReservesPool: econ.totalReservesPool,
      totalRFCDistributed: econ.totalRFCDistributed,
      operatingSurplus: econ.operatingSurplus,
      rfcShareValue: econ.rfcShareValue
    },
    authors: econ.authorsList,
    payments: [...econ.payments].reverse().slice(0, 100)
  });
});

app.post('/api/admin/save-config', async (req, res) => {
  const { mpFeePercent, mpFeeFixed, taxPercent, paperCostFixed, reservePercent } = req.body;
  
  const config = {
    mpFeePercent: parseFloat(mpFeePercent) || 0,
    mpFeeFixed: parseFloat(mpFeeFixed) || 0,
    taxPercent: parseFloat(taxPercent) || 0,
    paperCostFixed: parseFloat(paperCostFixed) || 0,
    reservePercent: parseFloat(reservePercent) || 0
  };

  await saveTaxesConfig(config);
  return res.json({ success: true, message: 'Configuración guardada correctamente.' });
});

app.post('/api/escritores/update-wallet', async (req, res) => {
  const authorName = getAuthorFromCookie(req);
  if (!authorName) return res.status(401).json({ error: 'No autenticado' });

  const { wallet } = req.body;
  if (!wallet || !wallet.startsWith('0x') || wallet.length !== 42) {
    return res.status(400).json({ error: 'Dirección de billetera EVM no válida. Debe comenzar con 0x y tener 42 caracteres.' });
  }

  const registry = await getAuthorRegistry();
  if (registry[authorName]) {
    registry[authorName].wallet = wallet.trim();
    await saveAuthorRegistry(registry);
    return res.json({ success: true, message: 'Billetera vinculada con éxito' });
  } else {
    return res.status(404).json({ error: 'Autor no encontrado' });
  }
});

app.post('/api/escritores/upload-poem', async (req, res) => {
  const authorName = getAuthorFromCookie(req);
  if (!authorName) return res.status(401).json({ error: 'No autenticado' });

  const { title, content } = req.body;
  if (!title || !content) {
    return res.status(400).json({ error: 'Por favor ingresa el título y contenido del poema' });
  }

  try {
    const poemsDir = path.join(__dirname, '../poemas');
    if (!fs.existsSync(poemsDir)) {
      await fs.promises.mkdir(poemsDir, { recursive: true });
    }

    const safeFilename = title.toLowerCase().replace(/[^a-z0-9_-]/g, '_').replace(/_+/g, '_') + '.txt';
    const filePath = path.join(poemsDir, safeFilename);
    const poemBody = `${title.trim()}\n\n${content.trim()}\n\n-- ${authorName}`;
    await fs.promises.writeFile(filePath, poemBody, 'utf8');

    return res.json({ success: true, message: '¡Poema publicado con éxito en el sistema!' });
  } catch (e) {
    return res.status(500).json({ error: 'Error al publicar poema: ' + e.message });
  }
});

// Rutas de alias
app.get('/presentacion', (req, res) => res.redirect('/escritores'));
app.get('/artist', (req, res) => res.redirect('/escritores'));

// RUTA PRINCIPAL DEL PORTAL DE ESCRITORES
app.get('/escritores', (req, res) => {
  const authorName = getAuthorFromCookie(req);
  const trimmedName = authorName ? authorName.trim() : '';

  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Portal de Escritores - El Pecado Teatro</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&family=Playfair+Display:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
      <style>
        :root {
          --bg-color: #0b0303;
          --card-bg: rgba(22, 10, 10, 0.75);
          --border-color: rgba(239, 68, 68, 0.18);
          --text-color: #fbecec;
          --text-muted: #cda2a2;
          --primary-color: #ef4444;
          --primary-hover: #dc2626;
          --accent-color: #fbbf24;
          --success-color: #34d399;
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }

        body {
          font-family: 'Outfit', sans-serif;
          background-color: var(--bg-color);
          background-image: 
          	radial-gradient(circle at 10% 20%, rgba(239, 68, 68, 0.14) 0%, transparent 40%),
          	radial-gradient(circle at 90% 80%, rgba(251, 191, 36, 0.06) 0%, transparent 40%);
          color: var(--text-color);
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          line-height: 1.6;
        }

        header {
          padding: 2rem 1rem 1.5rem 1rem;
          text-align: center;
          border-bottom: 1px solid rgba(239, 68, 68, 0.1);
          background: rgba(11, 3, 3, 0.6);
          backdrop-filter: blur(10px);
          position: relative;
        }

        header h1 {
          font-family: 'Playfair Display', serif;
          font-size: 2.6rem;
          font-weight: 700;
          background: linear-gradient(135deg, #fff 30%, #ef4444 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          margin-bottom: 0.4rem;
        }

        header p {
          font-size: 0.8rem;
          letter-spacing: 2px;
          color: var(--text-muted);
          text-transform: uppercase;
        }

        .user-bar {
          margin-top: 1.2rem;
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 1.5rem;
          flex-wrap: wrap;
        }

        @media (max-width: 768px) {
          .user-bar { position: static; margin-top: 1rem; }
        }

        .main-container {
          max-width: 900px;
          width: 100%;
          margin: 0 auto;
          padding: 2rem 1.5rem;
          flex: 1;
        }

        /* Tabs */
        .nav-tabs {
          display: flex;
          gap: 0.6rem;
          margin-bottom: 2rem;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          padding-bottom: 0.8rem;
        }

        .tab-btn {
          flex: 1;
          padding: 0.9rem;
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 12px;
          color: var(--text-muted);
          font-family: 'Outfit', sans-serif;
          font-weight: 600;
          font-size: 0.95rem;
          cursor: pointer;
          transition: all 0.25s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
        }

        .tab-btn:hover {
          background: rgba(239, 68, 68, 0.1);
          color: #fff;
        }

        .tab-btn.active {
          background: linear-gradient(135deg, var(--primary-color) 0%, #b91c1c 100%);
          border-color: var(--primary-color);
          color: #fff;
        }

        .tab-content {
          display: none;
          animation: fadeIn 0.3s ease-out;
        }

        .tab-content.active { display: block; }

        /* Tarjetas */
        .card {
          background: var(--card-bg);
          backdrop-filter: blur(16px);
          border: 1px solid var(--border-color);
          border-radius: 20px;
          padding: 2rem;
          box-shadow: 0 15px 35px rgba(0,0,0,0.5);
          margin-bottom: 2rem;
        }

        .card h2 {
          font-family: 'Playfair Display', serif;
          font-size: 1.7rem;
          color: #fff;
          margin-bottom: 1.2rem;
          display: flex;
          align-items: center;
          gap: 0.6rem;
        }

        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 1.2rem;
          margin-bottom: 1.5rem;
        }

        .stat-card {
          background: rgba(0, 0, 0, 0.4);
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 14px;
          padding: 1.25rem;
          text-align: center;
        }

        .stat-value {
          font-size: 2.2rem;
          font-weight: 800;
          font-family: monospace;
          color: var(--accent-color);
          margin-top: 0.3rem;
        }

        .stat-label {
          font-size: 0.85rem;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .form-group { margin-bottom: 1.2rem; }

        .form-group label {
          display: block;
          font-size: 0.88rem;
          color: var(--text-muted);
          margin-bottom: 0.4rem;
          font-weight: 600;
        }

        .form-control {
          width: 100%;
          padding: 0.85rem 1rem;
          border-radius: 12px;
          border: 1px solid var(--border-color);
          background: rgba(0, 0, 0, 0.45);
          color: white;
          font-family: 'Outfit', sans-serif;
          font-size: 1rem;
          outline: none;
          transition: all 0.2s;
        }

        .form-control:focus {
          border-color: var(--primary-color);
          box-shadow: 0 0 12px rgba(239, 68, 68, 0.2);
        }

        .btn {
          display: inline-block;
          width: 100%;
          padding: 0.9rem;
          background: linear-gradient(135deg, var(--primary-color) 0%, #b91c1c 100%);
          border: none;
          border-radius: 12px;
          color: white;
          font-size: 1.05rem;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.2s;
          text-align: center;
        }

        .btn:hover { transform: translateY(-1px); opacity: 0.95; }

        .btn-secondary {
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: var(--text-muted);
        }

        .btn-secondary:hover { background: rgba(255, 255, 255, 0.12); color: #fff; }

        .btn-tutorial {
          background: linear-gradient(135deg, var(--accent-color) 0%, #d97706 100%);
          color: #0b0303;
          font-weight: 700;
          padding: 0.75rem 1.2rem;
          font-size: 0.9rem;
          border-radius: 12px;
          border: none;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          transition: all 0.2s;
        }

        .btn-tutorial:hover { transform: translateY(-1px); box-shadow: 0 4px 15px rgba(251, 191, 36, 0.3); }

        .tutorial-box {
          display: none;
          background: rgba(251, 191, 36, 0.05);
          border: 1px solid rgba(251, 191, 36, 0.2);
          border-radius: 16px;
          padding: 1.5rem;
          margin-top: 1.5rem;
          animation: fadeIn 0.3s ease-out;
        }

        .tutorial-step {
          display: flex;
          gap: 1rem;
          margin-bottom: 1.2rem;
          align-items: flex-start;
        }

        .step-number {
          background: var(--accent-color);
          color: #0b0303;
          width: 28px;
          height: 28px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 800;
          font-size: 0.9rem;
          flex-shrink: 0;
        }

        .step-text h4 { color: #fff; margin-bottom: 0.2rem; font-size: 1rem; }
        .step-text p { color: var(--text-muted); font-size: 0.9rem; line-height: 1.5; }

        .notification {
          padding: 1rem 1.2rem;
          border-radius: 12px;
          font-size: 0.95rem;
          margin-bottom: 1.5rem;
          display: none;
        }

        .notification.success { background: rgba(52, 211, 153, 0.1); border: 1px solid rgba(52, 211, 153, 0.25); color: var(--success-color); }
        .notification.error { background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.25); color: #f87171; }
        .notification.info { background: rgba(251, 191, 36, 0.1); border: 1px solid rgba(251, 191, 36, 0.25); color: var(--accent-color); }

        .contract-viewer {
          background: rgba(0, 0, 0, 0.4);
          border: 1px solid var(--border-color);
          border-radius: 12px;
          padding: 1.2rem;
          max-height: 180px;
          overflow-y: auto;
          font-size: 0.85rem;
          color: var(--text-muted);
          line-height: 1.5;
          margin-bottom: 1.2rem;
        }

        .contract-viewer h3 { color: #fff; font-family: 'Playfair Display', serif; margin-bottom: 0.5rem; text-align: center; }

        footer {
          text-align: center;
          padding: 2rem 1rem;
          border-top: 1px solid rgba(239, 68, 68, 0.08);
          color: var(--text-muted);
          font-size: 0.8rem;
          margin-top: auto;
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      </style>
    </head>
    <body>
      <header>
        <h1>✿ Poemas al Viento ✿</h1>
        <p>PORTAL DE ESCRITORES &bull; ELPECADO.AR</p>

        ${authorName ? `
          <div class="user-bar">
            <span style="font-size: 0.95rem; color: #fff;">✒️ Autor: <strong>${authorName}</strong></span>
            <button onclick="handleLogout()" class="btn btn-secondary" style="width: auto; padding: 0.4rem 0.9rem; font-size: 0.85rem;">Cerrar Sesión</button>
          </div>
        ` : ''}
      </header>

      <div class="main-container">
        <div id="globalNotif" class="notification"></div>

        ${!authorName ? `
          <div style="max-width: 550px; margin: 2rem auto;" class="card">
            <h2 id="authTitle">✍️ Acceso a Escritores</h2>
            
            <form id="formAuth" onsubmit="handleAuthSubmit(event)">
              <div class="form-group">
                <label for="penNameInput">Tu Firma o Nombre Artístico</label>
                <input type="text" id="penNameInput" class="form-control" placeholder="Ej: Goyo.art3" required autocomplete="off">
              </div>

              <button type="submit" id="btnAuthSubmit" class="btn">Continuar al Portal</button>
            </form>

            <div id="registerSection" style="display: none; margin-top: 1.5rem; border-top: 1px dashed var(--border-color); padding-top: 1.5rem;">
              <h3 style="font-family: 'Playfair Display', serif; color: #fff; margin-bottom: 1rem;">Completar Registro y Contrato Digital</h3>
              
              <div class="form-group">
                <label for="regLegalName">Nombre Completo (Legal)</label>
                <input type="text" id="regLegalName" class="form-control" placeholder="Ej: Gregorio Martín">
              </div>

              <div class="form-group">
                <label for="regCuit">CUIT / CUIL (Formato: XX-XXXXXXXX-X)</label>
                <input type="text" id="regCuit" class="form-control" placeholder="Ej: 20-34567890-9" pattern="\\d{2}-\\d{8}-\\d{1}">
              </div>

              <div class="form-group">
                <label for="regWallet">Billetera Virtual (Opcional por ahora)</label>
                <input type="text" id="regWallet" class="form-control" placeholder="Ej: 0x... (EVM / Polygon)">
              </div>

              <div class="contract-viewer">
                <h3>CONTRATO DE LICENCIA Y REGALÍAS</h3>
                <p>El autor otorga a El Pecado Teatro licencia de uso no exclusiva para la reproducción térmica de sus poemas en tickets emitidos por terminales Point Smart.</p>
                <br>
                <p>Por cada impresión realizada, el sistema acumulará recompensas en tokens RFC acreditables en la billetera virtual informada.</p>
              </div>

              <div style="display: flex; gap: 0.6rem; margin-bottom: 1.2rem; font-size: 0.85rem; color: var(--text-muted);">
                <input type="checkbox" id="regAcceptTerms" style="accent-color: var(--primary-color);">
                <label for="regAcceptTerms">Declaro bajo juramento ser residente argentino y acepto las pautas editoriales y legales.</label>
              </div>

              <button type="button" onclick="handleRegisterSubmit()" class="btn" style="background: linear-gradient(135deg, var(--accent-color) 0%, #d97706 100%); color: #0b0303;">Firmar y Crear Cuenta</button>
            </div>
          </div>
        ` : `
          <!-- DASHBOARD CON PESTAÑAS DE ESCRITORES (NORMAL) -->
          <div class="nav-tabs">
            <button class="tab-btn active" onclick="switchTab('tab-poemas')">📜 Poemas y Estadísticas</button>
            <button class="tab-btn" onclick="switchTab('tab-cargar')">✍️ Cargar Poema</button>
            <button class="tab-btn" onclick="switchTab('tab-recompensa')">🏆 Recompensa RFC</button>
          </div>

          <!-- PESTAÑA 1: POEMAS -->
          <div id="tab-poemas" class="tab-content active">
            <div class="stats-grid">
              <div class="stat-card">
                <div class="stat-label">Obras Publicadas</div>
                <div class="stat-value" id="statPoemsCount">0</div>
              </div>
              <div class="stat-card">
                <div class="stat-label">Total Impresiones</div>
                <div class="stat-value" id="statPrintsCount">0</div>
              </div>
              <div class="stat-card">
                <div class="stat-label">Saldo Acumulado RFC</div>
                <div class="stat-value" id="statRFCCount" style="color: var(--success-color);">0.00</div>
              </div>
            </div>

            <div class="card">
              <h2>📜 Mis Obras en el Catálogo</h2>
              <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.95rem;">
                  <thead>
                    <tr style="border-bottom: 2px solid var(--border-color); color: var(--primary-color);">
                      <th style="padding: 0.8rem;">Título de la Obra</th>
                      <th style="padding: 0.8rem; text-align: center;">Impresiones Realizadas</th>
                      <th style="padding: 0.8rem; text-align: right;">Recompensa Generada</th>
                    </tr>
                  </thead>
                  <tbody id="userPoemsTableBody">
                    <tr><td colspan="3" style="text-align: center; padding: 1.5rem; color: var(--text-muted);">Cargando tus obras poéticas...</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <!-- PESTAÑA 2: CARGAR POEMA -->
          <div id="tab-cargar" class="tab-content">
            <div style="display: grid; grid-template-columns: 1fr; gap: 2rem;">
              <div class="card">
                <h2>✍️ Publicar Nueva Obra Poética</h2>
                <form id="formUploadPoem" onsubmit="handleUploadPoem(event)">
                  <div class="form-group">
                    <label for="poemTitle">Título de la Obra</label>
                    <input type="text" id="poemTitle" class="form-control" placeholder="Ej: Brisa de Otoño" required maxlength="60">
                  </div>

                  <div class="form-group">
                    <label for="poemContent">Cuerpo del Poema (Versos)</label>
                    <textarea id="poemContent" class="form-control" rows="8" placeholder="Escribe aquí tus versos..." required oninput="updateCharCounter()"></textarea>
                    <div id="charCounter" style="text-align: right; font-size: 0.8rem; color: var(--text-muted); margin-top: 0.3rem;">0 / 400 caracteres</div>
                  </div>

                  <button type="submit" id="btnUploadPoem" class="btn">🚀 Publicar e Incluir en Cola de Impresión</button>
                </form>
              </div>
            </div>
          </div>

          <!-- PESTAÑA 3: RECOMPENSA -->
          <div id="tab-recompensa" class="tab-content">
            <div class="card">
              <h2>🏆 Estado de Recompensa y Retiros RFC</h2>
              
              <div id="thresholdAlert" class="notification info" style="display: block;">
                <strong style="color: #fff;">💡 Umbral de Retiro:</strong> El saldo mínimo para solicitar la transferencia a tu billetera virtual es de <strong>10.00 RFC</strong>.
              </div>

              <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.4); padding: 1.5rem; border-radius: 16px; margin-bottom: 2rem; border: 1px solid rgba(255,255,255,0.05); gap: 1.5rem; flex-wrap: wrap;">
                <div>
                  <div style="font-size: 0.9rem; color: var(--text-muted);">Saldo Acumulado Disponible</div>
                  <div id="rewardRFCBalance" style="font-size: 2.5rem; font-weight: 800; font-family: monospace; color: var(--success-color);">0.00 RFC</div>
                </div>
                <div style="text-align: right;">
                  <div style="font-size: 0.9rem; color: var(--text-muted);">Equivalencia Estimada (Rescate)</div>
                  <div id="rewardPesosBalance" style="font-size: 2.3rem; font-weight: 800; font-family: monospace; color: var(--accent-color);">$0.00 ARS</div>
                </div>
              </div>

              <div class="card" style="background: rgba(251, 191, 36, 0.04); border-color: rgba(251, 191, 36, 0.15); margin-bottom: 2rem; padding: 1.5rem;">
                <h4 style="color: var(--accent-color); margin-bottom: 0.5rem; font-size: 1.1rem; display: flex; align-items: center; gap: 0.5rem;">⚖️ Modelo de Respaldo Dinámico (Cuotaparte)</h4>
                <p style="font-size: 0.9rem; color: var(--text-muted); line-height: 1.5; margin-bottom: 0.8rem;">
                  Tus tokens RFC representan una cuotaparte del Fondo de Reserva líquido acumulado por impresiones en eventos presenciales. El valor de rescate de 1 RFC a pesos (ARS) se actualiza de forma automática y transparente según las comisiones de cobro, impuestos y costos de papel:
                </p>
                <div style="font-family: monospace; font-size: 0.95rem; color: #fff;">
                  Tipo de Cambio de Rescate: <span id="currentRfcRate" style="color: var(--accent-color); font-weight: bold;">$1.00</span> ARS por RFC
                </div>
              </div>

              <h3 style="font-family: 'Playfair Display', serif; color: #fff; margin-bottom: 1rem; font-size: 1.3rem;">
                💳 Dirección de Billetera Virtual (EVM / Polygon)
              </h3>

              <div style="display: flex; gap: 1rem; flex-wrap: wrap; align-items: center; margin-bottom: 1.5rem;">
                <input type="text" id="walletInput" class="form-control" style="flex: 1; min-width: 280px;" placeholder="Ej: 0x1234... (Dirección de 42 caracteres)">
                <button onclick="handleSaveWallet()" class="btn" style="width: auto; padding: 0.85rem 1.8rem;">Guardar Billetera</button>
                <button type="button" onclick="toggleTutorial()" class="btn-tutorial">
                  💡 ¿Cómo crear una billetera?
                </button>
              </div>

              <div id="tutorialBox" class="tutorial-box">
                <h3 style="font-family: 'Playfair Display', serif; color: var(--accent-color); margin-bottom: 1.2rem; font-size: 1.3rem;">
                  📖 Guía Fácil: Cómo Crear tu Billetera
                </h3>
                <div class="tutorial-step">
                  <div class="step-number">1</div>
                  <div class="step-text">
                    <h4>Descarga una Billetera Web3</h4>
                    <p style="margin-bottom: 0.8rem;">Te recomendamos usar <strong>MetaMask</strong> (iOS / Android / Chrome).</p>
                    <a href="https://metamask.io/es/download" target="_blank" rel="noopener" class="btn" style="display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; width: auto; padding: 0.6rem 1.2rem; font-size: 0.9rem; background: linear-gradient(135deg, #f6851b 0%, #e2761b 100%); text-decoration: none; color: white;">
                      🦊 Descargar MetaMask
                    </a>
                  </div>
                </div>
                <div class="tutorial-step">
                  <div class="step-number">2</div>
                  <div class="step-text">
                    <h4>Copia tu Dirección</h4>
                    <p>Copia tu dirección pública que comienza con <strong>0x...</strong> y pégala arriba.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        `}
      </div>

      <footer>
        EL PECADO TEATRO &bull; TODOS LOS DERECHOS RESERVADOS
      </footer>

      <script>
        const globalNotif = document.getElementById('globalNotif');

        function showNotif(type, message) {
          if (!globalNotif) return;
          globalNotif.className = 'notification ' + type;
          globalNotif.textContent = message;
          globalNotif.style.display = 'block';
          setTimeout(() => { globalNotif.style.display = 'none'; }, 6000);
        }

        function switchTab(tabId) {
          document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
          document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));

          const target = document.getElementById(tabId);
          if (target) target.classList.add('active');

          const btns = document.querySelectorAll('.tab-btn');
          btns.forEach(btn => {
            if (btn.getAttribute('onclick').includes(tabId)) {
              btn.classList.add('active');
            }
          });
        }

        function toggleTutorial() {
          const box = document.getElementById('tutorialBox');
          if (!box) return;
          box.style.display = (box.style.display === 'block') ? 'none' : 'block';
        }

        function updateCharCounter() {
          const content = document.getElementById('poemContent');
          const counter = document.getElementById('charCounter');
          if (content && counter) counter.textContent = content.value.length + ' / 400 caracteres';
        }

        async function handleAuthSubmit(event) {
          event.preventDefault();
          const penName = document.getElementById('penNameInput').value.trim();
          if (!penName) return;

          const btn = document.getElementById('btnAuthSubmit');
          btn.disabled = true;
          btn.textContent = 'Verificando...';

          try {
            const res = await fetch('/api/escritores/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ penName })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Error al autenticar');

            if (data.success) {
              showNotif('success', '¡Sesión iniciada! Entrando...');
              setTimeout(() => window.location.reload(), 1000);
            } else if (data.notRegistered) {
              showNotif('info', 'Firma no encontrada. Por favor completa tu registro.');
              document.getElementById('authTitle').textContent = '🖋️ Registro de Escritor';
              btn.style.display = 'none';
              document.getElementById('penNameInput').disabled = true;
              document.getElementById('registerSection').style.display = 'block';
            }
          } catch (err) {
            showNotif('error', err.message);
            btn.disabled = false;
            btn.textContent = 'Continuar al Portal';
          }
        }

        async function handleRegisterSubmit() {
          const penName = document.getElementById('penNameInput').value.trim();
          const legalName = document.getElementById('regLegalName').value.trim();
          const cuitCuil = document.getElementById('regCuit').value.trim();
          const wallet = document.getElementById('regWallet').value.trim();
          const acceptedTerms = document.getElementById('regAcceptTerms').checked;

          if (!legalName || !cuitCuil) {
            showNotif('error', 'Por favor completa Nombre Completo y CUIT/CUIL.');
            return;
          }
          if (!acceptedTerms) {
            showNotif('error', 'Debes aceptar los términos de la licencia para continuar.');
            return;
          }

          try {
            const res = await fetch('/api/escritores/register', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ penName, legalName, cuitCuil, wallet, acceptedTerms })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Error en registro');

            showNotif('success', '¡Cuenta creada con éxito! Entrando...');
            setTimeout(() => window.location.reload(), 1200);
          } catch (err) {
            showNotif('error', err.message);
          }
        }

        async function handleLogout() {
          try {
            await fetch('/api/escritores/logout', { method: 'POST' });
            window.location.reload();
          } catch (e) {
            window.location.reload();
          }
        }

        async function loadDashboardData() {
          try {
            const res = await fetch('/api/escritores/dashboard-data');
            if (!res.ok) return;
            const data = await res.json();

            // Rellenar estadísticas
            document.getElementById('statPoemsCount').textContent = data.stats.totalPoems;
            document.getElementById('statPrintsCount').textContent = data.stats.totalPrints;
            document.getElementById('statRFCCount').textContent = data.stats.totalEarnedRFC.toFixed(2);
            document.getElementById('rewardRFCBalance').textContent = data.stats.totalEarnedRFC.toFixed(2) + ' RFC';
            document.getElementById('rewardPesosBalance').textContent = '$' + data.stats.estimatedPesosVal.toFixed(2) + ' ARS';
            document.getElementById('currentRfcRate').textContent = '$' + data.stats.rfcShareValue.toFixed(4) + ' ARS';

            const tbody = document.getElementById('userPoemsTableBody');
            if (data.poems.length === 0) {
              tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 1.5rem; color: var(--text-muted);">No hay poemas publicados.</td></tr>';
            } else {
              tbody.innerHTML = data.poems.map(p => \`
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                  <td style="padding: 0.8rem; font-weight: 600; color: #fff;">\${p.title}</td>
                  <td style="padding: 0.8rem; text-align: center; font-family: monospace; font-weight: bold; color: #fff;">\${p.prints}</td>
                  <td style="padding: 0.8rem; text-align: right; font-weight: bold; font-family: monospace; color: var(--success-color);">\${p.earnedRFC.toFixed(2)} RFC</td>
                </tr>
              \`).join('');
            }

            if (data.authorData && data.authorData.wallet) {
              document.getElementById('walletInput').value = data.authorData.wallet;
            }

            const badge = document.getElementById('withdrawalStatusBadge');
            const alertBox = document.getElementById('thresholdAlert');
            if (data.stats.totalEarnedRFC >= data.stats.minWithdrawalThreshold) {
              alertBox.className = 'notification success';
              alertBox.innerHTML = '<strong style="color: #fff;">🎉 ¡Felicidades!</strong> Has alcanzado el saldo mínimo de 10 RFC para retirar.';
            }
          } catch (e) {
            console.error('Error cargando dashboard:', e);
          }
        }

        async function handleSaveWallet() {
          const wallet = document.getElementById('walletInput').value.trim();
          if (!wallet) return showNotif('error', 'Ingresa una dirección');
          try {
            const res = await fetch('/api/escritores/update-wallet', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ wallet })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            showNotif('success', 'Billetera vinculada con éxito!');
            loadDashboardData();
          } catch (e) {
            showNotif('error', e.message);
          }
        }

        async function handleUploadPoem(event) {
          event.preventDefault();
          const title = document.getElementById('poemTitle').value.trim();
          const content = document.getElementById('poemContent').value.trim();
          if (!title || !content) return;

          const btn = document.getElementById('btnUploadPoem');
          btn.disabled = true;
          btn.textContent = 'Publicando...';

          try {
            const res = await fetch('/api/escritores/upload-poem', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ title, content })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            showNotif('success', '¡Publicado con éxito!');
            document.getElementById('formUploadPoem').reset();
            updateCharCounter();
            loadDashboardData();
            switchTab('tab-poemas');
          } catch (e) {
            showNotif('error', e.message);
          } finally {
            btn.disabled = false;
            btn.textContent = '🚀 Publicar e Incluir en Cola de Impresión';
          }
        }

        if (${authorName ? 'true' : 'false'}) loadDashboardData();
      </script>
    </body>
    </html>
  `);
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 Servidor ejecutándose en http://localhost:${PORT}`);
  console.log(`📂 Carpeta de poemas activa en e:/POEMAS/poemas`);
  console.log(`====================================================`);
});
