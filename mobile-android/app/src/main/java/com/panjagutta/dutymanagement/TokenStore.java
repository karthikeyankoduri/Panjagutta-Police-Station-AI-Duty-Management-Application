package com.panjagutta.dutymanagement;

import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Stores the session token encrypted with an AES-GCM key held in the Android
 * Keystore. The key never leaves secure hardware (where available), so a copied
 * preferences file cannot be used to replay the session.
 */
final class TokenStore {
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String ALIAS = "panjagutta_session_key";
    private static final String PREF_KEY = "token_enc";
    private static final String LEGACY_KEY = "token";

    private final SharedPreferences prefs;

    TokenStore(SharedPreferences prefs) {
        this.prefs = prefs;
    }

    private SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance(KEYSTORE);
        ks.load(null);
        if (ks.containsAlias(ALIAS)) {
            return ((KeyStore.SecretKeyEntry) ks.getEntry(ALIAS, null)).getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return generator.generateKey();
    }

    void save(String token) {
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key());
            byte[] iv = cipher.getIV();
            byte[] data = cipher.doFinal(token.getBytes(StandardCharsets.UTF_8));
            String packed = Base64.encodeToString(iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(data, Base64.NO_WRAP);
            prefs.edit().putString(PREF_KEY, packed).remove(LEGACY_KEY).apply();
        } catch (Exception e) {
            // If the keystore is unavailable, do not persist the session at all.
            prefs.edit().remove(PREF_KEY).remove(LEGACY_KEY).apply();
        }
    }

    String load() {
        String packed = prefs.getString(PREF_KEY, null);
        if (packed == null) {
            // One-time migration from the earlier plain-text storage.
            String legacy = prefs.getString(LEGACY_KEY, null);
            if (legacy != null) save(legacy);
            return legacy;
        }
        try {
            String[] parts = packed.split(":", 2);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
            return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
        } catch (Exception e) {
            clear();
            return null;
        }
    }

    void clear() {
        prefs.edit().remove(PREF_KEY).remove(LEGACY_KEY).apply();
    }
}
