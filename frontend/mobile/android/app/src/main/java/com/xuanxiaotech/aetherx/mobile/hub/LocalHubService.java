package com.xuanxiaotech.aetherx.mobile.hub;

import android.content.Context;
import android.os.Build;
import android.os.PowerManager;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import android.util.Base64;

import java.util.UUID;

public final class LocalHubService {
    public static final int DEFAULT_PORT = 4319;
    private static volatile LocalHubService instance;

    private final LocalHubDatabase database;
    private final Context appContext;
    private final LocalHubSecretStore secretStore;
    private final LocalHubBlobStore blobStore;
    private final LocalHubNetworkServer networkServer;
    private volatile boolean running;
    private volatile String syncState = "";
    private volatile String syncStage = "";
    private volatile String syncDirection = "";
    private volatile String syncMessage = "";
    private volatile int syncProgress;
    private volatile int syncApplied;
    private volatile int syncPushed;
    private volatile long syncStartedAt;
    private volatile long syncUpdatedAt;
    private volatile long syncCompletedAt;

    private LocalHubService(Context context) {
        appContext = context.getApplicationContext();
        database = new LocalHubDatabase(appContext);
        secretStore = new LocalHubSecretStore(appContext);
        blobStore = new LocalHubBlobStore(appContext);
        networkServer = new LocalHubNetworkServer(
            appContext,
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
        if (pending == null &&
            ("stable".equals(current.optString("state")) ||
             "forced_active".equals(current.optString("state")))) return current;
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
            .put("networkEndpoints", networkServer.endpoints())
            .put("peerEndpoints", database.peerEndpoints())
            .put("batteryOptimizationExempt", batteryOptimizationExempt())
            .put("synchronization", synchronizationStatus());
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

    public JSONObject synchronize() {
        ensureRunning();
        try {
            database.requireBootstrapCompleted();
            String direction = "active".equals(database.replicationConfig().optString("role")) ? "push" : "pull";
            beginSynchronization(direction);
            JSONObject result = new LocalHubPeerSync(
                database,
                secretStore,
                blobStore,
                this::updateSynchronization
            ).run();
            completeSynchronization(result);
            return result;
        } catch (IllegalStateException error) {
            failSynchronization(error);
            throw error;
        } catch (Exception error) {
            failSynchronization(error);
            throw new IllegalStateException("LOCAL_HUB_SYNC_FAILED", error);
        }
    }

    public JSONObject keepPeerAlive() {
        ensureRunning();
        try {
            database.requireBootstrapCompleted();
            return new LocalHubPeerSync(database, secretStore, blobStore).keepAlive();
        } catch (IllegalStateException error) {
            throw error;
        } catch (Exception error) {
            throw new IllegalStateException("LOCAL_HUB_KEEPALIVE_FAILED", error);
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

    public synchronized JSONObject createPeerSwitchPreflightProof() {
        ensureRunning();
        try {
            return new LocalHubPeerSync(database, secretStore, blobStore)
                .createSwitchPreflightProof();
        } catch (IllegalStateException error) {
            throw error;
        } catch (Exception error) {
            throw new IllegalStateException("LOCAL_HUB_SWITCH_PREFLIGHT_FAILED", error);
        }
    }

    public synchronized JSONObject applyPeerSwitchControl(JSONObject signedControl) {
        ensureRunning();
        try {
            return new LocalHubPeerSync(database, secretStore, blobStore)
                .applyPeerSwitchControl(signedControl);
        } catch (IllegalStateException error) {
            throw error;
        } catch (Exception error) {
            throw new IllegalStateException("LOCAL_HUB_SWITCH_CONTROL_FAILED", error);
        }
    }

    public synchronized JSONObject runPeerFinalSync(JSONObject input) {
        ensureRunning();
        try {
            beginSynchronization("pull");
            JSONObject result = new LocalHubPeerSync(
                database,
                secretStore,
                blobStore,
                this::updateSynchronization
            ).runPeerFinalSync(input);
            completeSynchronization(result);
            return result;
        } catch (IllegalStateException error) {
            failSynchronization(error);
            throw error;
        } catch (Exception error) {
            failSynchronization(error);
            throw new IllegalStateException("LOCAL_HUB_FINAL_SYNC_FAILED", error);
        }
    }

    public synchronized JSONObject forceTakeover() {
        ensureRunning();
        try {
            return new LocalHubPeerSync(database, secretStore, blobStore).forceTakeover();
        } catch (IllegalStateException error) {
            throw error;
        } catch (Exception error) {
            throw new IllegalStateException("LOCAL_HUB_FORCE_TAKEOVER_FAILED", error);
        }
    }

    public synchronized JSONObject recoverDivergence(JSONObject input) {
        ensureRunning();
        try {
            return new LocalHubPeerSync(database, secretStore, blobStore)
                .recoverDivergence(input);
        } catch (IllegalStateException error) {
            throw error;
        } catch (Exception error) {
            throw new IllegalStateException("LOCAL_HUB_DIVERGENCE_RECOVERY_FAILED", error);
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

    public JSONObject resumeReplication() throws JSONException {
        ensureRunning();
        JSONObject pending = database.pendingSwitchExchange();
        if (pending != null) {
            return "toPeer".equals(pending.optString("mode")) ? switchToPeer() : switchToLocal();
        }
        JSONObject state = status();
        if ("forced_active".equals(state.optString("state"))) return state;
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

    private synchronized void beginSynchronization(String direction) {
        long now = System.currentTimeMillis();
        syncState = "syncing";
        syncStage = "starting";
        syncDirection = direction;
        syncMessage = direction.equals("push") ? "正在把手机 Hub 的变更同步到电脑" : "正在把电脑 Hub 的变更同步到手机";
        syncProgress = 3;
        syncApplied = 0;
        syncPushed = 0;
        syncStartedAt = now;
        syncUpdatedAt = now;
        syncCompletedAt = 0;
    }

    private synchronized void updateSynchronization(String stage, int progress, String message) {
        syncState = "syncing";
        syncStage = stage;
        syncProgress = Math.max(0, Math.min(99, progress));
        syncMessage = message;
        syncUpdatedAt = System.currentTimeMillis();
    }

    private synchronized void completeSynchronization(JSONObject result) {
        long completedAt = result.optLong("completedAt", System.currentTimeMillis());
        syncState = "synced";
        syncStage = "completed";
        syncProgress = 100;
        syncDirection = result.optString("direction", syncDirection.isEmpty() ? "pull" : syncDirection);
        syncApplied = result.optInt("applied", 0);
        syncPushed = result.optInt("pushed", 0);
        int changed = syncApplied + syncPushed;
        syncMessage = changed > 0 ? "双 Hub 已同步 " + changed + " 项变更" : "电脑 Hub 与手机 Hub 已同步";
        syncUpdatedAt = completedAt;
        syncCompletedAt = completedAt;
    }

    private synchronized void failSynchronization(Exception error) {
        syncState = "error";
        syncStage = "error";
        syncMessage = error.getMessage() == null || error.getMessage().isEmpty()
            ? "双 Hub 同步失败，等待重试"
            : error.getMessage();
        syncUpdatedAt = System.currentTimeMillis();
    }

    private synchronized JSONObject synchronizationStatus() throws JSONException {
        if (syncState.isEmpty()) return database.lastSyncStatus();
        return new JSONObject()
            .put("state", syncState)
            .put("stage", syncStage)
            .put("progress", syncProgress)
            .put("direction", syncDirection)
            .put("message", syncMessage)
            .put("applied", syncApplied)
            .put("pushed", syncPushed)
            .put("startedAt", syncStartedAt > 0 ? syncStartedAt : JSONObject.NULL)
            .put("updatedAt", syncUpdatedAt > 0 ? syncUpdatedAt : JSONObject.NULL)
            .put("completedAt", syncCompletedAt > 0 ? syncCompletedAt : JSONObject.NULL);
    }

    private boolean batteryOptimizationExempt() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        PowerManager manager = (PowerManager) appContext.getSystemService(Context.POWER_SERVICE);
        return manager == null || manager.isIgnoringBatteryOptimizations(appContext.getPackageName());
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
