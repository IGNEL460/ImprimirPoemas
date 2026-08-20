import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let sheetsClient = null;
let spreadsheetId = process.env.GOOGLE_SHEET_ID || '1OYkE2Yr-LGu9NdapmEQMIkRdPVmM9x8Cxn6fFSgQ68Q';

/**
 * Inicializa el cliente de Google Sheets mediante Service Account (desde .env o credentials.json).
 */
async function getSheetsClient() {
  if (sheetsClient) return sheetsClient;

  try {
    let auth = null;
    const jsonEnv = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    const credentialsPath = path.join(__dirname, '../credentials.json');

    if (jsonEnv) {
      const credentials = typeof jsonEnv === 'string' ? JSON.parse(jsonEnv) : jsonEnv;
      auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });
      console.log('[GoogleSheets] Autenticado mediante variable de entorno GOOGLE_SERVICE_ACCOUNT_JSON.');
    } else if (fs.existsSync(credentialsPath)) {
      auth = new google.auth.GoogleAuth({
        keyFile: credentialsPath,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });
      console.log('[GoogleSheets] Autenticado mediante archivo local credentials.json.');
    } else {
      console.warn('[GoogleSheets] Advertencia: No se encontraron credenciales de Google (GOOGLE_SERVICE_ACCOUNT_JSON o credentials.json).');
      return null;
    }

    sheetsClient = google.sheets({ version: 'v4', auth });
    return sheetsClient;
  } catch (error) {
    console.error('[GoogleSheets] Error al inicializar cliente de Google Sheets:', error.message);
    return null;
  }
}

/**
 * Registra una fila de auditoría de impresión en la hoja de cálculo de Google Sheets.
 * @param {Object} data 
 */
export async function appendAuditRow(data) {
  const currentSheetId = process.env.GOOGLE_SHEET_ID || spreadsheetId;
  const scriptUrl = process.env.GOOGLE_SCRIPT_URL || '';

  const timestamp = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
  const {
    paymentId = 'Efectivo',
    amount = 0,
    filename = '',
    author = 'Anónimo',
    title = 'Sin Título',
    vendorName = 'Sin Evento',
    copyrightStatus = 'Anónimo (Libre)',
    mpFeeValue = 0,
    taxValue = 0,
    paperCost = 0,
    netAmount = 0,
    reserveAllocated = 0
  } = data;

  const row = [
    timestamp,
    paymentId,
    vendorName,
    `$${parseFloat(amount).toFixed(2)}`,
    title,
    author,
    copyrightStatus,
    `$${parseFloat(mpFeeValue).toFixed(2)}`,
    `$${parseFloat(taxValue).toFixed(2)}`,
    `$${parseFloat(paperCost).toFixed(2)}`,
    `$${parseFloat(netAmount).toFixed(2)}`,
    `$${parseFloat(reserveAllocated).toFixed(2)}`
  ];

  // Opción 1: Enviar mediante Web App URL de Google Apps Script (Método Sencillo)
  if (scriptUrl) {
    try {
      const payload = JSON.stringify({ row, spreadsheetId: currentSheetId });
      await axios.post(scriptUrl, payload, {
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        maxRedirects: 5
      });
      console.log(`[GoogleSheets] Fila de auditoría enviada por Apps Script URL para pago ${paymentId}.`);
      return true;
    } catch (err) {
      console.error('[GoogleSheets] Error al enviar vía Google Apps Script:', err.response?.data || err.message);
    }
  }

  // Opción 2: Enviar mediante Google Sheets API (Service Account)
  if (!currentSheetId) {
    console.log('[GoogleSheets] Nota: GOOGLE_SHEET_ID no configurado aún en .env. Saltando registro en la nube.');
    return false;
  }

  try {
    const sheets = await getSheetsClient();
    if (!sheets) return false;

    const timestamp = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
    const {
      paymentId = 'Efectivo',
      amount = 0,
      filename = '',
      author = 'Anónimo',
      title = 'Sin Título',
      vendorName = 'Sin Evento',
      copyrightStatus = 'Anónimo (Libre)',
      mpFeeValue = 0,
      taxValue = 0,
      paperCost = 0,
      netAmount = 0,
      reserveAllocated = 0
    } = data;

    const row = [
      timestamp,
      paymentId,
      vendorName,
      `$${parseFloat(amount).toFixed(2)}`,
      title,
      author,
      copyrightStatus,
      `$${parseFloat(mpFeeValue).toFixed(2)}`,
      `$${parseFloat(taxValue).toFixed(2)}`,
      `$${parseFloat(paperCost).toFixed(2)}`,
      `$${parseFloat(netAmount).toFixed(2)}`,
      `$${parseFloat(reserveAllocated).toFixed(2)}`
    ];

    // Intentar agregar fila en la pestaña 'Auditoria' o en la hoja por defecto
    await sheets.spreadsheets.values.append({
      spreadsheetId: currentSheetId,
      range: 'Auditoria!A:L',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [row]
      }
    });

    console.log(`[GoogleSheets] Fila de auditoría agregada exitosamente para pago ${paymentId} ($${amount}) en planilla.`);
    return true;
  } catch (error) {
    console.error('[GoogleSheets] Error al escribir fila en Google Sheets:', error.message);
    return false;
  }
}

