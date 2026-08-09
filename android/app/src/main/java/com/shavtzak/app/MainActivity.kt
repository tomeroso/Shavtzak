package com.shavtzak.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import org.json.JSONObject

/**
 * The whole interface is the web app, in a WebView.
 *
 * Rewriting it in Kotlin would take months and would immediately drift from the
 * version everybody uses in a browser. What this shell adds is what a web page
 * cannot do: a widget on the home screen, notifications through Firebase, and
 * an icon in the launcher.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView

    private val askNotifications =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        web = WebView(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT
            )
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.userAgentString = settings.userAgentString + " ShavtzakApp/1.0"
            webViewClient = Client()
            addJavascriptInterface(Bridge(), "ShavtzakAndroid")
        }
        setContentView(web)

        if (savedInstanceState == null) web.loadUrl(Shared.origin(this))

        // Asked on the second launch, not the first. A permission dialog in the
        // opening two seconds, before anyone has seen what this is, gets a no.
        val runs = getSharedPreferences("shavtzak", MODE_PRIVATE).getInt("runs", 0)
        getSharedPreferences("shavtzak", MODE_PRIVATE).edit().putInt("runs", runs + 1).apply()
        if (runs >= 1) askForNotifications()
    }

    private fun askForNotifications() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            == PackageManager.PERMISSION_GRANTED) return
        askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    /** Back inside the page rather than straight out of the app. */
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    override fun onResume() {
        super.onResume()
        ShavtzakWidget.refresh(this)
    }

    private inner class Client : WebViewClient() {

        /** Anything that is not our own site opens outside. A guard roster app
         *  has no business rendering somebody else's page inside itself. */
        override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
            val url = req.url ?: return false
            val s = url.scheme ?: ""
            if (s == "tel" || s == "mailto" || s == "sms") {
                open(url); return true
            }
            if (url.toString().startsWith(Shared.origin(this@MainActivity))) return false
            if (s == "http" || s == "https") { open(url); return true }
            return true
        }

        override fun onPageFinished(view: WebView, url: String) {
            ShavtzakWidget.refresh(this@MainActivity)
        }

        private fun open(u: Uri) {
            try { startActivity(Intent(Intent.ACTION_VIEW, u)) } catch (e: Exception) { }
        }
    }

    /**
     * The page calls window.ShavtzakAndroid.post(json). Only two messages
     * matter: here is your widget token, and please redraw.
     */
    private inner class Bridge {
        @JavascriptInterface
        fun post(raw: String) {
            val msg = try { JSONObject(raw) } catch (e: Exception) { return }
            when (msg.optString("type")) {
                "widget" -> {
                    val token = msg.optString("token")
                    if (token.isNotEmpty()) Shared.setToken(this@MainActivity, token)
                    val origin = msg.optString("origin")
                    if (origin.isNotEmpty()) Shared.setOrigin(this@MainActivity, origin)
                    Push.register(applicationContext)
                    ShavtzakWidget.refresh(this@MainActivity)
                }
                "refresh" -> ShavtzakWidget.refresh(this@MainActivity)
            }
        }
    }
}
