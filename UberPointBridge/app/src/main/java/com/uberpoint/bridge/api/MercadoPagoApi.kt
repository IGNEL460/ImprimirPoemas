package com.uberpoint.bridge.api

import com.google.gson.Gson
import com.google.gson.JsonObject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

class MercadoPagoApi {
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .build()

    private val gson = Gson()
    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    /**
     * Obtiene la lista de terminales Point asociadas a la cuenta del usuario.
     */
    suspend fun getDevices(accessToken: String): ApiResult<List<PointDevice>> =
        withContext(Dispatchers.IO) {
            val url = "https://api.mercadopago.com/point/integration-api/devices"
            val request = Request.Builder()
                .url(url)
                .header("Authorization", "Bearer $accessToken")
                .header("Content-Type", "application/json")
                .get()
                .build()

            try {
                client.newCall(request).execute().use { response ->
                    val body = response.body?.string().orEmpty()
                    if (!response.isSuccessful) {
                        val errorMsg = parseErrorMessage(body, response.code)
                        return@withContext ApiResult.Error(errorMsg, response.code)
                    }

                    val listResponse = gson.fromJson(body, DeviceListResponse::class.java)
                    val devices = listResponse.devices ?: emptyList()
                    ApiResult.Success(devices)
                }
            } catch (e: IOException) {
                ApiResult.Error("Error de red/conexión: ${e.localizedMessage}")
            } catch (e: Exception) {
                ApiResult.Error("Error inesperado: ${e.localizedMessage}")
            }
        }

    /**
     * Envía una orden de cobro (Payment Intent) al Point Smart.
     */
    suspend fun createPaymentIntent(
        accessToken: String,
        deviceId: String,
        amount: Double,
        description: String = "Viaje Uber"
    ): ApiResult<PaymentIntentResponse> = withContext(Dispatchers.IO) {
        val url = "https://api.mercadopago.com/point/integration-api/devices/$deviceId/payment-intents"

        val payload = CreatePaymentIntentRequest(
            amount = amount,
            description = description
        )
        val jsonBody = gson.toJson(payload)

        val request = Request.Builder()
            .url(url)
            .header("Authorization", "Bearer $accessToken")
            .header("Content-Type", "application/json")
            .post(jsonBody.toRequestBody(jsonMediaType))
            .build()

        try {
            client.newCall(request).execute().use { response ->
                val body = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    val errorMsg = parseErrorMessage(body, response.code)
                    return@withContext ApiResult.Error(errorMsg, response.code)
                }

                val intentResponse = gson.fromJson(body, PaymentIntentResponse::class.java)
                ApiResult.Success(intentResponse)
            }
        } catch (e: IOException) {
            ApiResult.Error("Error de red: no se pudo contactar a Mercado Pago. Verificá tu conexión a datos.")
        } catch (e: Exception) {
            ApiResult.Error("Error: ${e.localizedMessage}")
        }
    }

    /**
     * Cancela la orden actual en el Point Smart si el chofer lo desea.
     */
    suspend fun cancelPaymentIntent(
        accessToken: String,
        deviceId: String
    ): ApiResult<Boolean> = withContext(Dispatchers.IO) {
        val url = "https://api.mercadopago.com/point/integration-api/devices/$deviceId/payment-intents"
        val request = Request.Builder()
            .url(url)
            .header("Authorization", "Bearer $accessToken")
            .delete()
            .build()

        try {
            client.newCall(request).execute().use { response ->
                if (response.isSuccessful || response.code == 404) {
                    ApiResult.Success(true)
                } else {
                    ApiResult.Error("No se pudo cancelar el cobro actual.", response.code)
                }
            }
        } catch (e: Exception) {
            ApiResult.Error(e.localizedMessage ?: "Error al cancelar")
        }
    }

    private fun parseErrorMessage(jsonBody: String, statusCode: Int): String {
        return try {
            val json = gson.fromJson(jsonBody, JsonObject::class.java)
            when {
                json.has("message") -> json.get("message").asString
                json.has("error") -> json.get("error").asString
                statusCode == 400 -> "Monto o datos inválidos para el Point Smart."
                statusCode == 401 -> "Token inválido o expirado. Verificá tus credenciales."
                statusCode == 404 -> "Terminal no encontrada o dispositivo no asociado a tu cuenta."
                statusCode == 409 -> "La terminal está ocupada con otra transacción abierta."
                else -> "Error en Mercado Pago ($statusCode)"
            }
        } catch (_: Exception) {
            "Error de respuesta del servidor ($statusCode)"
        }
    }
}
