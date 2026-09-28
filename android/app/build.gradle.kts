plugins { id("com.android.application") }

android {
    namespace = "com.babajagabob.mobile"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.babajagabob.mobile"
        minSdk = 30
        targetSdk = 36
        versionCode = 1
        versionName = "0.3.0"
    }

    buildTypes {
        debug { applicationIdSuffix = ".debug" }
        release {
            isMinifyEnabled = false
            isShrinkResources = false
        }
    }

    buildFeatures { buildConfig = true }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }

    // The URL is intentionally configurable at build time; no control-plane
    // credential is embedded in the APK.
    buildConfigField("String", "CONTROL_PLANE_URL", "\"\"")
}
