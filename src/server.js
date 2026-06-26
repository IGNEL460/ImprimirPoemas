import express from 'express';
import cors from 'cors';
import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { getRandomPoem, parsePoemMetadata } from './poems.js';
import { transferRFCTokens, getWalletDetails } from './blockchain.js';

// Cargar variables de entorno
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Archivo de configuración persistente para configuraciones en caliente (ej: Modo Sandbox)
const SETTINGS_FILE = path.join(__dirname, '../settings.json');
let isSandboxMode = false;

// Cargar configuración de Sandbox inicial
try {
  if (fs.existsSync(SETTINGS_FILE)) {
    const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    isSandboxMode = settings.mpSandbox === true;
    console.log(`[Config] Configuración cargada desde settings.json. Modo Sandbox: ${isSandboxMode}`);
  } else {
    // Autodetección: variable de entorno o token de Mercado Pago de prueba
    isSandboxMode = process.env.MP_SANDBOX === 'true' || 
                    (process.env.MP_ACCESS_TOKEN && (
                      process.env.MP_ACCESS_TOKEN.startsWith('TEST-') || 
                      process.env.MP_ACCESS_TOKEN.includes('370217986407903')
                    )) ||
                    (process.env.MP_ACCESS_TOKEN_TEST && (
                      process.env.MP_ACCESS_TOKEN_TEST.startsWith('TEST-') || 
                      process.env.MP_ACCESS_TOKEN_TEST.includes('370217986407903')
                    ));
    console.log(`[Config] Autodetectado Modo Sandbox: ${isSandboxMode}`);
  }
} catch (e) {
  console.error('[Config] Error al cargar settings.json:', e);
}

// Guardar configuración
function saveSettings() {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ mpSandbox: isSandboxMode }, null, 2), 'utf8');
  } catch (e) {
    console.error('[Config] Error al guardar settings.json:', e);
  }
}

// Variables en memoria para simulaciones en Sandbox
let simulatedPrints = [];
let simulatedOrders = {};
let simulatedPayments = {};

// Getters dinámicos para credenciales de Mercado Pago según el modo
function getMPAccessToken() {
  if (isSandboxMode && process.env.MP_ACCESS_TOKEN_TEST) {
    return process.env.MP_ACCESS_TOKEN_TEST;
  }
  return process.env.MP_ACCESS_TOKEN;
}

function getMPTerminalId() {
  if (isSandboxMode && process.env.MP_TERMINAL_ID_TEST) {
    return process.env.MP_TERMINAL_ID_TEST;
  }
  return process.env.MP_TERMINAL_ID;
}

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

// Helper para obtener el autor autenticado desde la cookie
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
  const accessToken = getMPAccessToken();
  const terminalId = getMPTerminalId();

  if (!isSandboxMode) {
    if (!accessToken || accessToken.includes('tu_access_token')) {
      throw new Error('Mercado Pago Access Token no configurado en el archivo .env');
    }
    if (!terminalId || terminalId.includes('tu_terminal_id')) {
      throw new Error('Mercado Pago Terminal ID no configurado en el archivo .env');
    }
  }

  const formattedContent = formatPoemForPoint(text);
  const idempotencyKey = crypto.randomUUID();

  if (isSandboxMode) {
    console.log(`[Impresora] [SIMULACIÓN] Encolando impresión de poema en historial.`);
    const printJob = {
      id: `print_sim_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      type: 'poem',
      terminalId: terminalId || 'TEST_TERMINAL',
      formattedContent: formattedContent,
      rawText: text,
      timestamp: new Date().toISOString()
    };
    simulatedPrints.unshift(printJob);
    if (simulatedPrints.length > 50) simulatedPrints.pop();
    return { id: printJob.id, status: 'processed', isSimulated: true };
  }

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

  const accessToken = getMPAccessToken();
  const terminalId = getMPTerminalId();

  if (!isSandboxMode) {
    if (!accessToken || accessToken.includes('tu_access_token')) {
      throw new Error('Mercado Pago Access Token no configurado en el archivo .env');
    }
    if (!terminalId || terminalId.includes('tu_terminal_id')) {
      throw new Error('Mercado Pago Terminal ID no configurado en el archivo .env');
    }
  }

  const idempotencyKey = crypto.randomUUID();

  if (isSandboxMode) {
    console.log(`[Impresora] [SIMULACIÓN] Encolando impresión de logotipo en historial.`);
    const printJob = {
      id: `logo_sim_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      type: 'logo',
      terminalId: terminalId || 'TEST_TERMINAL',
      formattedContent: '{center}{b}🖼️ LOGOTIPO DE EL PECADO TEATRO 🖼️{/b}{/center}',
      rawText: 'Logo Base64',
      timestamp: new Date().toISOString()
    };
    simulatedPrints.unshift(printJob);
    if (simulatedPrints.length > 50) simulatedPrints.pop();
    return { id: printJob.id, status: 'processed', isSimulated: true };
  }

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

