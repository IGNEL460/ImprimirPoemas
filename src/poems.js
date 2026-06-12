import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Directorio de los poemas (e:/POEMAS/poemas)
const POEMS_DIR = path.join(__dirname, '../poemas');

/**
 * Lee todos los archivos .txt de la carpeta de poemas y devuelve uno al azar.
 * @returns {Promise<string>}
 */
export async function getRandomPoem() {
  try {
    // Verificar si el directorio existe, si no, lo crea
    if (!fs.existsSync(POEMS_DIR)) {
      await fs.promises.mkdir(POEMS_DIR, { recursive: true });
      return '¡Muchas gracias por colaborar!\n\n(Carga poemas en la carpeta "poemas/" en formato .txt)';
    }

    const files = await fs.promises.readdir(POEMS_DIR);
    const txtFiles = files.filter(file => file.endsWith('.txt'));

    if (txtFiles.length === 0) {
      return '¡Muchas gracias por apoyar nuestro arte y colaborar!';
    }

    const randomIndex = Math.floor(Math.random() * txtFiles.length);
    const chosenFile = txtFiles[randomIndex];
    const filePath = path.join(POEMS_DIR, chosenFile);
    
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return content.trim();
  } catch (error) {
    console.error('Error leyendo la carpeta de poemas:', error);
    return '¡Muchas gracias por tu generosa colaboración!';
  }
}
