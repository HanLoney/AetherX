package com.xuanxiaotech.aetherx.mobile.hub;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;

import java.security.SecureRandom;

public final class LocalHubClientSessionStore {
    private static final String PREFERENCES = "aetherx_local_hub_client_sessions";
    private static final long SESSION_TTL_MS = 30L * 24 * 60 * 60 * 1000;
    private final SharedPreferences preferences;
    private final SecureRandom random = new SecureRandom();

    public LocalHubClientSessionStore(Context context) {
        preferences = context.getApplicationContext()
            .getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }

    public synchronized Session issue() {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        String token = Base64.encodeToString(bytes, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
        long expiresAt = System.currentTimeMillis() + SESSION_TTL_MS;
        removeExpired();
        preferences.edit()
            .putLong(LocalHubDatabase.sha256(token), expiresAt)
            .apply();
        return new Session(token, expiresAt);
    }

    public synchronized boolean validate(String token) {
        if (token == null || token.length() < 32) return false;
        String key = LocalHubDatabase.sha256(token);
        long expiresAt = preferences.getLong(key, 0);
        if (expiresAt <= System.currentTimeMillis()) {
            if (expiresAt > 0) preferences.edit().remove(key).apply();
            return false;
        }
        return true;
    }

    private void removeExpired() {
        long now = System.currentTimeMillis();
        SharedPreferences.Editor editor = preferences.edit();
        boolean changed = false;
        for (String key : preferences.getAll().keySet()) {
            if (preferences.getLong(key, 0) <= now) {
                editor.remove(key);
                changed = true;
            }
        }
        if (changed) editor.apply();
    }

    public static final class Session {
        public final String token;
        public final long expiresAt;

        private Session(String token, long expiresAt) {
            this.token = token;
            this.expiresAt = expiresAt;
        }
    }
}