// Página de Presentación y Acceso para Artistas
const servePresentationPage = (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Poemas al Viento - El Pecado Teatro</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&family=Playfair+Display:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
      <style>
        :root {
          --bg-color: #0b0303;
          --card-bg: rgba(22, 10, 10, 0.7);
          --border-color: rgba(239, 68, 68, 0.15);
          --text-color: #fbecec;
          --text-muted: #cda2a2;
          --primary-color: #ef4444;
          --primary-hover: #dc2626;
          --accent-color: #fbbf24;
          --accent-hover: #f59e0b;
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
            radial-gradient(circle at 10% 20%, rgba(239, 68, 68, 0.12) 0%, transparent 40%),
            radial-gradient(circle at 90% 80%, rgba(251, 191, 36, 0.04) 0%, transparent 40%);
          color: var(--text-color);
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          line-height: 1.6;
        }

        header {
          padding: 2.5rem 1rem 1.5rem 1rem;
          text-align: center;
          border-bottom: 1px solid rgba(239, 68, 68, 0.08);
          background: rgba(11, 3, 3, 0.5);
          backdrop-filter: blur(8px);
        }

        header h1 {
          font-family: 'Playfair Display', serif;
          font-size: 2.8rem;
          font-weight: 700;
          background: linear-gradient(135deg, #fff 30%, #ef4444 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          margin-bottom: 0.3rem;
        }

        header p {
          color: var(--text-muted);
          font-size: 1.1rem;
          font-style: italic;
          letter-spacing: 1px;
        }

        .main-container {
          max-width: 1100px;
          margin: 3rem auto;
          padding: 0 1.5rem;
          flex: 1;
          display: grid;
          grid-template-columns: 1.1fr 0.9fr;
          gap: 3rem;
          align-items: start;
        }

        @media (max-width: 900px) {
          .main-container {
            grid-template-columns: 1fr;
            margin: 1.5rem auto;
            gap: 2rem;
          }
        }

        .presentation-side h2 {
          font-family: 'Playfair Display', serif;
          font-size: 2.2rem;
          margin-bottom: 1.5rem;
          color: #fff;
          border-left: 4px solid var(--primary-color);
          padding-left: 1rem;
        }

        .presentation-side p {
          font-size: 1.05rem;
          color: var(--text-muted);
          margin-bottom: 1.5rem;
          line-height: 1.8;
        }

        .feature-card {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(239, 68, 68, 0.05);
          border-radius: 16px;
          padding: 1.25rem;
          margin-bottom: 1.2rem;
          display: flex;
          gap: 1rem;
          align-items: flex-start;
          transition: transform 0.2s, border-color 0.2s;
        }

        .feature-card:hover {
          transform: translateX(4px);
          border-color: rgba(239, 68, 68, 0.15);
        }

        .feature-icon {
          font-size: 2rem;
          line-height: 1;
        }

        .feature-text h3 {
          font-size: 1.1rem;
          color: #fff;
          margin-bottom: 0.3rem;
        }

        .feature-text p {
          font-size: 0.95rem;
          color: var(--text-muted);
          margin-bottom: 0;
          line-height: 1.5;
        }

        .form-card {
          background: var(--card-bg);
          backdrop-filter: blur(16px);
          border: 1px solid var(--border-color);
          border-radius: 24px;
          padding: 2.2rem;
          box-shadow: 0 15px 45px rgba(0, 0, 0, 0.6);
        }

        .form-card h2 {
          font-family: 'Playfair Display', serif;
          font-size: 1.7rem;
          margin-bottom: 1.5rem;
          text-align: center;
          color: #fff;
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 0.5rem;
        }

        .form-group {
          margin-bottom: 1.2rem;
        }

        .form-group label {
          display: block;
          font-size: 0.85rem;
          color: var(--text-muted);
          margin-bottom: 0.4rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .form-control {
          width: 100%;
          padding: 0.8rem 1rem;
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
          box-shadow: 0 0 10px rgba(239, 68, 68, 0.15);
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
          box-shadow: 0 4px 15px rgba(239, 68, 68, 0.2);
          text-align: center;
          outline: none;
        }

        .btn:hover {
          transform: translateY(-1px);
          box-shadow: 0 6px 20px rgba(239, 68, 68, 0.35);
        }

        .btn:active {
          transform: scale(0.99);
        }

        .btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          transform: none;
          box-shadow: none;
        }

        .btn-secondary {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.08);
          color: var(--text-muted);
        }

        .btn-secondary:hover {
          background: rgba(255, 255, 255, 0.08);
          color: #fff;
          box-shadow: none;
        }

        /* Registro colapsable */
        .register-section {
          max-height: 0;
          overflow: hidden;
          transition: max-height 0.4s ease-out;
        }

        .register-section.active {
          max-height: 1200px;
          margin-top: 1.5rem;
          border-top: 1px dashed rgba(239, 68, 68, 0.15);
          padding-top: 1.5rem;
        }

        .contract-viewer {
          background: rgba(0, 0, 0, 0.35);
          border: 1px solid var(--border-color);
          border-radius: 12px;
          padding: 1rem;
          max-height: 180px;
          overflow-y: auto;
          font-size: 0.82rem;
          color: var(--text-muted);
          line-height: 1.5;
          margin-bottom: 1rem;
        }

        .contract-viewer h3 {
          color: #fff;
          font-family: 'Playfair Display', serif;
          margin-bottom: 0.5rem;
          font-size: 0.95rem;
          text-align: center;
        }

        .checkbox-group {
          display: flex;
          gap: 0.6rem;
          align-items: flex-start;
          margin: 1rem 0;
          font-size: 0.85rem;
          color: var(--text-muted);
          cursor: pointer;
        }

        .checkbox-group input {
          margin-top: 0.25rem;
          accent-color: var(--primary-color);
        }

        .notification {
          padding: 0.8rem 1rem;
          border-radius: 10px;
          font-size: 0.9rem;
          margin-bottom: 1.2rem;
          display: none;
          animation: fadeIn 0.3s ease-out;
        }

        .notification.info {
          background: rgba(251, 191, 36, 0.08);
          border: 1px solid rgba(251, 191, 36, 0.15);
          color: var(--accent-color);
        }

        .notification.error {
          background: rgba(239, 68, 68, 0.08);
          border: 1px solid rgba(239, 68, 68, 0.15);
          color: #f87171;
        }

        .notification.success {
          background: rgba(52, 211, 153, 0.08);
          border: 1px solid rgba(52, 211, 153, 0.15);
          color: #34d399;
        }

        footer {
          text-align: center;
          padding: 2rem 1rem;
          border-top: 1px solid rgba(239, 68, 68, 0.08);
          color: var(--text-muted);
          font-size: 0.8rem;
          letter-spacing: 1px;
          margin-top: auto;
          background: rgba(11, 3, 3, 0.5);
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-5px); }
          to { opacity: 1; transform: translateY(0); }
        }
      </style>
    </head>
    <body>
      <header>
        <h1>✿ Poemas al Viento ✿</h1>
        <p>EL PECADO TEATRO &bull; ELPECADO.AR</p>
      </header>

      <div class="main-container">
        <!-- Lado Izquierdo: Presentación -->
        <div class="presentation-side">
          <h2>Sobre el Proyecto</h2>
          <p>
            "Poemas al Viento" es una innovadora intervención artística y digital impulsada por <strong>El Pecado Teatro</strong>. 
            El proyecto conecta los aportes voluntarios de nuestro público con la difusión de la literatura local en formato tangible y el incentivo directo a los creadores a través de la tecnología moderna.
          </p>

          <div class="feature-card">
            <div class="feature-icon">📟</div>
            <div class="feature-text">
              <h3>Impresión en Terminal Point Smart</h3>
              <p>Al realizar una colaboración voluntaria (con tarjeta o QR), la terminal de pagoPoint Smart emite físicamente un poema seleccionado de forma aleatoria del catálogo del proyecto.</p>
            </div>
          </div>

          <div class="feature-card">
            <div class="feature-icon">🔗</div>
            <div class="feature-text">
              <h3>Derechos de Autor Automatizados</h3>
              <p>Cada impresión genera una recompensa directa e inmediata en tokens RFC (Reward Faucet Coin) liquidados inmutablemente mediante un contrato inteligente en la red Polygon.</p>
            </div>
          </div>

          <div class="feature-card">
            <div class="feature-icon">✍️</div>
            <div class="feature-text">
              <h3>Licencia de Uso Ley 11.723</h3>
              <p>El sistema opera bajo los términos de la Ley de Propiedad Intelectual en Argentina, garantizando que todo poema de autor vivo sea reproducido con su consentimiento digital formalizado.</p>
            </div>
          </div>
        </div>

        <!-- Lado Derecho: Acceso -->
        <div class="form-card">
          <h2 id="cardTitle">✍️ Portal de Artistas</h2>
          
          <div id="notif" class="notification"></div>

          <form id="formAuth" onsubmit="handleAuth(event)">
            <!-- Firma del artista -->
            <div class="form-group">
              <label for="penName">Tu Firma o Nombre Artístico</label>
              <input type="text" id="penName" class="form-control" placeholder="Ej: Goyo.art3" required autocomplete="off">
            </div>

            <!-- Botón principal de login -->
            <button type="submit" id="btnSubmit" class="btn">Continuar al Portal</button>

            <!-- Sección de Registro (oculta inicialmente) -->
            <div id="registerSection" class="register-section">
              <h3 style="font-size: 1.1rem; color: #fff; margin-bottom: 1.2rem; font-family: 'Playfair Display', serif;">
                Completar Firma de Contrato de Licencia
              </h3>

              <div class="form-group">
                <label for="legalName">Nombre Completo (Legal)</label>
                <input type="text" id="legalName" class="form-control" placeholder="Ej: Gregorio Martín">
              </div>

              <div class="form-group">
                <label for="cuitCuil">CUIT / CUIL (Formato: XX-XXXXXXXX-X)</label>
                <input type="text" id="cuitCuil" class="form-control" placeholder="Ej: 20-34567890-9" pattern="\\d{2}-\\d{8}-\\d{1}" title="Formato requerido: XX-XXXXXXXX-X">
              </div>

              <div class="form-group">
                <label for="wallet">Wallet EVM (Recibir regalías RFC en Polygon)</label>
                <input type="text" id="wallet" class="form-control" placeholder="Ej: 0x..." pattern="0x[a-fA-F0-9]{40}" title="Dirección de 42 caracteres hexadecimales que inicie con 0x">
              </div>

              <div class="form-group" style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                <div>
                  <label for="pricePerUse">Regalía (RFC / Impresión)</label>
                  <input type="number" id="pricePerUse" class="form-control" value="1" min="1" step="1">
                </div>
                <div>
                  <label for="nationality">Residencia / Nacionalidad</label>
                  <select id="nationality" class="form-control">
                    <option value="Argentino">Argentino / Residente</option>
                  </select>
                </div>
              </div>

              <!-- Contrato legal en scrollable visor -->
              <div class="contract-viewer">
                <h3>CONTRATO DE LICENCIA DE USO DE OBRA POÉTICA</h3>
                <p><strong>Objeto:</strong> El autor firmante otorga a El Pecado Teatro una licencia de uso no exclusiva para la reproducción de sus obras en tickets de venta e impresiones térmicas emitidas por terminales Point Smart.</p>
                <br>
                <p><strong>Remuneración:</strong> El editor pagará al autor de forma automática la tarifa en tokens Reward Faucet Coin (RFC) por cada impresión realizada, transferida directamente al wallet digital proporcionado.</p>
                <br>
                <p><strong>Derechos:</strong> El autor mantiene la propiedad intelectual total y puede dar de baja su obra cuando lo desee mediante comunicación. Las partes se someten a la jurisdicción de la Ley N° 11.723 de Propiedad Intelectual en la República Argentina.</p>
                <br>
                <p><strong>Moderación:</strong> El editor se reserva el derecho de retirar de la cola de impresión cualquier obra que resulte inapropiada o contraria a las pautas éticas editoriales.</p>
              </div>

              <div class="checkbox-group">
                <input type="checkbox" id="acceptTerms">
                <label for="acceptTerms">
                  Declaro bajo juramento ser residente argentino y acepto los términos de esta licencia y moderación editorial.
                </label>
              </div>

              <button type="button" id="btnRegister" onclick="handleRegister()" class="btn" style="background: linear-gradient(135deg, var(--accent-color) 0%, var(--accent-hover) 100%); color: #0b0303;">
                Firmar Contrato y Registrarse
              </button>

              <button type="button" onclick="cancelRegistration()" class="btn btn-secondary" style="margin-top: 0.6rem;">
                Volver
              </button>
            </div>
          </form>
        </div>
      </div>

      <footer>
        EL PECADO TEATRO &bull; TODOS LOS DERECHOS RESERVADOS &bull; LEY 11.723 ARGENTINA
      </footer>

      <script>
        const notif = document.getElementById('notif');
        const registerSection = document.getElementById('registerSection');
        const penNameInput = document.getElementById('penName');
        const btnSubmit = document.getElementById('btnSubmit');
        const cardTitle = document.getElementById('cardTitle');

        function showNotif(type, message) {
          notif.className = 'notification ' + type;
          notif.textContent = message;
          notif.style.display = 'block';
          setTimeout(() => {
            notif.style.display = 'none';
          }, 6000);
        }

        async function handleAuth(event) {
          event.preventDefault();
          const penName = penNameInput.value.trim();
          if (!penName) return;

          btnSubmit.disabled = true;
          btnSubmit.textContent = 'Verificando...';

          try {
            const res = await fetch('/api/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ penName })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Error al conectar con el servidor');

            if (data.success) {
              showNotif('success', 'Sesión iniciada con éxito. Redirigiendo...');
              setTimeout(() => {
                window.location.href = '/artist';
              }, 1200);
            } else if (data.notRegistered) {
              // Mostrar sección de registro y contrato
              showNotif('info', 'Firma no encontrada. Por favor, completa tu registro y firma el contrato digital.');
              cardTitle.textContent = '🖋️ Firmar Contrato Digital';
              btnSubmit.style.display = 'none';
              penNameInput.disabled = true;
              registerSection.classList.add('active');
              
              // Ajustar requerimientos de campos
              document.getElementById('legalName').required = true;
              document.getElementById('cuitCuil').required = true;
              document.getElementById('wallet').required = true;
            }
          } catch (err) {
            showNotif('error', err.message);
          } finally {
            btnSubmit.disabled = false;
            btnSubmit.textContent = 'Continuar al Portal';
          }
        }

        async function handleRegister() {
          const penName = penNameInput.value.trim();
          const legalName = document.getElementById('legalName').value.trim();
          const cuitCuil = document.getElementById('cuitCuil').value.trim();
          const wallet = document.getElementById('wallet').value.trim();
          const pricePerUse = document.getElementById('pricePerUse').value;
          const nationality = document.getElementById('nationality').value;
          const acceptTerms = document.getElementById('acceptTerms').checked;

          if (!legalName || !cuitCuil || !wallet || !pricePerUse) {
            showNotif('error', 'Por favor completa todos los campos del registro.');
            return;
          }

          if (!acceptTerms) {
            showNotif('error', 'Debes aceptar los términos y condiciones del contrato para continuar.');
            return;
          }

          const btnRegister = document.getElementById('btnRegister');
          btnRegister.disabled = true;
          btnRegister.textContent = 'Firmando Contrato...';

          try {
            const res = await fetch('/api/register-author', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                penName,
                legalName,
                cuitCuil,
                wallet,
                pricePerUse,
                nationality,
                acceptedTerms: acceptTerms
              })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Error al registrar el autor');

            showNotif('success', '¡Contrato firmado y registro completado con éxito! Redirigiendo...');
            setTimeout(() => {
              window.location.href = '/artist';
            }, 1500);
          } catch (err) {
            showNotif('error', err.message);
            btnRegister.disabled = false;
            btnRegister.textContent = 'Firmar Contrato y Registrarse';
          }
        }

        function cancelRegistration() {
          registerSection.classList.remove('active');
          btnSubmit.style.display = 'block';
          penNameInput.disabled = false;
          cardTitle.textContent = '✍️ Portal de Artistas';
          
          document.getElementById('legalName').required = false;
          document.getElementById('cuitCuil').required = false;
          document.getElementById('wallet').required = false;
        }
      </script>
    </body>
    </html>
  `);
};

app.get('/', servePresentationPage);
app.get('/presentacion', servePresentationPage);

// Panel del Artista (Espacio Privado)
app.get('/artist', (req, res) => {
  const authorName = getAuthorFromCookie(req);
  if (!authorName) {
    return res.redirect('/presentacion');
  }

  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Panel de Artista - Poemas al Viento</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&family=Playfair+Display:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
      <style>
        :root {
          --bg-color: #0b0303;
          --card-bg: rgba(22, 10, 10, 0.7);
          --border-color: rgba(239, 68, 68, 0.15);
          --text-color: #fbecec;
          --text-muted: #cda2a2;
          --primary-color: #ef4444;
          --primary-hover: #dc2626;
          --accent-color: #fbbf24;
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
            radial-gradient(circle at 10% 20%, rgba(239, 68, 68, 0.1) 0%, transparent 40%),
            radial-gradient(circle at 90% 80%, rgba(251, 191, 36, 0.03) 0%, transparent 40%);
          color: var(--text-color);
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          line-height: 1.6;
        }

        nav {
          background: rgba(11, 3, 3, 0.85);
          backdrop-filter: blur(12px);
          border-bottom: 1px solid var(--border-color);
          padding: 1rem 2rem;
          display: flex;
          justify-content: space-between;
          align-items: center;
          position: sticky;
          top: 0;
          z-index: 100;
        }

        nav .logo {
          font-family: 'Playfair Display', serif;
          font-size: 1.5rem;
          font-weight: 700;
          color: #fff;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          text-decoration: none;
        }

        nav .logo span {
          color: var(--primary-color);
        }

        nav .user-actions {
          display: flex;
          align-items: center;
          gap: 1.2rem;
        }

        .pen-name-badge {
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.25);
          color: #ff8b8b;
          padding: 0.35rem 0.9rem;
          border-radius: 20px;
          font-size: 0.9rem;
          font-weight: 600;
        }

        .btn-logout {
          background: transparent;
          border: 1px solid rgba(255, 255, 255, 0.15);
          color: var(--text-muted);
          padding: 0.35rem 0.9rem;
          border-radius: 20px;
          font-size: 0.85rem;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn-logout:hover {
          border-color: var(--primary-color);
          color: #fff;
          background: rgba(239, 68, 68, 0.05);
        }

        .container {
          max-width: 1200px;
          margin: 2rem auto;
          padding: 0 1.5rem;
          flex: 1;
          width: 100%;
        }

        .artist-welcome {
          margin-bottom: 2rem;
        }

        .artist-welcome h2 {
          font-family: 'Playfair Display', serif;
          font-size: 2.2rem;
          color: #fff;
          margin-bottom: 0.2rem;
        }

        .artist-welcome p {
          color: var(--text-muted);
          font-size: 1rem;
        }

        .top-cards-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 2rem;
          margin-bottom: 2.5rem;
        }

        @media (max-width: 768px) {
          .top-cards-grid {
            grid-template-columns: 1fr;
            gap: 1.5rem;
          }
        }

        .card {
          background: var(--card-bg);
          backdrop-filter: blur(16px);
          border: 1px solid var(--border-color);
          border-radius: 20px;
          padding: 1.8rem;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
        }

        .card h3 {
          font-family: 'Playfair Display', serif;
          font-size: 1.35rem;
          margin-bottom: 1.2rem;
          color: #fff;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .info-item {
          display: flex;
          justify-content: space-between;
          padding: 0.7rem 0;
          border-bottom: 1px solid rgba(255, 255, 255, 0.04);
          font-size: 0.95rem;
        }

        .info-item:last-child {
          border-bottom: none;
        }

        .info-label {
          color: var(--text-muted);
        }

        .info-value {
          font-weight: 600;
          color: #fff;
        }

        .balance-amount {
          font-size: 2.8rem;
          font-weight: 800;
          color: var(--accent-color);
          text-shadow: 0 0 20px rgba(251, 191, 36, 0.25);
          margin: 0.5rem 0;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .balance-symbol {
          font-size: 1.3rem;
          font-weight: 600;
          color: var(--text-muted);
        }

        .main-grid {
          display: grid;
          grid-template-columns: 1.2fr 0.8fr;
          gap: 2rem;
        }

        @media (max-width: 992px) {
          .main-grid {
            grid-template-columns: 1fr;
          }
        }

        .table-container {
          overflow-x: auto;
          margin-top: 1rem;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
          font-size: 0.92rem;
        }

        th {
          padding: 0.8rem;
          color: var(--primary-color);
          border-bottom: 2px solid var(--border-color);
          font-weight: 600;
        }

        td {
          padding: 0.8rem;
          border-bottom: 1px solid rgba(255, 255, 255, 0.04);
          color: var(--text-muted);
        }

        tr:hover td {
          color: #fff;
          background: rgba(255, 255, 255, 0.01);
        }

        .btn {
          display: inline-block;
          width: 100%;
          padding: 0.75rem;
          background: linear-gradient(135deg, var(--primary-color) 0%, #b91c1c 100%);
          border: none;
          border-radius: 10px;
          color: white;
          font-size: 0.95rem;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.2s;
          text-align: center;
          outline: none;
          box-shadow: 0 4px 12px rgba(239, 68, 68, 0.15);
        }

        .btn:hover {
          box-shadow: 0 6px 18px rgba(239, 68, 68, 0.3);
        }

        .btn-success {
          background: linear-gradient(135deg, var(--success-color) 0%, #059669 100%);
          box-shadow: 0 4px 12px rgba(52, 211, 153, 0.15);
        }

        .btn-success:hover {
          box-shadow: 0 6px 18px rgba(52, 211, 153, 0.3);
        }

        .form-group {
          margin-bottom: 1rem;
        }

        .form-group label {
          display: block;
          font-size: 0.8rem;
          color: var(--text-muted);
          margin-bottom: 0.3rem;
          font-weight: 600;
          text-transform: uppercase;
        }

        .form-control {
          width: 100%;
          padding: 0.7rem 0.9rem;
          border-radius: 8px;
          border: 1px solid var(--border-color);
          background: rgba(0, 0, 0, 0.4);
          color: white;
          font-family: 'Outfit', sans-serif;
          font-size: 0.92rem;
          outline: none;
        }

        .form-control:focus {
          border-color: var(--primary-color);
        }

        .badge-status {
          padding: 0.2rem 0.6rem;
          border-radius: 12px;
          font-size: 0.75rem;
          font-weight: 600;
          display: inline-block;
        }

        .badge-status.success {
          background: rgba(52, 211, 153, 0.12);
          color: var(--success-color);
          border: 1px solid rgba(52, 211, 153, 0.2);
        }

        .badge-status.simulated {
          background: rgba(251, 191, 36, 0.12);
          color: var(--accent-color);
          border: 1px solid rgba(251, 191, 36, 0.2);
        }

        .toast {
          position: fixed;
          bottom: 20px;
          right: 20px;
          background: #1c0606;
          border-left: 4px solid var(--primary-color);
          color: white;
          padding: 0.9rem 1.4rem;
          border-radius: 8px;
          box-shadow: 0 10px 25px rgba(0,0,0,0.6);
          display: none;
          z-index: 1000;
          animation: slideIn 0.3s ease-out;
        }

        @keyframes slideIn {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }

        footer {
          text-align: center;
          padding: 2rem 1rem;
          border-top: 1px solid rgba(239, 68, 68, 0.08);
          color: var(--text-muted);
          font-size: 0.8rem;
          letter-spacing: 1px;
          margin-top: 3rem;
          background: rgba(11, 3, 3, 0.5);
        }
      </style>
    </head>
    <body>
      <nav>
        <a href="/presentacion" class="logo">
          ✿ <span>Poemas al Viento</span>
        </a>
        <div class="user-actions">
          <span class="pen-name-badge">✍️ Firma: ${authorName}</span>
          <button onclick="handleLogout()" class="btn-logout">Cerrar Sesión</button>
        </div>
      </nav>

      <div class="container">
        <div class="artist-welcome">
          <h2>Espacio del Creador</h2>
          <p>Supervisa tus obras publicadas, controla tus regalías RFC e inscribe nuevos poemas en la antología digital.</p>
        </div>

        <div class="top-cards-grid">
          <!-- CARD 1: PERFIL & CONTRATO -->
          <div class="card">
            <h3>📄 Contrato de Licencia</h3>
            <div class="info-item">
              <span class="info-label">Nombre Legal</span>
              <span class="info-value" id="profLegalName">Cargando...</span>
            </div>
            <div class="info-item">
              <span class="info-label">CUIT / CUIL</span>
              <span class="info-value" id="profCuitCuil">Cargando...</span>
            </div>
            <div class="info-item">
              <span class="info-label">Nacionalidad</span>
              <span class="info-value" id="profNationality">Cargando...</span>
            </div>
            <div class="info-item">
              <span class="info-label">Estado de Licencia</span>
              <span class="info-value">
                <span class="badge-status success" style="font-size: 0.8rem;" id="profContractStatus">Activo (Ley 11.723)</span>
              </span>
            </div>
          </div>

          <!-- CARD 2: BILLETERA & RFC -->
          <div class="card" style="display: flex; flex-direction: column; justify-content: space-between;">
            <div>
              <h3>🪙 Mi Billetera Digital</h3>
              <div style="font-size: 0.85rem; color: var(--text-muted); font-family: monospace; word-break: break-all; margin-bottom: 0.8rem;" id="profWallet">
                Cargando...
              </div>
            </div>
            <div>
              <span class="info-label">Saldo Acumulado</span>
              <div class="balance-amount">
                <span id="profBalance">0.00</span>
                <span class="balance-symbol">RFC</span>
              </div>
              <span style="font-size: 0.75rem; color: var(--text-muted);">
                * Liquidado al instante tras cada impresión en la terminal física.
              </span>
            </div>
          </div>
        </div>

        <div class="main-grid">
          <!-- SECCIÓN IZQUIERDA: MIS POEMAS -->
          <div>
            <div class="card" style="margin-bottom: 2rem;">
              <h3>📚 Mis Obras en la Ticketera</h3>
              <p style="color: var(--text-muted); font-size: 0.88rem; margin-bottom: 1rem;">
                Estas son tus obras cargadas actualmente en el sistema que se imprimen aleatoriamente en el local.
              </p>
              
              <div class="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Título del Poema</th>
                      <th style="text-align: center;">Impresiones</th>
                      <th style="text-align: right;">Regalías Totales</th>
                      <th style="text-align: right;">Tarifa</th>
                    </tr>
                  </thead>
                  <tbody id="poemsTableBody">
                    <tr>
                      <td colspan="4" style="text-align: center; padding: 2rem;">Cargando tus poemas...</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- SECCIÓN: REGISTRO DE TRANSACCIONES BLOCKCHAIN -->
            <div class="card">
              <h3>🔗 Payouts Blockchain (Txs)</h3>
              <p style="color: var(--text-muted); font-size: 0.88rem; margin-bottom: 1rem;">
                Historial de liquidaciones inmutables de Reward Faucet Coin (RFC) enviadas a tu billetera.
              </p>
              
              <div class="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Obra</th>
                      <th style="text-align: right;">Monto</th>
                      <th>Estado</th>
                      <th>Hash de Transacción</th>
                    </tr>
                  </thead>
                  <tbody id="txsTableBody">
                    <tr>
                      <td colspan="5" style="text-align: center; padding: 2rem;">Cargando historial...</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <!-- SECCIÓN DERECHA: SUBIR POEMA -->
          <div>
            <div class="card">
              <h3>📝 Publicar Nueva Obra</h3>
              <p style="color: var(--text-muted); font-size: 0.88rem; margin-bottom: 1.2rem;">
                Inscribe una nueva poesía en la ticketera. Tu obra estará disponible para imprimirse inmediatamente tras enviarse.
              </p>

              <form id="formUploadPoem" onsubmit="uploadPoem(event)">
                <div class="form-group">
                  <label>Firma del Creador (Fija)</label>
                  <input type="text" class="form-control" value="${authorName}" disabled style="opacity: 0.6;">
                </div>

                <div class="form-group">
                  <label for="poemTitle">Título del Poema</label>
                  <input type="text" id="poemTitle" class="form-control" placeholder="Ej: Romance de Otoño" required>
                </div>

                <div class="form-group">
                  <label for="poemContent">Contenido (Límite estricto de 400 caracteres)</label>
                  <textarea id="poemContent" class="form-control" rows="8" maxlength="400" placeholder="Escribe los versos aquí..." required oninput="updateCharCounter()"></textarea>
                  <div style="text-align: right; font-size: 0.75rem; color: var(--text-muted); margin-top: 0.2rem;" id="charCounter">
                    0 / 400
                  </div>
                </div>

                <button type="submit" id="btnUpload" class="btn btn-success">
                  Publicar Obra en el Sistema
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>

      <div id="toast" class="toast"></div>

      <footer>
        EL PECADO TEATRO &bull; TODOS LOS DERECHOS RESERVADOS &bull; LEY 11.723 ARGENTINA
      </footer>

      <script>
        const toast = document.getElementById('toast');

        function showToast(message) {
          toast.textContent = message;
          toast.style.display = 'block';
          setTimeout(() => {
            toast.style.display = 'none';
          }, 4000);
        }

        function updateCharCounter() {
          const text = document.getElementById('poemContent').value;
          document.getElementById('charCounter').textContent = text.length + ' / 400';
        }

        async function handleLogout() {
          try {
            await fetch('/api/logout', { method: 'POST' });
            showToast('Sesión cerrada correctamente. Redirigiendo...');
            setTimeout(() => {
              window.location.href = '/presentacion';
            }, 1000);
          } catch (err) {
            showToast('Error al cerrar sesión');
          }
        }

        async function loadArtistData() {
          try {
            const res = await fetch('/api/artist-data');
            if (res.status === 401) {
              window.location.href = '/presentacion';
              return;
            }
            if (!res.ok) throw new Error('Error al cargar datos del artista');

            const data = await res.json();
            
            // 1. Rellenar Perfil
            document.getElementById('profLegalName').textContent = data.profile.legalName;
            document.getElementById('profCuitCuil').textContent = data.profile.cuitCuil;
            document.getElementById('profNationality').textContent = data.profile.nationality;
            document.getElementById('profWallet').textContent = data.profile.wallet;
            document.getElementById('profBalance').textContent = data.walletBalance;

            // Fecha formateada del contrato
            if (data.profile.acceptedDate) {
              const contractDate = new Date(data.profile.acceptedDate).toLocaleDateString('es-AR');
              document.getElementById('profContractStatus').textContent = 'Firmado: ' + contractDate;
            }

            // 2. Rellenar Tabla de Poemas
            const poemsTableBody = document.getElementById('poemsTableBody');
            poemsTableBody.innerHTML = '';
            
            if (data.poems.length === 0) {
              poemsTableBody.innerHTML = \`
                <tr>
                  <td colspan="4" style="text-align: center; padding: 2rem; color: var(--text-muted);">
                    No tienes poemas publicados en el sistema todavía.
                  </td>
                </tr>
              \`;
            } else {
              data.poems.forEach(poem => {
                const totalRoyalties = (poem.prints * poem.price).toFixed(2);
                const row = document.createElement('tr');
                row.innerHTML = \`
                  <td style="font-weight: 600; color: #fff;">\${poem.title}</td>
                  <td style="text-align: center; font-family: monospace; font-weight: bold;">\${poem.prints}</td>
                  <td style="text-align: right; color: var(--success-color); font-weight: bold; font-family: monospace;">\${totalRoyalties} RFC</td>
                  <td style="text-align: right; color: var(--accent-color); font-weight: bold; font-family: monospace;">\${poem.price} RFC</td>
                \`;
                poemsTableBody.appendChild(row);
              });
            }

            // 3. Rellenar Tabla de Transacciones
            const txsTableBody = document.getElementById('txsTableBody');
            txsTableBody.innerHTML = '';

            if (data.blockchainTxs.length === 0) {
              txsTableBody.innerHTML = \`
                <tr>
                  <td colspan="5" style="text-align: center; padding: 2rem; color: var(--text-muted);">
                    No se registran pagos de regalías en esta sesión todavía.
                  </td>
                </tr>
              \`;
            } else {
              data.blockchainTxs.forEach(tx => {
                const date = new Date(tx.timestamp).toLocaleString('es-AR');
                const badgeClass = tx.isSimulated ? 'badge-status simulated' : 'badge-status success';
                const badgeLabel = tx.isSimulated ? 'Simulado' : 'Confirmado';
                const shortHash = tx.txHash.substring(0, 10) + '...' + tx.txHash.substring(tx.txHash.length - 8);
                
                const hashHtml = tx.isSimulated 
                  ? \`<span style="font-family: monospace;" title="\${tx.txHash}">\${shortHash}</span>\`
                  : \`<a href="https://amoy.polygonscan.com/tx/\${tx.txHash}" target="_blank" style="font-family: monospace; color: var(--accent-color); text-decoration: none;" title="Explorar transacción Polygonscan">\${shortHash} ↗</a>\`;

                const row = document.createElement('tr');
                row.innerHTML = \`
                  <td>\${date}</td>
                  <td style="font-style: italic; color: #fff;">\${tx.filename.replace('.txt', '')}</td>
                  <td style="text-align: right; color: var(--success-color); font-weight: bold;">\${tx.amount} RFC</td>
                  <td><span class="\${badgeClass}">\${badgeLabel}</span></td>
                  <td>\${hashHtml}</td>
                \`;
                txsTableBody.appendChild(row);
              });
            }
          } catch (err) {
            showToast(err.message);
          }
        }

        async function uploadPoem(event) {
          event.preventDefault();
          const title = document.getElementById('poemTitle').value.trim();
          const content = document.getElementById('poemContent').value.trim();
          const authorName = "${authorName}";

          if (!title || !content) {
            showToast('Por favor completa el título y el contenido.');
            return;
          }

          const btnUpload = document.getElementById('btnUpload');
          btnUpload.disabled = true;
          btnUpload.textContent = 'Publicando...';

          try {
            const res = await fetch('/api/upload-poem', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ title, content, authorName })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Error al subir el poema');

            showToast('¡Poema publicado con éxito en la antología!');
            document.getElementById('formUploadPoem').reset();
            document.getElementById('charCounter').textContent = '0 / 400';
            
            // Recargar datos para ver la nueva obra
            loadArtistData();
          } catch (err) {
            showToast(err.message);
          } finally {
            btnUpload.disabled = false;
            btnUpload.textContent = 'Publicar Obra en el Sistema';
          }
        }

        // Carga de datos inicial
        loadArtistData();
      </script>
    </body>
    </html>
  `);
});

