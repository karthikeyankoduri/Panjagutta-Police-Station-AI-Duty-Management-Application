package com.panjagutta.dutymanagement

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "dutymanagement/settings")
            .setMethodCallHandler { call, result ->
                if (call.method == "legacyServer") {
                    result.success(getSharedPreferences("MainActivity", MODE_PRIVATE)
                        .getString("api_base", null))
                } else {
                    result.notImplemented()
                }
            }
    }
}