/**
 * Obtiene el estado de conexión con Google Sheets.
 */
export async function getSheetsStatus() {
  const currentSheetId = process.env.GOOGLE_SHEET_ID || '';
  const hasEnvCreds = !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const hasFileCreds = fs.existsSync(path.join(__dirname, '../credentials.json'));

  return {
    configured: !!(currentSheetId && (hasEnvCreds || hasFileCreds)),
    sheetId: currentSheetId ? `${currentSheetId.substring(0, 10)}...` : 'No configurado',
    authType: hasEnvCreds ? 'Variable de Entorno' : (hasFileCreds ? 'Archivo credentials.json' : 'Ninguna')
  };
}

/**
 * Lee todo el historial de transacciones desde la planilla de Google Sheets.
 * Permite restaurar el estado completo en memoria al reiniciar el servidor en Render.
 */
export async function fetchAuditHistoryFromSheet() {
  const currentSheetId = process.env.GOOGLE_SHEET_ID || spreadsheetId;
  if (!currentSheetId) return null;

  try {
    const sheets = await getSheetsClient();
    if (!sheets) return null;

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: currentSheetId,
      range: 'Auditoria!A2:L2000',
    });

    const rows = response.data.values || [];
    if (rows.length === 0) return [];

    return rows.map((row, index) => {
      const parseMoney = (val) => parseFloat(String(val || '0').replace('$', '').replace(',', '').trim()) || 0;
      return {
        paymentId: row[1] || `sheet_row_${index + 1}`,
        vendor: row[2] || 'Sin Evento',
        amount: parseMoney(row[3]),
        title: row[4] || 'Sin Título',
        author: row[5] || 'Anónimo',
        copyrightStatus: row[6] || 'Dominio Público',
        mpFee: parseMoney(row[7]),
        taxValue: parseMoney(row[8]),
        paperCost: parseMoney(row[9]),
        netAmount: parseMoney(row[10]),
        reserveAllocated: parseMoney(row[11]),
        timestamp: row[0] || new Date().toISOString()
      };
    });
  } catch (error) {
    console.error('[GoogleSheets] Error al leer historial desde Google Sheets:', error.message);
    return null;
  }
}

/**
 * Registra una solicitud de cobro/liquidación de un autor en Google Sheets.
 * @param {Object} data 
 */
export async function appendPayoutRequestRow(data) {
  const currentSheetId = process.env.GOOGLE_SHEET_ID || spreadsheetId;
  if (!currentSheetId) return false;

  try {
    const sheets = await getSheetsClient();
    if (!sheets) return false;

    const timestamp = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
    const {
      author = 'Anónimo',
      cuitCuil = 'Sin CUIT',
      wallet = 'Sin Billetera',
      amountPesos = 0,
      totalPrints = 0,
      status = 'Pendiente de Pago'
    } = data;

    const row = [
      timestamp,
      author,
      cuitCuil,
      wallet,
      `$${parseFloat(amountPesos).toFixed(2)}`,
      totalPrints,
      status
    ];

    try {
      await sheets.spreadsheets.values.append({
        spreadsheetId: currentSheetId,
        range: 'Solicitudes_Pagos!A:G',
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [row] }
      });
      console.log(`[GoogleSheets] Solicitud de pago agregada en 'Solicitudes_Pagos' para el autor ${author} ($${amountPesos}).`);
      return true;
    } catch (errTab) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: currentSheetId,
        range: 'Auditoria!A:L',
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: [[
            timestamp,
            'SOLICITUD_PAGO',
            author,
            `$${parseFloat(amountPesos).toFixed(2)}`,
            `Solicitud de cobro (Total impresiones: ${totalPrints})`,
            author,
            `CUIT: ${cuitCuil} | Destino: ${wallet}`,
            '$0.00', '$0.00', '$0.00',
            `$${parseFloat(amountPesos).toFixed(2)}`,
            '$0.00'
          ]]
        }
      });
      console.log(`[GoogleSheets] Solicitud de pago registrada como auditoría para ${author}.`);
      return true;
    }
  } catch (error) {
    console.error('[GoogleSheets] Error al registrar solicitud de pago en Google Sheets:', error.message);
    return false;
  }
}

