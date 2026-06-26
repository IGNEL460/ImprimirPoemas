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

    // Cargar el registro de autores para determinar precios y pesos
    let registry = {};
    try {
      const registryPath = path.join(__dirname, '../author_registry.json');
      if (fs.existsSync(registryPath)) {
        const regContent = await fs.promises.readFile(registryPath, 'utf8');
        registry = JSON.parse(regContent);
      }
    } catch (regErr) {
      console.error('[Poemas] Error leyendo registro de autores para ponderación:', regErr.message);
    }

    // Leer y parsear metadatos de todos los poemas para calcular pesos
    const poemsData = await Promise.all(
      txtFiles.map(async (file) => {
        const filePath = path.join(POEMS_DIR, file);
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const metadata = parsePoemMetadata(file, content);
        
        // Buscar el precio en el registro. Si no está registrado, el precio por defecto es 1.
        let price = 1;
        const authorName = metadata.author;
        if (registry[authorName]) {
          price = parseFloat(registry[authorName].pricePerUse) || 1;
        }
        
        // Peso es inverso al precio (1 / precio)
        const weight = 1.0 / price;

        return {
          filename: file,
          content: content.trim(),
          author: authorName,
          price,
          weight
        };
      })
    );

    // Algoritmo de selección ponderada (Weighted Random Selection)
    const totalWeight = poemsData.reduce((sum, p) => sum + p.weight, 0);
    let randomNum = Math.random() * totalWeight;
    let chosenPoem = poemsData[poemsData.length - 1]; // Fallback por seguridad

    for (const p of poemsData) {
      randomNum -= p.weight;
      if (randomNum <= 0) {
        chosenPoem = p;
        break;
      }
    }

    console.log(`[Poemas] Selección ponderada: se eligió "${chosenPoem.filename}" (Autor: ${chosenPoem.author}, Precio: ${chosenPoem.price} RFC, Peso: ${chosenPoem.weight.toFixed(4)}) de un total de ${poemsData.length} poemas.`);

    return {
      filename: chosenPoem.filename,
      content: chosenPoem.content,
      author: chosenPoem.author,
      price: chosenPoem.price
    };
  } catch (error) {
    console.error('Error leyendo la carpeta de poemas:', error);
    return {
      filename: 'error.txt',
      content: '¡Muchas gracias por tu generosa colaboración!',
      author: 'Anónimo',
      price: 1
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

