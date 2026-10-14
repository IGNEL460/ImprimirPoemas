# 🚖 Uber Point Bridge (Android Nativo)

Aplicación Android nativa para conductores de **Uber Driver** que permite cobrar viajes en efectivo mediante un **Mercado Pago Point Smart** (con tarjeta chip, contactless o QR) con un solo toque desde un botón flotante en pantalla.

---

## 🌟 ¿Cómo Funciona?

1. **Botón Flotante Permanente:** Se dibuja sobre la app de Uber Driver. Se puede arrastrar a cualquier borde de la pantalla para no obstaculizar la vista del mapa o GPS.
2. **Lectura Inteligente de Tarifas (Accesibilidad):** Cuando finaliza el viaje y Uber muestra el precio a cobrar en efectivo (por ejemplo: `$ 4.850`), el servicio de accesibilidad detecta el monto automáticamente.
3. **Disparo Instantáneo Cloud a Mercado Pago:** Al pulsar el botón flotante:
   - La app toma el monto exacto.
   - Envía una petición `POST` a la API de Integración de Mercado Pago vía 4G / Wi-Fi.
   - Tu **Point Smart** en el vehículo pita de inmediato y muestra la pantalla para acercar la tarjeta o escanear el código QR.

---

## 📁 Estructura del Proyecto

```
UberPointBridge/
├── app/
│   ├── build.gradle.kts
│   └── src/main/
│       ├── AndroidManifest.xml
│       ├── java/com/uberpoint/bridge/
│       │   ├── MainActivity.kt                # Configuración, permisos y pruebas
│       │   ├── api/
│       │   │   ├── MercadoPagoApi.kt          # Cliente HTTP hacia la API Point de MP
│       │   │   └── Models.kt                  # Modelos de datos JSON
│       │   ├── data/
│       │   │   └── AppPreferences.kt          # Almacenamiento local de credenciales
│       │   └── service/
│       │       ├── FloatingWidgetService.kt   # Botón flotante draggable sobre Uber
│       │       └── UberAccessibilityService.kt# Lector de precios en pantalla
│       └── res/
│           ├── layout/                        # Diseños visuales (Material 3 Dark)
│           ├── xml/                           # Configuración de accesibilidad
│           └── drawable/                      # Iconos y fondos
├── build.gradle.kts
└── settings.gradle.kts
```

---

## 🚀 Pasos para Abrir y Compilar en Android Studio

1. Abre **Android Studio** (Hedgehog, Iguana o superior).
2. Selecciona **Open** y elige la carpeta:
   `c:\Users\mauro\OneDrive\ImprimirPoemas-main\UberPointBridge`
3. Deja que Gradle sincronice las dependencias (`Sync Project with Gradle Files`).
4. Para generar el instalador APK:
   - Menú superior: **Build > Build Bundle(s) / APK(s) > Build APK(s)**.
   - Android Studio generará el archivo `app-debug.apk` listo para pasar por WhatsApp o instalar en cualquier teléfono.

---

## ⚙️ Configuración Inicial en el Teléfono

Al abrir la aplicación por primera vez:

1. **Permiso de Superposición:** Toca *Activar* y autoriza *"Mostrar sobre otras aplicaciones"*.
2. **Permiso de Accesibilidad:** Toca *Activar*, busca en la lista de accesibilidad *"Lector de Tarifas Uber para Point"* y enciéndelo.
3. **Access Token de Mercado Pago:**
   - Entra a [mercadopago.com/developers](https://www.mercadopago.com/developers).
   - En *Tus integraciones* copia tu **Access Token de Producción** (comienza con `APP_USR-...`).
   - Pégalo en la app.
4. **Detectar Terminal:** Toca el botón *"Detectar mis terminales Point"*. La app listará tu Point Smart automáticamente.
5. **Prueba rápida:** Pulsa *"Enviar prueba de $10 al Point"*. Tu terminal debería sonar y pedir tarjeta/QR.
6. Pulsa **"Iniciar Botón Flotante"** y abre Uber Driver.
