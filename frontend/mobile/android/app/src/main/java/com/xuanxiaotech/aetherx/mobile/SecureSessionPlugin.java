package com.xuanxiaotech.aetherx.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "SecureSession")
public class SecureSessionPlugin extends Plugin {
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "aetherx.mobile.session.v1";
    private static final String PREFERENCES = "aetherx_secure_session";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int GCM_TAG_BITS = 128;

    @PluginMethod
    public void set(PluginCall call) {
        String key = call.getString("key");
        String value = call.getString("value");
        if (!validKey(key) || value == null) {
            call.reject("安全存储参数无效。", "INVALID_SECURE_STORAGE_INPUT");
            return;
        }
        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
            byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            preferences().edit()
                .putString(key + ".iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
                .putString(key + ".data", Base64.encodeToString(encrypted, Base64.NO_WRAP))
                .apply();
            call.resolve();
        } catch (Exception error) {
            call.reject("无法安全保存登录凭证。", "SECURE_STORAGE_WRITE_FAILED", error);
        }
    }

    @PluginMethod
    public void get(PluginCall call) {
        String key = call.getString("key");
        if (!validKey(key)) {
            call.reject("安全存储参数无效。", "INVALID_SECURE_STORAGE_INPUT");
            return;
        }
        String ivValue = preferences().getString(key + ".iv", null);
        String dataValue = preferences().getString(key + ".data", null);
        JSObject result = new JSObject();
        if (ivValue == null || dataValue == null) {
            result.put("value", JSONObject.NULL);
            call.resolve(result);
            return;
        }
        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(
                Cipher.DECRYPT_MODE,
                getOrCreateKey(),
                new GCMParameterSpec(GCM_TAG_BITS, Base64.decode(ivValue, Base64.NO_WRAP))
            );
            byte[] decrypted = cipher.doFinal(Base64.decode(dataValue, Base64.NO_WRAP));
            result.put("value", new String(decrypted, StandardCharsets.UTF_8));
            call.resolve(result);
        } catch (Exception error) {
            removeValues(key);
            call.reject("本机登录凭证已经失效，请重新登录。", "SECURE_STORAGE_READ_FAILED", error);
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String key = call.getString("key");
        if (!validKey(key)) {
            call.reject("安全存储参数无效。", "INVALID_SECURE_STORAGE_INPUT");
            return;
        }
        removeValues(key);
        call.resolve();
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }

    private void removeValues(String key) {
        preferences().edit().remove(key + ".iv").remove(key + ".data").apply();
    }

    private boolean validKey(String key) {
        return key != null && !key.trim().isEmpty() && key.length() <= 128;
    }

    private SecretKey getOrCreateKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(KEYSTORE);
        keyStore.load(null);
        SecretKey existing = (SecretKey) keyStore.getKey(KEY_ALIAS, null);
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
