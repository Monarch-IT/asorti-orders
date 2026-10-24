package uz.asorti.orders

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.widget.Toast
import androidx.core.content.FileProvider
import com.google.gson.Gson
import com.google.gson.annotations.SerializedName
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.TimeUnit

data class VersionInfo(
    @SerializedName("versionCode") val versionCode: Int,
    @SerializedName("versionName") val versionName: String,
    @SerializedName("apkUrl") val apkUrl: String,
    @SerializedName("changelog") val changelog: String?
)

object UpdateChecker {
    private const val VERSION_URL = "https://asorty-trade-plus.web.app/update.json"

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    fun checkForUpdates(activity: Activity, userInitiated: Boolean = true) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val req = Request.Builder()
                    .url(VERSION_URL + "?t=" + System.currentTimeMillis())
                    .header("Cache-Control", "no-cache, no-store, must-revalidate")
                    .header("Pragma", "no-cache")
                    .build()

                val resp = client.newCall(req).execute()
                if (!resp.isSuccessful) {
                    if (userInitiated) withContext(Dispatchers.Main) {
                        Toast.makeText(activity, "Не удалось проверить обновления (${resp.code})", Toast.LENGTH_SHORT).show()
                    }
                    return@launch
                }

                val bodyStr = resp.body?.string() ?: return@launch
                val info = Gson().fromJson(bodyStr, VersionInfo::class.java)

                val currentCode = try {
                    val pInfo = activity.packageManager.getPackageInfo(activity.packageName, 0)
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                        pInfo.longVersionCode.toInt()
                    } else {
                        @Suppress("DEPRECATION")
                        pInfo.versionCode
                    }
                } catch (e: Exception) { 1 }

                if (info.versionCode > currentCode) {
                    withContext(Dispatchers.Main) {
                        showUpdateDialog(activity, info)
                    }
                } else if (userInitiated) {
                    withContext(Dispatchers.Main) {
                        Toast.makeText(activity, "У вас установлена актуальная версия (${info.versionName})", Toast.LENGTH_SHORT).show()
                    }
                }
            } catch (e: Exception) {
                if (userInitiated) withContext(Dispatchers.Main) {
                    Toast.makeText(activity, "Нет подключения к серверу обновлений", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    private fun showUpdateDialog(activity: Activity, info: VersionInfo) {
        if (activity.isFinishing || activity.isDestroyed) return

        val message = buildString {
            append("Доступна новая версия: ${info.versionName}\n\n")
            if (!info.changelog.isNullOrBlank()) {
                append("Что нового:\n${info.changelog}\n\n")
            }
            append("Нажмите «Скачать и установить», чтобы обновить приложение.")
        }

        AlertDialog.Builder(activity)
            .setTitle("Обновление ASORTI")
            .setMessage(message)
            .setPositiveButton("Скачать и установить") { _, _ ->
                downloadAndInstallApk(activity, info)
            }
            .setNegativeButton("Позже", null)
            .setCancelable(true)
            .show()
    }

    private fun downloadAndInstallApk(activity: Activity, info: VersionInfo) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (!activity.packageManager.canRequestPackageInstalls()) {
                AlertDialog.Builder(activity)
                    .setTitle("Разрешение на установку")
                    .setMessage("Для установки новой версии разрешите приложению установку APK.")
                    .setPositiveButton("Настройки") { _, _ ->
                        val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
                            data = Uri.parse("package:${activity.packageName}")
                        }
                        activity.startActivity(intent)
                    }
                    .setNegativeButton("Отмена", null)
                    .show()
                return
            }
        }

        val progressDialog = AlertDialog.Builder(activity)
            .setTitle("Загрузка обновления")
            .setMessage("Скачивание актуальной версии ${info.versionName}…")
            .setCancelable(false)
            .create()
        progressDialog.show()

        CoroutineScope(Dispatchers.IO).launch {
            try {
                val apkDir = File(activity.cacheDir, "updates")
                if (apkDir.exists()) {
                    apkDir.listFiles()?.forEach { it.delete() }
                } else {
                    apkDir.mkdirs()
                }

                val apkFile = File(apkDir, "AsortiOrders_v${info.versionCode}.apk")
                if (apkFile.exists()) {
                    apkFile.delete()
                }

                val downloadReq = Request.Builder()
                    .url(info.apkUrl)
                    .header("Cache-Control", "no-cache, no-store, must-revalidate")
                    .header("Pragma", "no-cache")
                    .build()

                val response = client.newCall(downloadReq).execute()
                if (!response.isSuccessful) {
                    throw Exception("Код ошибки сервера: ${response.code}")
                }

                val body = response.body ?: throw Exception("Пустой ответ от сервера")
                body.byteStream().use { input ->
                    FileOutputStream(apkFile).use { output ->
                        input.copyTo(output)
                    }
                }

                withContext(Dispatchers.Main) {
                    if (progressDialog.isShowing) progressDialog.dismiss()

                    val apkUri = FileProvider.getUriForFile(
                        activity,
                        "${activity.packageName}.fileprovider",
                        apkFile
                    )
                    val installIntent = Intent(Intent.ACTION_VIEW).apply {
                        setDataAndType(apkUri, "application/vnd.android.package-archive")
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION
                    }
                    activity.startActivity(installIntent)
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    if (progressDialog.isShowing) progressDialog.dismiss()
                    Toast.makeText(activity, "Ошибка загрузки: ${e.message}", Toast.LENGTH_LONG).show()
                }
            }
        }
    }
}
