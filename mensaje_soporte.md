# Respuesta de Soporte Técnico: Bug de UI/UX sobre 4G en Point Smart (`/actions`)

---

## 📨 Plantilla de Mensaje para Enviar

**Asunto:** Re: Soporte Técnico - API de Impresiones (`/terminals/v1/actions`) - Reporte de bug en Point Smart (Conexión 4G / Diálogo de Wi-Fi)

**Cuerpo del mensaje:**

Estimado equipo de Soporte y Desarrollo de Mercado Pago,

Agradecemos su respuesta a nuestra consulta. A continuación, les compartimos los datos reales de nuestro entorno de desarrollo, el ID de la acción de prueba y un comportamiento inusual (potencial bug de firmware/UX) que detectamos en la Point Smart operando exclusivamente bajo la conexión de datos móviles 4G integrada:

### 📋 Datos del Entorno Real:
*   **App ID de la Integración:** `1476209361169640`
*   **Terminal ID:** `NEWLAND_N950__N950NCD100051716`
*   **Número de Serie de la Point Smart (S/N):** `N950NCD100051716`
*   **ID de la Acción de Prueba (enviada bajo 4G):** `de001ab1-b7aa-45ba-916a-3e5d84b66777` (Estado final registrado en la API de Mercado Pago: `processed`)

### ⚠️ Comportamiento Inusual Detectado (Bug en la Terminal):
Al apagar el Wi-Fi de la Point Smart para forzar la conexión 4G integrada y enviar la orden de impresión mediante la API (`/actions`), ocurre lo siguiente en el dispositivo:

1. La terminal **recibe la orden de impresión correctamente** a través de la red de datos móviles celular.
2. Inmediatamente después de recibirla, muestra una pantalla emergente (popup) del sistema que solicita **"Conectarse a una red Wi-Fi para imprimir"**.
3. Si seleccionamos la opción **"Cancelar impresión"** en dicho cartel de advertencia (para poder cerrar el diálogo), la terminal de todas formas **procede a realizar la impresión física completa del ticket** (nuestro poema) de manera correcta y exitosa.

### 🔍 Diagnóstico Técnico del Bug:
Este comportamiento demuestra que la conectividad 4G celular del chip integrado **sí está descargando y procesando la acción** (por eso la API marca la acción como `processed`). Sin embargo, la aplicación nativa de Mercado Pago corriendo en la Point Smart asume erróneamente que requiere Wi-Fi de forma obligatoria y bloquea la experiencia del usuario mostrando un diálogo innecesario, el cual no interrumpe la cola de impresión real al ser cancelado.

### ❓ Preguntas para su Equipo de Ingeniería:
1. ¿Es posible reportar este bug de UI/UX a su equipo de ingeniería de desarrollo de la app nativa de Point Smart para que se corrija esta validación errónea de red?
2. ¿Existe actualmente alguna actualización de firmware o sistema para nuestro número de serie (`N950NCD100051716`) que corrija este chequeo de Wi-Fi innecesario al recibir peticiones desde el endpoint `/actions`?

Quedamos atentos a sus comentarios para poder resolver este inconveniente en nuestras funciones al aire libre.

Atentamente,

**Equipo de El Pecado Teatro & Poemas al Viento**  
**Email de la cuenta de Mercado Pago:** `mauro@elpecado.ar` *(reemplazar si corresponde)*  
**País:** Argentina
