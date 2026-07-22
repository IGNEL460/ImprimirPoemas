import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Directorio de los poemas (e:/POEMAS/poemas)
const POEMS_DIR = path.join(__dirname, '../poemas');

/**
 * Lee todos los archivos .txt de la carpeta de poemas y devuelve uno al azar.
 * @returns {Promise<{filename: string, content: string}>}
 */
export async function getRandomPoem() {
  try {
    // Verificar si el directorio existe, si no, lo crea
    if (!fs.existsSync(POEMS_DIR)) {
      await fs.promises.mkdir(POEMS_DIR, { recursive: true });
      return {
        filename: 'default.txt',
        content: '¡Muchas gracias por colaborar!\n\n(Carga poemas en la carpeta "poemas/" en formato .txt)'
      };
    }

    const files = await fs.promises.readdir(POEMS_DIR);
    const txtFiles = files.filter(file => file.endsWith('.txt'));

    if (txtFiles.length === 0) {
      return {
        filename: 'default.txt',
        content: '¡Muchas gracias por apoyar nuestro arte y colaborar!'
      };
    }

    const randomIndex = Math.floor(Math.random() * txtFiles.length);
    const chosenFile = txtFiles[randomIndex];
    const filePath = path.join(POEMS_DIR, chosenFile);
    
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return {
      filename: chosenFile,
      content: content.trim()
    };
  } catch (error) {
    console.error('Error leyendo la carpeta de poemas:', error);
    return {
      filename: 'error.txt',
      content: '¡Muchas gracias por tu generosa colaboración!'
    };
  }
}

/**
 * Extrae el título y el autor de un poema a partir de su contenido.
 * @param {string} filename 
 * @param {string} content 
 * @returns {{title: string, author: string}}
 */
export function parsePoemMetadata(filename, content) {
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  let title = filename.replace(/\.txt$/i, '');
  let author = 'Anónimo';
  
  if (lines.length > 0) {
    title = lines[0];
  }
  
  if (lines.length > 1) {
    const lastLine = lines[lines.length - 1];
    if (lastLine.startsWith('--')) {
      author = lastLine.replace(/^--\s*/, '');
    } else if (lastLine.toLowerCase().startsWith('autor:')) {
      author = lastLine.replace(/^autor:\s*/i, '');
    } else if (lastLine.toLowerCase().startsWith('autor')) {
      author = lastLine.replace(/^autor\s+/i, '');
    }
  }
  
  return { title, author };
}

/**
 * Obtiene la lista completa de poemas con su contenido y metadatos.
 * Útil para sincronizar la app del celular para modo 100% offline.
 * @returns {Promise<Array<{filename: string, content: string, title: string, author: string}>>}
 */
export async function getAllPoems() {
  try {
    if (!fs.existsSync(POEMS_DIR)) {
      await fs.promises.mkdir(POEMS_DIR, { recursive: true });
      return [];
    }

    const files = await fs.promises.readdir(POEMS_DIR);
    const txtFiles = files.filter(file => file.endsWith('.txt'));
    const poemList = [];

    for (const file of txtFiles) {
      const filePath = path.join(POEMS_DIR, file);
      const rawContent = await fs.promises.readFile(filePath, 'utf-8');
      const content = rawContent.trim();
      const meta = parsePoemMetadata(file, content);
      poemList.push({
        filename: file,
        content,
        title: meta.title,
        author: meta.author
      });
    }

    return poemList;
  } catch (error) {
    console.error('Error al obtener la lista de todos los poemas:', error);
    return [];
  }
}


