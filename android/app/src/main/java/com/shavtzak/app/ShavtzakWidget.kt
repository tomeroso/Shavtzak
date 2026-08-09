package com.shavtzak.app

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * The home screen widget: what is the next thing you have, and when.
 *
 * Everything it says is decided by the server. See widgetView() in the worker.
 * Doing the Hebrew and the dates here as well would mean two copies of the same
 * rules, and the copy inside a shipped app is the one you cannot fix today.
 */
class ShavtzakWidget : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        draw(context, manager, ids)
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action == ACTION_REFRESH) refresh(context)
    }

    private fun draw(context: Context, manager: AppWidgetManager, ids: IntArray) {
        // Paint what we already know first, so the widget never blinks empty
        // while the network is thinking.
        val cached = Shared.cache(context)?.let { runCatching { JSONObject(it) }.getOrNull() }
        if (cached != null) ids.forEach { manager.updateAppWidget(it, render(context, cached)) }

        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val view = Shared.widgetView(context)
                val rv = render(context, view)
                ids.forEach { manager.updateAppWidget(it, rv) }
            } finally {
                pending.finish()
            }
        }
    }

    private fun render(context: Context, v: JSONObject?): RemoteViews {
        val rv = RemoteViews(context.packageName, R.layout.widget)

        if (v == null) {
            rv.setTextViewText(R.id.head, context.getString(R.string.w_app))
            rv.setTextViewText(R.id.big, context.getString(R.string.w_signed_out))
            rv.setTextViewText(R.id.line2, "")
            rv.setTextViewText(R.id.line3, context.getString(R.string.w_open_app))
            rv.setViewVisibility(R.id.timer, android.view.View.GONE)
            return withTap(context, rv)
        }

        val state = v.optString("state")
        rv.setTextViewText(R.id.head, context.getString(
            when (state) {
                "on" -> R.string.w_on
                "soon" -> R.string.w_soon
                "free" -> R.string.w_next
                else -> R.string.w_app
            }
        ))
        rv.setInt(R.id.dot, "setColorFilter", when (state) {
            "on" -> 0xFFEF4444.toInt()
            "soon" -> 0xFFF59E0B.toInt()
            "free" -> 0xFF2DD4BF.toInt()
            else -> 0xFF8A94A6.toInt()
        })

        /* A chronometer counts on its own, without waking the widget again.
           That matters: Android will not let an app widget ask the network more
           than every half hour, so live minutes have to come from the clock. */
        val target = if (state == "on") v.optDouble("end", 0.0) else v.optDouble("start", 0.0)
        if (target > 0) {
            val base = android.os.SystemClock.elapsedRealtime() +
                (target.toLong() - System.currentTimeMillis())
            rv.setViewVisibility(R.id.timer, android.view.View.VISIBLE)
            rv.setViewVisibility(R.id.big, android.view.View.GONE)
            rv.setChronometer(R.id.timer, base, null, true)
            rv.setChronometerCountDown(R.id.timer, true)
        } else {
            rv.setViewVisibility(R.id.timer, android.view.View.GONE)
            rv.setViewVisibility(R.id.big, android.view.View.VISIBLE)
            rv.setTextViewText(R.id.big, v.optString("line1"))
        }

        rv.setTextViewText(R.id.line2, v.optString("line2"))
        val third = v.optString("line3").ifEmpty { v.optString("line1") }
        rv.setTextViewText(R.id.line3, third)
        return withTap(context, rv)
    }

    private fun withTap(context: Context, rv: RemoteViews): RemoteViews {
        val open = Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        rv.setOnClickPendingIntent(
            R.id.root,
            PendingIntent.getActivity(context, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        )
        return rv
    }

    companion object {
        const val ACTION_REFRESH = "com.shavtzak.app.REFRESH_WIDGET"

        /** Called on app open, on every push, and by the system twice an hour. */
        fun refresh(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, ShavtzakWidget::class.java))
            if (ids.isEmpty()) return
            val intent = Intent(context, ShavtzakWidget::class.java).apply {
                action = AppWidgetManager.ACTION_APPWIDGET_UPDATE
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
            }
            context.sendBroadcast(intent)
        }
    }
}