// Dashboard Web Premium
app.get('/dashboard', (req, res) => {
  res.redirect('/admin');
});
app.get('/admin', async (req, res) => {
  const accessToken = getMPAccessToken();
  const terminalId = getMPTerminalId();
  const hasToken = (accessToken && !accessToken.includes('tu_access_token')) || isSandboxMode;
  const hasTerminal = (terminalId && !terminalId.includes('tu_terminal_id')) || isSandboxMode;

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

  // Leer estadísticas de impresión
  let stats = {};
  try {
    if (fs.existsSync(STATS_FILE)) {
      stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error leyendo estadísticas de impresión:', e);
  }

  // Obtener todos los poemas y mapear sus estadísticas
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
  } catch (e) {
    console.error('Error generando lista de estadísticas:', e);
  }

  // Ordenar por cantidad de impresiones (descendente)
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
          max-width: 1050px;
          margin: 0 auto;
        }

        header {
          text-align: center;
          margin-bottom: 2.5rem;
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

        /* Tabs styling */
        .tabs {
          display: flex;
          justify-content: center;
          gap: 1rem;
          margin-bottom: 2.5rem;
        }

        .tab-btn {
          padding: 0.8rem 1.8rem;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid var(--border-color);
          border-radius: 12px;
          color: var(--text-muted);
          font-family: 'Outfit', sans-serif;
          font-weight: 600;
          font-size: 0.95rem;
          cursor: pointer;
          transition: all 0.2s;
        }

        .tab-btn:hover {
          background: rgba(192, 132, 252, 0.08);
          color: var(--text-color);
        }

        .tab-btn.active {
          background: var(--primary-color);
          border-color: var(--primary-color);
          color: #0b0f19;
          box-shadow: 0 0 15px rgba(192, 132, 252, 0.4);
        }

        .tab-content {
          display: none;
          animation: fadeIn 0.3s ease-in-out;
        }

        .tab-content.active {
          display: block;
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
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

        .split-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 2rem;
        }

        @media (min-width: 900px) {
          .split-grid {
            grid-template-columns: 1.1fr 0.9fr;
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

        /* Visor del contrato legal */
        .contract-viewer {
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid var(--border-color);
          border-radius: 12px;
          padding: 1.25rem;
          max-height: 280px;
          overflow-y: auto;
          font-family: 'Outfit', sans-serif;
          font-size: 0.9rem;
          color: var(--text-muted);
          margin-bottom: 1.5rem;
          line-height: 1.5;
        }

        .contract-viewer h3 {
          color: #fff;
          font-family: 'Playfair Display', serif;
          margin-bottom: 0.8rem;
          text-align: center;
          font-size: 1.1rem;
        }

        .form-group {
          margin-bottom: 1.2rem;
        }

        .form-group label {
          display: block;
          font-size: 0.9rem;
          color: var(--text-muted);
          margin-bottom: 0.4rem;
          font-weight: 600;
        }

        .form-control {
          width: 100%;
          padding: 0.75rem 0.85rem;
          border-radius: 10px;
          border: 1px solid var(--border-color);
          background: rgba(0, 0, 0, 0.45);
          color: white;
          font-family: 'Outfit', sans-serif;
          font-size: 0.95rem;
          outline: none;
          transition: border-color 0.2s;
        }

        .form-control:focus {
          border-color: var(--primary-color);
        }

        .checkbox-group {
          display: flex;
          gap: 0.5rem;
          align-items: flex-start;
          margin: 1.2rem 0;
          font-size: 0.85rem;
          color: var(--text-muted);
          cursor: pointer;
        }

        .checkbox-group input {
          margin-top: 0.2rem;
        }

        .badge-simulated {
          background: rgba(251, 191, 36, 0.12);
          color: #fbbf24;
          border: 1px solid rgba(251, 191, 36, 0.2);
          padding: 0.15rem 0.45rem;
          border-radius: 4px;
          font-size: 0.75rem;
          font-weight: 600;
        }

        .badge-real {
          background: rgba(52, 211, 153, 0.12);
          color: var(--success-color);
          border: 1px solid rgba(52, 211, 153, 0.2);
          padding: 0.15rem 0.45rem;
          border-radius: 4px;
          font-size: 0.75rem;
          font-weight: 600;
        }

        @keyframes slideIn {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes pulse {
          0% { opacity: 0.6; }
          50% { opacity: 1; }
          100% { opacity: 0.6; }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <header>
          <h1>✿ Poemas al Viento ✿</h1>
          <p class="subtitle">Integración de Mercado Pago Point Smart & Impresión de Poemas</p>
        </header>

        <!-- TABS DE NAVEGACIÓN -->
        <div class="tabs">
          <button id="tabBtnSmart" class="tab-btn active" onclick="switchTab('tab-smart')">📟 Point Smart Dashboard</button>
          <button id="tabBtnAutores" class="tab-btn" onclick="switchTab('tab-autores')">✍️ Portal de Autores y Regalías RFC</button>
        </div>

        <!-- CONTENIDO TAB 1: POINT SMART DASHBOARD -->
        <div id="tab-smart" class="tab-content active">
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
              <button id="btnTestLogo" class="btn btn-secondary" ${!hasToken || !hasTerminal ? 'disabled' : ''} style="margin-top: 0.5rem; border-color: rgba(192, 132, 252, 0.3);">
                🖼️ Imprimir Logo de Prueba
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

            <!-- CARD DE SIMULADOR SANDBOX (PRUEBAS) -->
            <div class="card full-width" style="border-color: rgba(251, 191, 36, 0.2); background: rgba(251, 191, 36, 0.02);">
              <h2>
                <span class="status-indicator" id="sandboxBadge" style="background-color: #fbbf24; box-shadow: 0 0 10px #fbbf24;"></span>
                Simulador de Entorno de Pruebas (Mercado Pago Sandbox)
              </h2>
              <p style="color: var(--text-muted); font-size: 0.95rem; margin-bottom: 1.5rem;">
                Habilita el simulador para probar los flujos de cobro, webhook e impresión sin necesidad de una terminal Point física vinculada, evitando el error <strong>409 Conflict</strong>.
              </p>
              
              <div style="display: flex; gap: 1rem; align-items: center; margin-bottom: 1.5rem; flex-wrap: wrap; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 1rem;">
                <span style="font-weight: 600; color: #fff;">Estado del Simulador:</span>
                <div style="display: flex; gap: 0.5rem; align-items: center;">
                  <button id="btnToggleSandbox" class="btn" style="width: auto; margin-top: 0; padding: 0.5rem 1.25rem; font-size: 0.9rem; background: #fbbf24; color: #0b0f19; box-shadow: 0 0 10px rgba(251, 191, 36, 0.3);">
                    Cargando...
                  </button>
                </div>
                <div style="font-size: 0.85rem; color: var(--text-muted);" id="sandboxStatusDesc">
                  Detectando credenciales...
                </div>
              </div>

              <!-- CONTROLES DEL SIMULADOR (Solo si Sandbox está activo) -->
              <div id="sandboxControls" style="display: none; animation: fadeIn 0.3s ease-in-out;">
                <div class="grid" style="grid-template-columns: 1fr; gap: 1.5rem; margin-bottom: 1.5rem;">
                  <!-- Subcard 1: Flujo de cobro simulado -->
                  <div style="background: rgba(255, 255, 255, 0.02); padding: 1.25rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.05);">
                    <h3 style="font-size: 1.1rem; color: #fff; margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.5rem;">📟 Terminal Virtual</h3>
                    <div id="simulatedOrderContainer">
                      <p style="color: var(--text-muted); font-size: 0.9rem;">No hay cobros activos en curso en este momento. Envía un cobro usando la tarjeta de arriba o haz una simulación directa.</p>
                    </div>
                  </div>

                  <!-- Subcard 2: Simulador de Webhook -->
                  <div style="background: rgba(255, 255, 255, 0.02); padding: 1.25rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.05);">
                    <h3 style="font-size: 1.1rem; color: #fff; margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.5rem;">🔔 Simular Webhook de Pago</h3>
                    <p style="color: var(--text-muted); font-size: 0.88rem; margin-bottom: 0.75rem;">
                      Dispara un webhook local de pago aprobado. Esto simula que Mercado Pago notifica un cobro exitoso, gatillando automáticamente la impresión del poema y la liquidación blockchain.
                    </p>
                    <div style="display: flex; gap: 0.5rem; align-items: center;">
                      <span style="font-weight: bold; color: var(--success-color);">$</span>
                      <input type="number" id="webhookSimAmount" value="50.00" step="1.00" min="15.00" style="width: 100px; padding: 0.5rem; border-radius: 6px; border: 1px solid var(--border-color); background: rgba(0,0,0,0.3); color: white; font-family: monospace;">
                      <button id="btnSimulateWebhook" class="btn" style="flex: 1; margin-top: 0; padding: 0.5rem 1rem; font-size: 0.88rem; background: linear-gradient(135deg, #10b981 0%, #059669 100%);">
                        Disparar Webhook de Pago
                      </button>
                    </div>
                  </div>
                </div>

                <!-- Historial de Impresiones Simuladas -->
                <div style="background: rgba(255, 255, 255, 0.01); padding: 1.5rem; border-radius: 15px; border: 1px solid rgba(255,255,255,0.04);">
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                    <h3 style="font-size: 1.2rem; color: #fff; display: flex; align-items: center; gap: 0.5rem;">📜 Historial de Tickets Impresos (Simulación)</h3>
                    <button id="btnClearSimPrints" class="btn btn-secondary" style="width: auto; margin-top: 0; padding: 0.4rem 0.8rem; font-size: 0.8rem; border-color: rgba(248,113,113,0.2); color: var(--error-color);">
                      Vaciar Historial
                    </button>
                  </div>
                  <p style="color: var(--text-muted); font-size: 0.88rem; margin-bottom: 1rem;">
                    Abajo puedes ver cómo se verían los tickets impresos físicamente por la Point Smart. Las etiquetas de la ticketera se renderizan simulando el papel térmico real.
                  </p>
                  
                  <div id="simulatedPrintsHistory" style="display: flex; gap: 1.5rem; overflow-x: auto; padding: 0.5rem 0; min-height: 100px;">
                    <div style="color: var(--text-muted); font-style: italic; width: 100%; text-align: center; padding: 1.5rem 0;">
                      Aún no hay impresiones simuladas registradas. Realiza un cobro o prueba manual arriba.
                    </div>
                  </div>
                </div>
              </div>
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

            <!-- CARD DE ESTADÍSTICAS -->
            <div class="card full-width">
              <h2>📊 Informe de Reproducción y Derechos de Autor</h2>
              <p style="color: var(--text-muted); font-size: 0.95rem; margin-bottom: 1.5rem;">
                Control de impresiones para liquidación de regalías y cumplimiento de la Ley de Propiedad Intelectual N° 11.723 en Argentina.
              </p>
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
                  * Nota: Según la Ley 11.723, la reproducción de poemas de autores vivos (como Goyo.art3) requiere autorización expresa y puede estar sujeta al pago de aranceles.
                </span>
                <button id="btnResetStats" class="btn btn-secondary" style="width: auto; margin-top: 0; padding: 0.5rem 1rem; font-size: 0.85rem; border-color: rgba(248, 113, 113, 0.3); color: var(--error-color);">
                  🗑️ Reiniciar Contadores
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- CONTENIDO TAB 2: PORTAL DE AUTORES Y BLOCKCHAIN -->
        <div id="tab-autores" class="tab-content">
          <div class="grid">
            
            <!-- INFORMACIÓN DE REGISTROS -->
            <div class="card full-width" style="border-color: rgba(192, 132, 252, 0.2); background: rgba(192, 132, 252, 0.02);">
              <h2 style="font-family: 'Playfair Display', serif; color: #fff;">👥 Portal de Artistas Separado</h2>
              <p style="color: var(--text-muted); font-size: 0.95rem; margin-bottom: 1rem;">
                El registro de firmas de autor, la aceptación digital de contratos (Ley N° 11.723) y la publicación de nuevas obras poéticas se han trasladado a un portal exclusivo para artistas para una mejor experiencia de usuario.
              </p>
              <a href="/presentacion" class="btn" style="width: auto; display: inline-block; padding: 0.6rem 1.5rem; font-size: 0.9rem; margin-top: 0; background: linear-gradient(135deg, var(--primary-color) 0%, #a855f7 100%);">
                🔗 Ir al Portal de Artistas (Presentación / Login)
              </a>
            </div>
            </div>

            <!-- TARJETA: TABLA DE AUTORES Y SALDOS -->
            <div class="card full-width">
              <h2>👥 Firmas Autorizadas y Balances de Red</h2>
              <p style="color: var(--text-muted); font-size: 0.95rem; margin-bottom: 1rem;">
                Balances consultados en tiempo real desde la blockchain local o Polygon Amoy.
              </p>
              <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.95rem;">
                  <thead>
                    <tr style="border-bottom: 2px solid var(--border-color); color: var(--primary-color);">
                      <th style="padding: 0.8rem;">Firma de Autor</th>
                      <th style="padding: 0.8rem;">Nombre Legal</th>
                      <th style="padding: 0.8rem;">CUIT/CUIL</th>
                      <th style="padding: 0.8rem;">Wallet Destinatario</th>
                      <th style="padding: 0.8rem; text-align: right;">Tarifa por Uso</th>
                      <th style="padding: 0.8rem; text-align: right;">Saldo en Wallet</th>
                    </tr>
                  </thead>
                  <tbody id="tablaAutoresBody">
                    <!-- Rellenado por JS -->
                  </tbody>
                </table>
              </div>
            </div>

            <!-- TARJETA: HISTORIAL DE TRANSACCIONES BLOCKCHAIN -->
            <div class="card full-width">
              <h2>🔗 Registro de Transacciones Blockchain (Tokens RFC)</h2>
              <p style="color: var(--text-muted); font-size: 0.95rem; margin-bottom: 1.5rem;">
                Liquidación automatizada e inmutable de regalías RFC por impresión en Point Smart.
              </p>
              <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.95rem;">
                  <thead>
                    <tr style="border-bottom: 2px solid var(--border-color); color: var(--primary-color);">
                      <th style="padding: 0.8rem;">Fecha y Hora</th>
                      <th style="padding: 0.8rem;">Autor</th>
                      <th style="padding: 0.8rem;">Poema</th>
                      <th style="padding: 0.8rem;">Wallet Destino</th>
                      <th style="padding: 0.8rem; text-align: right;">Monto RFC</th>
                      <th style="padding: 0.8rem;">Estado</th>
                      <th style="padding: 0.8rem;">Hash de Transacción</th>
                    </tr>
                  </thead>
                  <tbody id="tablaTxsBody">
                    <!-- Rellenado por JS -->
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        </div>

      </div>

      <div id="toast" class="toast">¡Imprimiendo poema de prueba!</div>

      <script>
        // Rellenar dinámicamente la URL del webhook basada en el navegador actual
        document.getElementById('webhookUrl').textContent = window.location.origin + '/webhook';

        // Cambiar entre pestañas
        function switchTab(tabId) {
          // Ocultar todos los contenidos de pestañas
          document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
          // Desactivar todos los botones
          document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
          
          // Mostrar la pestaña seleccionada
          document.getElementById(tabId).classList.add('active');
          
          // Activar el botón de la pestaña correspondiente
          if (tabId === 'tab-smart') {
            document.getElementById('tabBtnSmart').classList.add('active');
          } else if (tabId === 'tab-autores') {
            document.getElementById('tabBtnAutores').classList.add('active');
            loadAuthorPortalData();
          }
        }

        // Contador de caracteres para poemas
        function actualizarContadorPoema() {
          const content = document.getElementById('poemContent').value;
          document.getElementById('charCounter').textContent = content.length + ' / 400';
        }

        // Cargar datos dinámicos del portal de autores
        async function loadAuthorPortalData() {
          try {
            const response = await fetch('/api/author-portal-data');
            if (!response.ok) throw new Error('No se pudieron obtener datos del portal de autores');
            
            const data = await response.json();

            // 1. Rellenar tabla de autores
            const tablaAutoresBody = document.getElementById('tablaAutoresBody');
            tablaAutoresBody.innerHTML = '';
            
            const poemAuthorSelect = document.getElementById('poemAuthorSelect');
            if (poemAuthorSelect) {
              poemAuthorSelect.innerHTML = '<option value="">-- Selecciona tu Firma Autorizada --</option>';
            }

            const authorNames = Object.keys(data.authors);
            if (authorNames.length === 0) {
              tablaAutoresBody.innerHTML = \`
                <tr>
                  <td colspan="6" style="padding: 1.5rem; text-align: center; color: var(--text-muted);">
                    No hay autores registrados en el sistema digital todavía.
                  </td>
                </tr>
              \`;
            } else {
              authorNames.forEach(name => {
                const author = data.authors[name];
                
                // Buscar balance del autor
                let balance = '0.00 RFC';
                // Encontrar un poema del autor para ver el balance de su wallet
                const matchingPoem = data.poems.find(p => p.author === name);
                if (matchingPoem) {
                  balance = matchingPoem.walletBalance + ' RFC';
                }

                const row = document.createElement('tr');
                row.style.borderBottom = '1px solid rgba(255, 255, 255, 0.05)';
                row.innerHTML = \`
                  <td style="padding: 0.8rem; font-weight: 600; color: #fff;">\${name}</td>
                  <td style="padding: 0.8rem; color: var(--text-muted);">\${author.legalName}</td>
                  <td style="padding: 0.8rem; color: var(--text-muted);">\${author.cuitCuil}</td>
                  <td style="padding: 0.8rem; font-family: monospace; font-size: 0.85rem; color: var(--primary-color);">\${author.wallet}</td>
                  <td style="padding: 0.8rem; text-align: right; font-weight: bold; color: var(--success-color);">\${author.pricePerUse} RFC</td>
                  <td style="padding: 0.8rem; text-align: right; font-family: monospace; font-weight: bold; color: #fff;">\${balance}</td>
\`;
                tablaAutoresBody.appendChild(row);

                // Añadir al select
                if (poemAuthorSelect) {
                  const option = document.createElement('option');
                  option.value = name;
                  option.textContent = name + ' (' + author.legalName + ')';
                  poemAuthorSelect.appendChild(option);
                }
              });
            }

            // 2. Rellenar tabla de transacciones blockchain
            const tablaTxsBody = document.getElementById('tablaTxsBody');
            tablaTxsBody.innerHTML = '';

            if (data.blockchainTxs.length === 0) {
              tablaTxsBody.innerHTML = \`
                <tr>
                  <td colspan="7" style="padding: 1.5rem; text-align: center; color: var(--text-muted);">
                    No se han registrado transacciones blockchain en esta sesión.
                  </td>
                </tr>
              \`;
            } else {
              data.blockchainTxs.forEach(tx => {
                const date = new Date(tx.timestamp).toLocaleString('es-AR');
                const badge = tx.isSimulated 
                  ? '<span class="badge-simulated">Simulada</span>' 
                  : '<span class="badge-real">Real (Confirmada)</span>';
                
                const shortHash = tx.txHash.substring(0, 10) + '...' + tx.txHash.substring(tx.txHash.length - 8);
                const hashHtml = tx.isSimulated 
                  ? \`<span style="font-family: monospace; font-size: 0.85rem; color: var(--text-muted);" title="\${tx.txHash}">\${shortHash}</span>\`
                  : \`<a href="https://amoy.polygonscan.com/tx/\${tx.txHash}" target="_blank" style="font-family: monospace; font-size: 0.85rem; color: var(--primary-color);" title="Ver en explorador Polygonscan">\${shortHash} ↗</a>\`;

                const row = document.createElement('tr');
                row.style.borderBottom = '1px solid rgba(255, 255, 255, 0.05)';
                row.innerHTML = \`
                  <td style="padding: 0.8rem; color: var(--text-muted);">\${date}</td>
                  <td style="padding: 0.8rem; font-weight: 600; color: #fff;">\${tx.author}</td>
                  <td style="padding: 0.8rem; color: var(--text-muted); font-style: italic;">\${tx.filename}</td>
                  <td style="padding: 0.8rem; font-family: monospace; font-size: 0.82rem; color: var(--text-muted);">\${tx.wallet}</td>
                  <td style="padding: 0.8rem; text-align: right; font-weight: bold; color: var(--success-color);">\${tx.amount} RFC</td>
                  <td style="padding: 0.8rem;">\${badge}</td>
                  <td style="padding: 0.8rem;">\${hashHtml}</td>
                \`;
                tablaTxsBody.appendChild(row);
              });
            }
          } catch (err) {
            console.error('Error cargando los datos del portal:', err);
          }
        }

        // Manejar el envío de registro de autores
        const formRegistro = document.getElementById('formRegistro');
        if (formRegistro) {
          formRegistro.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btnSubmit = formRegistro.querySelector('button[type="submit"]');
            btnSubmit.disabled = true;
            btnSubmit.textContent = 'Procesando Firma...';

            const payload = {
              penName: document.getElementById('penName').value,
              legalName: document.getElementById('legalName').value,
              cuitCuil: document.getElementById('cuitCuil').value,
              wallet: document.getElementById('wallet').value,
              pricePerUse: document.getElementById('pricePerUse').value,
              nationality: document.getElementById('nationality').value,
              acceptedTerms: document.getElementById('acceptTerms').checked
            };

            try {
              const response = await fetch('/api/register-author', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
              });

              const data = await response.json();
              if (response.ok) {
                showToast('¡Firma de autor registrada y contrato firmado digitalmente!');
                formRegistro.reset();
                loadAuthorPortalData();
              } else {
                showToast('Error: ' + data.error);
              }
            } catch (err) {
              showToast('Error de conexión al registrar autor.');
            } finally {
              btnSubmit.disabled = false;
              btnSubmit.textContent = '🖋️ Aceptar y Registrar';
            }
          });
        }

        // Manejar la subida de poemas
        const formPoema = document.getElementById('formPoema');
        if (formPoema) {
          formPoema.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btnSubmit = formPoema.querySelector('button[type="submit"]');
            btnSubmit.disabled = true;
            btnSubmit.textContent = 'Publicando Poema...';

            const payload = {
              authorName: document.getElementById('poemAuthorSelect').value,
              title: document.getElementById('poemTitle').value,
              content: document.getElementById('poemContent').value
            };

            try {
              const response = await fetch('/api/upload-poem', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
              });

              const data = await response.json();
              if (response.ok) {
                showToast('¡Poema publicado y cargado en el sistema con éxito!');
                formPoema.reset();
                document.getElementById('charCounter').textContent = '0 / 400';
                loadAuthorPortalData();
              } else {
                showToast('Error: ' + data.error);
              }
            } catch (err) {
              showToast('Error de red al subir el poema.');
            } finally {
              btnSubmit.disabled = false;
              btnSubmit.textContent = '🚀 Publicar Obra en el Point Smart';
            }
          });
        }

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

        // Manejar botón de prueba de impresión de logo
        const btnTestLogo = document.getElementById('btnTestLogo');

        if (btnTestLogo) {
          btnTestLogo.addEventListener('click', async () => {
            btnTestLogo.disabled = true;
            btnTestLogo.textContent = 'Enviando logo...';
            
            try {
              const response = await fetch('/test-print-logo', { method: 'POST' });
              const data = await response.json();
              
              if (response.ok) {
                showToast('¡Logo de prueba enviado a la ticketera!');
              } else {
                showToast('Error: ' + data.error);
              }
            } catch (err) {
              showToast('Error de red al intentar imprimir.');
            } finally {
              btnTestLogo.disabled = false;
              btnTestLogo.textContent = '🖼️ Imprimir Logo de Prueba';
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

        // Manejar botón de reinicio de estadísticas
        const btnResetStats = document.getElementById('btnResetStats');
        if (btnResetStats) {
          btnResetStats.addEventListener('click', async () => {
            if (!confirm('¿Estás seguro de que deseas reiniciar los contadores de impresión a cero? Esta acción no se puede deshacer.')) {
              return;
            }

            btnResetStats.disabled = true;
            btnResetStats.textContent = 'Reiniciando...';

            try {
              const response = await fetch('/reset-stats', { method: 'POST' });
              const data = await response.json();

              if (response.ok) {
                showToast('¡Contadores reiniciados con éxito!');
                setTimeout(() => {
                  window.location.reload();
                }, 1500);
              } else {
                showToast('Error: ' + data.error);
              }
            } catch (err) {
              showToast('Error de red al intentar reiniciar estadísticas.');
            } finally {
              btnResetStats.disabled = false;
              btnResetStats.textContent = '🗑️ Reiniciar Contadores';
            }
          });
        }

        function showToast(message) {
          toast.textContent = message;
          toast.style.display = 'block';
          setTimeout(() => {
            toast.style.display = 'none';
          }, 4000);
        }

        // --- Lógica del Simulador Sandbox (Mercado Pago) ---
        let simulatedPrints = [];
        
        function formatReceiptHtml(content) {
          if (content === 'Logo Base64') {
            return '<div style="text-align: center; padding: 1rem 0;">' +
              '<div style="font-weight: bold; font-family: monospace;">🖼️ LOGOTIPO DE EL PECADO TEATRO 🖼️</div>' +
              '<div style="font-size: 0.75rem; color: var(--text-muted);">[Imagen Base64]</div>' +
            '</div>';
          }
          
          let html = content;
          html = html.replace(/{br}/g, '<br>');
          html = html.replace(/{center}/g, '<div style="text-align: center;">');
          html = html.replace(/{\/center}/g, '</div>');
          html = html.replace(/{b}/g, '<strong>');
          html = html.replace(/{\/b}/g, '</strong>');
          html = html.replace(/{w}/g, '<span style="font-size: 1.15rem; font-weight: 800; display: inline-block;">');
          html = html.replace(/{\/w}/g, '</span>');
          html = html.replace(/{s}/g, '<span style="font-size: 0.8rem; opacity: 0.8; display: inline-block;">');
          html = html.replace(/{\/s}/g, '</span>');
          
          return '<div style="background: #ffffff; color: #111827; padding: 1rem; border-radius: 4px; font-family: monospace; font-size: 0.82rem; line-height: 1.3; box-shadow: inset 0 0 10px rgba(0,0,0,0.1); border-left: 2px dashed #d1d5db; border-right: 2px dashed #d1d5db; margin-top: 0.5rem; text-align: left; max-height: 250px; overflow-y: auto; width: 100%;">' +
            html +
          '</div>';
        }

        async function loadSandboxStatus() {
          try {
            const response = await fetch('/api/sandbox/status');
            if (!response.ok) throw new Error('Error al cargar estado del Sandbox');
            
            const data = await response.json();
            const isSandbox = data.isSandboxMode;
            
            // Actualizar insignias de modo
            const badge = document.getElementById('sandboxBadge');
            const toggleBtn = document.getElementById('btnToggleSandbox');
            const statusDesc = document.getElementById('sandboxStatusDesc');
            const controlsDiv = document.getElementById('sandboxControls');
            
            // Habilitar los botones de prueba y cobro incluso si no hay tokens/terminal configurados reales
            document.getElementById('btnTest').disabled = false;
            document.getElementById('btnTestLogo').disabled = false;
            
            if (isSandbox) {
              badge.className = 'status-indicator status-ok';
              toggleBtn.textContent = '❌ Desactivar Modo Sandbox';
              toggleBtn.style.background = '#f87171';
              toggleBtn.style.color = 'white';
              toggleBtn.style.boxShadow = '0 0 10px rgba(248, 113, 113, 0.3)';
              statusDesc.innerHTML = '<strong>Modo Sandbox ACTIVO</strong>. Las llamadas a las terminales y cobros reales están siendo interceptadas y simuladas localmente.';
              controlsDiv.style.display = 'block';
            } else {
              badge.className = 'status-indicator status-warning';
              toggleBtn.textContent = '🔌 Activar Modo Sandbox';
              toggleBtn.style.background = '#fbbf24';
              toggleBtn.style.color = '#0b0f19';
              toggleBtn.style.boxShadow = '0 0 10px rgba(251, 191, 36, 0.3)';
              statusDesc.innerHTML = 'Modo Producción Activo. El sistema intentará comunicarse con terminales Point reales de Mercado Pago.';
              controlsDiv.style.display = 'none';
            }
            
            // Rellenar orden activa
            const simulatedOrderContainer = document.getElementById('simulatedOrderContainer');
            if (data.activeOrder) {
              const order = data.activeOrder;
              simulatedOrderContainer.innerHTML = \`
                <div style="background: rgba(251, 191, 36, 0.05); border: 1px solid rgba(251,191,36,0.2); border-radius: 8px; padding: 1rem;">
                  <div style="display: flex; justify-content: space-between; font-weight: 600; margin-bottom: 0.5rem; align-items: center;">
                    <span>Cobro en Curso: <strong style="color: #fbbf24; font-family: monospace;">\${order.id}</strong></span>
                    <span style="color: #fbbf24; font-weight: bold; animation: pulse 1.5s infinite;">● \${order.status.toUpperCase()}</span>
                  </div>
                  <div style="font-size: 1.4rem; font-weight: 800; color: #fff; margin-bottom: 0.75rem;">
                    Monto: \$\${order.amount.toFixed(2)}
                  </div>
                  <p style="color: var(--text-muted); font-size: 0.88rem; margin-bottom: 1rem;">
                    \${order.status === 'created' ? 'Inicializando orden de cobro...' : 'Esperando interacción del cliente. Pasa la tarjeta para completar el flujo:'}
                  </p>
                  <div style="display: flex; gap: 0.5rem;">
                    <button onclick="simulateSwipe()" class="btn" style="margin-top: 0; padding: 0.5rem 1rem; font-size: 0.85rem; background: #fbbf24; color: #0b0f19; flex: 1;">
                      💳 Simular Pase de Tarjeta (Aprobar)
                    </button>
                    <button onclick="simulateCancelOrder()" class="btn btn-secondary" style="margin-top: 0; padding: 0.5rem; font-size: 0.85rem; color: var(--error-color); border-color: rgba(248,113,113,0.3); flex: 0.4;">
                      Cancelar
                    </button>
                  </div>
                </div>
              \`;
            } else {
              simulatedOrderContainer.innerHTML = \`
                <p style="color: var(--text-muted); font-size: 0.9rem;">
                  No hay cobros activos en curso en este momento. Envía un cobro usando la tarjeta <strong>"Iniciar Cobro en Terminal"</strong> de arriba para iniciar el flujo.
                </p>
              \`;
            }
            
            // Rellenar historial de impresiones simuladas
            const printsHistory = document.getElementById('simulatedPrintsHistory');
            if (data.simulatedPrints.length === 0) {
              printsHistory.innerHTML = \`<div style="color: var(--text-muted); font-style: italic; width: 100%; text-align: center; padding: 1.5rem 0;">Aún no hay impresiones simuladas registradas. Realiza un cobro o prueba manual arriba.</div>\`;
            } else {
              printsHistory.innerHTML = data.simulatedPrints.map(print => {
                const typeLabel = print.type === 'logo' ? '🖼️ Logotipo' : '📜 Poema';
                const time = new Date(print.timestamp).toLocaleTimeString('es-AR');
                return \`
                  <div style="flex: 0 0 auto; display: flex; flex-direction: column; align-items: center; border: 1px solid var(--border-color); padding: 0.75rem; border-radius: 8px; background: rgba(255,255,255,0.02); min-width: 280px; max-width: 280px;">
                    <div style="font-size: 0.8rem; font-weight: bold; width: 100%; display: flex; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 0.25rem; margin-bottom: 0.5rem; align-items: center;">
                      <span style="color: var(--primary-color);">\${typeLabel}</span>
                      <span style="color: var(--text-muted);">\${time}</span>
                    </div>
                    \${formatReceiptHtml(print.formattedContent)}
                  </div>
                \`;
              }).join('');
            }
            
          } catch (err) {
            console.error('Error al cargar estado de Sandbox:', err);
          }
        }
        
        // Manejar botón de alternar Sandbox
        const btnToggleSandbox = document.getElementById('btnToggleSandbox');
        if (btnToggleSandbox) {
          btnToggleSandbox.addEventListener('click', async () => {
            const isCurrentlySandbox = btnToggleSandbox.textContent.includes('Desactivar');
            const targetState = !isCurrentlySandbox;
            
            btnToggleSandbox.disabled = true;
            
            try {
              const response = await fetch('/api/sandbox/toggle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled: targetState })
              });
              
              if (response.ok) {
                showToast(\`Modo Sandbox \${targetState ? 'activado' : 'desactivado'} con éxito.\`);
                loadSandboxStatus();
              } else {
                showToast('Error al cambiar el modo Sandbox');
              }
            } catch (err) {
              showToast('Error de red al cambiar el modo Sandbox');
            } finally {
              btnToggleSandbox.disabled = false;
            }
          });
        }
        
        // Simular pase de tarjeta
        async function simulateSwipe() {
          try {
            const response = await fetch('/api/sandbox/simulate-swipe', { method: 'POST' });
            if (response.ok) {
              showToast('¡Pago aprobado en simulador! Procesando impresión del poema y royalties...');
              loadSandboxStatus();
            } else {
              const data = await response.json();
              showToast('Error: ' + data.error);
            }
          } catch (e) {
            showToast('Error al simular el pase de tarjeta.');
          }
        }
        
        // Simular cancelación
        async function simulateCancelOrder() {
          try {
            const response = await fetch('/api/sandbox/simulate-cancel-order', { method: 'POST' });
            if (response.ok) {
              showToast('Cobro simulado cancelado con éxito.');
              loadSandboxStatus();
            } else {
              const data = await response.json();
              showToast('Error: ' + data.error);
            }
          } catch (e) {
            showToast('Error al simular la cancelación de la orden.');
          }
        }
        
        // Simular Webhook
        const btnSimulateWebhook = document.getElementById('btnSimulateWebhook');
        if (btnSimulateWebhook) {
          btnSimulateWebhook.addEventListener('click', async () => {
            const amountInput = document.getElementById('webhookSimAmount');
            const amount = parseFloat(amountInput.value) || 15.00;
            
            btnSimulateWebhook.disabled = true;
            btnSimulateWebhook.textContent = 'Enviando webhook...';
            
            try {
              const response = await fetch('/api/sandbox/simulate-webhook', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount })
              });
              
              if (response.ok) {
                showToast(\`Webhook simulado para pago de \$\${amount} enviado con éxito.\`);
                loadSandboxStatus();
              } else {
                showToast('Error al enviar webhook simulado.');
              }
            } catch (e) {
              showToast('Error de red al enviar webhook simulado.');
            } finally {
              btnSimulateWebhook.disabled = false;
              btnSimulateWebhook.textContent = 'Disparar Webhook de Pago';
            }
          });
        }
        
        // Vaciar historial de impresiones simuladas
        const btnClearSimPrints = document.getElementById('btnClearSimPrints');
        if (btnClearSimPrints) {
          btnClearSimPrints.addEventListener('click', async () => {
            try {
              const response = await fetch('/api/sandbox/clear-prints', { method: 'POST' });
              if (response.ok) {
                showToast('Historial de impresiones vaciado.');
                loadSandboxStatus();
              }
            } catch (e) {
              showToast('Error al vaciar historial de impresiones.');
            }
          });
        }
        
        // Iniciar polling del estado de Sandbox cada 2 segundos
        setInterval(loadSandboxStatus, 2000);
        loadSandboxStatus();

        // Cargar datos por defecto al iniciar
        loadAuthorPortalData();
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
          transition: all 0.2s;
          outline: none;
        }

        .preset-btn:hover {
          background: rgba(239, 68, 68, 0.12);
          border-color: rgba(239, 68, 68, 0.3);
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
          transition: all 0.2s;
          box-shadow: 0 4px 20px rgba(239, 68, 68, 0.25);
          text-transform: uppercase;
          outline: none;
        }

        .btn-action:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 6px 25px rgba(239, 68, 68, 0.45);
        }

        .btn-action:active:not(:disabled) {
          transform: scale(0.98);
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
      </style>
    </head>
    <body>
      <div class="container">
        <div class="logo-container">
          <img src="/logo.jpg" alt="El Pecado Logo" class="logo-img" onerror="this.src='https://img.icons8.com/color/120/apple.png'">
        </div>
        
        <h1>El Pecado</h1>
        <div class="tagline">¿Cuál será tu tentación esta noche?</div>

        <div class="card">
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
        </div>

        <div class="footer">
          EL PECADO TEATRO &bull; ELPECADO.AR
        </div>
      </div>

      <div id="toast" class="toast"></div>

      <script>
        let activeAmount = 200;

        function selectPreset(amount) {
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
            btn.disabled = false;
            btn.textContent = '🍎 Pecar... digo Pagar';
          }
        }

        async function imprimirEfectivo() {
          const btn = document.getElementById('btnImprimirEfectivo');
          btn.disabled = true;
          btn.textContent = '💵 Imprimiendo...';

          try {
            const response = await fetch('/print-logo-and-poem', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              }
            });

            const data = await response.json();

            if (response.ok) {
              showToast('¡Imprimiendo logo y poema para cobro en efectivo!');
            } else {
              showToast('Error: ' + data.error);
            }
          } catch (err) {
            showToast('Error de conexión con el servidor.');
          } finally {
            btn.disabled = false;
            btn.textContent = '💵 Imprimir Poema (Efectivo)';
          }
        }

        function showToast(msg) {
          const toast = document.getElementById('toast');
          toast.textContent = msg;
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
    const { filename, content, author, price } = await getRandomPoem();
    const result = await printOnTerminal(content);
    await incrementPoemPrint(filename);
    await triggerBlockchainPayout(author, filename, price);
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

// Endpoint para imprimir logo + poema en efectivo (sin transacción de cobro)
app.post('/print-logo-and-poem', async (req, res) => {
  try {
    console.log('[Efectivo] Solicitando impresión de logo + poema en efectivo...');
    
    // 1. Logo
    try {
      if (logoBase64) {
        console.log('[Efectivo] Encolando impresión de logotipo...');
        await executePrintActionWithRetry(
          () => printImageOnTerminal(),
          'Logo'
        );
        // Pausa de 5 segundos para que termine el logotipo antes del poema
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    } catch (imgError) {
      console.error('[Efectivo] Falló la impresión del logotipo:', imgError.message);
    }

    // 2. Poema
    const { filename, content, author, price } = await getRandomPoem();
    await executePrintActionWithRetry(
      () => printOnTerminal(content),
      'Poema'
    );
    await incrementPoemPrint(filename);
    await triggerBlockchainPayout(author, filename, price);

    return res.status(200).json({ success: true, message: 'Impresión en efectivo enviada con éxito' });
  } catch (error) {
    const errorDetails = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    console.error('[Efectivo] Error en la impresión en efectivo:', errorDetails);
    const errorMessage = error.response?.data?.message || (error.response?.data?.error_messages ? error.response.data.error_messages.join(', ') : null) || error.message;
    return res.status(500).json({ error: errorMessage });
  }
});

// Endpoint para crear una orden de cobro en la terminal Point
app.post('/create-order', async (req, res) => {
  const { amount, notificationUrl } = req.body;
  const accessToken = getMPAccessToken();
  const terminalId = getMPTerminalId();

  if (!isSandboxMode) {
    if (!accessToken || accessToken.includes('tu_access_token')) {
      return res.status(400).json({ error: 'Mercado Pago Access Token no configurado en el archivo .env' });
    }
    if (!terminalId || terminalId.includes('tu_terminal_id')) {
      return res.status(400).json({ error: 'Mercado Pago Terminal ID no configurado en el archivo .env' });
    }
  }

  const numericAmount = parseFloat(amount);
  if (isNaN(numericAmount) || numericAmount < 15.00) {
    return res.status(400).json({ error: 'El monto mínimo de cobro en Mercado Pago es de $15.00 ARS' });
  }

  const idempotencyKey = crypto.randomUUID();
  const externalReference = `payment_${Date.now()}`;

  if (isSandboxMode) {
    const orderId = `sim_order_${Date.now()}`;
    const simulatedOrder = {
      id: orderId,
      status: 'created',
      amount: numericAmount,
      payments: [],
      external_reference: externalReference,
      config: { point: { terminal_id: terminalId || 'TEST_TERMINAL' } }
    };
    
    simulatedOrders[orderId] = simulatedOrder;
    console.log(`[Cobro] [SIMULACIÓN] Creada orden de cobro simulada por $${numericAmount} con ID: ${orderId}`);
    
    // Auto-avanzar a 'at_terminal' después de 1.5 segundos
    setTimeout(() => {
      if (simulatedOrders[orderId] && simulatedOrders[orderId].status === 'created') {
        simulatedOrders[orderId].status = 'at_terminal';
        console.log(`[Cobro] [SIMULACIÓN] Orden ${orderId} avanzó a estado: at_terminal`);
      }
    }, 1500);

    // Auto-procesar / auto-aprobar después de 20 segundos por si el usuario no interactúa
    setTimeout(() => {
      if (simulatedOrders[orderId] && simulatedOrders[orderId].status === 'at_terminal') {
        simulatedOrders[orderId].status = 'processed';
        simulatedOrders[orderId].payments = [{
          id: `pay_sim_${Date.now()}`,
          status: 'approved',
          transaction_amount: numericAmount
        }];
        simulatedPayments[simulatedOrders[orderId].payments[0].id] = simulatedOrders[orderId].payments[0];
        console.log(`[Cobro] [SIMULACIÓN] Orden ${orderId} auto-aprobada por timeout.`);
      }
    }, 20000);

    startOrderPolling(orderId);
    return res.status(200).json({ 
      success: true, 
      message: 'Orden de cobro simulada iniciada', 
      isSimulated: true,
      data: simulatedOrder 
    });
  }

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
  const accessToken = getMPAccessToken();

  if (!isSandboxMode) {
    if (!accessToken || accessToken.includes('tu_access_token')) {
      return res.status(400).json({ error: 'Mercado Pago Access Token no configurado en el archivo .env' });
    }
  }

  if (!terminalId || !mode) {
    return res.status(400).json({ error: 'Faltan parámetros obligatorios: terminalId o mode' });
  }

  if (isSandboxMode) {
    console.log(`[Configuración] [SIMULACIÓN] Configurando terminal ${terminalId} en modo: ${mode}...`);
    return res.status(200).json({ 
      success: true, 
      message: `Modo de operación configurado a ${mode} (Simulación)`, 
      isSimulated: true,
      data: { id: terminalId, operating_mode: mode }
    });
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

// --- Portal de Autores y Blockchain API ---
const REGISTRY_FILE = path.join(__dirname, '../author_registry.json');
const BLOCKCHAIN_TXS_FILE = path.join(__dirname, '../blockchain_txs.json');
const STATS_FILE = path.join(__dirname, '../poem_stats.json');

// Obtener datos del portal de autor (autores, poemas, transacciones)
app.get('/api/author-portal-data', async (req, res) => {
  try {
    let registry = {};
    if (fs.existsSync(REGISTRY_FILE)) {
      registry = JSON.parse(await fs.promises.readFile(REGISTRY_FILE, 'utf8'));
    }

    let txs = [];
    if (fs.existsSync(BLOCKCHAIN_TXS_FILE)) {
      txs = JSON.parse(await fs.promises.readFile(BLOCKCHAIN_TXS_FILE, 'utf8'));
    }

    // Listar poemas con sus detalles para la vista del autor
    const poemsDir = path.join(__dirname, '../poemas');
    const poemsList = [];
    
    // Leer estadísticas de impresión
    let stats = {};
    if (fs.existsSync(STATS_FILE)) {
      stats = JSON.parse(await fs.promises.readFile(STATS_FILE, 'utf8'));
    }

    if (fs.existsSync(poemsDir)) {
      const files = await fs.promises.readdir(poemsDir);
      const txtFiles = files.filter(f => f.endsWith('.txt'));
      
      for (const file of txtFiles) {
        const content = await fs.promises.readFile(path.join(poemsDir, file), 'utf8');
        const { title, author } = parsePoemMetadata(file, content);
        const prints = stats[file] || 0;
        
        let price = 1;
        let isRegistered = false;
        let wallet = '';
        
        if (registry[author]) {
          price = registry[author].pricePerUse;
          isRegistered = true;
          wallet = registry[author].wallet;
        }

        // Consultar balance en segundo plano o simulado rápido
        let walletBalance = '0.00';
        if (isRegistered && wallet) {
          const wDetails = await getWalletDetails(wallet);
          walletBalance = wDetails.balance;
        }

        poemsList.push({
          filename: file,
          title,
          author,
          prints,
          price,
          isRegistered,
          wallet,
          walletBalance
        });
      }
    }

    return res.status(200).json({
      authors: registry,
      blockchainTxs: txs,
      poems: poemsList
    });
  } catch (error) {
    console.error('[API] Error al obtener datos del portal:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

// Login de autor
app.post('/api/login', async (req, res) => {
  const { penName } = req.body;
  if (!penName) {
    return res.status(400).json({ error: 'Firma de autor requerida' });
  }

  try {
    let registry = {};
    if (fs.existsSync(REGISTRY_FILE)) {
      registry = JSON.parse(await fs.promises.readFile(REGISTRY_FILE, 'utf8'));
    }

    const trimmedName = penName.trim();
    if (registry[trimmedName]) {
      res.setHeader('Set-Cookie', `author_session=${encodeURIComponent(trimmedName)}; Path=/; HttpOnly; Max-Age=2592000`);
      return res.status(200).json({ success: true, message: 'Sesión iniciada' });
    } else {
      return res.status(200).json({ success: false, notRegistered: true, message: 'Autor no registrado' });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Logout de autor
app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'author_session=; Path=/; HttpOnly; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  return res.status(200).json({ success: true });
});

// Datos de artista autenticado
app.get('/api/artist-data', async (req, res) => {
  const authorName = getAuthorFromCookie(req);
  if (!authorName) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  try {
    let registry = {};
    if (fs.existsSync(REGISTRY_FILE)) {
      registry = JSON.parse(await fs.promises.readFile(REGISTRY_FILE, 'utf8'));
    }

    const profile = registry[authorName];
    if (!profile) {
      return res.status(404).json({ error: 'Autor no encontrado en el registro' });
    }

    // Leer poemas y filtrar los de este autor
    const poemsDir = path.join(__dirname, '../poemas');
    const poemsList = [];

    let stats = {};
    if (fs.existsSync(STATS_FILE)) {
      stats = JSON.parse(await fs.promises.readFile(STATS_FILE, 'utf8'));
    }

    if (fs.existsSync(poemsDir)) {
      const files = await fs.promises.readdir(poemsDir);
      const txtFiles = files.filter(f => f.endsWith('.txt'));

      for (const file of txtFiles) {
        const content = await fs.promises.readFile(path.join(poemsDir, file), 'utf8');
        const { title, author } = parsePoemMetadata(file, content);

        if (author.trim().toLowerCase() === authorName.trim().toLowerCase()) {
          const prints = stats[file] || 0;
          poemsList.push({
            filename: file,
            title,
            prints,
            price: profile.pricePerUse
          });
        }
      }
    }

    // Consultar balance
    let walletBalance = '0.00';
    if (profile.wallet) {
      const wDetails = await getWalletDetails(profile.wallet);
      walletBalance = wDetails.balance;
    }

    // Filtrar transacciones del autor
    let txs = [];
    if (fs.existsSync(BLOCKCHAIN_TXS_FILE)) {
      const allTxs = JSON.parse(await fs.promises.readFile(BLOCKCHAIN_TXS_FILE, 'utf8'));
      txs = allTxs.filter(tx => tx.author.trim().toLowerCase() === authorName.trim().toLowerCase());
    }

    return res.status(200).json({
      authorName,
      profile,
      poems: poemsList,
      walletBalance,
      blockchainTxs: txs
    });
  } catch (err) {
    console.error('[API] Error en artist-data:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// Registrar un autor
app.post('/api/register-author', async (req, res) => {
  const { penName, legalName, cuitCuil, wallet, pricePerUse, nationality, acceptedTerms } = req.body;

  if (!penName || !legalName || !cuitCuil || !wallet || !pricePerUse || !nationality) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios' });
  }

  if (acceptedTerms !== true && acceptedTerms !== 'true') {
    return res.status(400).json({ error: 'Debes aceptar los términos y condiciones del contrato' });
  }

  // Validación de CUIT/CUIL argentino (XX-XXXXXXXX-X)
  const cuitRegex = /^\d{2}-\d{8}-\d{1}$/;
  if (!cuitRegex.test(cuitCuil.trim())) {
    return res.status(400).json({ error: 'El CUIT/CUIL debe tener un formato válido: XX-XXXXXXXX-X' });
  }

  // Validación de wallet EVM (0x seguido de 40 caracteres hexadecimales)
  const walletRegex = /^0x[a-fA-F0-9]{40}$/;
  if (!walletRegex.test(wallet.trim())) {
    return res.status(400).json({ error: 'La dirección wallet debe ser una dirección Ethereum/EVM válida de 42 caracteres (empezando con 0x)' });
  }

  const priceVal = parseFloat(pricePerUse);
  if (isNaN(priceVal) || priceVal < 1) {
    return res.status(400).json({ error: 'El precio por uso debe ser un número mayor o igual a 1 RFC' });
  }

  try {
    let registry = {};
    if (fs.existsSync(REGISTRY_FILE)) {
      registry = JSON.parse(await fs.promises.readFile(REGISTRY_FILE, 'utf8'));
    }

    // Guardar o actualizar autor en el registro
    registry[penName.trim()] = {
      legalName: legalName.trim(),
      cuitCuil: cuitCuil.trim(),
      wallet: wallet.trim(),
      pricePerUse: priceVal,
      nationality: nationality.trim(),
      acceptedTerms: true,
      acceptedDate: new Date().toISOString()
    };

    await fs.promises.writeFile(REGISTRY_FILE, JSON.stringify(registry, null, 2), 'utf8');
    console.log(`[API] Autor registrado con éxito: ${penName}`);

    res.setHeader('Set-Cookie', `author_session=${encodeURIComponent(penName.trim())}; Path=/; HttpOnly; Max-Age=2592000`);
    return res.status(200).json({ success: true, message: 'Autor registrado correctamente' });
  } catch (error) {
    console.error('[API] Error al registrar autor:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

// Subir un poema nuevo
app.post('/api/upload-poem', async (req, res) => {
  const { title, content, authorName } = req.body;

  if (!title || !content || !authorName) {
    return res.status(400).json({ error: 'Faltan campos obligatorios: título, contenido o autor' });
  }

  const sessionAuthor = getAuthorFromCookie(req);
  if (!sessionAuthor || sessionAuthor.trim().toLowerCase() !== authorName.trim().toLowerCase()) {
    return res.status(401).json({ error: 'No autorizado. La firma no coincide con tu sesión activa.' });
  }

  if (content.length > 400) {
    return res.status(400).json({ error: 'El poema supera el límite máximo de 400 caracteres' });
  }

  try {
    // Validar que el autor esté registrado
    let registry = {};
    if (fs.existsSync(REGISTRY_FILE)) {
      registry = JSON.parse(await fs.promises.readFile(REGISTRY_FILE, 'utf8'));
    }

    if (!registry[authorName.trim()]) {
      return res.status(400).json({ error: 'El autor especificado no está registrado en el sistema. Regístrate primero.' });
    }

    // Guardar el poema como archivo .txt en la carpeta poemas/
    const poemsDir = path.join(__dirname, '../poemas');
    const cleanTitle = title.toLowerCase().trim().replace(/[^a-z0-9_]/gi, '_');
    
    let filename = `${cleanTitle}.txt`;
    let filePath = path.join(poemsDir, filename);
    
    // Si ya existe, agregar un sufijo único
    if (fs.existsSync(filePath)) {
      filename = `${cleanTitle}_${Date.now()}.txt`;
      filePath = path.join(poemsDir, filename);
    }

    // Formato de guardado del poema
    const fileContent = `${title.trim()}\n\n${content.trim()}\n\nAutor: ${authorName.trim()}\n`;
    
    await fs.promises.writeFile(filePath, fileContent, 'utf8');
    console.log(`[API] Nuevo poema guardado en: ${filename} por el autor ${authorName}`);

    return res.status(200).json({ success: true, message: `Poema "${title}" subido y publicado con éxito` });
  } catch (error) {
    console.error('[API] Error al subir poema:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

async function triggerBlockchainPayout(author, filename, price) {
  if (!author) return;

  try {
    let registry = {};
    if (fs.existsSync(REGISTRY_FILE)) {
      registry = JSON.parse(await fs.promises.readFile(REGISTRY_FILE, 'utf8'));
    }

    if (registry[author] && registry[author].wallet) {
      const wallet = registry[author].wallet;
      const payoutPrice = parseFloat(price) || parseFloat(registry[author].pricePerUse) || 1;

      console.log(`[Pago Token] Disparando pago de ${payoutPrice} RFC para el autor registrado "${author}" (Wallet: ${wallet}) por impresión de "${filename}".`);

      // Llamar a la blockchain para transferir tokens
      const txResult = await transferRFCTokens(wallet, payoutPrice);

      // Registrar la transacción en blockchain_txs.json
      if (txResult.success) {
        let txs = [];
        if (fs.existsSync(BLOCKCHAIN_TXS_FILE)) {
          txs = JSON.parse(await fs.promises.readFile(BLOCKCHAIN_TXS_FILE, 'utf8'));
        }

        txs.unshift({
          timestamp: new Date().toISOString(),
          author,
          filename,
          wallet,
          amount: payoutPrice,
          txHash: txResult.txHash,
          blockNumber: txResult.blockNumber,
          isSimulated: txResult.isSimulated,
          note: txResult.note || ''
        });

        if (txs.length > 100) {
          txs = txs.slice(0, 100);
        }

        await fs.promises.writeFile(BLOCKCHAIN_TXS_FILE, JSON.stringify(txs, null, 2), 'utf8');
        console.log(`[Pago Token] Transacción registrada con éxito. Hash: ${txResult.txHash}`);
      } else {
        console.error(`[Pago Token] Error al realizar la transacción blockchain: ${txResult.error}`);
      }
    } else {
      console.log(`[Pago Token] El autor "${author}" de "${filename}" no está registrado para recibir pagos con token RFC o no tiene wallet configurado.`);
    }
  } catch (err) {
    console.error('[Pago Token] Error crítico en triggerBlockchainPayout:', err.message);
  }
}

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
      // Pausa de 5 segundos para asegurar que el papel del logotipo termine de salir antes de enviar el poema
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  } catch (imgError) {
    console.error('[Impresora] Falló definitivamente la impresión del logotipo:', imgError.message);
  }

  // 2. Imprimir el poema con reintentos
  try {
    console.log('[Impresora] Encolando impresión de poema...');
    const { filename, content, author, price } = await getRandomPoem();
    
    await executePrintActionWithRetry(
      () => printOnTerminal(content),
      'Poema'
    );
    
    await incrementPoemPrint(filename);
    await triggerBlockchainPayout(author, filename, price);
    
    // Registrar en el archivo de control
    markPaymentAsPrinted(paymentIdStr);
  } catch (poemError) {
    console.error('[Impresora] Falló definitivamente la impresión del poema:', poemError.message);
  }
}

// Función para realizar polling del estado de una orden de cobro
async function startOrderPolling(orderId, maxAttempts = 100, intervalMs = 3000) {
  const accessToken = getMPAccessToken();
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
      let orderData;
      if (orderId.toString().startsWith('sim_order_') || isSandboxMode) {
        orderData = simulatedOrders[orderId];
        if (!orderData) {
          console.warn(`[Polling] Orden simulada ${orderId} no encontrada en memoria. Deteniendo polling.`);
          clearInterval(timer);
          return;
        }
      } else {
        const response = await axios.get(
          `https://api.mercadopago.com/v1/orders/${orderId}`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`
            }
          }
        );
        orderData = response.data;
      }
      
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

    const accessToken = getMPAccessToken();

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
        let paymentData;
        if (resourceId.toString().startsWith('pay_sim_') || isSandboxMode) {
          paymentData = simulatedPayments[resourceId];
          if (!paymentData) {
            paymentData = {
              id: resourceId,
              status: 'approved',
              status_detail: 'accredited',
              transaction_amount: 15.00
            };
          }
        } else {
          const paymentResponse = await axios.get(
            `https://api.mercadopago.com/v1/payments/${resourceId}`,
            {
              headers: {
                'Authorization': `Bearer ${accessToken}`
              }
            }
          );
          paymentData = paymentResponse.data;
        }

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
        let orderData;
        if (resourceId.toString().startsWith('sim_order_') || isSandboxMode) {
          orderData = simulatedOrders[resourceId];
          if (!orderData) {
            orderData = {
              payments: [{ status: 'approved', transaction_amount: 15.00, id: `pay_sim_${Date.now()}` }]
            };
          }
        } else {
          const orderResponse = await axios.get(
            `https://api.mercadopago.com/merchant_orders/${resourceId}`,
            {
              headers: {
                'Authorization': `Bearer ${accessToken}`
              }
            }
          );
          orderData = orderResponse.data;
        }

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

// --- Endpoints de Simulación Sandbox ---

// Obtener estado actual del simulador
app.get('/api/sandbox/status', (req, res) => {
  // Buscar si hay alguna orden simulada activa
  const activeOrder = Object.values(simulatedOrders).find(
    o => o.status === 'created' || o.status === 'at_terminal'
  );
  
  res.json({
    isSandboxMode,
    activeOrder: activeOrder || null,
    simulatedPrints: simulatedPrints
  });
});

// Cambiar modo sandbox
app.post('/api/sandbox/toggle', (req, res) => {
  const { enabled } = req.body;
  isSandboxMode = enabled === true;
  saveSettings();
  console.log(`[Config] Modo Sandbox cambiado a: ${isSandboxMode}`);
  res.json({ success: true, isSandboxMode });
});

// Limpiar historial de impresiones simuladas
app.post('/api/sandbox/clear-prints', (req, res) => {
  simulatedPrints = [];
  res.json({ success: true, message: 'Historial de impresiones simuladas vaciado' });
});

// Simular pase de tarjeta (Aprobar pago de orden activa)
app.post('/api/sandbox/simulate-swipe', (req, res) => {
  const activeOrder = Object.values(simulatedOrders).find(
    o => o.status === 'created' || o.status === 'at_terminal'
  );

  if (!activeOrder) {
    return res.status(400).json({ error: 'No hay ninguna orden de cobro activa en la terminal para procesar.' });
  }

  activeOrder.status = 'processed';
  activeOrder.payments = [{
    id: `pay_sim_${Date.now()}`,
    status: 'approved',
    transaction_amount: activeOrder.amount
  }];
  
  // Guardar en pagos simulados
  simulatedPayments[activeOrder.payments[0].id] = activeOrder.payments[0];

  console.log(`[Simulador] Pago aprobado para orden simulada ${activeOrder.id} ($${activeOrder.amount})`);
  res.json({ success: true, order: activeOrder });
});

// Simular cancelación de orden activa
app.post('/api/sandbox/simulate-cancel-order', (req, res) => {
  const activeOrder = Object.values(simulatedOrders).find(
    o => o.status === 'created' || o.status === 'at_terminal'
  );

  if (!activeOrder) {
    return res.status(400).json({ error: 'No hay ninguna orden de cobro activa en la terminal para cancelar.' });
  }

  activeOrder.status = 'cancelled';
  console.log(`[Simulador] Orden simulada ${activeOrder.id} cancelada manualmente.`);
  res.json({ success: true, order: activeOrder });
});

// Simular webhook de pago aprobado
app.post('/api/sandbox/simulate-webhook', async (req, res) => {
  const { amount } = req.body;
  const numericAmount = parseFloat(amount) || 15.00;
  const paymentId = `pay_sim_wh_${Date.now()}`;
  
  // Registrar el pago simulado
  simulatedPayments[paymentId] = {
    id: paymentId,
    status: 'approved',
    status_detail: 'accredited',
    transaction_amount: numericAmount
  };

  console.log(`[Simulador Webhook] Registrado pago simulado ${paymentId} por $${numericAmount}. Enviando webhook...`);

  // Crear payload del webhook
  const webhookPayload = {
    action: "payment.created",
    api_version: "v1",
    data: {
      id: paymentId
    },
    date_created: new Date().toISOString(),
    id: `event_sim_${Date.now()}`,
    live_mode: false,
    type: "payment",
    user_id: "test_user_id"
  };

  try {
    const port = process.env.PORT || 3000;
    // Llamar al endpoint local
    const response = await axios.post(
      `http://localhost:${port}/webhook`,
      webhookPayload,
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
    return res.status(200).json({ 
      success: true, 
      message: 'Simulación de webhook enviada y procesada', 
      paymentId, 
      result: response.data 
    });
  } catch (error) {
    console.error('[Simulador Webhook] Falló el POST HTTP local, ejecutando lógica de procesamiento directa.');
    try {
      await processApprovedPayment(paymentId, numericAmount);
      return res.status(200).json({ 
        success: true, 
        message: 'Simulación de webhook ejecutada vía fallback local', 
        paymentId 
      });
    } catch (fallbackError) {
      return res.status(500).json({ error: fallbackError.message });
    }
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 Servidor ejecutándose en http://localhost:${PORT}`);
  console.log(`📂 Carpeta de poemas activa en e:/POEMAS/poemas`);
  console.log(`====================================================`);
});
