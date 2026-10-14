package com.uberpoint.bridge.service

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.view.Gravity
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.core.app.NotificationCompat
import com.uberpoint.bridge.MainActivity
import com.uberpoint.bridge.R
import com.uberpoint.bridge.api.ApiResult
import com.uberpoint.bridge.api.MercadoPagoApi
import com.uberpoint.bridge.data.AppPreferences
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.abs

class FloatingWidgetService : Service() {

    private lateinit var windowManager: WindowManager
    private lateinit var floatingView: View
    private lateinit var params: WindowManager.LayoutParams
    private lateinit var prefs: AppPreferences

    private lateinit var bubbleContainer: FrameLayout
    private lateinit var ivBubbleIcon: ImageView
    private lateinit var pbBubbleLoading: ProgressBar
    private lateinit var layoutPriceBadge: LinearLayout
    private lateinit var tvDetectedPrice: TextView

    private val serviceScope = CoroutineScope(Dispatchers.Main + Job())
    private val mpApi = MercadoPagoApi()
    private val handler = Handler(Looper.getMainLooper())

    private var isSendingPayment = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        prefs = AppPreferences.getInstance(this)
        windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager

        startForegroundServiceNotification()
        setupFloatingView()
        setupAccessibilityListener()
    }

    @SuppressLint("InflateParams")
    private fun setupFloatingView() {
        floatingView = LayoutInflater.from(this).inflate(R.layout.layout_floating_widget, null)

        bubbleContainer = floatingView.findViewById(R.id.bubbleContainer)
        ivBubbleIcon = floatingView.findViewById(R.id.ivBubbleIcon)
        pbBubbleLoading = floatingView.findViewById(R.id.pbBubbleLoading)
        layoutPriceBadge = floatingView.findViewById(R.id.layoutPriceBadge)
        tvDetectedPrice = floatingView.findViewById(R.id.tvDetectedPrice)

        val layoutType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }

        params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            layoutType,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                    WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = 30
            y = 400
        }

        windowManager.addView(floatingView, params)
        setupTouchAndDragListener()
    }

    private fun setupAccessibilityListener() {
        // Escucha actualizaciones automáticas del lector de pantalla
        UberAccessibilityService.onAmountDetectedListener = { amount ->
            handler.post {
                updateDetectedPriceBadge(amount)
            }
        }

        // Si ya había un monto detectado previamente
        UberAccessibilityService.lastDetectedAmount?.let {
            updateDetectedPriceBadge(it)
        }
    }

    private fun updateDetectedPriceBadge(amount: Double) {
        layoutPriceBadge.visibility = View.VISIBLE
        val formatted = if (amount % 1.0 == 0.0) {
            String.format("$ %,.0f", amount)
        } else {
            String.format("$ %,.2f", amount)
        }
        tvDetectedPrice.text = formatted
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun setupTouchAndDragListener() {
        var initialX = 0
        var initialY = 0
        var initialTouchX = 0f
        var initialTouchY = 0f
        var isClick = true

        bubbleContainer.setOnTouchListener { _, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    initialX = params.x
                    initialY = params.y
                    initialTouchX = event.rawX
                    initialTouchY = event.rawY
                    isClick = true
                    true
                }

                MotionEvent.ACTION_MOVE -> {
                    val deltaX = (event.rawX - initialTouchX).toInt()
                    val deltaY = (event.rawY - initialTouchY).toInt()

                    if (abs(deltaX) > 12 || abs(deltaY) > 12) {
                        isClick = false
                    }

                    params.x = initialX + deltaX
                    params.y = initialY + deltaY
                    windowManager.updateViewLayout(floatingView, params)
                    true
                }

                MotionEvent.ACTION_UP -> {
                    if (isClick) {
                        onBubbleClicked()
                    } else {
                        // Imantar al borde de pantalla más cercano (izq o der)
                        val screenWidth = resources.displayMetrics.widthPixels
                        params.x = if (params.x + (floatingView.width / 2) < screenWidth / 2) {
                            10
                        } else {
                            screenWidth - floatingView.width - 10
                        }
                        windowManager.updateViewLayout(floatingView, params)
                    }
                    true
                }

                else -> false
            }
        }
    }

    private fun onBubbleClicked() {
        if (isSendingPayment) return

        vibrate(30)

        // Forzar escaneo de pantalla en el momento exacto
        val amount = UberAccessibilityService.readScreenNow()

        if (amount == null || amount <= 0) {
            Toast.makeText(
                this,
                "No se detectó el precio en pantalla. Asegurate de tener abierta la pantalla de cobro de Uber.",
                Toast.LENGTH_LONG
            ).show()
            showErrorState()
            return
        }

        val token = prefs.accessToken
        val deviceId = prefs.deviceId

        if (token.isEmpty() || deviceId.isEmpty()) {
            Toast.makeText(
                this,
                "Falta configurar Token o Device ID de Mercado Pago en la app.",
                Toast.LENGTH_LONG
            ).show()
            showErrorState()
            return
        }

        sendPaymentToPoint(token, deviceId, amount)
    }

    private fun sendPaymentToPoint(token: String, deviceId: String, amount: Double) {
        isSendingPayment = true
        showLoadingState()

        serviceScope.launch {
            val result = mpApi.createPaymentIntent(
                accessToken = token,
                deviceId = deviceId,
                amount = amount,
                description = "Viaje Uber"
            )

            withContext(Dispatchers.Main) {
                isSendingPayment = false
                when (result) {
                    is ApiResult.Success -> {
                        showSuccessState(amount)
                    }
                    is ApiResult.Error -> {
                        showErrorState()
                        Toast.makeText(
                            this@FloatingWidgetService,
                            "Error Point: ${result.message}",
                            Toast.LENGTH_LONG
                        ).show()
                    }
                }
            }
        }
    }

    private fun showLoadingState() {
        pbBubbleLoading.visibility = View.VISIBLE
        ivBubbleIcon.visibility = View.GONE
    }

    private fun showSuccessState(amount: Double) {
        vibrate(100)
        pbBubbleLoading.visibility = View.GONE
        ivBubbleIcon.visibility = View.VISIBLE
        ivBubbleIcon.setImageResource(R.drawable.ic_check)
        bubbleContainer.setBackgroundResource(R.drawable.bg_floating_bubble_success)

        val formatted = String.format("$ %,.0f", amount)
        Toast.makeText(
            this,
            "¡Orden de $formatted enviada al Point Smart!",
            Toast.LENGTH_SHORT
        ).show()

        handler.postDelayed({
            resetBubbleState()
        }, 3500)
    }

    private fun showErrorState() {
        vibrate(200)
        pbBubbleLoading.visibility = View.GONE
        ivBubbleIcon.visibility = View.VISIBLE
        bubbleContainer.setBackgroundResource(R.drawable.bg_floating_bubble_error)

        handler.postDelayed({
            resetBubbleState()
        }, 3000)
    }

    private fun resetBubbleState() {
        pbBubbleLoading.visibility = View.GONE
        ivBubbleIcon.visibility = View.VISIBLE
        ivBubbleIcon.setImageResource(R.drawable.ic_point_terminal)
        bubbleContainer.setBackgroundResource(R.drawable.bg_floating_bubble)
    }

    private fun vibrate(durationMs: Long) {
        val vibrator = getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator?.vibrate(VibrationEffect.createOneShot(durationMs, VibrationEffect.DEFAULT_AMPLITUDE))
        } else {
            @Suppress("DEPRECATION")
            vibrator?.vibrate(durationMs)
        }
    }

    private fun startForegroundServiceNotification() {
        val channelId = "uber_point_channel"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                channelId,
                getString(R.string.channel_name),
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = getString(R.string.channel_description)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }

        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val notification: Notification = NotificationCompat.Builder(this, channelId)
            .setContentTitle("Uber Point Bridge Activo")
            .setContentText("El botón flotante está listo para enviar cobros al Point Smart.")
            .setSmallIcon(R.drawable.ic_point_terminal)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()

        startForeground(1001, notification)
    }

    override fun onDestroy() {
        super.onDestroy()
        UberAccessibilityService.onAmountDetectedListener = null
        serviceScope.cancel()
        if (::floatingView.isInitialized) {
            try {
                windowManager.removeView(floatingView)
            } catch (_: Exception) {}
        }
    }
}
