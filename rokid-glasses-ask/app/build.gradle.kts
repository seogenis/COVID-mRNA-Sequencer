plugins {
    alias(libs.plugins.android.application)
}

android {
    namespace = "co.synphony.rokidask"
    compileSdk = 36

    defaultConfig {
        applicationId = "co.synphony.rokidask"
        minSdk = 28
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"

        // Rokid Glasses are arm64. x86_64 is kept so the app also runs in an emulator.
        ndk {
            abiFilters += listOf("arm64-v8a", "x86_64")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation(libs.androidx.activity)
    implementation(libs.androidx.camera.core)
    implementation(libs.androidx.camera.camera2)
    implementation(libs.androidx.camera.lifecycle)
    implementation(libs.androidx.camera.view)
}
