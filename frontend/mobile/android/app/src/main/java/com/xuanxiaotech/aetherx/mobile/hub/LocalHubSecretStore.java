package com.xuanxiaotech.aetherx.mobile.hub;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONObject;
import org.json.JSONArray;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

public final class LocalHubSecretStore {
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "aetherx.mobile.local-hub.v1";
    private static final String PREFERENCES = "aetherx_local_hub_secrets";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int GCM_TAG_BITS = 128;
    private final Context context;

    public LocalHubSecretStore(Context context) {
        this.context = context.getApplicationContext();
    }

    public synchronized void save(JSONObject value) throws Exception {
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] encrypted = cipher.doFinal(
            LocalHubDatabase.canonical(value).getBytes(StandardCharsets.UTF_8)
        );
        preferences().edit()
            .putString("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
            .putString("data", Base64.encodeToString(encrypted, Base64.NO_WRAP))
            .apply();
    }

    public synchronized JSONObject load() throws Exception {
        String iv = preferences().getString("iv", null);
        String data = preferences().getString("data", null);
        if (iv == null || data == null) return null;
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(
            Cipher.DECRYPT_MODE,
            key(),
            new GCMParameterSpec(GCM_TAG_BITS, Base64.decode(iv, Base64.NO_WRAP))
        );
        byte[] decrypted = cipher.doFinal(Base64.decode(data, Base64.NO_WRAP));
        return new JSONObject(new String(decrypted, StandardCharsets.UTF_8));
    }

    public synchronized void merge(JSONObject patch) throws Exception {
        JSONObject value = load();
        if (value == null) value = new JSONObject();
        java.util.Iterator<String> keys = patch.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            value.put(key, patch.get(key));
        }
        save(value);
    }

    public synchronized void applyProviderOperations(JSONArray operations, byte[] syncKey, String spaceId) throws Exception {
        JSONObject secrets = load();
        if (secrets == null) throw new IllegalStateException("LOCAL_HUB_CREDENTIAL_UNAVAILABLE");
        JSONObject providers = secrets.optJSONObject("providerCredentials");
        if (providers == null) providers = new JSONObject();
        boolean changed = false;
        for (int index = 0; index < operations.length(); index += 1) {
            JSONObject operation = operations.getJSONObject(index);
            String entityType = operation.optString("entityType");
            if (!("ai_configs".equals(entityType) || "ai_image_configs".equals(entityType))) continue;
            JSONObject payload = operation.optJSONObject("payload");
            if (payload == null) continue;
            Object envelopeValue = payload.opt("credential");
            String key = "ai_configs".equals(entityType) ? "aiApiKey" : "imageApiKey";
            if (envelopeValue == null || envelopeValue == JSONObject.NULL) {
                providers.put(key, "");
            } else {
                providers.put(key, decryptSpaceSecret(
                    (JSONObject) envelopeValue,
                    syncKey,
                    new JSONObject()
                        .put("purpose", "aetherx-provider-credential")
                        .put("spaceId", spaceId)
                        .put("entityType", entityType)
                        .put("entityId", "config")
                ));
            }
            changed = true;
        }
        if (changed) {
            secrets.put("providerCredentials", providers);
            save(secrets);
        }
    }

    private static String decryptSpaceSecret(JSONObject envelope, byte[] key, JSONObject aad) throws Exception {
        if (envelope.optInt("version", 0) != 1 || !"A256GCM".equals(envelope.optString("algorithm"))) {
            throw new IllegalStateException("LOCAL_HUB_PROVIDER_CREDENTIAL_INVALID");
        }
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(
            Cipher.DECRYPT_MODE,
            new javax.crypto.spec.SecretKeySpec(key, "AES"),
            new GCMParameterSpec(GCM_TAG_BITS, Base64.decode(envelope.getString("iv"), Base64.NO_WRAP))
        );
        cipher.updateAAD(LocalHubDatabase.canonical(aad).getBytes(StandardCharsets.UTF_8));
        byte[] ciphertext = Base64.decode(envelope.getString("ciphertext"), Base64.NO_WRAP);
        byte[] tag = Base64.decode(envelope.getString("authenticationTag"), Base64.NO_WRAP);
        byte[] combined = new byte[ciphertext.length + tag.length];
        System.arraycopy(ciphertext, 0, combined, 0, ciphertext.length);
        System.arraycopy(tag, 0, combined, ciphertext.length, tag.length);
        return new String(cipher.doFinal(combined), StandardCharsets.UTF_8);
    }

    public synchronized boolean isReady() {
        try {
            JSONObject value = load();
            return value != null &&
                value.optString("spaceSyncKey").length() >= 40 &&
                value.optJSONObject("peerCredential") != null;
        } catch (Exception error) {
            clear();
            return false;
        }
    }

    public synchronized void clear() {
        preferences().edit().clear().apply();
    }

    private SharedPreferences preferences() {
        return context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }

    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance(KEYSTORE);
        store.load(null);
        SecretKey existing = (SecretKey) store.getKey(KEY_ALIAS, null);
        if (existing != null) return existing;
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build());
        return generator.generateKey();
    }
}
