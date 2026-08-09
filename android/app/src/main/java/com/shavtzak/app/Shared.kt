package com.shavtzak.app

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * The one channel between the app, the widget and the push service.
 *
 * All three run in the same process here, unlike on iOS, but they still meet
 * only through this file: the widget token, the address of the server, and the
 * last answer we got. Keeping it to one place is what stops the widget from
 * quietly using a token the app has already replaced.
 */
object Shared {
    private const val PREFS = "shavtzak"
    private const val TOKEN = "widgetToken"
    private const val ORIGIN = "origin"
    private const val CACHE = "lastView"

    private fun prefs(c: Context): SharedPreferences =
        c.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun token(c: Context): String? = prefs(c).getString(TOKEN, null)
    fun setToken(c: Context, v: String) = prefs(c).edit().putString(TOKEN, v).apply()

    fun origin(c: Context): String =
        prefs(c).getString(ORIGIN, null) ?: c.getString(R.string.sh_origin).trimEnd('/')

    fun setOrigin(c: Context, v: String) {
        if (v.startsWith("https://")) prefs(c).edit().putString(ORIGIN, v.trimEnd('/')).apply()
    }

    fun cache(c: Context): String? = prefs(c).getString(CACHE, null)
    private fun setCache(c: Context, v: String) = prefs(c).edit().putString(CACHE, v).apply()

    /**
     * One small GET, with the widget token on it. Returns null on anything at
     * all going wrong: a home screen is the worst place in the world to show an
     * error, because nobody can dismiss it.
     */
    fun get(c: Context, path: String): String? {
        val token = token(c) ?: return null
        return try {
            val conn = URL(origin(c) + path).openConnection() as HttpURLConnection
            conn.requestMethod = "GET"
            conn.setRequestProperty("Authorization", "Bearer $token")
            conn.connectTimeout = 8000
            conn.readTimeout = 10000
            if (conn.responseCode != 200) { conn.disconnect(); return null }
            val body = conn.inputStream.bufferedReader().use { it.readText() }
            conn.disconnect()
            body
        } catch (e: Exception) {
            null
        }
    }

    fun post(c: Context, path: String, json: JSONObject): Boolean {
        val token = token(c) ?: return false
        return try {
            val conn = URL(origin(c) + path).openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.setRequestProperty("Authorization", "Bearer $token")
            conn.setRequestProperty("Content-Type", "application/json")
            conn.connectTimeout = 8000
            conn.readTimeout = 10000
            conn.outputStream.use { it.write(json.toString().toByteArray()) }
            val ok = conn.responseCode in 200..299
            conn.disconnect()
            ok
        } catch (e: Exception) {
            false
        }
    }

    /** What the widget draws. Fetches, and remembers the answer for next time. */
    fun widgetView(c: Context): JSONObject? {
        val body = get(c, "/api/widget")
        if (body != null) {
            setCache(c, body)
            return try { JSONObject(body) } catch (e: Exception) { null }
        }
        return cache(c)?.let { try { JSONObject(it) } catch (e: Exception) { null } }
    }
}
