import { appendAuditRow, appendLivingAuthorPrintRow } from '../src/googleSheetsService.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runExample() {
  console.log('=== EJEMPLO DE REGISTRO DE IMPRESIÓN DE AUTOR VIVO ===\n');

  const samplePrintData = {
    paymentId: `cash_test_${Date.now()}`,
    amount: 500,
    filename: 'goyo.txt',
    author: 'Goyo.art3',
    title: 'Esto papeludo',
    vendorName: 'Feria del Libro 2026',
    copyrightStatus: 'Autor Vivo / Reservado',
    mpFeeValue: 0,
    taxValue: 25.00,
    paperCost: 20.00,
    netAmount: 455.00,
    reserveAllocated: 273.00
  };

  console.log('1. Datos de la transacción de impresión:');
  console.dir(samplePrintData, { depth: null });

  console.log('\n2. Fila formateada para pestaña "Auditoria" (A:L):');
  const auditRow = [
    new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }),
    samplePrintData.paymentId,
    samplePrintData.vendorName,
    `$${samplePrintData.amount.toFixed(2)}`,
    samplePrintData.title,
    samplePrintData.author,
    samplePrintData.copyrightStatus,
    `$${samplePrintData.mpFeeValue.toFixed(2)}`,
    `$${samplePrintData.taxValue.toFixed(2)}`,
    `$${samplePrintData.paperCost.toFixed(2)}`,
    `$${samplePrintData.netAmount.toFixed(2)}`,
    `$${samplePrintData.reserveAllocated.toFixed(2)}`
  ];
  console.log(auditRow);

  console.log('\n3. Fila formateada para pestaña "Autores_Vivos" (A:J):');
  const livingRow = [
    new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }),
    samplePrintData.paymentId,
    samplePrintData.vendorName,
    samplePrintData.author,
    samplePrintData.title,
    samplePrintData.filename,
    `$${samplePrintData.amount.toFixed(2)}`,
    `$${samplePrintData.netAmount.toFixed(2)}`,
    `$${samplePrintData.reserveAllocated.toFixed(2)}`,
    samplePrintData.copyrightStatus
  ];
  console.log(livingRow);

  console.log('\n4. Intentando enviar registro a Google Sheets...');
  const auditSuccess = await appendAuditRow(samplePrintData);
  const livingSuccess = await appendLivingAuthorPrintRow(samplePrintData);

  console.log('\nResultado de sincronización:');
  console.log(`- Auditoría general ('Auditoria'): ${auditSuccess ? 'ÉXITO ✅' : 'PENDIENTE DE CREDENCIALES / APPS SCRIPT ⚠️'}`);
  console.log(`- Registro Artistas Vivos ('Autores_Vivos'): ${livingSuccess ? 'ÉXITO ✅' : 'PENDIENTE DE CREDENCIALES / APPS SCRIPT ⚠️'}`);
}

runExample();
