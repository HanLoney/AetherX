package com.xuanxiaotech.aetherx.mobile;

import android.os.Bundle;
import android.util.Log;
import android.content.Intent;
import android.webkit.WebSettings;

import com.getcapacitor.BridgeActivity;
import com.xuanxiaotech.aetherx.mobile.hub.LocalHubForegroundService;
import com.xuanxiaotech.aetherx.mobile.hub.LocalHubService;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "AetherXLocalHub";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SecureSessionPlugin.class);
        registerPlugin(LocalHubPlugin.class);

        startForegroundService(new Intent(this, LocalHubForegroundService.class));

        // Bring up the native listener independently from the WebView. Desktop clients can
        // discover the phone immediately after a cold start while the page runtime restores
        // its cache and registers the signed API bridge in the background.
        new Thread(() -> {
            try {
                LocalHubService.get(getApplicationContext()).start();
            } catch (Exception error) {
                Log.e(TAG, "Failed to bootstrap Android Local Hub", error);
            }
        }, "aetherx-local-hub-bootstrap").start();

        super.onCreate(savedInstanceState);

        if (BuildConfig.ALLOW_INSECURE_LAN) {
            getBridge().getWebView().getSettings().setMixedContentMode(
                WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            );
        }
    }
}
