package com.xuanxiaotech.aetherx.mobile.hub;

import android.content.Context;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.RandomAccessFile;
import java.security.MessageDigest;

public final class LocalHubBlobStore {
    private final File root;

    public LocalHubBlobStore(Context context) {
        root = new File(context.getFilesDir(), "local-hub/blobs");
        if (!root.exists() && !root.mkdirs()) {
            throw new IllegalStateException("LOCAL_HUB_BLOB_DIRECTORY_FAILED");
        }
    }

    public synchronized long reconcile(JSONObject blob) throws Exception {
        File target = finalFile(blob.optString("mediaId"));
        if (target.exists() &&
            target.length() == blob.optLong("byteSize", -1) &&
            blob.optString("contentHash").equals(hash(target))) {
            File partial = partialFile(blob.optString("mediaId"));
            if (partial.exists() && !partial.delete()) {
                throw new IllegalStateException("LOCAL_HUB_BLOB_RESET_FAILED");
            }
            return target.length();
        }
        File partial = partialFile(blob.optString("mediaId"));
        long actual = partial.exists() ? partial.length() : 0;
        if (actual > blob.optLong("byteSize", 0)) {
            if (!partial.delete()) throw new IllegalStateException("LOCAL_HUB_BLOB_RESET_FAILED");
            return 0;
        }
        return actual;
    }

    public synchronized long append(JSONObject blob, long offset, byte[] bytes) throws Exception {
        File partial = partialFile(blob.getString("mediaId"));
        long size = partial.exists() ? partial.length() : 0;
        if (size != offset) throw new IllegalStateException("LOCAL_HUB_BLOB_OFFSET_MISMATCH");
        try (RandomAccessFile output = new RandomAccessFile(partial, "rw")) {
            output.seek(offset);
            output.write(bytes);
            output.getFD().sync();
        }
        return offset + bytes.length;
    }

    public synchronized String finalizeBlob(JSONObject blob) throws Exception {
        String mediaId = blob.getString("mediaId");
        File target = finalFile(mediaId);
        long expectedSize = blob.getLong("byteSize");
        String expectedHash = blob.getString("contentHash");
        if (target.exists() && target.length() == expectedSize && expectedHash.equals(hash(target))) {
            File stalePartial = partialFile(mediaId);
            if (stalePartial.exists() && !stalePartial.delete()) {
                throw new IllegalStateException("LOCAL_HUB_BLOB_RESET_FAILED");
            }
            return target.getAbsolutePath();
        }
        File partial = partialFile(mediaId);
        if (expectedSize == 0 && !partial.exists() && !partial.createNewFile()) {
            throw new IllegalStateException("LOCAL_HUB_BLOB_CREATE_FAILED");
        }
        if (!partial.exists() || partial.length() != expectedSize) {
            throw new IllegalStateException("LOCAL_HUB_BLOB_SIZE_MISMATCH");
        }
        if (!expectedHash.equals(hash(partial))) {
            if (!partial.delete()) throw new IllegalStateException("LOCAL_HUB_BLOB_RESET_FAILED");
            throw new IllegalStateException("LOCAL_HUB_BLOB_HASH_MISMATCH");
        }
        if (target.exists() && (!expectedHash.equals(hash(target)) || target.length() != expectedSize)) {
            if (!target.delete()) throw new IllegalStateException("LOCAL_HUB_BLOB_REPLACE_FAILED");
        }
        if (!target.exists() && !partial.renameTo(target)) {
            throw new IllegalStateException("LOCAL_HUB_BLOB_PROMOTE_FAILED");
        }
        return target.getAbsolutePath();
    }

    public synchronized String resolve(String mediaId) {
        File target = finalFile(mediaId);
        return target.exists() ? target.getAbsolutePath() : "";
    }

    public synchronized byte[] read(String mediaId, long offset, int length) throws Exception {
        File file = finalFile(mediaId);
        if (!file.isFile() || offset < 0 || offset >= file.length() || length < 1) {
            throw new IllegalStateException("LOCAL_HUB_MEDIA_NOT_FOUND");
        }
        int actualLength = (int) Math.min(length, file.length() - offset);
        byte[] bytes = new byte[actualLength];
        try (RandomAccessFile input = new RandomAccessFile(file, "r")) {
            input.seek(offset);
            input.readFully(bytes);
        }
        return bytes;
    }

    public synchronized String store(String mediaId, byte[] bytes, String expectedHash) throws Exception {
        if (bytes == null || bytes.length < 1 ||
            !LocalHubDatabase.sha256(bytes).equals(expectedHash)) {
            throw new IllegalStateException("LOCAL_HUB_MEDIA_INVALID");
        }
        File partial = partialFile(mediaId);
        File target = finalFile(mediaId);
        try (RandomAccessFile output = new RandomAccessFile(partial, "rw")) {
            output.setLength(0);
            output.write(bytes);
            output.getFD().sync();
        }
        if (target.exists() && !target.delete()) throw new IllegalStateException("LOCAL_HUB_MEDIA_INVALID");
        if (!partial.renameTo(target)) throw new IllegalStateException("LOCAL_HUB_MEDIA_INVALID");
        return target.getAbsolutePath();
    }

    public synchronized void resetPartial(String mediaId) {
        File partial = partialFile(mediaId);
        if (partial.exists() && !partial.delete()) {
            throw new IllegalStateException("LOCAL_HUB_BLOB_RESET_FAILED");
        }
    }

    public synchronized void discard(String mediaId) {
        resetPartial(mediaId);
        File target = finalFile(mediaId);
        if (target.exists() && !target.delete()) {
            throw new IllegalStateException("LOCAL_HUB_BLOB_RESET_FAILED");
        }
    }

    synchronized File temporaryFile(String purpose, String id) {
        return new File(root, LocalHubDatabase.sha256(purpose + ":" + id) + ".tmp");
    }

    private File partialFile(String mediaId) {
        return new File(root, LocalHubDatabase.sha256(mediaId) + ".part");
    }

    private File finalFile(String mediaId) {
        return new File(root, LocalHubDatabase.sha256(mediaId) + ".blob");
    }

    private static String hash(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] buffer = new byte[128 * 1024];
        try (FileInputStream input = new FileInputStream(file)) {
            int read;
            while ((read = input.read(buffer)) >= 0) {
                if (read > 0) digest.update(buffer, 0, read);
            }
        }
        StringBuilder result = new StringBuilder(64);
        for (byte value : digest.digest()) result.append(String.format("%02x", value & 0xff));
        return result.toString();
    }
}
