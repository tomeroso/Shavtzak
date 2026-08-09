import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/* Firebase is only wired in when google-services.json is actually there. The
   plugins block cannot hold an if, so this is applied the long way round —
   which also means the project still builds for somebody who has not set
   Firebase up yet, just without push. */
val hasFirebase = rootProject.file("app/google-services.json").exists()
if (hasFirebase) apply(plugin = "com.google.gms.google-services")

/** Where the app lives. The one value that must be right. */
val shOrigin: String = (project.findProperty("SH_ORIGIN") as String?)
    ?: "https://shavtzak.YOUR-SUBDOMAIN.workers.dev"

android {
    namespace = "com.shavtzak.app"
    // Google Play requires new uploads to target Android 16 from 31 August 2026.
    compileSdk = 36

    defaultConfig {
        applicationId = "com.shavtzak.app"
        minSdk = 26
        targetSdk = 36
        versionCode = (project.findProperty("VERSION_CODE") as String?)?.toInt() ?: 1
        versionName = (project.findProperty("VERSION_NAME") as String?) ?: "1.0"
        resValue("string", "sh_origin", shOrigin)
        resValue("string", "app_name", "שבצ״ק")
    }

    signingConfigs {
        create("release") {
            // Supplied by CI from secrets. Absent on a plain local build, which
            // then produces an unsigned bundle rather than failing.
            val store = System.getenv("KEYSTORE_PATH")
            if (store != null && file(store).exists()) {
                storeFile = file(store)
                storePassword = System.getenv("KEYSTORE_PASSWORD")
                keyAlias = System.getenv("KEY_ALIAS")
                keyPassword = System.getenv("KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (System.getenv("KEYSTORE_PATH") != null) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
        debug {
            applicationIdSuffix = ".debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { buildConfig = true }

    // so the Kotlin sources can ask whether push is even possible
    defaultConfig { buildConfigField("boolean", "HAS_FIREBASE", hasFirebase.toString()) }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    /* Always compiled in: the library is what the Kotlin refers to, while
       google-services.json is only what the plugin needs. Without the file the
       app still builds and runs, it simply never receives a push. */
    implementation(platform("com.google.firebase:firebase-bom:33.7.0"))
    implementation("com.google.firebase:firebase-messaging-ktx")
}
