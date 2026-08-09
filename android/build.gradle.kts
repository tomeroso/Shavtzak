// Versions are pinned together on purpose: AGP, Kotlin and Gradle only work in
// matched sets, and a floating version turns "it built last week" into a
// half-hour of reading release notes.
plugins {
    id("com.android.application") version "8.9.1" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
    id("com.google.gms.google-services") version "4.4.2" apply false
}