/**
 * Registra una fila de impresión de AUTOR VIVO en la hoja de cálculo de Google Sheets.
 * Diseñado para ser 100% no bloqueante (Fire-and-forget).
 * @param {Object} data 
 */
export async function appendLivingAuthorPrintRow(data) {
  const currentSheetId = process.env.GOOGLE_SHEET_ID || spreadsheetId;
  const scriptUrl = process.env.GOOGLE_SCRIPT_URL || '';

  const timestamp = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
  const {
    paymentId = 'Efectivo',
    amount = 0,
    filename = '',
    author = 'Autor Vivo',
    title = 'Sin Título',
    vendorName = 'Sin Evento',
    copyrightStatus = 'Autor Vivo (Con Derechos)',
    netAmount = 0,
    reserveAllocated = 0,
    totalPrints = 1
  } = data;

  const row = [
    timestamp,
    String(paymentId),
    author,
    title,
    filename,
    vendorName,
    `$${parseFloat(amount).toFixed(2)}`,
    `$${parseFloat(netAmount).toFixed(2)}`,
    `$${parseFloat(reserveAllocated).toFixed(2)}`,
    Number(totalPrints)
  ];

  // Opción 1: Enviar mediante Web App URL de Google Apps Script (Recomendado)
  if (scriptUrl) {
    try {
      const payload = JSON.stringify({
        sheetName: 'Autores_Vivos',
        row,
        spreadsheetId: currentSheetId,
        data: {
          timestamp,
          paymentId: String(paymentId),
          author,
          title,
          filename,
          vendorName,
          amount,
          netAmount,
          reserveAllocated,
          totalPrints
        }
      });
      await axios.post(scriptUrl, payload, {
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        timeout: 10000,
        maxRedirects: 5
      });
      console.log(`[GoogleSheets] Impresión de autor vivo '${author}' enviada por Apps Script para pago ${paymentId}.`);
      return true;
    } catch (err) {
      console.warn('[GoogleSheets] Error no bloqueante al enviar autor vivo vía Apps Script:', err.response?.data || err.message);
      return false;
    }
  }

  // Opción 2: Enviar mediante Google Sheets API (Service Account)
  if (!currentSheetId) {
    return false;
  }

  try {
    const sheets = await getSheetsClient();
    if (!sheets) return false;

    try {
      await sheets.spreadsheets.values.append({
        spreadsheetId: currentSheetId,
        range: 'Autores_Vivos!A:J',
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [row] }
      });
      console.log(`[GoogleSheets] Fila registrada en pestaña 'Autores_Vivos' para autor ${author}.`);
      return true;
    } catch (tabErr) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: currentSheetId,
        range: 'Auditoria!A:L',
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: [[
            timestamp,
            paymentId,
            vendorName,
            `$${parseFloat(amount).toFixed(2)}`,
            title,
            author,
            `[AUTOR VIVO] ${copyrightStatus}`,
            '$0.00', '$0.00', '$0.00',
            `$${parseFloat(netAmount).toFixed(2)}`,
            `$${parseFloat(reserveAllocated).toFixed(2)}`
          ]]
        }
      });
      console.log(`[GoogleSheets] Fila de autor vivo registrada en 'Auditoria' para ${author}.`);
      return true;
    }
  } catch (error) {
    console.warn('[GoogleSheets] Error no bloqueante al registrar autor vivo en Google Sheets:', error.message);
    return false;
  }
}
