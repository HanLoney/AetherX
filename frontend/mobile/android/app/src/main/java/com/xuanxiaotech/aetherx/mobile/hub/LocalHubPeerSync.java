package com.xuanxiaotech.aetherx.mobile.hub;

import android.util.Base64;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.UUID;

import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

public final class LocalHubPeerSync {
    public interface ProgressListener {
        void onProgress(String stage, int progress, String message);
    }

    private static final String TAG = "AetherXLocalHub";
    private static final int STRUCTURED_SNAPSHOT_CHUNK_BYTES = 512 * 1024;
    private static final long ENDPOINT_CACHE_TTL_MS = 5 * 60_000;
    private static volatile String healthyEndpoint = "";
    private static volatile long healthyEndpointAt = 0;
    private final LocalHubDatabase database;
    private final LocalHubSecretStore secretStore;
    private final LocalHubBlobStore blobStore;
    private final ProgressListener progressListener;
    private String selectedEndpoint;

    public LocalHubPeerSync(
        LocalHubDatabase database,
        LocalHubSecretStore secretStore,
        LocalHubBlobStore blobStore
    ) {
        this(database, secretStore, blobStore, (stage, progress, message) -> {});
    }

    public LocalHubPeerSync(
        LocalHubDatabase database,
        LocalHubSecretStore secretStore,
        LocalHubBlobStore blobStore,
        ProgressListener progressListener
    ) {
        this.database = database;
        this.secretStore = secretStore;
        this.blobStore = blobStore;
        this.progressListener = progressListener == null
            ? (stage, progress, message) -> {}
            : progressListener;
    }

    public JSONObject keepAlive() throws Exception {
        JSONObject config = database.replicationConfig();
        JSONObject secrets = requireSecrets();
        JSONObject credential = secrets.getJSONObject("peerCredential");
        String endpoint = selectEndpoint(config);
        JSONObject response = hello(endpoint, config, credential, secrets);
        return new JSONObject()
            .put("reachable", true)
            .put("endpoint", endpoint)
            .put("peer", response)
            .put("checkedAt", System.currentTimeMillis());
    }

    public JSONObject run() throws Exception {
        JSONObject config = database.replicationConfig();
        if ("active".equals(config.optString("role"))) return pushActiveOperations(config);
        progress("connecting", 8, "正在连接电脑 Hub");
        JSONObject secrets = secretStore.load();
        if (secrets == null) throw new IllegalStateException("LOCAL_HUB_CREDENTIAL_UNAVAILABLE");
        JSONObject credential = secrets.getJSONObject("peerCredential");
        String endpoint = selectEndpoint(config);
        hello(endpoint, config, credential, secrets);
        progress("operations", 20, "正在检查电脑 Hub 的最新变更");
        String origin = config.getString("peerNodeId");
        long after = config.getLong("after");
        int applied = 0;
        boolean hasMore = true;
        JSONObject page = null;
        while (hasMore) {
            String path = "/api/v1/peer/operations?origin=" + encode(origin) + "&after=" + after + "&limit=200";
            page = request(endpoint, config, credential, secrets, "GET", path, new JSONObject());
            JSONArray operations = page.optJSONArray("operations");
            if (operations == null) operations = new JSONArray();
            byte[] syncKey = Base64.decode(secrets.getString("spaceSyncKey"), Base64.DEFAULT);
            JSONObject previousSecrets = new JSONObject(LocalHubDatabase.canonical(secrets));
            JSONObject result;
            try {
                secretStore.applyProviderOperations(operations, syncKey, config.getString("spaceId"));
                result = database.applyOperations(operations, syncKey);
            } catch (Exception error) {
                secretStore.save(previousSecrets);
                throw error;
            }
            applied += result.getInt("applied");
            long nextAfter = page.optLong("nextAfter", after);
            hasMore = page.optBoolean("hasMore", false);
            if (hasMore && nextAfter <= after) throw new IllegalStateException("LOCAL_HUB_SYNC_CURSOR_STALLED");
            after = nextAfter;
            long headSequence = page.optLong("headSequence", after);
            int operationProgress = headSequence <= 0
                ? 55
                : 20 + (int) Math.round(Math.min(1d, (double) after / (double) headSequence) * 35d);
            progress("operations", operationProgress, "正在同步电脑 Hub 的变更");
        }
        if (after > 0) {
            JSONObject current = database.replicationConfig();
            JSONArray acknowledgements = new JSONArray().put(new JSONObject()
                .put("originNodeId", origin)
                .put("contiguousSequence", current.getLong("after"))
                .put("operationHash", current.getString("operationHash")));
            request(endpoint, config, credential, secrets, "POST", "/api/v1/peer/acknowledgements",
                new JSONObject().put("acknowledgements", acknowledgements));
        }
        progress("media", 62, "正在核对双 Hub 媒体文件");
        JSONObject media = synchronizeMedia(endpoint, config, credential, secrets);
        progress("verifying", 94, "正在校验双 Hub 操作链");
        JSONObject syncProof = reportSyncComplete(
            endpoint,
            config,
            credential,
            secrets,
            database.operationHead(origin)
        );
        JSONObject result = new JSONObject()
            .put("synchronized", true)
            .put("peerNodeId", origin)
            .put("applied", applied)
            .put("after", after)
            .put("headSequence", page == null ? after : page.optLong("headSequence", after))
            .put("media", media)
            .put("syncProof", syncProof)
            .put("completedAt", System.currentTimeMillis());
        database.recordSyncResult(result);
        return result;
    }

    private JSONObject hello(
        String endpoint,
        JSONObject config,
        JSONObject credential,
        JSONObject secrets
    ) throws Exception {
        return request(
            endpoint,
            config,
            credential,
            secrets,
            "POST",
            "/api/v1/peer/hello",
            new JSONObject()
                .put("protocolVersion", config.optInt("protocolVersion", LocalHubDatabase.PROTOCOL_VERSION))
                .put("schemaVersion", LocalHubDatabase.NODE_SCHEMA_VERSION)
                .put("spaceId", config.getString("spaceId"))
                .put("nodeId", config.getString("localNodeId"))
                .put("epoch", config.getLong("epoch"))
                .put("activeNodeId", config.getString("activeNodeId"))
        );
    }

