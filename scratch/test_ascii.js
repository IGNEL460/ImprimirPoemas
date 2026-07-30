import { createCanvas, loadImage } from '@napi-rs/canvas';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testAsciiLogo(width = 24) {
  const logoPath = path.join(__dirname, '../src/logo.jpg');
  if (!fs.existsSync(logoPath)) return;

  const img = await loadImage(logoPath);
  const aspect = img.height / Math.max(1, img.width);
  const height = Math.max(1, Math.round(width * aspect * 0.5));

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, width, height);

  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  // Invertido para papel térmico (blanco = espacio, negro = caracteres densos)
  const chars = '  ..:--==++**##%%@@';

  let ascii = '';
  for (let y = 0; y < height; y++) {
    let line = '';
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      // Invertir gray (0 = negro, 255 = blanco en papel)
      const inv = 255 - gray;
      const charIdx = Math.floor((inv / 256) * chars.length);
      line += chars[Math.min(chars.length - 1, charIdx)];
    }
    ascii += line + '\n';
  }
  console.log('--- INVERTED ASCII LOGO OUTPUT ---');
  console.log(ascii);
}

testAsciiLogo(24);
