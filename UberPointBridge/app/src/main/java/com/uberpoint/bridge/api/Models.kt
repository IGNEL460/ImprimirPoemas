package com.uberpoint.bridge.api

import com.google.gson.annotations.SerializedName

data class DeviceListResponse(
    @SerializedName("devices")
    val devices: List<PointDevice>?
)

data class PointDevice(
    @SerializedName("id")
    val id: String,
    @SerializedName("pos_id")
    val posId: Long?,
    @SerializedName("operating_mode")
    val operatingMode: String?
)

data class CreatePaymentIntentRequest(
    @SerializedName("amount")
    val amount: Double,
    @SerializedName("description")
    val description: String = "Viaje Uber",
    @SerializedName("payment")
    val payment: PaymentOptions? = null
)

data class PaymentOptions(
    @SerializedName("type")
    val type: String? = null // "credit_card", "debit_card", "voucher_card"
)

data class PaymentIntentResponse(
    @SerializedName("id")
    val id: String?,
    @SerializedName("device_id")
    val deviceId: String?,
    @SerializedName("amount")
    val amount: Double?,
    @SerializedName("status")
    val status: String?,
    @SerializedName("message")
    val message: String?
)

sealed class ApiResult<out T> {
    data class Success<out T>(val data: T) : ApiResult<T>()
    data class Error(val message: String, val statusCode: Int? = null) : ApiResult<Nothing>()
}
