# The page calls into this class by name from JavaScript, so it must survive
# shrinking with its method names intact.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.shavtzak.app.ShavtzakWidget { *; }
-keep class com.shavtzak.app.ShavtzakMessaging { *; }
