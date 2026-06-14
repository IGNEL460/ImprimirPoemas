# Solicitud de Soporte Técnico: Habilitación de API de Impresiones (`/terminals/v1/actions`) sobre Conexión 4G en Point Smart

---

## 📨 Plantilla de Mensaje para el Soporte

**Asunto:** Solicitud de excepción/habilitación de API de Impresiones (`/terminals/v1/actions`) mediante conexión 4G para Point Smart

**Cuerpo del mensaje:**

Estimado equipo de Soporte y Desarrollo de Mercado Pago,

Me dirijo a ustedes con el propósito de realizar una consulta técnica y solicitar una excepción/configuración especial para nuestra integración presencial con terminales Point Smart.

Actualmente, hemos desarrollado una aplicación vinculada a nuestra cuenta de Mercado Pago Developers que utiliza la **API de Terminales (`/terminals/v1/actions`)** para enviar órdenes de impresión de tickets personalizados (con formato de texto e imágenes en Base64) a nuestro dispositivo **Point Smart**.

### Contexto de la Integración:
*   **ID de la Aplicación (App ID):** `[COLOCAR_AQUÍ_EL_APP_ID_DE_TU_INTEGRACIÓN]`
*   **Número de Serie de la Terminal (S/N):** `[COLOCAR_AQUÍ_EL_NÚMERO_DE_SERIE_DE_TU_POINT_SMART]`
*   **ID de la Terminal (Terminal ID):** `[COLOCAR_AQUÍ_EL_TERMINAL_ID_SI_LO_TIENES]`
*   **Propósito:** Imprimir un poema/comprobante artístico de forma automatizada al recibir una colaboración/donación confirmada mediante Webhooks de pagos.

### El Problema Técnico:
La integración funciona perfectamente de manera instantánea cuando la terminal Point Smart está conectada a una red **Wi-Fi**. Sin embargo, en eventos públicos, ferias de arte y locaciones móviles donde no disponemos de Wi-Fi, la terminal depende exclusivamente de su **conexión de datos móviles 4G (chip multiempresa integrado)**. 

Al operar únicamente bajo 4G, notamos que las órdenes enviadas mediante `POST https://api.mercadopago.com/terminals/v1/actions` quedan encoladas en estado `"in_process"` o `"pending"`, y la terminal no recibe ni procesa la orden de impresión hasta que se la vuelve a conectar a una red Wi-Fi.

Entendemos que esto podría deberse a una política de ahorro de datos móviles o una limitación en los protocolos de WebSocket/polling que utiliza el dispositivo cuando opera con la red celular móvil provista por defecto.

### Nuestra Solicitud:
1.  **Evaluación de Excepción / Whitelist:** Solicitar si es posible habilitar una excepción para nuestro dispositivo (S/N especificado arriba) o nuestra App ID, de modo que se permita la recepción de peticiones desde la API de Impresiones (`/actions`) consumiendo los datos del chip 4G integrado de la terminal.
2.  **Documentación Oficial / Workaround:** En caso de que esto sea una restricción de hardware o de red insalvable para el chip de datos por defecto, consultar si existe alguna alternativa técnica documentada, actualización de firmware específica, o si es posible cambiar el chip por uno propio con plan de datos liberado que permita este tráfico sin restricciones.
3.  **Configuraciones alternativas:** Indicar si existe algún parámetro en el header o en el payload del JSON de la acción para forzar la sincronización inmediata del dispositivo en redes móviles.

Agradecemos de antemano su asesoramiento y soporte técnico para poder llevar este proyecto artístico a espacios abiertos sin depender de la existencia de redes Wi-Fi locales.

Quedamos a su entera disposición para brindar cualquier detalle adicional del flujo de API o logs que requieran.

Atentamente,

**[Tu Nombre / Nombre del Proyecto]**  
**Email de la cuenta de Mercado Pago:** `[COLOCAR_EMAIL_ASOCIADO_A_LA_CUENTA]`  
**País:** `[Tu País, ej: Argentina]`

---

## 💡 Recomendaciones para enviar la consulta

1. **Dónde enviarlo:**
   * Ve al portal de **[Mercado Pago Developers Support](https://www.mercadopago.com.ar/developers/es/support)** (o el correspondiente a tu país).
   * Inicia sesión con la misma cuenta dueña de las credenciales (`Access Token`).
   * Selecciona la categoría **Point** -> **Integración de API de Point** o **Soporte Técnico de APIs**.

2. **Adjuntar Datos Reales:**
   * Asegúrate de rellenar los datos entre corchetes (`[...]`) con la información real de tu Point Smart (el número de serie suele estar detrás de la pantalla, en la tapa de la batería o en la configuración de la terminal en `Ajustes -> Acerca del dispositivo`).
   * Adjuntar el **App ID** es clave porque permite al soporte ver si tu cuenta tiene los permisos de impresión activos a nivel de API.

3. **Prueba Alternativa (Mientras esperas respuesta):**
   * Si el evento es pronto y necesitas una solución de emergencia, una alternativa práctica es **compartir internet (Hotspot) desde un teléfono móvil** y conectar el Point Smart a esa red Wi-Fi compartida. Al estar conectado vía Wi-Fi (aunque sea el Wi-Fi del teléfono), la terminal sí procesará las acciones de impresión al instante.
