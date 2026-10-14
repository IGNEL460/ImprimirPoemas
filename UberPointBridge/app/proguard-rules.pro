# Proguard rules for UberPointBridge
-keep class com.uberpoint.bridge.api.** { *; }
-keepclassmembers class * {
    @com.google.gson.annotations.SerializedName <fields>;
}
