package com.xuanxiaotech.aetherx.mobile.hub;

import org.json.JSONObject;

import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

public final class LocalHubNetworkBridge {
    public interface RequestListener {
        void onRequest(JSONObject request) throws Exception;
    }

    private static final long REQUEST_TIMEOUT_SECONDS = 310;
    private static final ConcurrentHashMap<String, CompletableFuture<JSONObject>> pending =
        new ConcurrentHashMap<>();
    private static volatile RequestListener listener;

    private LocalHubNetworkBridge() {}

    public static void setListener(RequestListener next) {
        listener = next;
    }

    public static void clearListener(RequestListener expected) {
        if (listener == expected) listener = null;
    }

    public static JSONObject dispatch(String method, String path, JSONObject body) throws Exception {
        RequestListener current = listener;
        if (current == null) throw new IllegalStateException("LOCAL_HUB_RUNTIME_UNAVAILABLE");
        String requestId = UUID.randomUUID().toString();
        CompletableFuture<JSONObject> response = new CompletableFuture<>();
        pending.put(requestId, response);
        try {
            current.onRequest(new JSONObject()
                .put("requestId", requestId)
                .put("method", method)
                .put("path", path)
                .put("body", body == null ? new JSONObject() : body));
            return response.get(REQUEST_TIMEOUT_SECONDS, TimeUnit.SECONDS);
        } finally {
            pending.remove(requestId);
        }
    }

    public static boolean respond(JSONObject value) {
        String requestId = value == null ? "" : value.optString("requestId", "");
        CompletableFuture<JSONObject> response = pending.remove(requestId);
        if (response == null) return false;
        response.complete(value);
        return true;
    }
}