    public JSONObject recoverDivergence(JSONObject input) throws Exception {
        String recoveryId = input.optString("recoveryId", "").trim();
        if (recoveryId.isEmpty()) {
            throw new IllegalStateException("DIVERGENCE_RECOVERY_ID_INVALID");
        }
        JSONObject config = database.replicationConfig();
        JSONObject secrets = requireSecrets();
        JSONObject credential = secrets.getJSONObject("peerCredential");
        String endpoint = selectEndpoint(config);
        byte[] syncKey = Base64.decode(secrets.getString("spaceSyncKey"), Base64.DEFAULT);
        JSONObject recovery = request(
            endpoint,
            config,
            credential,
            secrets,
            "GET",
            "/api/v1/peer/divergence-recoveries/" + encode(recoveryId),
            new JSONObject()
        );
        if (
            !recoveryId.equals(recovery.optString("id")) ||
            !config.getString("spaceId").equals(recovery.optString("spaceId")) ||
            !config.getString("localNodeId").equals(recovery.optString("authorityNodeId")) &&
                !config.getString("localNodeId").equals(recovery.optString("targetNodeId"))
        ) {
            throw new IllegalStateException("DIVERGENCE_RECOVERY_CONTEXT_MISMATCH");
        }
        if ("completed".equals(recovery.optString("status"))) {
            database.clearDivergenceRecoveryAcknowledgement();
            return new JSONObject()
                .put("completed", true)
                .put("recovery", recovery)
                .put("completedAt", System.currentTimeMillis());
        }
        if ("failed".equals(recovery.optString("status"))) {
            throw new IllegalStateException("DIVERGENCE_RECOVERY_FAILED");
        }
        JSONObject savedAck = database.divergenceRecoveryAcknowledgement(recoveryId);
        if (savedAck != null) {
            return acknowledgeRecovery(
                endpoint,
                config,
                credential,
                secrets,
                recoveryId,
                savedAck
            );
        }
        database.beginDivergenceRecovery(recovery);
        JSONObject signedControl;
        if (config.getString("localNodeId").equals(recovery.getString("authorityNodeId"))) {
            if ("awaiting_peer_ack".equals(recovery.optString("status"))) {
                signedControl = recovery.getJSONObject("signedControl");
            } else {
                pushActiveMedia(endpoint, config, credential, secrets);
                JSONObject packageValue = database.exportRecoverySnapshot(
                    recovery,
                    secretStore.providerCredentials()
                );
                String snapshotHash = LocalHubDatabase.sha256(LocalHubDatabase.canonical(packageValue));
                database.rememberRecoverySnapshot(recoveryId, snapshotHash);
                JSONObject aad = recoveryAad(recovery, snapshotHash);
                JSONObject envelope = encryptRecoveryEnvelope(packageValue, syncKey, aad);
                byte[] encoded = LocalHubDatabase.canonical(envelope).getBytes(StandardCharsets.UTF_8);
                uploadRecoveryEnvelope(
                    endpoint,
                    config,
                    credential,
                    secrets,
                    recoveryId,
                    encoded
                );
                JSONObject completed = request(
                    endpoint,
                    config,
                    credential,
                    secrets,
                    "POST",
                    "/api/v1/peer/divergence-recoveries/" + encode(recoveryId) + "/snapshot/complete",
                    new JSONObject()
                        .put("byteSize", encoded.length)
                        .put("payloadHash", LocalHubDatabase.sha256(LocalHubDatabase.canonical(envelope)))
                );
                signedControl = completed.getJSONObject("signedControl");
            }
        } else {
            JSONObject envelope = downloadRecoveryEnvelope(
                endpoint,
                config,
                credential,
                secrets,
                recovery
            );
            JSONObject packageValue = decryptSnapshotEnvelope(
                envelope,
                secrets.getString("spaceSyncKey")
            );
            String snapshotHash = LocalHubDatabase.sha256(LocalHubDatabase.canonical(packageValue));
            if (
                !snapshotHash.equals(recovery.optString("snapshotHash")) ||
                !LocalHubDatabase.canonical(recoveryAad(recovery, snapshotHash))
                    .equals(LocalHubDatabase.canonical(envelope.optJSONObject("aad"))) ||
                !recoveryId.equals(packageValue.optString("recoveryId")) ||
                !config.getString("spaceId").equals(packageValue.optString("spaceId"))
            ) {
                throw new IllegalStateException("DIVERGENCE_RECOVERY_SNAPSHOT_INVALID");
            }
            packageValue.put("recoverySnapshotHash", snapshotHash);
            secretStore.merge(new JSONObject()
                .put("providerCredentials", packageValue.getJSONObject("credentials")));
            database.importSnapshot(packageValue, syncKey);
            downloadRecoveryBlobs(
                endpoint,
                config,
                credential,
                secrets,
                recoveryId
            );
            database.markRecoverySnapshotCompleted();
            signedControl = recovery.getJSONObject("signedControl");
        }
        JSONObject signedAck = database.applyDivergenceRecovery(signedControl, syncKey);
        return acknowledgeRecovery(
            endpoint,
            config,
            credential,
            secrets,
            recoveryId,
            signedAck
        );
    }

    private JSONObject acknowledgeRecovery(
        String endpoint,
        JSONObject config,
        JSONObject credential,
        JSONObject secrets,
        String recoveryId,
        JSONObject signedAck
    ) throws Exception {
        JSONObject acknowledged = request(
            endpoint,
            config,
            credential,
            secrets,
            "POST",
            "/api/v1/peer/divergence-recoveries/" + encode(recoveryId) + "/ack",
            signedAck
        );
        if ("completed".equals(acknowledged.optString("status"))) {
            database.clearDivergenceRecoveryAcknowledgement();
        }
        return new JSONObject()
            .put("completed", "completed".equals(acknowledged.optString("status")))
            .put("recovery", acknowledged)
            .put("acknowledgement", signedAck)
            .put("completedAt", System.currentTimeMillis());
    }

    private void uploadRecoveryEnvelope(
        String endpoint,
        JSONObject config,
        JSONObject credential,
        JSONObject secrets,
        String recoveryId,
        byte[] bytes
    ) throws Exception {
        int offset = 0;
        while (offset < bytes.length) {
            int length = Math.min(STRUCTURED_SNAPSHOT_CHUNK_BYTES, bytes.length - offset);
            byte[] chunk = new byte[length];
            System.arraycopy(bytes, offset, chunk, 0, length);
            JSONObject result = request(
                endpoint,
                config,
                credential,
                secrets,
                "POST",
                "/api/v1/peer/divergence-recoveries/" + encode(recoveryId) + "/snapshot/chunks",
                new JSONObject()
                    .put("offset", offset)
                    .put("data", Base64.encodeToString(chunk, Base64.NO_WRAP))
                    .put("chunkHash", LocalHubDatabase.sha256(chunk))
            );
            int next = result.optInt("receivedBytes", offset);
            if (next != offset + length) {
                throw new IllegalStateException("DIVERGENCE_RECOVERY_UPLOAD_STALLED");
            }
            offset = next;
        }
    }

