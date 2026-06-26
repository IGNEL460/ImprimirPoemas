import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logoPath = path.join(__dirname, '../src/logo.jpg');

function getJpegDimensions(filePath) {
  const buffer = fs.readFileSync(filePath);
  let i = 0;
  if (buffer[i] !== 0xFF || buffer[i + 1] !== 0xD8) {
    throw new Error('Not a valid JPEG file');
  }
  i += 2;
  
  while (i < buffer.length) {
    while (buffer[i] !== 0xFF && i < buffer.length) {
      i++;
    }
    if (i >= buffer.length) break;
    
    const marker = buffer[i + 1];
    if (marker === 0xD9 || marker === 0xDA) { // EOI or SOS
      break;
    }
    
    const length = buffer.readUInt16BE(i + 2);
    
    // SOF0 (Start of Frame 0) marker is 0xC0
    // SOF2 (Progressive Start of Frame) marker is 0xC2
    if (marker === 0xC0 || marker === 0xC2) {
      const height = buffer.readUInt16BE(i + 5);
      const width = buffer.readUInt16BE(i + 7);
      return { width, height };
    }
    
    i += 2 + length;
  }
  return null;
}

try {
  const stats = fs.statSync(logoPath);
  const dimensions = getJpegDimensions(logoPath);
  console.log('File size:', (stats.size / 1024).toFixed(2), 'KB');
  if (dimensions) {
    console.log('Dimensions:', dimensions.width, 'x', dimensions.height);
  } else {
    console.log('Could not parse dimensions from JPEG markers');
  }
} catch (error) {
  console.error('Error:', error.message);
}
