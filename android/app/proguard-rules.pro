-repackageclasses ''
-allowaccessmodification
-renamesourcefileattribute SourceFile
-keepattributes SourceFile,LineNumberTable,*Annotation*

-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

-keep class uz.asorti.orders.MainActivity$OrdersNativeBridge {
    public *;
}

-keepclassmembers class uz.asorti.orders.MainActivity$OrdersNativeBridge {
    public *;
}

-dontwarn okio.**
-dontwarn java.awt.**
