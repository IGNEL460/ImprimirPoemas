# ✿ Poemas en Mercado Pago Point Smart ✿

Este proyecto conecta los pagos de tu cuenta de **Mercado Pago** (mediante código QR o cobro en Point) con tu terminal física **Point Smart** para imprimir un poema al azar cada vez que recibes una colaboración/donación.

El sistema corre en un servidor online que está siempre disponible y reacciona de forma instantánea a los pagos sin necesidad de tener tu computadora encendida durante los eventos.

---

## 📋 Requisitos Previos

### 1. Activar Impresiones Personalizadas en tu Point Smart
Para poder imprimir comprobantes personalizados (como poemas), debes solicitar a Mercado Pago que habilite esta función en tu dispositivo:
1. Contacta al soporte de Mercado Pago a través del portal de ayuda de **Mercado Pago Developers**.
2. Envía un mensaje con el asunto "Habilitación de API de Impresión en Point Smart".
3. Proporciona el número de serie de tu Point Smart (se puede encontrar en la etiqueta trasera del dispositivo o en los ajustes del sistema) y pide que actualicen el dispositivo para admitir la API de impresiones (`/terminals/v1/actions`).

### 2. Obtener tus Credenciales de Mercado Pago
1. Ve al sitio web de [Mercado Pago Developers](https://www.mercadopago.com/developers) e inicia sesión con tu cuenta.
2. Ve a **Tus Integraciones** y crea una nueva aplicación (puedes llamarla "Impresora de Poemas"). Selecciona **Pagos presenciales** como tipo de integración.
3. En la sección **Credenciales de producción**, copia tu **Access Token** (empieza con `APP_USR-...`). Este token otorga permisos al servidor para interactuar con tu terminal.

---

## 🛠️ Configuración Local

1. Instala las dependencias del proyecto (si no lo has hecho ya):
   ```bash
   npm install
   ```

2. Abre el archivo [.env](file:///e:/POEMAS/.env) y configura tus credenciales:
   - Copia tu `Access Token` en la variable `MP_ACCESS_TOKEN`.
   - Si ya conoces tu `Terminal ID` (el número de serie de tu Point Smart), escríbelo en `MP_TERMINAL_ID`.
   
   *(Si no sabes cuál es tu Terminal ID, no te preocupes: al iniciar el servidor con tu Access Token, podrás entrar a la página web del servidor y verás listados los IDs de todos tus dispositivos Point conectados)*.

3. Inicia el servidor de desarrollo:
   ```bash
   npm run dev
   ```
   El servidor se abrirá en `http://localhost:3000`.

---

## 🧪 Pruebas Locales (con ngrok)

Para probar que el servidor recibe notificaciones de Mercado Pago reales antes de subirlo a la nube, puedes usar una herramienta gratuita como **ngrok**:

1. Descarga e instala [ngrok](https://ngrok.com/).
2. Ejecuta ngrok en tu terminal para crear un puente seguro a tu servidor local (puerto 3000):
   ```bash
   ngrok http 3000
   ```
3. Copia la URL pública generada por ngrok (debe verse similar a `https://a1b2-cd34.ngrok-free.app`).
4. Ve al panel de [Mercado Pago Developers](https://www.mercadopago.com/developers), entra a tu aplicación, ve a la sección de **Webhooks** (o Notificaciones).
5. En la URL del Webhook, pega tu enlace de ngrok agregando `/webhook` al final. Ejemplo:
   ```
   https://a1b2-cd34.ngrok-free.app/webhook
   ```
6. Activa el evento `payment` (pagos) para recibir notificaciones cuando se crea/actualiza un pago.
7. Haz un pago de prueba (con tu QR o Point en modo prueba/sandbox) y verás cómo el servidor local detecta la aprobación al instante y envía la señal de impresión a tu Point Smart.

---

## 🚀 Despliegue en la Nube (Gratis en Render)

Para que el sistema funcione en eventos sin necesidad de tener tu PC encendida, te recomendamos desplegarlo en **Render.com** (plataforma gratuita y muy fácil de usar):

1. **Sube tu código a GitHub:**
   - Crea un repositorio privado en tu cuenta de GitHub.
   - Sube los archivos de este proyecto (asegúrate de que el archivo `.env` **NO** se suba a GitHub para mantener tus credenciales protegidas. El archivo `.gitignore` ya está configurado para evitarlo).

2. **Crea el servicio en Render:**
   - Regístrate gratis en [Render.com](https://render.com/).
   - Haz clic en **New +** y selecciona **Web Service**.
   - Conecta tu cuenta de GitHub y selecciona el repositorio de tus poemas.
   - Configura las opciones básicas:
     - **Runtime:** `Node`
     - **Build Command:** `npm install`
     - **Start Command:** `npm start`
     - **Instance Type:** `Free` (gratuito).

3. **Configura las Variables de Entorno en Render:**
   - Ve a la pestaña **Environment** en el panel de tu servicio en Render.
   - Haz clic en **Add Environment Variable** y añade las siguientes llaves con sus valores:
     - `MP_ACCESS_TOKEN` = `TU_ACCESS_TOKEN_REAL`
     - `MP_TERMINAL_ID` = `TU_TERMINAL_ID_DE_POINT_SMART`
     - `NODE_ENV` = `production`
   - Haz clic en **Save Changes**. El servidor se compilará y se pondrá en marcha automáticamente.

4. **Configura el Webhook Definitivo:**
   - Render te dará una URL pública (ejemplo: `https://poemas-mercadopago.onrender.com`).
   - Ve al panel de Mercado Pago Developers -> Tu Aplicación -> Webhooks.
   - Cambia la URL del Webhook para apuntar a tu nueva dirección de Render terminada en `/webhook`:
     ```
     https://tu-nombre-de-app.onrender.com/webhook
     ```
   - ¡Listo! Tu Point Smart ahora imprimirá poemas al instante cada vez que un cobro sea aprobado, sin importar dónde estés o si tu computadora personal está encendida.

---

## ✍️ Cómo añadir o modificar poemas

La colección de poemas se almacena en la carpeta [poemas/](file:///e:/POEMAS/poemas/).
- Para añadir un poema nuevo: simplemente crea un nuevo archivo de texto (`.txt`) dentro de esa carpeta.
- Para eliminar o modificar: edita o borra los archivos existentes.
- El servidor lee esta carpeta de manera dinámica, por lo que si agregas un poema y reinicias el servidor (o el servicio en Render se redespliega al subir los cambios a GitHub), el nuevo poema se incluirá automáticamente en la selección al azar.
