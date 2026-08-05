package com.xuanxiaotech.aetherx.mobile.hub;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import android.util.Base64;

import java.util.UUID;

public final class LocalHubService {
    public static final int DEFAULT_PORT = 4319;
    private static volatile LocalHubService instance;

    private final LocalHubDatabase database;
    private final LocalHubSecretStore secretStore;
    private final LocalHubBlobStore blobStore;
    private final LocalHubNetworkServer networkServer;
    private volatile boolean running;

    private LocalHubService(Context context) {
        database = new LocalHubDatabase(context.getApplicationContext());
        secretStore = new LocalHubSecretStore(context.getApplicationContext());
        blobStore = new LocalHubBlobStore(context.getApplicationContext());
        networkServer = new LocalHubNetworkServer(
            context.getApplicationContext(),
            this,
            secretStore
        );
    }

    public static LocalHubService get(Context context) {
        if (instance == null) {
            synchronized (LocalHubService.class) {
                if (instance == null) instance = new LocalHubService(context);
            }
        }
        return instance;
    }

    public synchronized JSONObject start() throws JSONException {
        database.getWritableDatabase();
        database.getOrCreateNodeId();
        networkServer.start();
        running = true;
        return status();
    }

    public synchronized JSONObject startAndResumePendingSwitch() throws JSONException {
        JSONObject current = start();
        if (!current.optBoolean("configured", false)) return current;
        JSONObject pending = database.pendingSwitchExchange();
        if (pending == null && "stable".equals(current.optString("state"))) return current;
        return resumeReplication();
    }

    public synchronized JSONObject stop() throws JSONException {
        networkServer.stop();
        running = false;
        return status();
    }

    public JSONObject status() throws JSONException {
        int networkPort = networkServer.port();
        return database.status(running, networkPort)
            .put("credentialReady", secretStore.isReady())
            .put("networkPort", networkPort)
            .put("networkEndpoints", networkServer.endpoints());
    }

    public JSONObject configure(JSONObject input) throws JSONException {
        ensureRunning();
        try {
            JSONObject credential = input.optJSONObject("peerCredential");
            String syncKey = input.optString("spaceSyncKey", "");
            if (credential != null && !syncKey.isEmpty()) {
                secretStore.save(new JSONObject()
                    .put("spaceId", input.optString("spaceId"))
                    .put("peerNodeId", input.optString("peerNodeId"))
                    .put("peerCredential", credential)
                    .put("spaceSyncKey", syncKey)
                    .put("spaceSyncKeyVersion", input.optInt("spaceSyncKeyVersion", 1)));
            }
            return database.configure(input).put("credentialReady", secretStore.isReady());
        } catch (JSONException error) {
            throw error;
        } catch (Exception error) {
            throw new IllegalStateException("LOCAL_HUB_SECRET_STORAGE_FAILED", error);
        }
    }

    public JSONObject updatePeerEndpoints(JSONArray endpoints) throws JSONException {
        ensureRunning();
        return database.updatePeerEndpoints(endpoints);
    }

    public JSONObject importSnapshot(JSONObject input) throws JSONException {
        ensureRunning();
        JSONObject previous = null;
        try {
            JSONObject credentials = input.optJSONObject("credentials");
            if (credentials == null) throw new JSONException("credentials is required");
            previous = secretStore.load();
            secretStore.merge(new JSONObject().put("providerCredentials", credentials));
            return database.importSnapshot(input, syncKey());
        } catch (JSONException error) {
            restoreSecrets(previous);
            throw error;
        } catch (IllegalStateException error) {
            restoreSecrets(previous);
            throw error;
        } catch (Exception error) {
            restoreSecrets(previous);
            throw new IllegalStateException("LOCAL_HUB_SECRET_STORAGE_FAILED", error);
        }
    }

    private void restoreSecrets(JSONObject previous) {
        try {
            if (previous == null) secretStore.clear();
            else secretStore.save(previous);
        } catch (Exception ignored) {
            // Preserve the original import failure; a later readiness check will force re-pairing.
        }
    }

    public JSONObject applyOperations(JSONArray operations) throws JSONException {
        ensureRunning();
        byte[] key = syncKey();
        JSONObject previous = null;
        try {
            previous = secretStore.load();
            String spaceId = status().getString("spaceId");
            secretStore.applyProviderOperations(operations, key, spaceId);
            return database.applyOperations(operations, key);
        } catch (JSONException error) {
            restoreSecrets(previous);
            throw error;
        } catch (IllegalStateException error) {
            restoreSecrets(previous);
            throw error;
        } catch (Exception error) {
            restoreSecrets(previous);
            throw new IllegalStateException("LOCAL_HUB_PROVIDER_CREDENTIAL_INVALID", error);
        }
    }

    public JSONObject mutateDocument(JSONObject input) throws JSONException {
        ensureRunning();
        return database.mutateDocument(input, syncKey());
    }

    public JSONObject mutateDocuments(JSONObject input) throws JSONException {
        ensureRunning();
        return database.mutateDocuments(input, syncKey());
    }

