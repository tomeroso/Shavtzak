package com.shavtzak.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

object Push {
    const val CHANNEL = "shavtzak"

    /** Hand the device token to the worker, paired with the widget token. */
    fun register(context: Context) {
        if (!BuildConfig.HAS_FIREBASE) return
        if (Shared.token(context) == null) return
        FirebaseMessaging.getInstance().token.addOnSuccessListener { fcm ->
            CoroutineScope(Dispatchers.IO).launch {
                Shared.post(context, "/api/fcm/register", JSONObject().put("token", fcm))
            }
        }
    }

    fun channel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val c = NotificationChannel(CHANNEL, "שבצ״ק", NotificationManager.IMPORTANCE_HIGH)
        c.description = "שמירות, הודעות ולוז"
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(c)
    }
}

/**
 * The message Firebase carries has no text in it. It says "there is something",
 * and nothing else. This service then fetches what it actually was over our own
 * authenticated connection and posts the notification itself.
 *
 * That is the same arrangement the browser version has always had, and the
 * reason no name and no hour of anybody's watch passes through Google.
 */
class ShavtzakMessaging : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        CoroutineScope(Dispatchers.IO).launch {
            Shared.post(applicationContext, "/api/fcm/register", JSONObject().put("token", token))
        }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val ctx = applicationContext
        CoroutineScope(Dispatchers.IO).launch {
            val body = Shared.get(ctx, "/api/notify/ext")
            val n = body?.let { runCatching { JSONObject(it) }.getOrNull() }
            val (title, text) = describe(n)
            if (title.isNotEmpty()) show(ctx, title, text)
            ShavtzakWidget.refresh(ctx)
        }
    }

    private fun hm(ms: Double): String {
        if (ms <= 0) return ""
        val f = SimpleDateFormat("HH:mm", Locale("he", "IL"))
        f.timeZone = TimeZone.getTimeZone("Asia/Jerusalem")
        return f.format(Date(ms.toLong()))
    }

    private fun describe(n: JSONObject?): Pair<String, String> {
        if (n == null) return "שבצ״ק" to "יש עדכון"
        return when (n.optString("kind")) {
            "reminder" -> {
                val mins = n.optInt("mins")
                val title = if (mins <= 1) "השמירה שלך מתחילה עכשיו" else "שמירה בעוד $mins דקות"
                val sb = StringBuilder(hm(n.optDouble("start")) + "–" + hm(n.optDouble("end")))
                n.optString("post").takeIf { it.isNotEmpty() }?.let { sb.append(" · ").append(it) }
                n.optJSONArray("withMe")?.let { arr ->
                    if (arr.length() > 0) {
                        val names = (0 until arr.length()).joinToString(", ") { arr.optString(it) }
                        sb.append("\nאיתך: ").append(names)
                    }
                }
                title to sb.toString()
            }
            "event" -> {
                val mins = n.optInt("mins")
                val title = if (mins <= 1) "מתחיל עכשיו" else "בעוד $mins דקות"
                title to (n.optString("text") + "\n" + hm(n.optDouble("start")))
            }
            "msg" -> {
                val from = n.optString("from")
                val title = if (from.isNotEmpty()) "הודעה מ$from" else "הודעה מהמפקד"
                val w = n.optDouble("when", 0.0)
                title to (n.optString("text") + if (w > 0) "\n" + hm(w) else "")
            }
            "change" -> "השבצ״ק עודכן" to "יש שינוי בשיבוצים שלך"
            else -> "שבצ״ק" to "יש עדכון"
        }
    }

    private fun show(ctx: Context, title: String, text: String) {
        Push.channel(ctx)
        val open = PendingIntent.getActivity(
            ctx, 0, Intent(ctx, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val n = NotificationCompat.Builder(ctx, Push.CHANNEL)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(open)
            .build()
        try {
            NotificationManagerCompat.from(ctx).notify(1, n)
        } catch (e: SecurityException) {
            // permission not granted; nothing to do and nothing to say
        }
    }
}
