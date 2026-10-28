package uz.asorti.orders

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Bundle
import android.util.Base64
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
import androidx.core.content.FileProvider
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import java.io.File
import java.io.FileOutputStream

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
                webView.clearCache(true)
                webView.loadUrl(liveUrl)
            } else {
                webView.loadUrl(localUrl)
            }
        }

        configureWebView()

        if (isNetworkAvailable()) {
            webView.clearCache(true)
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
        WebView.setWebContentsDebuggingEnabled(false)
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
        s.useWideViewPort = true
        s.loadWithOverviewMode = true
        s.cacheMode = if (isNetworkAvailable()) WebSettings.LOAD_NO_CACHE else WebSettings.LOAD_CACHE_ELSE_NETWORK

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

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false
                if (url.startsWith("yandexnavi:") || url.startsWith("yandexmaps:") || url.startsWith("geo:") || url.startsWith("intent:") || url.contains("yandex.ru/maps") || url.contains("maps.yandex.ru") || url.contains("maps.google.com") || url.startsWith("tel:") || url.startsWith("mailto:")) {
                    try {
                        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                        startActivity(intent)
                        return true
                    } catch (e: Exception) {
                        if (url.startsWith("yandexnavi:")) {
                            val fallbackUrl = url.replace("yandexnavi://build_route_on_map?lat_to=", "https://yandex.ru/maps/?rtext=~").replace("&lon_to=", ",") + "&rtt=auto"
                            try {
                                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(fallbackUrl)))
                                return true
                            } catch (e2: Exception) {}
                        }
                    }
                }
                return super.shouldOverrideUrlLoading(view, request)
            }

            override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? {
                val urlStr = request?.url?.toString() ?: ""
                if (urlStr.contains("/api/products") && !isNetworkAvailable()) {
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
        fun shareFileToTelegram(base64Data: String, fileName: String, mimeType: String, text: String) {
            runOnUiThread {
                try {
                    val cleanBase64 = if (base64Data.contains(",")) {
                        base64Data.substringAfter(",")
                    } else {
                        base64Data
                    }
                    val fileBytes = Base64.decode(cleanBase64, Base64.DEFAULT)
                    val shareDir = File(context.cacheDir, "shares")
                    if (!shareDir.exists()) {
                        shareDir.mkdirs()
                    }
                    val file = File(shareDir, fileName)
                    FileOutputStream(file).use { fos ->
                        fos.write(fileBytes)
                        fos.flush()
                    }

                    val contentUri = FileProvider.getUriForFile(
                        context,
                        "${context.packageName}.fileprovider",
                        file
                    )

                    val intent = Intent(Intent.ACTION_SEND).apply {
                        type = if (mimeType.isNotBlank()) mimeType else "*/*"
                        putExtra(Intent.EXTRA_STREAM, contentUri)
                        if (text.isNotBlank()) {
                            putExtra(Intent.EXTRA_TEXT, text)
                        }
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        setPackage("org.telegram.messenger")
                    }

                    if (intent.resolveActivity(packageManager) != null) {
                        startActivity(intent)
                    } else {
                        val fallbackIntent = Intent(Intent.ACTION_SEND).apply {
                            type = if (mimeType.isNotBlank()) mimeType else "*/*"
                            putExtra(Intent.EXTRA_STREAM, contentUri)
                            if (text.isNotBlank()) {
                                putExtra(Intent.EXTRA_TEXT, text)
                            }
                            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        }
                        val chooser = Intent.createChooser(fallbackIntent, "Отправить файл через Telegram")
                        startActivity(chooser)
                    }
                } catch (e: Exception) {
                    Toast.makeText(context, "Ошибка отправки файла: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }

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

        @JavascriptInterface
        fun openYandexNavigator(lat: Double, lng: Double, label: String) {
            runOnUiThread {
                try {
                    val naviIntent = Intent(Intent.ACTION_VIEW, Uri.parse("yandexnavi://build_route_on_map?lat_to=$lat&lon_to=$lng"))
                    naviIntent.setPackage("ru.yandex.yandexnavi")
                    if (naviIntent.resolveActivity(packageManager) != null) {
                        startActivity(naviIntent)
                        return@runOnUiThread
                    }
                } catch (e: Exception) {}

                try {
                    val mapsIntent = Intent(Intent.ACTION_VIEW, Uri.parse("yandexmaps://maps.yandex.ru/?rtext=~$lat,$lng&rtt=auto"))
                    mapsIntent.setPackage("ru.yandex.yandexmaps")
                    if (mapsIntent.resolveActivity(packageManager) != null) {
                        startActivity(mapsIntent)
                        return@runOnUiThread
                    }
                } catch (e: Exception) {}

                try {
                    val webIntent = Intent(Intent.ACTION_VIEW, Uri.parse("https://yandex.ru/maps/?rtext=~$lat,$lng&rtt=auto"))
                    startActivity(webIntent)
                } catch (e: Exception) {
                    Toast.makeText(context, "Не удалось открыть навигатор", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }
}
