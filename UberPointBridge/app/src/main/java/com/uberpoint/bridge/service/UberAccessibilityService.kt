package com.uberpoint.bridge.service

import android.accessibilityservice.AccessibilityService
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

class UberAccessibilityService : AccessibilityService() {

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        Log.d(TAG, "UberAccessibilityService conectado correctamente.")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Escaneamos la pantalla cuando cambia la ventana o el contenido
        if (event == null) return

        val rootNode = rootInActiveWindow ?: return
        try {
            val amount = findFareAmount(rootNode)
            if (amount != null && amount > 0) {
                lastDetectedAmount = amount
                onAmountDetectedListener?.invoke(amount)
                Log.d(TAG, "Monto detectado en pantalla: $$amount")
            }
        } finally {
            rootNode.recycle()
        }
    }

    override fun onInterrupt() {
        Log.w(TAG, "UberAccessibilityService interrumpido.")
    }

    override fun onDestroy() {
        super.onDestroy()
        if (instance == this) {
            instance = null
        }
    }

    companion object {
        private const val TAG = "UberAccessibility"

        @Volatile
        var instance: UberAccessibilityService? = null
            private set

        @Volatile
        var lastDetectedAmount: Double? = null

        var onAmountDetectedListener: ((Double) -> Unit)? = null

        /**
         * Permite forzar una lectura inmediata de la pantalla activa al pulsar el botón.
         */
        fun readScreenNow(): Double? {
            val service = instance ?: return lastDetectedAmount
            val root = service.rootInActiveWindow ?: return lastDetectedAmount
            return try {
                val amount = service.findFareAmount(root)
                if (amount != null && amount > 0) {
                    lastDetectedAmount = amount
                    amount
                } else {
                    lastDetectedAmount
                }
            } finally {
                root.recycle()
            }
        }
    }

    /**
     * Algoritmo de detección inteligente de tarifas:
     * 1. Prioriza nodos que tengan o estén cerca de palabras clave ("Efectivo", "Cobrar", "Recoger", "Total").
     * 2. Analiza expresiones monetarias como "$ 4.500", "$4500,00", "$ 1,250.00".
     */
    private fun findFareAmount(rootNode: AccessibilityNodeInfo): Double? {
        val candidates = mutableListOf<CandidatePrice>()
        traverseAndCollect(rootNode, candidates, parentKeyword = false)

        if (candidates.isEmpty()) return null

        // Ordenamos por prioridad contextual (si estaba cerca de "Efectivo"/"Cobrar") y luego por valor
        val bestMatch = candidates.maxWithOrNull(
            compareBy<CandidatePrice> { it.hasCashContext }
                .thenBy { it.amount }
        )

        return bestMatch?.amount
    }

    private data class CandidatePrice(
        val amount: Double,
        val hasCashContext: Boolean
    )

    private fun traverseAndCollect(
        node: AccessibilityNodeInfo,
        results: MutableList<CandidatePrice>,
        parentKeyword: Boolean
    ) {
        val text = node.text?.toString()?.trim() ?: ""
        val contentDesc = node.contentDescription?.toString()?.trim() ?: ""
        val combined = "$text $contentDesc"

        val containsKeyword = parentKeyword || isFareKeyword(combined)

        // Verificamos si contiene un precio con formato de moneda
        val parsedAmount = extractPriceNumber(combined)
        if (parsedAmount != null && parsedAmount > 0) {
            results.add(CandidatePrice(parsedAmount, containsKeyword))
        }

        // Recorrer hijos
        val childCount = node.childCount
        for (i in 0 until childCount) {
            val child = node.getChild(i) ?: continue
            traverseAndCollect(child, results, containsKeyword)
            child.recycle()
        }
    }

    private fun isFareKeyword(text: String): Boolean {
        val lower = text.lowercase()
        return lower.contains("efectivo") ||
                lower.contains("cobrar") ||
                lower.contains("recoger") ||
                lower.contains("total") ||
                lower.contains("tarifa") ||
                lower.contains("pagar") ||
                lower.contains("cash") ||
                lower.contains("collect")
    }

    private fun extractPriceNumber(raw: String): Double? {
        // Regex para detectar valores tipo: "$ 3.450,50", "$3450", "$ 1,200.00", "ARS 4500"
        val regex = Regex("""(?:\$|ARS|UYU|COP|MXN|CLP)\s*([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{1,2})?|[0-9]+(?:[.,][0-9]{1,2})?)""")
        val match = regex.find(raw) ?: return null

        val numberString = match.groupValues[1]
        return normalizeToDouble(numberString)
    }

    private fun normalizeToDouble(str: String): Double? {
        return try {
            // Manejar separadores de miles y decimales comunes en Latinoamérica:
            // Ejemplos: "4.500,50" -> 4500.50 | "4,500.50" -> 4500.50 | "4500" -> 4500.0
            var clean = str.trim()
            if (clean.contains(".") && clean.contains(",")) {
                if (clean.lastIndexOf(",") > clean.lastIndexOf(".")) {
                    // Formato latinoamericano/europeo: 1.250,50
                    clean = clean.replace(".", "").replace(",", ".")
                } else {
                    // Formato anglosajón: 1,250.50
                    clean = clean.replace(",", "")
                }
            } else if (clean.contains(",")) {
                // Solo coma: si tiene 2 dígitos al final es decimal (ej: 450,50), si tiene 3 es miles (4,500)
                val parts = clean.split(",")
                if (parts.size == 2 && parts[1].length == 3) {
                    clean = clean.replace(",", "")
                } else {
                    clean = clean.replace(",", ".")
                }
            } else if (clean.contains(".")) {
                // Solo punto: si tiene 3 dígitos al final usualmente es miles (ej: 4.500)
                val parts = clean.split(".")
                if (parts.size == 2 && parts[1].length == 3) {
                    clean = clean.replace(".", "")
                }
            }
            clean.toDoubleOrNull()
        } catch (_: Exception) {
            null
        }
    }
}
