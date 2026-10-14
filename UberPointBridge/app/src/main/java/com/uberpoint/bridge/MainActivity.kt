package com.uberpoint.bridge

import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.accessibility.AccessibilityManager
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.widget.addTextChangedListener
import androidx.lifecycle.lifecycleScope
import com.uberpoint.bridge.api.ApiResult
import com.uberpoint.bridge.api.MercadoPagoApi
import com.uberpoint.bridge.data.AppPreferences
import com.uberpoint.bridge.databinding.ActivityMainBinding
import com.uberpoint.bridge.service.FloatingWidgetService
import com.uberpoint.bridge.service.UberAccessibilityService
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var prefs: AppPreferences
    private val mpApi = MercadoPagoApi()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        prefs = AppPreferences.getInstance(this)

        setupFields()
        setupListeners()
    }

    override fun onResume() {
        super.onResume()
        updatePermissionStatus()
        updateServiceButtonState()
    }

    private fun setupFields() {
        binding.etAccessToken.setText(prefs.accessToken)
        binding.etDeviceId.setText(prefs.deviceId)

        binding.etAccessToken.addTextChangedListener {
            prefs.accessToken = it.toString()
        }

        binding.etDeviceId.addTextChangedListener {
            prefs.deviceId = it.toString()
        }
    }

    private fun setupListeners() {
        // Botón permiso Superposición
        binding.btnGrantOverlay.setOnClickListener {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                if (!Settings.canDrawOverlays(this)) {
                    val intent = Intent(
                        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:$packageName")
                    )
                    startActivity(intent)
                } else {
                    Toast.makeText(this, "Permiso de superposición ya concedido.", Toast.LENGTH_SHORT).show()
                }
            }
        }

        // Botón permiso Accesibilidad
        binding.btnGrantAccessibility.setOnClickListener {
            val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
            startActivity(intent)
            Toast.makeText(
                this,
                "Buscá 'Lector de Tarifas Uber para Point' y activalo.",
                Toast.LENGTH_LONG
            ).show()
        }

        // Botón detectar terminales Mercado Pago
        binding.btnFetchDevices.setOnClickListener {
            fetchMercadoPagoDevices()
        }

        // Botón cobro de prueba
        binding.btnTestPayment.setOnClickListener {
            runTestPayment()
        }

        // Botón iniciar / detener botón flotante
        binding.btnToggleFloatingService.setOnClickListener {
            toggleFloatingService()
        }
    }

    private fun updatePermissionStatus() {
        val hasOverlay = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Settings.canDrawOverlays(this)
        } else {
            true
        }

        val hasAccessibility = isAccessibilityServiceEnabled()

        if (hasOverlay) {
            binding.tvOverlayStatus.text = "✓ Mostrar sobre otras apps: CONCEDIDO"
            binding.tvOverlayStatus.setTextColor(ContextCompat.getColor(this, R.color.accent))
            binding.btnGrantOverlay.isEnabled = false
            binding.btnGrantOverlay.text = "Listo"
        } else {
            binding.tvOverlayStatus.text = "• Mostrar sobre otras apps: PENDIENTE"
            binding.tvOverlayStatus.setTextColor(ContextCompat.getColor(this, R.color.warning))
            binding.btnGrantOverlay.isEnabled = true
            binding.btnGrantOverlay.text = "Activar"
        }

        if (hasAccessibility) {
            binding.tvAccessibilityStatus.text = "✓ Lector de pantalla: CONCEDIDO"
            binding.tvAccessibilityStatus.setTextColor(ContextCompat.getColor(this, R.color.accent))
            binding.btnGrantAccessibility.isEnabled = false
            binding.btnGrantAccessibility.text = "Listo"
        } else {
            binding.tvAccessibilityStatus.text = "• Lector de pantalla: PENDIENTE"
            binding.tvAccessibilityStatus.setTextColor(ContextCompat.getColor(this, R.color.warning))
            binding.btnGrantAccessibility.isEnabled = true
            binding.btnGrantAccessibility.text = "Activar"
        }
    }

    private fun isAccessibilityServiceEnabled(): Boolean {
        val am = getSystemService(Context.ACCESSIBILITY_SERVICE) as AccessibilityManager
        val enabledServices = am.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK)
        for (service in enabledServices) {
            if (service.resolveInfo.serviceInfo.packageName == packageName &&
                service.resolveInfo.serviceInfo.name == UberAccessibilityService::class.java.name
            ) {
                return true
            }
        }
        return false
    }

    private fun fetchMercadoPagoDevices() {
        val token = prefs.accessToken
        if (token.isEmpty()) {
            Toast.makeText(this, "Ingresá primero tu Access Token de Mercado Pago.", Toast.LENGTH_SHORT).show()
            return
        }

        binding.btnFetchDevices.isEnabled = false
        binding.btnFetchDevices.text = "Consultando Mercado Pago..."

        lifecycleScope.launch {
            val result = mpApi.getDevices(token)
            binding.btnFetchDevices.isEnabled = true
            binding.btnFetchDevices.text = "Detectar mis terminales Point"

            when (result) {
                is ApiResult.Success -> {
                    val devices = result.data
                    if (devices.isEmpty()) {
                        AlertDialog.Builder(this@MainActivity)
                            .setTitle("Sin terminales")
                            .setMessage("No se encontraron terminales Point activas en tu cuenta. Asegurate de que el Point Smart esté encendido y vinculado a tu cuenta de Mercado Pago.")
                            .setPositiveButton("Entendido", null)
                            .show()
                    } else if (devices.size == 1) {
                        val device = devices.first()
                        prefs.deviceId = device.id
                        binding.etDeviceId.setText(device.id)
                        Toast.makeText(
                            this@MainActivity,
                            "¡Terminal ${device.id} detectada y configurada!",
                            Toast.LENGTH_LONG
                        ).show()
                    } else {
                        // Selección múltiple
                        val deviceIds = devices.map { it.id }.toTypedArray()
                        AlertDialog.Builder(this@MainActivity)
                            .setTitle("Seleccioná tu Point Smart")
                            .setItems(deviceIds) { _, which ->
                                val selectedId = deviceIds[which]
                                prefs.deviceId = selectedId
                                binding.etDeviceId.setText(selectedId)
                                Toast.makeText(
                                    this@MainActivity,
                                    "Terminal seleccionada: $selectedId",
                                    Toast.LENGTH_SHORT
                                ).show()
                            }
                            .show()
                    }
                }
                is ApiResult.Error -> {
                    AlertDialog.Builder(this@MainActivity)
                        .setTitle("Error de conexión")
                        .setMessage(result.message)
                        .setPositiveButton("Aceptar", null)
                        .show()
                }
            }
        }
    }

    private fun runTestPayment() {
        val token = prefs.accessToken
        val deviceId = prefs.deviceId

        if (token.isEmpty() || deviceId.isEmpty()) {
            Toast.makeText(this, "Completá el Token y seleccioná un Point Smart antes de probar.", Toast.LENGTH_SHORT).show()
            return
        }

        binding.btnTestPayment.isEnabled = false
        binding.btnTestPayment.text = "Enviando $10 al Point..."

        lifecycleScope.launch {
            val result = mpApi.createPaymentIntent(
                accessToken = token,
                deviceId = deviceId,
                amount = 10.0,
                description = "Prueba Uber Point Bridge"
            )

            binding.btnTestPayment.isEnabled = true
            binding.btnTestPayment.text = "Enviar prueba de $10 al Point"

            when (result) {
                is ApiResult.Success -> {
                    AlertDialog.Builder(this@MainActivity)
                        .setTitle("¡Éxito!")
                        .setMessage("Se envió una orden de $10 a tu Point Smart. Tu terminal debería estar pitando y mostrando la pantalla de cobro.")
                        .setPositiveButton("Genial", null)
                        .show()
                }
                is ApiResult.Error -> {
                    AlertDialog.Builder(this@MainActivity)
                        .setTitle("No se pudo enviar el cobro")
                        .setMessage("Detalle: ${result.message}")
                        .setPositiveButton("Entendido", null)
                        .show()
                }
            }
        }
    }

    private fun toggleFloatingService() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
            Toast.makeText(this, "Debes otorgar el permiso 'Mostrar sobre otras apps' primero.", Toast.LENGTH_LONG).show()
            return
        }

        val serviceIntent = Intent(this, FloatingWidgetService::class.java)

        if (prefs.isServiceRunning) {
            stopService(serviceIntent)
            prefs.isServiceRunning = false
            Toast.makeText(this, "Botón flotante detenido.", Toast.LENGTH_SHORT).show()
        } else {
            ContextCompat.startForegroundService(this, serviceIntent)
            prefs.isServiceRunning = true
            Toast.makeText(this, "Botón flotante iniciado. Podés abrir Uber Driver.", Toast.LENGTH_LONG).show()
        }

        updateServiceButtonState()
    }

    private fun updateServiceButtonState() {
        if (prefs.isServiceRunning) {
            binding.btnToggleFloatingService.text = "Detener Botón Flotante"
            binding.btnToggleFloatingService.setBackgroundColor(ContextCompat.getColor(this, R.color.error))
        } else {
            binding.btnToggleFloatingService.text = "Iniciar Botón Flotante"
            binding.btnToggleFloatingService.setBackgroundColor(ContextCompat.getColor(this, R.color.primary))
        }
    }
}
