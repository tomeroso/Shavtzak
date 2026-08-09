package com.shavtzak.app

import android.app.Application

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        // The channel has to exist before the first notification arrives, and
        // the first one usually arrives while the app is not running.
        Push.channel(this)
    }
}
