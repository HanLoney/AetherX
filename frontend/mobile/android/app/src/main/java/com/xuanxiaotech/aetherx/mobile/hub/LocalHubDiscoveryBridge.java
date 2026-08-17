package com.xuanxiaotech.aetherx.mobile.hub;

import org.json.JSONObject;

public final class LocalHubDiscoveryBridge {
    public interface Listener {
        void onDiscovered(JSONObject payload);
    }

    private static volatile Listener listener;

    private LocalHubDiscoveryBridge() {}

    public static void setListener(Listener next) {
        listener = next;
    }

    public static void clearListener(Listener current) {
        if (listener == current) listener = null;
    }

    public static void publish(JSONObject payload) {
        Listener current = listener;
        if (current != null) current.onDiscovered(payload);
    }
}