    public JSONArray listDocuments(
        String entityType,
        boolean includeDeleted,
        String payloadField,
        String payloadValue
    ) throws JSONException {
        ensureRunning();
        return database.listDocuments(entityType, includeDeleted, payloadField, payloadValue);
    }

    public JSONObject localChanges(long after, int limit) throws JSONException {
        ensureRunning();
        String localNodeId = database.getOrCreateNodeId();
        int boundedLimit = Math.max(1, Math.min(limit, 500));
        JSONArray operations = database.listOperationsAfter(localNodeId, Math.max(0, after), boundedLimit + 1);
        boolean hasMore = operations.length() > boundedLimit;
        JSONArray changes = new JSONArray();
        long nextCursor = Math.max(0, after);
        int count = Math.min(operations.length(), boundedLimit);
        for (int index = 0; index < count; index += 1) {
            JSONObject operation = operations.getJSONObject(index);
            nextCursor = operation.getLong("originSequence");
            changes.put(new JSONObject()
                .put("seq", nextCursor)
                .put("entityType", operation.getString("entityType"))
                .put("entityId", operation.getString("entityId"))
                .put("operation", operation.getString("operation"))
                .put("createdAt", operation.getLong("createdAt")));
        }
        return new JSONObject()
            .put("changes", changes)
            .put("nextCursor", nextCursor)
            .put("hasMore", hasMore);
    }

    public JSONObject verifyIntegrity() throws JSONException {
        ensureRunning();
        return database.verifyIntegrity();
    }

    public synchronized JSONObject synchronize() {
        ensureRunning();
        try {
            database.requireBootstrapCompleted();
            return new LocalHubPeerSync(database, secretStore, blobStore).run();
        } catch (IllegalStateException error) {
            throw error;
        } catch (Exception error) {
            throw new IllegalStateException("LOCAL_HUB_SYNC_FAILED", error);
        }
    }

    public JSONObject bootstrapBlobs() {
        ensureRunning();
        try {
            return new LocalHubPeerSync(database, secretStore, blobStore).downloadBootstrapBlobs();
        } catch (IllegalStateException error) {
            throw error;
        } catch (Exception error) {
            throw new IllegalStateException("LOCAL_HUB_BLOB_SYNC_FAILED", error);
        }
    }

    public JSONObject bootstrapStructure() {
        ensureRunning();
        try {
            JSONObject input = new LocalHubPeerSync(database, secretStore, blobStore)
                .downloadStructuredSnapshot();
            return importSnapshot(input);
        } catch (IllegalStateException error) {
            throw error;
        } catch (Exception error) {
            throw new IllegalStateException("LOCAL_HUB_STRUCTURE_SYNC_FAILED", error);
        }
    }

    public JSONObject finalizeBootstrap() {
        ensureRunning();
        try {
            return new LocalHubPeerSync(database, secretStore, blobStore).finalizeBootstrap();
        } catch (IllegalStateException error) {
            throw error;
        } catch (Exception error) {
            throw new IllegalStateException("LOCAL_HUB_BOOTSTRAP_FINALIZE_FAILED", error);
        }
    }

    public synchronized JSONObject switchToLocal() {
        ensureRunning();
        try {
            return new LocalHubPeerSync(database, secretStore, blobStore).switchToLocal();
        } catch (IllegalStateException error) {
            throw error;
        } catch (Exception error) {
            throw new IllegalStateException("LOCAL_HUB_SWITCH_FAILED", error);
        }
    }

    public synchronized JSONObject switchToPeer() {
        ensureRunning();
        try {
            return new LocalHubPeerSync(database, secretStore, blobStore).switchToPeer();
        } catch (IllegalStateException error) {
            throw error;
        } catch (Exception error) {
            throw new IllegalStateException("LOCAL_HUB_SWITCH_FAILED", error);
        }
    }

    public JSONObject media(String mediaId) throws JSONException {
        ensureRunning();
        JSONObject blob = database.findMediaBlob(mediaId);
        if (blob == null || !"verified".equals(blob.optString("status"))) {
            throw new IllegalStateException("LOCAL_HUB_MEDIA_NOT_FOUND");
        }
        String path = blobStore.resolve(mediaId);
        if (path.isEmpty()) throw new IllegalStateException("LOCAL_HUB_MEDIA_NOT_FOUND");
        return new JSONObject()
            .put("mediaId", mediaId)
            .put("mimeType", blob.getString("mimeType"))
            .put("path", path)
            .put("uri", "file://" + path);
    }

    public JSONObject providerCredentials() throws JSONException {
        ensureRunning();
        JSONObject cluster = status();
        if (!"active".equals(cluster.optString("role"))) throw new IllegalStateException("HUB_NOT_ACTIVE");
        try {
            JSONObject secrets = secretStore.load();
            JSONObject credentials = secrets == null ? null : secrets.optJSONObject("providerCredentials");
            JSONObject config = database.firstDocumentPayload("ai_configs");
            if (credentials == null || credentials.optString("aiApiKey").isEmpty()) {
                throw new IllegalStateException("LOCAL_HUB_AI_KEY_UNAVAILABLE");
            }
            return new JSONObject()
                .put("baseUrl", config.optString("base_url", "https://api.openai.com/v1"))
                .put("model", config.optString("model", "gpt-5.4-mini"))
                .put("apiKey", credentials.getString("aiApiKey"));
        } catch (IllegalStateException error) {
            throw error;
        } catch (Exception error) {
            throw new IllegalStateException("LOCAL_HUB_CREDENTIAL_UNAVAILABLE", error);
        }
    }

