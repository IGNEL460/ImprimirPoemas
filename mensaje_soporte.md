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

---

## 📨 Respuesta de Seguimiento al Soporte (Contestando sus preguntas)

**Asunto:** Re: Soporte Técnico - API de Impresiones (`/terminals/v1/actions`) - Reporte de bug en Point Smart (Conexión 4G / Diálogo de Wi-Fi)

**Cuerpo del mensaje:**

Estimado equipo de Soporte,

Agradecemos mucho sus observaciones y el análisis detallado. Respondemos a sus consultas para poder acotar y documentar mejor el caso para su equipo de SmartPOS/ingeniería:

1. **Sobre el origen de la orden (API vs SDK):**
   Confirmamos que ejecutamos el flujo a través de la **API de MP Point** mediante llamadas HTTP POST a:
   `https://api.mercadopago.com/terminals/v1/actions`
   No estamos utilizando ninguna SmartApp nativa (SDK) cargada en el dispositivo. Las impresiones se envían directamente desde nuestro servidor en la nube de manera remota al recibir notificaciones de cobro.

2. **Sobre el Modo de la Terminal (PDV):**
   Sí, confirmamos que la terminal Point Smart (`N950NCD100051716`) se encuentra configurada y activa en **Modo PDV** (operating_mode = 'PDV'). Hemos validado que las llamadas a la API de impresión fallan inmediatamente con error HTTP si la terminal está en modo Autónomo/Standalone, por lo que confirmamos que opera bajo PDV.

3. **Flujo de Estados de la Acción en la API:**
   El flujo de estados es consistente y pasa de manera correcta de `created` -> `on_terminal` -> `processed`. La API finaliza la acción con éxito y el ticket se imprime físicamente en su totalidad. 
   
   Esto confirma, tal como señalan, que no hay un problema con la entrega de datos de la API al dispositivo (la orden viaja y se descarga por el chip 4G sin inconvenientes), sino que el problema reside exclusivamente en la **capa de la interfaz gráfica (UI/UX) de la aplicación de Mercado Pago en la terminal**, la cual lanza una validación de Wi-Fi innecesaria que bloquea la pantalla e interrumpe la experiencia del operador/usuario a pesar de que el hardware de impresión sigue funcionando en segundo plano.

Les agradeceríamos si pueden escalar este comportamiento a su equipo de desarrollo de SmartPOS/Terminales para que sea evaluado en futuras actualizaciones del cliente nativo de Point Smart, de modo que no se fuerce el popup de Wi-Fi cuando hay conexión 4G disponible y funcional.

Quedamos atentos a cualquier novedad o actualización de software disponible para nuestro dispositivo.

Atentamente,

**Equipo de El Pecado Teatro & Poemas al Viento**