    private JSONObject downloadRecoveryEnvelope(
        String endpoint,
        JSONObject config,
        JSONObject credential,
        JSONObject secrets,
        JSONObject recovery
    ) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        long offset = 0;
        long totalBytes = -1;
        String payloadHash = "";
        while (totalBytes < 0 || offset < totalBytes) {
            JSONObject chunk = request(
                endpoint,
                config,
                credential,
                secrets,
                "GET",
                "/api/v1/peer/divergence-recoveries/" + encode(recovery.getString("id")) +
                    "/snapshot/chunks?offset=" + offset +
                    "&length=" + STRUCTURED_SNAPSHOT_CHUNK_BYTES,
                new JSONObject()
            );
            if (chunk.optLong("offset", -1) != offset) {
                throw new IllegalStateException("DIVERGENCE_RECOVERY_SNAPSHOT_INVALID");
            }
            byte[] bytes = Base64.decode(chunk.optString("data", ""), Base64.DEFAULT);
            if (bytes.length == 0 ||
                !LocalHubDatabase.sha256(bytes).equals(chunk.optString("chunkHash"))) {
                throw new IllegalStateException("DIVERGENCE_RECOVERY_SNAPSHOT_INVALID");
            }
            long currentTotal = chunk.optLong("totalBytes", -1);
            if (currentTotal < 1 || totalBytes >= 0 && currentTotal != totalBytes) {
                throw new IllegalStateException("DIVERGENCE_RECOVERY_SNAPSHOT_INVALID");
            }
            totalBytes = currentTotal;
            payloadHash = chunk.optString("payloadHash", payloadHash);
            output.write(bytes);
            offset += bytes.length;
        }
        JSONObject envelope = new JSONObject(output.toString(StandardCharsets.UTF_8.name()));
        if (
            offset != totalBytes ||
            !payloadHash.equals(LocalHubDatabase.sha256(LocalHubDatabase.canonical(envelope)))
        ) {
            throw new IllegalStateException("DIVERGENCE_RECOVERY_SNAPSHOT_INVALID");
        }
        return envelope;
    }

    private void downloadRecoveryBlobs(
        String endpoint,
        JSONObject config,
        JSONObject credential,
        JSONObject secrets,
        String recoveryId
    ) throws Exception {
        JSONArray blobs = database.pendingBootstrapBlobs();
        for (int index = 0; index < blobs.length(); index += 1) {
            JSONObject blob = blobs.getJSONObject(index);
            String mediaId = blob.getString("mediaId");
            long offset = blobStore.reconcile(blob);
            long byteSize = blob.getLong("byteSize");
            while (offset < byteSize) {
                int length = (int) Math.min(1024 * 1024, byteSize - offset);
                BinaryResponse response = requestBinary(
                    endpoint,
                    config,
                    credential,
                    secrets,
                    "/api/v1/peer/divergence-recoveries/" + encode(recoveryId) +
                        "/media/" + encode(mediaId) +
                        "?offset=" + offset + "&length=" + length
                );
                if (
                    !blob.getString("contentHash").equals(response.header("X-AetherX-Blob-Hash")) ||
                    offset != parseLong(response.header("X-AetherX-Blob-Offset")) ||
                    byteSize != parseLong(response.header("X-AetherX-Blob-Size")) ||
                    !LocalHubDatabase.sha256(response.bytes)
                        .equals(response.header("X-AetherX-Chunk-Hash"))
                ) {
                    throw new IllegalStateException("DIVERGENCE_RECOVERY_MEDIA_INVALID");
                }
                offset = blobStore.append(blob, offset, response.bytes);
                database.updateBlobProgress(mediaId, offset, "pending", "");
            }
            String localPath = blobStore.finalizeBlob(blob);
            database.updateBlobProgress(mediaId, byteSize, "verified", localPath);
        }
    }

    private static JSONObject recoveryAad(JSONObject recovery, String snapshotHash) throws Exception {
        return new JSONObject()
            .put("purpose", "aetherx-divergence-recovery")
            .put("recoveryId", recovery.getString("id"))
            .put("takeoverId", recovery.getString("takeoverId"))
            .put("spaceId", recovery.getString("spaceId"))
            .put("authorityNodeId", recovery.getString("authorityNodeId"))
            .put("targetNodeId", recovery.getString("targetNodeId"))
            .put("sourceEpoch", recovery.getLong("sourceEpoch"))
            .put("targetEpoch", recovery.getLong("targetEpoch"))
            .put("snapshotHash", snapshotHash);
    }

    private static JSONObject encryptRecoveryEnvelope(
        JSONObject packageValue,
        byte[] key,
        JSONObject aad
    ) throws Exception {
        if (key.length != 32) throw new IllegalStateException("LOCAL_HUB_CREDENTIAL_UNAVAILABLE");
        byte[] iv = new byte[12];
        new SecureRandom().nextBytes(iv);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, iv));
        cipher.updateAAD(LocalHubDatabase.canonical(aad).getBytes(StandardCharsets.UTF_8));
        byte[] encrypted = cipher.doFinal(
            LocalHubDatabase.canonical(packageValue).getBytes(StandardCharsets.UTF_8)
        );
        int tagOffset = encrypted.length - 16;
        byte[] ciphertext = new byte[tagOffset];
        byte[] tag = new byte[16];
        System.arraycopy(encrypted, 0, ciphertext, 0, tagOffset);
        System.arraycopy(encrypted, tagOffset, tag, 0, 16);
        return new JSONObject()
            .put("version", 1)
            .put("algorithm", "A256GCM")
            .put("aad", aad)
            .put("iv", Base64.encodeToString(iv, Base64.NO_WRAP))
            .put("ciphertext", Base64.encodeToString(ciphertext, Base64.NO_WRAP))
            .put("authenticationTag", Base64.encodeToString(tag, Base64.NO_WRAP));
    }

    public JSONObject downloadStructuredSnapshot() throws Exception {
        JSONObject config = database.replicationConfig();
        JSONObject secrets = requireSecrets();
        JSONObject credential = secrets.getJSONObject("peerCredential");
        String endpoint = selectEndpoint(config);
        JSONObject manifest = request(
            endpoint,
            config,
            credential,
            secrets,
            "POST",
            "/api/v1/peer/snapshots",
            new JSONObject()
        );
        String snapshotId = manifest.optString("id", "");
        if (snapshotId.isEmpty()) throw new IllegalStateException("LOCAL_HUB_SNAPSHOT_INVALID");
        JSONObject envelope = downloadSnapshotEnvelope(
            endpoint,
            config,
            credential,
            secrets,
            snapshotId
        );
        JSONObject snapshot = decryptSnapshotEnvelope(envelope, secrets.getString("spaceSyncKey"));
        JSONObject aad = envelope.optJSONObject("aad");
        JSONObject snapshotManifest = snapshot.optJSONObject("manifest");
        JSONObject metadata = snapshot.optJSONObject("metadata");
        JSONObject replication = snapshot.optJSONObject("replication");
        if (
            aad == null || snapshotManifest == null || metadata == null || replication == null ||
            !snapshotId.equals(snapshot.optString("snapshotId")) ||
            !snapshotId.equals(aad.optString("snapshotId")) ||
            !config.getString("spaceId").equals(aad.optString("spaceId")) ||
            !config.getString("peerNodeId").equals(aad.optString("sourceNodeId")) ||
            !config.getString("localNodeId").equals(aad.optString("requestedByNodeId")) ||
            config.getLong("epoch") != aad.optLong("epoch") ||
            !snapshotManifest.optString("manifestHash").equals(aad.optString("manifestHash"))
        ) {
            throw new IllegalStateException("LOCAL_HUB_SNAPSHOT_IDENTITY_INVALID");
        }
        JSONObject records = metadata.optJSONObject("records");
        JSONObject account = metadata.optJSONObject("account");
        JSONObject credentials = metadata.optJSONObject("credentials");
        JSONArray media = metadata.optJSONArray("media");
        if (records == null || account == null || credentials == null || media == null) {
            throw new IllegalStateException("LOCAL_HUB_SNAPSHOT_INVALID");
        }
        return new JSONObject()
            .put("snapshotId", snapshotId)
            .put("spaceId", config.getString("spaceId"))
            .put("tables", records)
            .put("account", account)
            .put("credentials", credentials)
            .put("media", media)
            .put("manifest", snapshotManifest)
            .put("replication", replication);
    }

    private JSONObject downloadSnapshotEnvelope(
        String endpoint,
        JSONObject config,
        JSONObject credential,
        JSONObject secrets,
        String snapshotId
    ) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        long offset = 0;
        long byteSize = -1;
        String payloadHash = "";
        for (;;) {
            String path = "/api/v1/peer/snapshots/" + encode(snapshotId) +
                "/payload/chunks?offset=" + offset +
                "&length=" + STRUCTURED_SNAPSHOT_CHUNK_BYTES;
            JSONObject chunk = request(
                endpoint,
                config,
                credential,
                secrets,
                "GET",
                path,
                new JSONObject()
            );
            if (!snapshotId.equals(chunk.optString("snapshotId")) ||
                chunk.optLong("offset", -1) != offset) {
                throw new IllegalStateException("LOCAL_HUB_SNAPSHOT_CHUNK_INVALID");
            }
            long currentByteSize = chunk.optLong("byteSize", -1);
            if (currentByteSize < 1 || (byteSize >= 0 && currentByteSize != byteSize)) {
                throw new IllegalStateException("LOCAL_HUB_SNAPSHOT_CHUNK_INVALID");
            }
            byteSize = currentByteSize;
            byte[] bytes = Base64.decode(chunk.optString("data", ""), Base64.DEFAULT);
            if (!LocalHubDatabase.sha256(bytes).equals(chunk.optString("chunkHash"))) {
                throw new IllegalStateException("LOCAL_HUB_SNAPSHOT_CHUNK_INVALID");
            }
            long nextOffset = chunk.optLong("nextOffset", -1);
            if (bytes.length == 0 || nextOffset != offset + bytes.length || nextOffset > byteSize) {
                throw new IllegalStateException("LOCAL_HUB_SNAPSHOT_CHUNK_INVALID");
            }
            String currentPayloadHash = chunk.optString("payloadHash", "");
            if (currentPayloadHash.isEmpty() ||
                (!payloadHash.isEmpty() && !payloadHash.equals(currentPayloadHash))) {
                throw new IllegalStateException("LOCAL_HUB_SNAPSHOT_CHUNK_INVALID");
            }
            payloadHash = currentPayloadHash;
            output.write(bytes);
            offset = nextOffset;
            boolean complete = chunk.optBoolean("complete", false);
            if (complete) {
                if (offset != byteSize) {
                    throw new IllegalStateException("LOCAL_HUB_SNAPSHOT_CHUNK_INVALID");
                }
                break;
            }
            if (offset >= byteSize) {
                throw new IllegalStateException("LOCAL_HUB_SNAPSHOT_CHUNK_INVALID");
            }
        }
        JSONObject envelope = new JSONObject(output.toString(StandardCharsets.UTF_8.name()));
        if (!payloadHash.equals(LocalHubDatabase.sha256(LocalHubDatabase.canonical(envelope)))) {
            throw new IllegalStateException("LOCAL_HUB_SNAPSHOT_INTEGRITY_INVALID");
        }
        return envelope;
    }

    private JSONObject pushActiveOperations(JSONObject config) throws Exception {
        progress("connecting", 8, "正在连接电脑 Hub");
        JSONObject secrets = requireSecrets();
        JSONObject credential = secrets.getJSONObject("peerCredential");
        String endpoint = selectEndpoint(config);
        String localNodeId = config.getString("localNodeId");
        JSONObject helloBody = new JSONObject()
            .put("protocolVersion", config.optInt("protocolVersion", LocalHubDatabase.PROTOCOL_VERSION))
            .put("schemaVersion", config.optInt("schemaVersion", LocalHubDatabase.NODE_SCHEMA_VERSION))
            .put("spaceId", config.getString("spaceId"))
            .put("nodeId", localNodeId)
            .put("epoch", config.getLong("epoch"))
            .put("activeNodeId", localNodeId);
        JSONObject forcedTakeover = config.optJSONObject("forcedTakeover");
        if (forcedTakeover != null) helloBody.put("forcedTakeover", forcedTakeover);
        JSONObject hello = request(
            endpoint,
            config,
            credential,
            secrets,
            "POST",
            "/api/v1/peer/hello",
            helloBody
        );
        if ("divergent".equals(hello.optString("state"))) {
            throw new IllegalStateException("LOCAL_HUB_DIVERGENCE_DETECTED");
        }
        if ("forced_active".equals(config.optString("state")) &&
            "stable".equals(hello.optString("state"))) {
            database.settleForcedTakeover();
        }
        long after = hello.optJSONObject("watermarks") == null
            ? 0
            : hello.getJSONObject("watermarks").optLong(localNodeId, 0);
        long headSequence = database.operationHead(localNodeId).optLong("originSequence", after);
        progress("operations", 20, "正在检查手机 Hub 的待同步变更");
        int pushed = 0;
        for (;;) {
            JSONArray operations = database.listOperationsAfter(localNodeId, after, 200);
            if (operations.length() == 0) break;
            JSONObject applied = request(
                endpoint,
                config,
                credential,
                secrets,
                "POST",
                "/api/v1/peer/operations/apply",
                new JSONObject().put("operations", operations)
            );
            JSONObject acknowledgements = applied.optJSONObject("acknowledgements");
            JSONObject acknowledgement = acknowledgements == null
                ? null
                : acknowledgements.optJSONObject(localNodeId);
            long next = acknowledgement == null
                ? operations.getJSONObject(operations.length() - 1).getLong("originSequence")
                : acknowledgement.getLong("contiguousSequence");
            if (next <= after) throw new IllegalStateException("LOCAL_HUB_PUSH_CURSOR_STALLED");
            after = next;
            pushed += operations.length();
            long total = Math.max(0, headSequence);
            int operationProgress = total <= 0
                ? 55
                : 20 + (int) Math.round(Math.min(1d, (double) after / (double) total) * 35d);
            progress("operations", operationProgress, "正在把手机 Hub 的变更同步到电脑");
            if (operations.length() < 200) break;
        }
        progress("media", 62, "正在核对双 Hub 媒体文件");
        JSONObject media = pushActiveMedia(endpoint, config, credential, secrets);
        progress("verifying", 94, "正在校验双 Hub 操作链");
        JSONObject syncProof = reportSyncComplete(
            endpoint,
            config,
            credential,
            secrets,
            database.operationHead(localNodeId)
        );
        JSONObject result = new JSONObject()
            .put("synchronized", true)
            .put("direction", "push")
            .put("peerNodeId", config.getString("peerNodeId"))
            .put("pushed", pushed)
            .put("after", after)
            .put("media", media)
            .put("syncProof", syncProof)
            .put("completedAt", System.currentTimeMillis());
        database.recordSyncResult(result);
        return result;
    }

    private JSONObject reportSyncComplete(
        String endpoint,
        JSONObject config,
        JSONObject credential,
        JSONObject secrets,
        JSONObject operationHead
    ) throws Exception {
        JSONObject result = request(
            endpoint,
            config,
            credential,
            secrets,
            "POST",
            "/api/v1/peer/sync-complete",
            new JSONObject()
                .put("originNodeId", operationHead.getString("originNodeId"))
                .put("originSequence", operationHead.getLong("originSequence"))
                .put("operationHash", operationHead.getString("operationHash"))
                .put("completedAt", System.currentTimeMillis())
        );
        if ("stable".equals(result.optString("clusterState"))) {
            database.settleForcedTakeover();
        }
        return result;
    }

    public JSONObject forceTakeover() throws Exception {
        JSONObject secrets = requireSecrets();
        byte[] syncKey = Base64.decode(secrets.getString("spaceSyncKey"), Base64.DEFAULT);
        return database.forceTakeover(syncKey);
    }

    private JSONObject pushActiveMedia(
        String endpoint,
        JSONObject config,
        JSONObject credential,
        JSONObject secrets
    ) throws Exception {
        JSONArray blobs = database.verifiedMediaBlobs();
        int transferred = 0;
        long uploadedBytes = 0;
        for (int start = 0; start < blobs.length(); start += 200) {
            JSONArray descriptors = new JSONArray();
            int end = Math.min(blobs.length(), start + 200);
            for (int index = start; index < end; index += 1) {
                JSONObject blob = blobs.getJSONObject(index);
                descriptors.put(mediaDescriptor(blob));
            }
            JSONObject status = request(
                endpoint,
                config,
                credential,
                secrets,
                "POST",
                "/api/v1/peer/media/status",
                new JSONObject().put("items", descriptors)
            );
            JSONArray remoteItems = status.optJSONArray("items");
            if (remoteItems == null || remoteItems.length() != descriptors.length()) {
                throw new IllegalStateException("LOCAL_HUB_MEDIA_STATUS_INVALID");
            }
            for (int offsetIndex = 0; offsetIndex < descriptors.length(); offsetIndex += 1) {
                JSONObject remote = remoteItems.getJSONObject(offsetIndex);
                JSONObject descriptor = descriptors.getJSONObject(offsetIndex);
                int absoluteIndex = start + offsetIndex;
                if (remote.optBoolean("completed", false)) {
                    reportMediaProgress(absoluteIndex + 1d, blobs.length(), "正在核对电脑 Hub 的媒体文件");
                    continue;
                }
                long offset = remote.optLong("receivedBytes", 0);
                long byteSize = descriptor.getLong("byteSize");
                while (offset < byteSize) {
                    int length = (int) Math.min(1024 * 1024, byteSize - offset);
                    byte[] bytes = blobStore.read(descriptor.getString("id"), offset, length);
                    JSONObject uploaded = request(
                        endpoint,
                        config,
                        credential,
                        secrets,
                        "POST",
                        "/api/v1/peer/media/chunks",
                        new JSONObject()
                            .put("item", descriptor)
                            .put("offset", offset)
                            .put("bytes", Base64.encodeToString(bytes, Base64.NO_WRAP))
                            .put("chunkHash", LocalHubDatabase.sha256(bytes))
                    );
                    long next = uploaded.optLong("receivedBytes", offset);
                    if (next <= offset) throw new IllegalStateException("LOCAL_HUB_MEDIA_PUSH_STALLED");
                    uploadedBytes += next - offset;
                    offset = next;
                    double itemProgress = byteSize <= 0 ? 1d : Math.min(1d, (double) offset / (double) byteSize);
                    reportMediaProgress(absoluteIndex + itemProgress, blobs.length(), "正在同步媒体到电脑 Hub");
                }
                transferred += 1;
                reportMediaProgress(absoluteIndex + 1d, blobs.length(), "正在同步媒体到电脑 Hub");
            }
        }
        if (blobs.length() == 0) progress("media", 88, "双 Hub 媒体文件已一致");
        return new JSONObject()
            .put("discovered", blobs.length())
            .put("transferred", transferred)
            .put("uploadedBytes", uploadedBytes);
    }

    private static JSONObject mediaDescriptor(JSONObject blob) throws Exception {
        return new JSONObject()
            .put("id", blob.getString("mediaId"))
            .put("mimeType", blob.getString("mimeType"))
            .put("fileName", blob.getString("fileName"))
            .put("byteSize", blob.getLong("byteSize"))
            .put("contentHash", blob.getString("contentHash"))
            .put("createdAt", blob.optLong("createdAt", 0));
    }

    public JSONObject downloadBootstrapBlobs() throws Exception {
        JSONObject config = database.replicationConfig();
        JSONObject secrets = requireSecrets();
        JSONObject credential = secrets.getJSONObject("peerCredential");
        String endpoint = selectEndpoint(config);
        JSONArray blobs = database.pendingBootstrapBlobs();
        long downloaded = 0;
        for (int index = 0; index < blobs.length(); index += 1) {
            JSONObject blob = blobs.getJSONObject(index);
            String mediaId = blob.getString("mediaId");
            long offset = blobStore.reconcile(blob);
            if (offset != blob.getLong("receivedBytes")) {
                database.updateBlobProgress(mediaId, offset, "pending", "");
            }
            long byteSize = blob.getLong("byteSize");
            while (offset < byteSize) {
                int length = (int) Math.min(1024 * 1024, byteSize - offset);
                String path = "/api/v1/peer/snapshots/" + encode(blob.getString("snapshotId")) +
                    "/blobs/" + encode(mediaId) + "?offset=" + offset + "&length=" + length;
                BinaryResponse response = requestBinary(endpoint, config, credential, secrets, path);
                if (!blob.getString("contentHash").equals(response.header("X-AetherX-Blob-Hash")) ||
                    offset != parseLong(response.header("X-AetherX-Blob-Offset")) ||
                    byteSize != parseLong(response.header("X-AetherX-Blob-Size")) ||
                    !LocalHubDatabase.sha256(response.bytes).equals(response.header("X-AetherX-Chunk-Hash"))) {
                    throw new IllegalStateException("LOCAL_HUB_BLOB_CHUNK_INVALID");
                }
                if (response.bytes.length == 0) throw new IllegalStateException("LOCAL_HUB_BLOB_CURSOR_STALLED");
                offset = blobStore.append(blob, offset, response.bytes);
                downloaded += response.bytes.length;
                database.updateBlobProgress(mediaId, offset, "pending", "");
            }
            String localPath = blobStore.finalizeBlob(blob);
            database.updateBlobProgress(mediaId, byteSize, "verified", localPath);
        }
        return new JSONObject()
            .put("completed", true)
            .put("downloadedBytes", downloaded)
            .put("blobCount", blobs.length())
            .put("completedAt", System.currentTimeMillis());
    }

    private JSONObject synchronizeMedia(
        String endpoint,
        JSONObject config,
        JSONObject credential,
        JSONObject secrets
    ) throws Exception {
        String cursor = "";
        int discovered = 0;
        int pages = 0;
        for (;;) {
            String path = "/api/v1/peer/media/manifest?limit=200" +
                (cursor.isEmpty() ? "" : "&cursor=" + encode(cursor));
            JSONObject manifest = request(endpoint, config, credential, secrets, "GET", path, new JSONObject());
            JSONArray items = manifest.optJSONArray("items");
            if (items == null) items = new JSONArray();
            JSONArray reset = database.mergeMediaManifest(items);
            for (int index = 0; index < reset.length(); index += 1) blobStore.discard(reset.getString(index));
            discovered += items.length();
            pages += 1;
            if (!manifest.optBoolean("hasMore", false)) break;
            String next = manifest.optString("nextCursor", "");
            if (next.isEmpty() || next.equals(cursor) || items.length() == 0) {
                throw new IllegalStateException("LOCAL_HUB_MEDIA_CURSOR_STALLED");
            }
            cursor = next;
        }
        JSONArray blobs = database.pendingIncrementalBlobs();
        long downloaded = 0;
        for (int index = 0; index < blobs.length(); index += 1) {
            JSONObject blob = blobs.getJSONObject(index);
            String mediaId = blob.getString("mediaId");
            long offset = blobStore.reconcile(blob);
            if (offset != blob.getLong("receivedBytes")) {
                database.updateBlobProgress(mediaId, offset, "pending", "");
            }
            long byteSize = blob.getLong("byteSize");
            while (offset < byteSize) {
                int length = (int) Math.min(1024 * 1024, byteSize - offset);
                String path = "/api/v1/peer/media/" + encode(mediaId) +
                    "/blob?offset=" + offset + "&length=" + length;
                BinaryResponse response = requestBinary(endpoint, config, credential, secrets, path);
                if (!blob.getString("contentHash").equals(response.header("X-AetherX-Blob-Hash")) ||
                    offset != parseLong(response.header("X-AetherX-Blob-Offset")) ||
                    byteSize != parseLong(response.header("X-AetherX-Blob-Size")) ||
                    !LocalHubDatabase.sha256(response.bytes).equals(response.header("X-AetherX-Chunk-Hash"))) {
                    throw new IllegalStateException("LOCAL_HUB_BLOB_CHUNK_INVALID");
                }
                if (response.bytes.length == 0) throw new IllegalStateException("LOCAL_HUB_BLOB_CURSOR_STALLED");
                offset = blobStore.append(blob, offset, response.bytes);
                downloaded += response.bytes.length;
                database.updateBlobProgress(mediaId, offset, "pending", "");
                double itemProgress = byteSize <= 0 ? 1d : Math.min(1d, (double) offset / (double) byteSize);
                reportMediaProgress(index + itemProgress, blobs.length(), "正在同步媒体到手机 Hub");
            }
            String localPath = blobStore.finalizeBlob(blob);
            database.updateBlobProgress(mediaId, byteSize, "verified", localPath);
            reportMediaProgress(index + 1d, blobs.length(), "正在同步媒体到手机 Hub");
        }
        if (blobs.length() == 0) progress("media", 88, "双 Hub 媒体文件已一致");
        return new JSONObject()
            .put("discovered", discovered)
            .put("transferred", blobs.length())
            .put("downloadedBytes", downloaded)
            .put("pages", pages);
    }

    public JSONObject finalizeBootstrap() throws Exception {
        downloadBootstrapBlobs();
        run();
        JSONObject config = database.replicationConfig();
        JSONObject secrets = requireSecrets();
        JSONObject credential = secrets.getJSONObject("peerCredential");
        String endpoint = selectEndpoint(config);
        JSONObject proof = database.createCompletionProof();
        JSONObject completion = request(
            endpoint,
            config,
            credential,
            secrets,
            "POST",
            "/api/v1/peer/bootstrap/complete",
            new JSONObject().put("proof", proof)
        );
        JSONObject receipt = completion.getJSONObject("receipt");
        String authenticationTag = completion.getString("authenticationTag");
        byte[] syncKey = Base64.decode(secrets.getString("spaceSyncKey"), Base64.DEFAULT);
        String expectedTag = hmac(syncKey, LocalHubDatabase.sha256(LocalHubDatabase.canonical(receipt)));
        if (!expectedTag.equals(authenticationTag)) {
            throw new IllegalStateException("LOCAL_HUB_BOOTSTRAP_RECEIPT_INVALID");
        }
        JSONObject finalized = request(
            endpoint,
            config,
            credential,
            secrets,
            "POST",
            "/api/v1/peer/bootstrap/finalize",
            new JSONObject().put("receipt", receipt).put("authenticationTag", authenticationTag)
        );
        database.markBootstrapCompleted(receipt);
        return new JSONObject()
            .put("completed", true)
            .put("receipt", receipt)
            .put("source", finalized)
            .put("completedAt", System.currentTimeMillis());
    }

    private void reportMediaProgress(double completed, int total, String message) {
        double ratio = total <= 0 ? 1d : Math.max(0d, Math.min(1d, completed / (double) total));
        progress("media", 65 + (int) Math.round(ratio * 23d), message);
    }

    private void progress(String stage, int value, String message) {
        progressListener.onProgress(stage, Math.max(0, Math.min(100, value)), message);
    }

    public JSONObject switchToLocal() throws Exception {
        JSONObject config = database.replicationConfig();
        JSONObject secrets = requireSecrets();
        JSONObject credential = secrets.getJSONObject("peerCredential");
        String endpoint = selectEndpoint(config);
        byte[] syncKey = Base64.decode(secrets.getString("spaceSyncKey"), Base64.DEFAULT);
        JSONObject exchange = database.pendingSwitchExchange();
        if (exchange != null && !"toLocal".equals(exchange.optString("mode", "toLocal"))) {
            throw new IllegalStateException("SWITCH_STATE_CONFLICT");
        }

        if (exchange == null) {
            JSONObject status = database.status(true, 0);
            if ("active".equals(status.optString("role")) &&
                "stable".equals(status.optString("state"))) {
                return new JSONObject()
                    .put("completed", true)
                    .put("activeNodeId", status.getString("activeNodeId"))
                    .put("epoch", status.getLong("epoch"));
            }
            if (!"standby".equals(status.optString("role")) ||
                !"stable".equals(status.optString("state")) ||
                status.optJSONObject("bootstrap") == null ||
                !"completed".equals(status.getJSONObject("bootstrap").optString("status"))) {
                throw new IllegalStateException("LOCAL_HUB_SWITCH_NOT_READY");
            }
            // The completed bootstrap is only the baseline. Catch up operations created
            // afterwards before asking the active Hub to evaluate the stable-state gate.
            run();
            status = database.status(true, 0);
            if (!"standby".equals(status.optString("role")) ||
                !"stable".equals(status.optString("state")) ||
                status.optJSONObject("bootstrap") == null ||
                !"completed".equals(status.getJSONObject("bootstrap").optString("status"))) {
                throw new IllegalStateException("LOCAL_HUB_SWITCH_NOT_READY");
            }
            JSONObject signedProof = signedSwitchProof(syncKey);
            JSONObject started = request(
                endpoint,
                config,
                credential,
                secrets,
                "POST",
                "/api/v1/peer/mobile-switch/start",
                new JSONObject().put("proof", signedProof)
            );
            exchange = prepareExchange(started.getJSONObject("signedControl"), syncKey);
        } else if (!exchange.has("signedAck")) {
            exchange = prepareExchange(exchange.getJSONObject("signedControl"), syncKey);
        }

        for (int step = 0; step < 8; step += 1) {
            JSONObject localStatus = database.status(true, 0);
            JSONObject body = new JSONObject()
                .put("signedControl", exchange.getJSONObject("signedControl"))
                .put("signedAck", exchange.getJSONObject("signedAck"));
            String state = localStatus.optString("state");
            if ("final_sync".equals(state)) {
                run();
                body.put("proof", signedSwitchProof(syncKey));
            } else if ("integrity_check".equals(state)) {
                body.put("proof", signedSwitchProof(syncKey));
            }
            JSONObject advanced = request(
                endpoint,
                config,
                credential,
                secrets,
                "POST",
                "/api/v1/peer/mobile-switch/advance",
                body
            );
            if (advanced.optBoolean("done", false)) {
                database.clearPendingSwitchExchange();
                JSONObject completed = database.status(true, 0);
                return new JSONObject()
                    .put("completed", true)
                    .put("transitionId", advanced.optString("transitionId", ""))
                    .put("activeNodeId", completed.getString("activeNodeId"))
                    .put("epoch", completed.getLong("epoch"))
                    .put("state", completed.getString("state"));
            }
            exchange = prepareExchange(advanced.getJSONObject("signedControl"), syncKey);
        }
        throw new IllegalStateException("LOCAL_HUB_SWITCH_STALLED");
    }

    public JSONObject switchToPeer() throws Exception {
        JSONObject config = database.replicationConfig();
        JSONObject secrets = requireSecrets();
        JSONObject credential = secrets.getJSONObject("peerCredential");
        String endpoint = selectEndpoint(config);
        byte[] syncKey = Base64.decode(secrets.getString("spaceSyncKey"), Base64.DEFAULT);
        JSONObject pending = database.pendingSwitchExchange();
        if (pending != null && !"toPeer".equals(pending.optString("mode"))) {
            throw new IllegalStateException("SWITCH_STATE_CONFLICT");
        }
        if (pending != null) completeOutgoingExchange(
            endpoint, config, credential, secrets, pending, syncKey
        );

        for (int step = 0; step < 8; step += 1) {
            JSONObject status = database.status(true, 0);
            String state = status.getString("state");
            if ("stable".equals(state) && "standby".equals(status.getString("role"))) {
                return new JSONObject()
                    .put("completed", true)
                    .put("activeNodeId", status.getString("activeNodeId"))
                    .put("epoch", status.getLong("epoch"))
                    .put("state", state);
            }
            if (!"active".equals(status.getString("role"))) {
                throw new IllegalStateException("LOCAL_HUB_SWITCH_NOT_READY");
            }
            if ("forced_active".equals(state)) {
                run();
                continue;
            }
            String transitionId = status.optString("transitionId", "");
            long transitionStartedAt = status.optLong("transitionStartedAt", 0);
            String nextState;
            String action = "phase";
            long nextEpoch = status.getLong("epoch");
            if ("stable".equals(state)) {
                assertRemoteProof(endpoint, config, credential, secrets, syncKey, "stable");
                transitionId = UUID.randomUUID().toString();
                transitionStartedAt = System.currentTimeMillis();
                nextState = "preparing_switch";
            } else if ("preparing_switch".equals(state)) {
                nextState = "draining";
            } else if ("draining".equals(state)) {
                nextState = "final_sync";
            } else if ("final_sync".equals(state)) {
                run();
                assertRemoteProof(endpoint, config, credential, secrets, syncKey, "final_sync");
                nextState = "integrity_check";
            } else if ("integrity_check".equals(state)) {
                assertRemoteProof(endpoint, config, credential, secrets, syncKey, "integrity_check");
                nextState = "committing_switch";
            } else if ("committing_switch".equals(state)) {
                action = "commit";
                nextState = "stable";
                nextEpoch += 1;
            } else {
                throw new IllegalStateException("SWITCH_STATE_CONFLICT");
            }
            JSONObject signedControl = signSwitchControl(
                action,
                nextState,
                nextEpoch,
                status.getString("spaceId"),
                status.getString("localNodeId"),
                config.getString("peerNodeId"),
                transitionId,
                transitionStartedAt,
                syncKey
            );
            pending = new JSONObject()
                .put("mode", "toPeer")
                .put("signedControl", signedControl);
            database.savePendingSwitchExchange(pending);
            if (!"commit".equals(action)) {
                pending.put("localAck", database.applySwitchControl(signedControl, syncKey, true));
                database.savePendingSwitchExchange(pending);
            }
            completeOutgoingExchange(endpoint, config, credential, secrets, pending, syncKey);
        }
        throw new IllegalStateException("LOCAL_HUB_SWITCH_STALLED");
    }

    public JSONObject createSwitchPreflightProof() throws Exception {
        return signedSwitchProof(syncKey());
    }

    public JSONObject applyPeerSwitchControl(JSONObject signedControl) throws Exception {
        return database.applySwitchControl(signedControl, syncKey(), false);
    }

    public JSONObject runPeerFinalSync(JSONObject input) throws Exception {
        JSONObject config = database.replicationConfig();
        JSONObject status = database.status(true, 0);
        String transitionId = input.optString("transitionId", "");
        if (transitionId.isEmpty() ||
            !config.getString("peerNodeId").equals(status.optString("activeNodeId")) ||
            status.optString("localNodeId").equals(status.optString("activeNodeId")) ||
            !"final_sync".equals(status.optString("state")) ||
            !transitionId.equals(status.optString("transitionId")) ||
            !status.optString("localNodeId").equals(status.optString("transitionTargetNodeId"))) {
            throw new IllegalStateException("SWITCH_STATE_CONFLICT");
        }
        return run();
    }

    private void completeOutgoingExchange(
        String endpoint,
        JSONObject config,
        JSONObject credential,
        JSONObject secrets,
        JSONObject pending,
        byte[] syncKey
    ) throws Exception {
        JSONObject signedControl = pending.getJSONObject("signedControl");
        JSONObject control = signedControl.getJSONObject("control");
        if (Math.abs(System.currentTimeMillis() - control.optLong("issuedAt")) > 25_000L) {
            signedControl = signSwitchControl(
                control.getString("action"),
                control.getString("state"),
                control.getLong("epoch"),
                control.getString("spaceId"),
                control.getString("activeNodeId"),
                control.getString("targetNodeId"),
                control.getString("transitionId"),
                control.getLong("transitionStartedAt"),
                syncKey
            );
            pending.put("signedControl", signedControl);
            if (!"commit".equals(control.getString("action"))) {
                pending.put("localAck", database.applySwitchControl(signedControl, syncKey, true));
            }
            database.savePendingSwitchExchange(pending);
            control = signedControl.getJSONObject("control");
        }
        JSONObject signedAck = request(
            endpoint,
            config,
            credential,
            secrets,
            "POST",
            "/api/v1/peer/switch/control",
            signedControl
        );
        verifySwitchAck(signedControl, signedAck, config.getString("peerNodeId"), syncKey);
        if ("commit".equals(control.getString("action"))) {
            JSONObject status = database.status(true, 0);
            if (!("stable".equals(status.getString("state")) &&
                config.getString("peerNodeId").equals(status.getString("activeNodeId")))) {
                database.applySwitchControl(signedControl, syncKey, true);
            }
        }
        database.clearPendingSwitchExchange();
    }

    private void assertRemoteProof(
        String endpoint,
        JSONObject config,
        JSONObject credential,
        JSONObject secrets,
        byte[] syncKey,
        String expectedState
    ) throws Exception {
        JSONObject localSigned = signedSwitchProof(syncKey);
        JSONObject remoteSigned = request(
            endpoint,
            config,
            credential,
            secrets,
            "POST",
            "/api/v1/peer/switch/preflight",
            new JSONObject()
        );
        JSONObject local = localSigned.getJSONObject("proof");
        JSONObject remote = remoteSigned.optJSONObject("proof");
        JSONArray failed = new JSONArray();
        boolean proofValid = remote != null &&
            hmac(syncKey, LocalHubDatabase.sha256(LocalHubDatabase.canonical(remote)))
                .equals(remoteSigned.optString("authenticationTag")) &&
            Math.abs(System.currentTimeMillis() - remote.optLong("generatedAt")) <= 30_000L;
        requireCheck(failed, "proof", proofValid);
        if (remote != null) {
            requireCheck(failed, "cluster",
                expectedState.equals(local.optString("clusterState")) &&
                expectedState.equals(remote.optString("clusterState")));
            requireCheck(failed, "target",
                config.getString("peerNodeId").equals(remote.optString("nodeId")) &&
                "standby".equals(remote.optString("role")) &&
                "standby".equals(remote.optString("nodeStatus")));
            requireCheck(failed, "space", local.optString("spaceId").equals(remote.optString("spaceId")));
            requireCheck(failed, "epoch",
                local.optLong("epoch") == remote.optLong("epoch") &&
                local.optString("activeNodeId").equals(remote.optString("activeNodeId")));
            requireCheck(failed, "protocol", local.optInt("protocolVersion") == remote.optInt("protocolVersion"));
            requireCheck(failed, "schema", local.optInt("schemaVersion") == remote.optInt("schemaVersion"));
            requireCheck(failed, "database", local.optBoolean("databaseHealthy") && remote.optBoolean("databaseHealthy"));
            requireCheck(failed, "credentials", local.optBoolean("providerCredentialsReadable") && remote.optBoolean("providerCredentialsReadable"));
            requireCheck(failed, "agent", local.optBoolean("agentIdle") && remote.optBoolean("agentIdle"));
            requireCheck(failed, "operations",
                LocalHubDatabase.canonical(local.optJSONObject("operationHeads"))
                    .equals(LocalHubDatabase.canonical(remote.optJSONObject("operationHeads"))));
            requireCheck(failed, "records", local.optString("recordsRoot").equals(remote.optString("recordsRoot")));
            requireCheck(failed, "media",
                local.optString("blobsRoot").equals(remote.optString("blobsRoot")) &&
                local.optInt("pendingMediaCount") == 0 && remote.optInt("pendingMediaCount") == 0);
            requireCheck(failed, "bootstrap",
                local.optInt("busyBootstrapCount") == 0 && remote.optInt("busyBootstrapCount") == 0);
        }
        throwPreflightFailure(failed);
    }

    private static void requireCheck(JSONArray failed, String id, boolean passed) {
        if (!passed) failed.put(id);
    }

    private static void throwPreflightFailure(JSONArray failed) {
        if (failed.length() == 0) return;
        StringBuilder ids = new StringBuilder();
        for (int index = 0; index < failed.length(); index += 1) {
            if (ids.length() > 0) ids.append(',');
            ids.append(failed.optString(index));
        }
        Log.e(TAG, "Hub switch preflight failed: " + ids);
        throw new IllegalStateException("SWITCH_PREFLIGHT_FAILED:" + ids);
    }

    private JSONObject prepareExchange(JSONObject signedControl, byte[] syncKey) throws Exception {
        JSONObject pending = new JSONObject()
            .put("mode", "toLocal")
            .put("signedControl", signedControl);
        database.savePendingSwitchExchange(pending);
        JSONObject signedAck = database.applySwitchControl(signedControl, syncKey, false);
        pending.put("signedAck", signedAck);
        database.savePendingSwitchExchange(pending);
        return pending;
    }

    private JSONObject signedSwitchProof(byte[] syncKey) throws Exception {
        JSONObject proof = database.createSwitchPreflightProof(secretStore.isReady());
        return new JSONObject()
            .put("proof", proof)
            .put("authenticationTag", hmac(
                syncKey,
                LocalHubDatabase.sha256(LocalHubDatabase.canonical(proof))
            ));
    }

    private static JSONObject signSwitchControl(
        String action,
        String state,
        long epoch,
        String spaceId,
        String activeNodeId,
        String targetNodeId,
        String transitionId,
        long transitionStartedAt,
        byte[] syncKey
    ) throws Exception {
        JSONObject control = new JSONObject()
            .put("version", 1)
            .put("action", action)
            .put("spaceId", spaceId)
            .put("epoch", epoch)
            .put("activeNodeId", activeNodeId)
            .put("targetNodeId", targetNodeId)
            .put("transitionId", transitionId)
            .put("transitionStartedAt", transitionStartedAt)
            .put("state", state)
            .put("issuedAt", System.currentTimeMillis());
        return new JSONObject()
            .put("control", control)
            .put("authenticationTag", hmac(syncKey, LocalHubDatabase.canonical(control)));
    }

    private static void verifySwitchAck(
        JSONObject signedControl,
        JSONObject signedAck,
        String expectedNodeId,
        byte[] syncKey
    ) throws Exception {
        JSONObject control = signedControl.getJSONObject("control");
        JSONObject ack = signedAck.optJSONObject("ack");
        JSONObject state = persistedSwitchState(control);
        if (ack == null ||
            !hmac(syncKey, LocalHubDatabase.canonical(ack))
                .equals(signedAck.optString("authenticationTag")) ||
            !LocalHubDatabase.sha256(LocalHubDatabase.canonical(control))
                .equals(ack.optString("controlHash")) ||
            !expectedNodeId.equals(ack.optString("nodeId")) ||
            !state.getString("state").equals(ack.optString("state")) ||
            state.getLong("epoch") != ack.optLong("epoch") ||
            !LocalHubDatabase.sha256(LocalHubDatabase.canonical(state))
                .equals(ack.optString("stateHash"))) {
            throw new IllegalStateException("SWITCH_CONTROL_INVALID");
        }
    }

    private static JSONObject persistedSwitchState(JSONObject control) throws Exception {
        String action = control.getString("action");
        if ("phase".equals(action)) {
            return new JSONObject()
                .put("spaceId", control.getString("spaceId"))
                .put("epoch", control.getLong("epoch"))
                .put("activeNodeId", control.getString("activeNodeId"))
                .put("transitionId", control.getString("transitionId"))
                .put("transitionTargetNodeId", control.getString("targetNodeId"))
                .put("transitionStartedAt", control.getLong("transitionStartedAt"))
                .put("state", control.getString("state"));
        }
        if ("commit".equals(action)) {
            return new JSONObject()
                .put("spaceId", control.getString("spaceId"))
                .put("epoch", control.getLong("epoch"))
                .put("activeNodeId", control.getString("targetNodeId"))
                .put("transitionId", "")
                .put("transitionTargetNodeId", "")
                .put("transitionStartedAt", JSONObject.NULL)
                .put("state", "stable");
        }
        return new JSONObject()
            .put("spaceId", control.getString("spaceId"))
            .put("epoch", control.getLong("epoch"))
            .put("activeNodeId", control.getString("activeNodeId"))
            .put("transitionId", "")
            .put("transitionTargetNodeId", "")
            .put("transitionStartedAt", JSONObject.NULL)
            .put("state", "stable");
    }

    private JSONObject requireSecrets() throws Exception {
        JSONObject secrets = secretStore.load();
        if (secrets == null) throw new IllegalStateException("LOCAL_HUB_CREDENTIAL_UNAVAILABLE");
        return secrets;
    }

    private byte[] syncKey() throws Exception {
        return Base64.decode(requireSecrets().getString("spaceSyncKey"), Base64.DEFAULT);
    }

    private String selectEndpoint(JSONObject config) throws Exception {
        if (selectedEndpoint != null && !selectedEndpoint.isEmpty()) return selectedEndpoint;
        JSONArray endpoints = config.getJSONArray("endpoints");
        if (endpoints.length() == 0) throw new IllegalStateException("PEER_ENDPOINT_UNAVAILABLE");
        long now = System.currentTimeMillis();
        if (!healthyEndpoint.isEmpty() && now - healthyEndpointAt < ENDPOINT_CACHE_TTL_MS) {
            for (int index = 0; index < endpoints.length(); index += 1) {
                String candidate = endpoints.getJSONObject(index).getString("address");
                if (!healthyEndpoint.equals(candidate)) continue;
                selectedEndpoint = candidate;
                Log.i(TAG, "Reusing healthy peer endpoint: " + candidate);
                return candidate;
            }
        }
        String fallback = endpoints.getJSONObject(endpoints.length() - 1).getString("address");
        for (int index = 0; index < endpoints.length(); index += 1) {
            JSONObject endpoint = endpoints.getJSONObject(index);
            String candidate = endpoint.getString("address");
            String transport = endpoint.optString("transport");
            int timeoutMs = ("lan".equals(transport) || "development".equals(transport)) ? 1_000 : 3_500;
            if (isReachable(candidate, timeoutMs)) {
                selectedEndpoint = candidate;
                rememberHealthyEndpoint(candidate);
                Log.i(TAG, "Selected peer endpoint: " + candidate);
                return candidate;
            }
        }
        selectedEndpoint = fallback;
        Log.i(TAG, "Peer health probes timed out; falling back to: " + fallback);
        return fallback;
    }

    private static void rememberHealthyEndpoint(String endpoint) {
        healthyEndpoint = endpoint;
        healthyEndpointAt = System.currentTimeMillis();
    }

    private static void forgetHealthyEndpoint(String endpoint) {
        if (!endpoint.equals(healthyEndpoint)) return;
        healthyEndpoint = "";
        healthyEndpointAt = 0;
    }

    private static boolean isReachable(String endpoint, int timeoutMs) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(endpoint + "/health").openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(timeoutMs);
            connection.setReadTimeout(timeoutMs);
            connection.setInstanceFollowRedirects(false);
            int status = connection.getResponseCode();
            return status >= 200 && status < 300;
        } catch (Exception ignored) {
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private JSONObject request(
        String endpoint,
        JSONObject config,
        JSONObject credential,
        JSONObject secrets,
        String method,
        String path,
        JSONObject body
    ) throws Exception {
        try {
            HttpURLConnection connection = open(endpoint, config, credential, method, path, body);
            connection.setConnectTimeout(8_000);
            connection.setReadTimeout(20_000);
            connection.setInstanceFollowRedirects(false);
            if (!"GET".equals(method)) {
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json");
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(LocalHubDatabase.canonical(body).getBytes(StandardCharsets.UTF_8));
                }
            }
            int status = connection.getResponseCode();
            rememberHealthyEndpoint(endpoint);
            String responseText = read(status >= 200 && status < 300
                ? connection.getInputStream()
                : connection.getErrorStream());
            JSONObject payload = responseText.isEmpty() ? new JSONObject() : new JSONObject(responseText);
            if (status < 200 || status >= 300) {
                JSONObject error = payload.optJSONObject("error");
                throw new IllegalStateException(peerErrorCode(error));
            }
            JSONObject data = payload.optJSONObject("data");
            return data == null ? new JSONObject() : data;
        } catch (IOException error) {
            forgetHealthyEndpoint(endpoint);
            throw error;
        }
    }

    private static String peerErrorCode(JSONObject error) {
        if (error == null) return "LOCAL_HUB_PEER_REQUEST_FAILED";
        String code = error.optString("code", "LOCAL_HUB_PEER_REQUEST_FAILED");
        if (!"SWITCH_PREFLIGHT_FAILED".equals(code)) return code;
        JSONObject details = error.optJSONObject("details");
        JSONArray checks = details == null ? null : details.optJSONArray("failedChecks");
        if (checks == null || checks.length() == 0) return code;
        StringBuilder ids = new StringBuilder();
        for (int index = 0; index < checks.length(); index += 1) {
            String id = checks.optJSONObject(index) == null
                ? ""
                : checks.optJSONObject(index).optString("id", "");
            if (id.isEmpty()) continue;
            if (ids.length() > 0) ids.append(',');
            ids.append(id);
        }
        String detailed = ids.length() == 0 ? code : code + ":" + ids;
        Log.e(TAG, "Peer rejected Hub switch preflight: " + detailed);
        return detailed;
    }

    private BinaryResponse requestBinary(
        String endpoint,
        JSONObject config,
        JSONObject credential,
        JSONObject secrets,
        String path
    ) throws Exception {
        HttpURLConnection connection = open(endpoint, config, credential, "GET", path, new JSONObject());
        connection.setConnectTimeout(8_000);
        connection.setReadTimeout(30_000);
        connection.setInstanceFollowRedirects(false);
        int status = connection.getResponseCode();
        if (status < 200 || status >= 300) {
            String responseText = read(connection.getErrorStream());
            JSONObject payload = responseText.isEmpty() ? new JSONObject() : new JSONObject(responseText);
            JSONObject error = payload.optJSONObject("error");
            throw new IllegalStateException(error == null
                ? "LOCAL_HUB_PEER_REQUEST_FAILED"
                : error.optString("code", "LOCAL_HUB_PEER_REQUEST_FAILED"));
        }
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[64 * 1024];
        try (InputStream input = connection.getInputStream()) {
            int read;
            while ((read = input.read(buffer)) >= 0) if (read > 0) output.write(buffer, 0, read);
        }
        return new BinaryResponse(connection, output.toByteArray());
    }

    private HttpURLConnection open(
        String endpoint,
        JSONObject config,
        JSONObject credential,
        String method,
        String path,
        JSONObject body
    ) throws Exception {
        long timestamp = System.currentTimeMillis();
        String nonce = UUID.randomUUID().toString();
        JSONObject material = new JSONObject()
            .put("version", 1)
            .put("spaceId", config.getString("spaceId"))
            .put("nodeId", config.getString("localNodeId"))
            .put("keyId", credential.getString("keyId"))
            .put("method", method)
            .put("path", path)
            .put("timestamp", timestamp)
            .put("nonce", nonce)
            .put("bodyHash", LocalHubDatabase.sha256(LocalHubDatabase.canonical(body)));
        String materialHash = LocalHubDatabase.sha256(LocalHubDatabase.canonical(material));
        byte[] sharedSecret = Base64.decode(credential.getString("sharedSecret"), Base64.DEFAULT);
        String signature = hmac(sharedSecret, materialHash);
        HttpURLConnection connection = (HttpURLConnection) new URL(endpoint + path).openConnection();
        connection.setRequestMethod(method);
        connection.setRequestProperty("X-AetherX-Peer-Space", config.getString("spaceId"));
        connection.setRequestProperty("X-AetherX-Peer-Node", config.getString("localNodeId"));
        connection.setRequestProperty("X-AetherX-Peer-Key", credential.getString("keyId"));
        connection.setRequestProperty("X-AetherX-Peer-Timestamp", String.valueOf(timestamp));
        connection.setRequestProperty("X-AetherX-Peer-Nonce", nonce);
        connection.setRequestProperty("X-AetherX-Peer-Signature", signature);
        return connection;
    }

    private static String hmac(byte[] key, String value) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(key, "HmacSHA256"));
        byte[] bytes = mac.doFinal(value.getBytes(StandardCharsets.UTF_8));
        StringBuilder result = new StringBuilder(bytes.length * 2);
        for (byte item : bytes) result.append(String.format("%02x", item & 0xff));
        return result.toString();
    }

    private static JSONObject decryptSnapshotEnvelope(JSONObject envelope, String encodedKey) throws Exception {
        if (envelope.optInt("version", 0) != 1 || !"A256GCM".equals(envelope.optString("algorithm"))) {
            throw new IllegalStateException("LOCAL_HUB_SNAPSHOT_INVALID");
        }
        JSONObject aad = envelope.optJSONObject("aad");
        byte[] key = Base64.decode(encodedKey, Base64.DEFAULT);
        byte[] iv = Base64.decode(envelope.getString("iv"), Base64.DEFAULT);
        byte[] ciphertext = Base64.decode(envelope.getString("ciphertext"), Base64.DEFAULT);
        byte[] tag = Base64.decode(envelope.getString("authenticationTag"), Base64.DEFAULT);
        if (aad == null || key.length != 32 || iv.length != 12 || tag.length != 16) {
            throw new IllegalStateException("LOCAL_HUB_SNAPSHOT_INVALID");
        }
        byte[] combined = new byte[ciphertext.length + tag.length];
        System.arraycopy(ciphertext, 0, combined, 0, ciphertext.length);
        System.arraycopy(tag, 0, combined, ciphertext.length, tag.length);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, iv));
        cipher.updateAAD(LocalHubDatabase.canonical(aad).getBytes(StandardCharsets.UTF_8));
        try {
            return new JSONObject(new String(cipher.doFinal(combined), StandardCharsets.UTF_8));
        } catch (Exception error) {
            throw new IllegalStateException("LOCAL_HUB_SNAPSHOT_INVALID", error);
        }
    }

    private static String read(InputStream input) throws Exception {
        if (input == null) return "";
        StringBuilder result = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) result.append(line);
        }
        return result.toString();
    }

    private static String encode(String value) throws Exception {
        return java.net.URLEncoder.encode(value, StandardCharsets.UTF_8.name()).replace("+", "%20");
    }

    private static long parseLong(String value) {
        try {
            return Long.parseLong(value == null ? "" : value);
        } catch (NumberFormatException error) {
            return -1;
        }
    }

    private static final class BinaryResponse {
        final HttpURLConnection connection;
        final byte[] bytes;

        BinaryResponse(HttpURLConnection connection, byte[] bytes) {
            this.connection = connection;
            this.bytes = bytes;
        }

        String header(String name) {
            return connection.getHeaderField(name);
        }
    }
}