    public JSONObject imageProviderCredentials() throws JSONException {
        ensureRunning();
        JSONObject cluster = status();
        if (!"active".equals(cluster.optString("role"))) throw new IllegalStateException("HUB_NOT_ACTIVE");
        try {
            JSONObject secrets = secretStore.load();
            JSONObject credentials = secrets == null ? null : secrets.optJSONObject("providerCredentials");
            JSONObject config = database.firstDocumentPayload("ai_image_configs");
            if (credentials == null || credentials.optString("imageApiKey").isEmpty()) {
                throw new IllegalStateException("LOCAL_HUB_IMAGE_KEY_UNAVAILABLE");
            }
            return new JSONObject()
                .put("baseUrl", config.optString("base_url", "https://api.openai.com/v1"))
                .put("model", config.optString("model", "gpt-image-1"))
                .put("apiKey", credentials.getString("imageApiKey"));
        } catch (IllegalStateException error) {
            throw error;
        } catch (Exception error) {
            throw new IllegalStateException("LOCAL_HUB_CREDENTIAL_UNAVAILABLE", error);
        }
    }

    public JSONObject storeMedia(JSONObject input) throws Exception {
        ensureRunning();
        String dataUrl = input.optString("dataUrl", "");
        int comma = dataUrl.indexOf(',');
        if (!dataUrl.startsWith("data:image/") || comma < 1 ||
            !dataUrl.substring(0, comma).endsWith(";base64")) {
            throw new IllegalStateException("LOCAL_HUB_MEDIA_INVALID");
        }
        String mimeType = dataUrl.substring(5, dataUrl.indexOf(';'));
        if (!mimeType.matches("image/(png|jpeg|webp|gif)")) {
            throw new IllegalStateException("LOCAL_HUB_MEDIA_INVALID");
        }
        byte[] bytes = Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT);
        if (bytes.length < 1 || bytes.length > 16 * 1024 * 1024) {
            throw new IllegalStateException("LOCAL_HUB_MEDIA_INVALID");
        }
        String mediaId = input.optString("mediaId", UUID.randomUUID().toString());
        String extension = "image/jpeg".equals(mimeType) ? "jpg" : mimeType.substring("image/".length());
        String hash = LocalHubDatabase.sha256(bytes);
        String path = blobStore.store(mediaId, bytes, hash);
        return database.registerLocalMedia(new JSONObject()
            .put("mediaId", mediaId)
            .put("mimeType", mimeType)
            .put("fileName", mediaId + "." + extension)
            .put("byteSize", bytes.length)
            .put("contentHash", hash)
            .put("localPath", path));
    }

    public synchronized JSONObject resumeReplication() throws JSONException {
        ensureRunning();
        JSONObject pending = database.pendingSwitchExchange();
        if (pending != null) {
            return "toPeer".equals(pending.optString("mode")) ? switchToPeer() : switchToLocal();
        }
        JSONObject state = status();
        if (!"stable".equals(state.optString("state"))) {
            return "active".equals(state.optString("role")) ? switchToPeer() : switchToLocal();
        }
        JSONObject current = state;
        JSONObject bootstrap = current.optJSONObject("bootstrap");
        if (bootstrap == null) {
            bootstrapStructure();
            current = status();
            bootstrap = current.optJSONObject("bootstrap");
        }
        if (bootstrap == null) throw new IllegalStateException("LOCAL_HUB_BOOTSTRAP_INCOMPLETE");
        if ("waiting_blobs".equals(bootstrap.optString("status"))) {
            bootstrapBlobs();
            current = status();
            bootstrap = current.optJSONObject("bootstrap");
        }
        if (bootstrap != null && "restored".equals(bootstrap.optString("status"))) {
            return finalizeBootstrap();
        }
        if (bootstrap == null || !"completed".equals(bootstrap.optString("status"))) {
            throw new IllegalStateException("LOCAL_HUB_BOOTSTRAP_INCOMPLETE");
        }
        return synchronize();
    }

    private void ensureRunning() {
        if (!running) throw new IllegalStateException("LOCAL_HUB_STOPPED");
    }

    private byte[] syncKey() {
        try {
            JSONObject secrets = secretStore.load();
            if (secrets == null) throw new IllegalStateException("LOCAL_HUB_CREDENTIAL_UNAVAILABLE");
            byte[] key = Base64.decode(secrets.optString("spaceSyncKey", ""), Base64.DEFAULT);
            if (key.length != 32) throw new IllegalStateException("LOCAL_HUB_CREDENTIAL_UNAVAILABLE");
            return key;
        } catch (IllegalStateException error) {
            throw error;
        } catch (Exception error) {
            throw new IllegalStateException("LOCAL_HUB_CREDENTIAL_UNAVAILABLE", error);
        }
    }
}
