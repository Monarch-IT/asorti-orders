package uz.asorti.orders

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.Manifest
import android.content.pm.PackageManager
import android.webkit.GeolocationPermissions
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var swipeRefresh: SwipeRefreshLayout
    private val localUrl = "file:///android_asset/web/index.html"
    private var liveUrl = "https://asorty-trade-plus.web.app"

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        checkAndRequestLocationPermissions()

        webView = findViewById(R.id.webView)
        swipeRefresh = findViewById(R.id.swipeRefresh)

        swipeRefresh.setColorSchemeColors(0xFF003366.toInt(), 0xFF0066CC.toInt())
        swipeRefresh.setOnRefreshListener {
            if (isNetworkAvailable()) {
                webView.loadUrl(liveUrl)
            } else {
                webView.loadUrl(localUrl)
            }
        }

        configureWebView()

        if (isNetworkAvailable()) {
            webView.loadUrl(liveUrl)
        } else {
            webView.loadUrl(localUrl)
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        val s = webView.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.databaseEnabled = true
        s.allowFileAccess = true
        s.allowContentAccess = true
        s.loadsImagesAutomatically = true
        s.mediaPlaybackRequiresUserGesture = false
        s.setSupportZoom(false)
        s.builtInZoomControls = false
        s.displayZoomControls = false
        s.cacheMode = if (isNetworkAvailable()) WebSettings.LOAD_DEFAULT else WebSettings.LOAD_CACHE_ELSE_NETWORK

        webView.scrollBarStyle = View.SCROLLBARS_INSIDE_OVERLAY
        webView.isHapticFeedbackEnabled = true
        webView.addJavascriptInterface(OrdersNativeBridge(this), "OrdersNative")

        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                swipeRefresh.isRefreshing = true
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                swipeRefresh.isRefreshing = false
            }

            override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? {
                val urlStr = request?.url?.toString() ?: ""
                if (urlStr.endsWith("/api/products") && !isNetworkAvailable()) {
                    try {
                        val input = assets.open("web/api/products")
                        return WebResourceResponse("application/json", "UTF-8", input)
                    } catch (e: Exception) {}
                }
                return super.shouldInterceptRequest(view, request)
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                if (request?.isForMainFrame == true) {
                    view?.loadUrl(localUrl)
                }
            }
        }

        s.setGeolocationEnabled(true)
        s.setGeolocationDatabasePath(this.filesDir.path)

        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                if (newProgress >= 95) {
                    swipeRefresh.isRefreshing = false
                }
            }

            override fun onGeolocationPermissionsShowPrompt(
                origin: String?,
                callback: GeolocationPermissions.Callback?
            ) {
                callback?.invoke(origin, true, false)
            }
        }
    }

    private fun checkAndRequestLocationPermissions() {
        val permissions = arrayOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION
        )
        val needed = permissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (needed.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, needed.toTypedArray(), 1001)
        }
    }

    private fun isNetworkAvailable(): Boolean {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return false
        val network = cm.activeNetwork ?: return false
        val caps = cm.getNetworkCapabilities(network) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    inner class OrdersNativeBridge(private val context: Context) {
        @JavascriptInterface
        fun shareToTelegram(text: String, fileUrl: String) {
            runOnUiThread {
                try {
                    val intent = Intent(Intent.ACTION_SEND).apply {
                        type = "text/plain"
                        putExtra(Intent.EXTRA_TEXT, text)
                        setPackage("org.telegram.messenger")
                    }
                    if (intent.resolveActivity(packageManager) != null) {
                        startActivity(intent)
                    } else {
                        val chooser = Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                            type = "text/plain"
                            putExtra(Intent.EXTRA_TEXT, text)
                        }, "Поделиться накладной")
                        startActivity(chooser)
                    }
                } catch (e: Exception) {
                    Toast.makeText(context, "Ошибка отправки: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }

        @JavascriptInterface
        fun checkUpdates() {
            runOnUiThread {
                if (!isNetworkAvailable()) {
                    Toast.makeText(context, "Для проверки обновлений необходимо подключение к интернету", Toast.LENGTH_SHORT).show()
                    return@runOnUiThread
                }
                UpdateChecker.checkForUpdates(this@MainActivity, userInitiated = true)
            }
        }
    }
}
