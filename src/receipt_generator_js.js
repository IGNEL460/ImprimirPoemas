import { createCanvas, loadImage } from '@napi-rs/canvas';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let cachedLogoImg = null;
let cachedLogoPath = null;

async function getCachedLogo(logoPath) {
  if (cachedLogoImg && cachedLogoPath === logoPath) {
    return cachedLogoImg;
  }
  if (fs.existsSync(logoPath)) {
    try {
      cachedLogoImg = await loadImage(logoPath);
      cachedLogoPath = logoPath;
      return cachedLogoImg;
    } catch (err) {
      console.warn('[ReceiptJS] No se pudo cargar la imagen del logo:', err.message);
    }
  }
  return null;
}

export async function generateThermalReceiptBase64JS(poemText, customLogoPath = null) {
  try {
    const logoPath = customLogoPath || path.join(__dirname, 'logo.jpg');
    // const logoImg = await getCachedLogo(logoPath);
    const logoImg = null; // Logo desactivado por el momento

    const RECEIPT_WIDTH = 384;
    const targetLogoWidth = 210;
    let targetLogoHeight = 0;

    if (logoImg) {
      const aspect = logoImg.height / Math.max(1, logoImg.width);
      targetLogoHeight = Math.round(targetLogoWidth * aspect);
    }

    // Helper para wrap de texto a un límite de caracteres
    function wrapLine(text, maxChars = 30) {
      const words = text.split(' ');
      const lines = [];
      let curr = '';
      for (const w of words) {
        if ((curr + (curr ? ' ' : '') + w).length <= maxChars) {
          curr += (curr ? ' ' : '') + w;
        } else {
          if (curr) lines.push(curr);
          curr = w;
        }
      }
      if (curr) lines.push(curr);
      return lines;
    }

    const rawLines = poemText.split('\n');
    const wrappedLines = [];
    for (const l of rawLines) {
      const t = l.trim();
      if (!t) {
        wrappedLines.push('');
      } else {
        wrappedLines.push(...wrapLine(t, 30));
      }
    }

    const headerTitle = '🍎 UN POEMA PARA TI 🍎';
    const footerLines = [
      '* * * * *',
      'Gracias por tu colaboración',
      'y por apoyar el arte.',
      '--------------------------------',
      'Encuentra más información en:',
      'elpecado.ar'
    ];

    const paddingTop = 12;
    const paddingLogoTitle = 10;
    const paddingTitlePoem = 14;
    const paddingPoemFooter = 16;
    const paddingBottom = 18;

    const lineHeightBody = 22;
    const lineHeightFooter = 20;

    const hPoem = wrappedLines.reduce((acc, line) => acc + (line === '' ? 10 : lineHeightBody), 0);
    const hFooter = footerLines.reduce((acc, line) => acc + (line === 'elpecado.ar' ? 24 : lineHeightFooter), 0);

    const totalHeight = paddingTop + 
      (logoImg ? targetLogoHeight + paddingLogoTitle : 0) + 
      26 + paddingTitlePoem + 
      hPoem + 
      paddingPoemFooter + hFooter + 
      paddingBottom;

    const canvas = createCanvas(RECEIPT_WIDTH, totalHeight);
    const ctx = canvas.getContext('2d');

    // Fondo blanco
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, RECEIPT_WIDTH, totalHeight);

    let currY = paddingTop;

    // 1. Dibujar Logo Centrado
    if (logoImg) {
      const logoX = Math.floor((RECEIPT_WIDTH - targetLogoWidth) / 2);
      ctx.drawImage(logoImg, logoX, currY, targetLogoWidth, targetLogoHeight);
      currY += targetLogoHeight + paddingLogoTitle;
    }

    // 2. Encabezado Título
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(headerTitle, RECEIPT_WIDTH / 2, currY);
    currY += 26 + paddingTitlePoem;

    // 3. Poema
    ctx.font = '16px sans-serif';
    for (const line of wrappedLines) {
      if (line === '') {
        currY += 10;
        continue;
      }
      ctx.fillText(line, RECEIPT_WIDTH / 2, currY);
      currY += lineHeightBody;
    }

    currY += paddingPoemFooter;

    // 4. Pie de Página
    for (let i = 0; i < footerLines.length; i++) {
      const line = footerLines[i];
      if (line === 'elpecado.ar') {
        ctx.font = 'bold 18px sans-serif';
      } else if (line === 'Encuentra más información en:') {
        ctx.font = '13px sans-serif';
      } else {
        ctx.font = '14px sans-serif';
      }
      ctx.fillText(line, RECEIPT_WIDTH / 2, currY);
      currY += (line === 'elpecado.ar' ? 24 : lineHeightFooter);
    }

    // 5. Binarizar a 1-bit monocromo para reducir el tamaño del Base64 de ~120KB a ~12KB
    const imgData = ctx.getImageData(0, 0, RECEIPT_WIDTH, totalHeight);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      const val = gray > 180 ? 255 : 0;
      data[i] = val;
      data[i + 1] = val;
      data[i + 2] = val;
    }
    // Exportar como JPEG de alta resolución y bajo peso (~20KB Base64) para evitar desbordamientos de búfer en Point Smart
    const jpegBuffer = canvas.toBuffer('image/jpeg', 85);
    const b64Result = jpegBuffer.toString('base64');
    console.log('[ReceiptJS] Recibo térmico optimizado generado en JPEG Base64 (' + Math.round(b64Result.length / 1024) + ' KB).');
    return b64Result;
  } catch (err) {
    console.error('[ReceiptJS] Error al generar imagen de recibo:', err);
    return null;
  }
}
