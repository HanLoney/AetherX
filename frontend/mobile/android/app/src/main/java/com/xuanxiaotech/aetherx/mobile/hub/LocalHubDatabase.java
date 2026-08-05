package com.xuanxiaotech.aetherx.mobile.hub;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.nio.charset.StandardCharsets;
import java.net.URL;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.List;
import java.util.UUID;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

public final class LocalHubDatabase extends SQLiteOpenHelper {
    public static final int PROTOCOL_VERSION = 1;
    public static final int NODE_SCHEMA_VERSION = 40;
    private static final String DATABASE_NAME = "aetherx-mobile-hub.db";
    private static final int DATABASE_VERSION = 3;

    public LocalHubDatabase(Context context) {
        super(context, DATABASE_NAME, null, DATABASE_VERSION);
        setWriteAheadLoggingEnabled(true);
    }

    @Override
    public void onConfigure(SQLiteDatabase db) {
        super.onConfigure(db);
        db.setForeignKeyConstraintsEnabled(true);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE hub_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
        db.execSQL("CREATE TABLE hub_cluster_state (" +
            "space_id TEXT PRIMARY KEY, local_node_id TEXT NOT NULL, active_node_id TEXT NOT NULL," +
            "epoch INTEGER NOT NULL, state TEXT NOT NULL, role TEXT NOT NULL," +
            "protocol_version INTEGER NOT NULL, schema_version INTEGER NOT NULL," +
            "transition_id TEXT NOT NULL DEFAULT '', transition_target_node_id TEXT NOT NULL DEFAULT ''," +
            "transition_started_at INTEGER, state_hash TEXT NOT NULL DEFAULT ''," +
            "control_signature TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL)");
        db.execSQL("CREATE TABLE hub_nodes (" +
            "id TEXT PRIMARY KEY, space_id TEXT NOT NULL, name TEXT NOT NULL, platform TEXT NOT NULL," +
            "status TEXT NOT NULL, role TEXT NOT NULL, last_seen_at INTEGER, payload_json TEXT NOT NULL)");
        db.execSQL("CREATE TABLE hub_endpoints (" +
            "space_id TEXT NOT NULL, node_id TEXT NOT NULL, transport TEXT NOT NULL, address TEXT NOT NULL," +
            "priority INTEGER NOT NULL, fingerprint TEXT NOT NULL, PRIMARY KEY(space_id,node_id,transport,address))");
        db.execSQL("CREATE TABLE hub_documents (" +
            "entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, version INTEGER NOT NULL," +
            "payload_json TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL," +
            "PRIMARY KEY(entity_type,entity_id))");
        db.execSQL("CREATE TABLE hub_operations (" +
            "operation_id TEXT PRIMARY KEY, space_id TEXT NOT NULL, origin_node_id TEXT NOT NULL," +
            "origin_sequence INTEGER NOT NULL, epoch INTEGER NOT NULL, entity_type TEXT NOT NULL," +
            "entity_id TEXT NOT NULL, operation TEXT NOT NULL, entity_version INTEGER NOT NULL," +
            "payload_json TEXT NOT NULL, payload_hash TEXT NOT NULL, previous_operation_hash TEXT NOT NULL," +
            "operation_hash TEXT NOT NULL, authentication_tag TEXT NOT NULL, created_at INTEGER NOT NULL," +
            "UNIQUE(space_id,origin_node_id,origin_sequence))");
        db.execSQL("CREATE TABLE hub_watermarks (" +
            "space_id TEXT NOT NULL, origin_node_id TEXT NOT NULL, contiguous_sequence INTEGER NOT NULL," +
            "operation_hash TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(space_id,origin_node_id))");
        db.execSQL("CREATE TABLE hub_idempotency (" +
            "request_id TEXT PRIMARY KEY, result_json TEXT NOT NULL, created_at INTEGER NOT NULL)");
        db.execSQL("CREATE TABLE hub_integrity (" +
            "id INTEGER PRIMARY KEY CHECK(id=1), snapshot_id TEXT NOT NULL, records_root TEXT NOT NULL," +
            "record_count INTEGER NOT NULL, verified_at INTEGER NOT NULL)");
        createBootstrapTables(db);
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        if (oldVersion < 2) createBootstrapTables(db);
        if (oldVersion < 3) {
            db.execSQL("ALTER TABLE hub_cluster_state ADD COLUMN transition_id TEXT NOT NULL DEFAULT ''");
            db.execSQL("ALTER TABLE hub_cluster_state ADD COLUMN transition_target_node_id TEXT NOT NULL DEFAULT ''");
            db.execSQL("ALTER TABLE hub_cluster_state ADD COLUMN transition_started_at INTEGER");
            db.execSQL("ALTER TABLE hub_cluster_state ADD COLUMN state_hash TEXT NOT NULL DEFAULT ''");
            db.execSQL("ALTER TABLE hub_cluster_state ADD COLUMN control_signature TEXT NOT NULL DEFAULT ''");
        }
    }

    private static void createBootstrapTables(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE IF NOT EXISTS hub_snapshots (" +
            "snapshot_id TEXT PRIMARY KEY, space_id TEXT NOT NULL, manifest_json TEXT NOT NULL," +
            "records_root TEXT NOT NULL, blobs_root TEXT NOT NULL, boundary_json TEXT NOT NULL," +
            "status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
        db.execSQL("CREATE TABLE IF NOT EXISTS hub_entity_versions (" +
            "entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, version INTEGER NOT NULL," +
            "updated_at INTEGER NOT NULL, PRIMARY KEY(entity_type,entity_id))");
        db.execSQL("CREATE TABLE IF NOT EXISTS hub_media_blobs (" +
            "media_id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL, mime_type TEXT NOT NULL," +
            "file_name TEXT NOT NULL, byte_size INTEGER NOT NULL, content_hash TEXT NOT NULL," +
            "received_bytes INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL," +
            "local_path TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL)");
    }

    public synchronized String getOrCreateNodeId() {
        String existing = meta("local_node_id");
        if (existing != null && !existing.isEmpty()) return existing;
        String nodeId = "android-" + UUID.randomUUID();
        putMeta("local_node_id", nodeId);
        return nodeId;
    }

    public synchronized JSONObject status(boolean running, int port) throws JSONException {
        SQLiteDatabase db = getReadableDatabase();
        JSONObject result = new JSONObject();
        result.put("running", running);
        result.put("port", port);
        result.put("transport", port > 0 ? "http+capacitor" : "capacitor");
        result.put("serverUrl", "capacitor://local-hub");
        result.put("nodeId", getOrCreateNodeId());
        result.put("protocolVersion", PROTOCOL_VERSION);
        result.put("schemaVersion", NODE_SCHEMA_VERSION);
        try (Cursor cursor = db.rawQuery("SELECT * FROM hub_cluster_state LIMIT 1", null)) {
            if (cursor.moveToFirst()) {
                result.put("configured", true);
                result.put("spaceId", cursor.getString(cursor.getColumnIndexOrThrow("space_id")));
                result.put("localNodeId", cursor.getString(cursor.getColumnIndexOrThrow("local_node_id")));
                result.put("activeNodeId", cursor.getString(cursor.getColumnIndexOrThrow("active_node_id")));
                result.put("epoch", cursor.getLong(cursor.getColumnIndexOrThrow("epoch")));
                result.put("state", cursor.getString(cursor.getColumnIndexOrThrow("state")));
                result.put("role", cursor.getString(cursor.getColumnIndexOrThrow("role")));
                result.put("transitionId", cursor.getString(cursor.getColumnIndexOrThrow("transition_id")));
                result.put("transitionTargetNodeId", cursor.getString(cursor.getColumnIndexOrThrow("transition_target_node_id")));
                int transitionStartedAt = cursor.getColumnIndexOrThrow("transition_started_at");
                result.put("transitionStartedAt", cursor.isNull(transitionStartedAt)
                    ? JSONObject.NULL
                    : cursor.getLong(transitionStartedAt));
            } else {
                result.put("configured", false);
                result.put("spaceId", "");
                result.put("localNodeId", getOrCreateNodeId());
                result.put("activeNodeId", "");
                result.put("epoch", 0);
                result.put("state", "unpaired");
                result.put("role", "unpaired");
                result.put("transitionId", "");
                result.put("transitionTargetNodeId", "");
                result.put("transitionStartedAt", JSONObject.NULL);
            }
        }
        result.put("documentCount", scalarLong(db, "SELECT COUNT(*) FROM hub_documents WHERE deleted=0"));
        result.put("operationCount", scalarLong(db, "SELECT COUNT(*) FROM hub_operations"));
        result.put("mediaCount", scalarLong(db, "SELECT COUNT(*) FROM hub_media_blobs WHERE status='verified'"));
        result.put("pendingMediaCount", scalarLong(db, "SELECT COUNT(*) FROM hub_media_blobs WHERE status<>'verified'"));
        result.put("mediaBytes", scalarLong(db, "SELECT COALESCE(SUM(received_bytes),0) FROM hub_media_blobs"));
        result.put("mediaTotalBytes", scalarLong(db, "SELECT COALESCE(SUM(byte_size),0) FROM hub_media_blobs"));
        try (Cursor cursor = db.rawQuery("SELECT snapshot_id,status,records_root,blobs_root FROM hub_snapshots ORDER BY updated_at DESC LIMIT 1", null)) {
            if (cursor.moveToFirst()) {
                result.put("bootstrap", new JSONObject()
                    .put("snapshotId", cursor.getString(0))
                    .put("status", cursor.getString(1))
                    .put("recordsRoot", cursor.getString(2))
                    .put("blobsRoot", cursor.getString(3)));
            } else {
                result.put("bootstrap", JSONObject.NULL);
            }
        }
        try (Cursor cursor = db.rawQuery("SELECT snapshot_id,records_root,record_count,verified_at FROM hub_integrity WHERE id=1", null)) {
            if (cursor.moveToFirst()) {
                JSONObject integrity = new JSONObject();
                integrity.put("snapshotId", cursor.getString(0));
                integrity.put("recordsRoot", cursor.getString(1));
                integrity.put("recordCount", cursor.getLong(2));
                integrity.put("verifiedAt", cursor.getLong(3));
                result.put("integrity", integrity);
            } else {
                result.put("integrity", JSONObject.NULL);
            }
        }
        return result;
    }

    public synchronized JSONObject configure(JSONObject input) throws JSONException {
        String spaceId = required(input, "spaceId");
        String localNodeId = input.optString("localNodeId", getOrCreateNodeId());
        String activeNodeId = required(input, "activeNodeId");
        long epoch = positive(input.optLong("epoch", 0), "epoch");
        String state = input.optString("state", "stable");
        String role = localNodeId.equals(activeNodeId) ? "active" : "standby";
        long now = System.currentTimeMillis();
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            if (scalarLong(db, "SELECT COUNT(*) FROM hub_snapshots WHERE status='completed'") == 0) {
                clearIncompleteReplica(db);
            }
            ContentValues cluster = new ContentValues();
            cluster.put("space_id", spaceId);
            cluster.put("local_node_id", localNodeId);
            cluster.put("active_node_id", activeNodeId);
            cluster.put("epoch", epoch);
            cluster.put("state", state);
            cluster.put("role", role);
            cluster.put("protocol_version", input.optInt("protocolVersion", PROTOCOL_VERSION));
            cluster.put("schema_version", input.optInt("schemaVersion", NODE_SCHEMA_VERSION));
            cluster.put("transition_id", input.optString("transitionId", ""));
            cluster.put("transition_target_node_id", input.optString("transitionTargetNodeId", ""));
            if (input.has("transitionStartedAt") && !input.isNull("transitionStartedAt")) {
                cluster.put("transition_started_at", input.optLong("transitionStartedAt"));
            } else {
                cluster.putNull("transition_started_at");
            }
            cluster.put("state_hash", input.optString("stateHash", ""));
            cluster.put("control_signature", input.optString("controlSignature", ""));
            cluster.put("updated_at", now);
            db.insertWithOnConflict("hub_cluster_state", null, cluster, SQLiteDatabase.CONFLICT_REPLACE);
            db.delete("hub_nodes", "space_id=?", new String[]{spaceId});
            JSONArray nodes = input.optJSONArray("nodes");
            if (nodes != null) {
                for (int index = 0; index < nodes.length(); index += 1) {
                    JSONObject node = nodes.getJSONObject(index);
                    ContentValues values = new ContentValues();
                    values.put("id", required(node, "id"));
                    values.put("space_id", spaceId);
                    values.put("name", node.optString("name", "AetherX Hub"));
                    values.put("platform", node.optString("platform", "unknown"));
                    values.put("status", node.optString("status", "online"));
                    values.put("role", node.optString("id").equals(activeNodeId) ? "active" : "standby");
                    if (!node.isNull("lastSeenAt")) values.put("last_seen_at", node.optLong("lastSeenAt"));
                    values.put("payload_json", canonical(node));
                    db.insertWithOnConflict("hub_nodes", null, values, SQLiteDatabase.CONFLICT_REPLACE);
                }
            }
            db.delete("hub_endpoints", "space_id=?", new String[]{spaceId});
            JSONArray endpoints = input.optJSONArray("endpoints");
            if (endpoints != null) {
                for (int index = 0; index < endpoints.length(); index += 1) {
                    JSONObject endpoint = endpoints.getJSONObject(index);
                    ContentValues values = new ContentValues();
                    values.put("space_id", spaceId);
                    values.put("node_id", required(endpoint, "nodeId"));
                    values.put("transport", required(endpoint, "transport"));
                    values.put("address", required(endpoint, "address"));
                    values.put("priority", endpoint.optInt("priority", 0));
                    values.put("fingerprint", endpoint.optString("certificateFingerprint", ""));
                    db.insertWithOnConflict("hub_endpoints", null, values, SQLiteDatabase.CONFLICT_REPLACE);
                }
            }
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
        return status(true, LocalHubService.DEFAULT_PORT);
    }

    public synchronized JSONObject updatePeerEndpoints(JSONArray endpoints) throws JSONException {
        if (endpoints == null || endpoints.length() == 0) {
            return status(true, LocalHubService.DEFAULT_PORT);
        }
        JSONObject config = replicationConfig();
        String spaceId = config.getString("spaceId");
        String peerNodeId = config.getString("peerNodeId");
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            db.delete("hub_endpoints", "space_id=? AND node_id=?", new String[]{spaceId, peerNodeId});
            for (int index = 0; index < Math.min(8, endpoints.length()); index += 1) {
                JSONObject endpoint = endpoints.getJSONObject(index);
                String transport = endpoint.optString("transport", "");
                String address = endpoint.optString("address", "");
                if (!validPeerEndpoint(transport, address)) continue;
                ContentValues values = new ContentValues();
                values.put("space_id", spaceId);
                values.put("node_id", peerNodeId);
                values.put("transport", transport);
                values.put("address", new URL(address).toString().replaceAll("/$", ""));
                values.put("priority", Math.max(-1000, Math.min(1000, endpoint.optInt("priority", 0))));
                values.put("fingerprint", endpoint.optString("certificateFingerprint", ""));
                db.insertWithOnConflict("hub_endpoints", null, values, SQLiteDatabase.CONFLICT_REPLACE);
            }
            long count = 0;
            try (Cursor cursor = db.rawQuery(
                "SELECT COUNT(*) FROM hub_endpoints WHERE space_id=? AND node_id=?",
                new String[]{spaceId, peerNodeId})) {
                if (cursor.moveToFirst()) count = cursor.getLong(0);
            }
            if (count == 0) throw new IllegalStateException("LOCAL_HUB_PEER_UNAVAILABLE");
            db.setTransactionSuccessful();
        } catch (JSONException error) {
            throw error;
        } catch (IllegalStateException error) {
            throw error;
        } catch (Exception error) {
            throw new IllegalStateException("LOCAL_HUB_ENDPOINT_INVALID", error);
        } finally {
            db.endTransaction();
        }
        return status(true, LocalHubService.DEFAULT_PORT);
    }

    private static boolean validPeerEndpoint(String transport, String address) {
        try {
            URL url = new URL(address);
            if ("anywhere".equals(transport)) return "https".equals(url.getProtocol());
            if ("development".equals(transport)) {
                return "http".equals(url.getProtocol()) &&
                    ("127.0.0.1".equals(url.getHost()) || "localhost".equalsIgnoreCase(url.getHost()));
            }
            return "lan".equals(transport) && "http".equals(url.getProtocol()) &&
                privateIpv4(url.getHost());
        } catch (Exception ignored) {
            return false;
        }
    }

    private static boolean privateIpv4(String value) {
        String[] parts = String.valueOf(value).split("\\.");
        if (parts.length != 4) return false;
        try {
            int first = Integer.parseInt(parts[0]);
            int second = Integer.parseInt(parts[1]);
            for (String part : parts) {
                int number = Integer.parseInt(part);
                if (number < 0 || number > 255) return false;
            }
            return first == 10 || (first == 172 && second >= 16 && second <= 31) ||
                (first == 192 && second == 168);
        } catch (NumberFormatException ignored) {
            return false;
        }
    }


    public synchronized JSONObject importSnapshot(JSONObject input, byte[] syncKey) throws JSONException {
        String snapshotId = required(input, "snapshotId");
        String spaceId = required(input, "spaceId");
        JSONObject tables = input.optJSONObject("tables");
        if (tables == null) throw new JSONException("tables is required");
        JSONObject manifest = input.optJSONObject("manifest");
        if (manifest == null) throw new JSONException("manifest is required");
        JSONObject account = input.optJSONObject("account");
        JSONObject credentials = input.optJSONObject("credentials");
        JSONArray media = input.optJSONArray("media");
        JSONObject replication = input.optJSONObject("replication");
        if (account == null || credentials == null || media == null || replication == null) {
            throw new JSONException("complete snapshot metadata is required");
        }
        SQLiteDatabase db = getWritableDatabase();
        long now = System.currentTimeMillis();
        int count = 0;
        db.beginTransaction();
        try {
            db.delete("hub_documents", null, null);
            db.delete("hub_operations", null, null);
            db.delete("hub_watermarks", null, null);
            db.delete("hub_entity_versions", null, null);
            db.delete("hub_media_blobs", null, null);
            db.delete("hub_snapshots", null, null);
            List<String> tableNames = sortedKeys(tables);
            for (String table : tableNames) {
                JSONArray rows = tables.optJSONArray(table);
                if (rows == null) continue;
                for (int index = 0; index < rows.length(); index += 1) {
                    JSONObject row = rows.getJSONObject(index);
                    String payload = canonical(row);
                    String entityId = snapshotEntityId(table, row, payload);
                    ContentValues values = new ContentValues();
                    values.put("entity_type", table);
                    values.put("entity_id", entityId);
                    values.put("version", Math.max(1, row.optLong("entity_version", 1)));
                    values.put("payload_json", payload);
                    values.put("deleted", 0);
                    values.put("updated_at", now);
                    db.insertWithOnConflict("hub_documents", null, values, SQLiteDatabase.CONFLICT_REPLACE);
                    count += 1;
                }
            }
            writeSnapshotSingleton(db, "$account", account, now);
            putMeta(db, "credentials_leaf_hash", sha256(canonical(credentials)));
            count += 2;

            JSONArray operations = replication.optJSONArray("operations");
            if (operations == null) operations = new JSONArray();
            for (int index = 0; index < operations.length(); index += 1) {
                JSONObject operation = operations.getJSONObject(index);
                validateOperation(db, operation, syncKey, spaceId, manifest.optLong("epoch", -1));
                writeOperation(db, operation);
                writeWatermark(
                    db,
                    required(operation, "spaceId"),
                    required(operation, "originNodeId"),
                    operation.getLong("originSequence"),
                    required(operation, "operationHash"),
                    operation.optLong("createdAt", now)
                );
            }
            JSONArray versions = replication.optJSONArray("entityVersions");
            if (versions == null) versions = new JSONArray();
            for (int index = 0; index < versions.length(); index += 1) {
                JSONObject version = versions.getJSONObject(index);
                ContentValues values = new ContentValues();
                values.put("entity_type", required(version, "entityType"));
                values.put("entity_id", required(version, "entityId"));
                values.put("version", positive(version.optLong("version", 0), "version"));
                values.put("updated_at", Math.max(0, version.optLong("updatedAt", now)));
                db.insertWithOnConflict("hub_entity_versions", null, values, SQLiteDatabase.CONFLICT_REPLACE);
            }
            for (int index = 0; index < media.length(); index += 1) {
                JSONObject item = media.getJSONObject(index);
                ContentValues values = new ContentValues();
                values.put("media_id", required(item, "id"));
                values.put("snapshot_id", snapshotId);
                values.put("mime_type", required(item, "mimeType"));
                values.put("file_name", required(item, "fileName"));
                values.put("byte_size", Math.max(0, item.optLong("byteSize", -1)));
                values.put("content_hash", required(item, "contentHash").toLowerCase());
                values.put("received_bytes", 0);
                values.put("status", "pending");
                values.put("local_path", "");
                values.put("updated_at", now);
                db.insertOrThrow("hub_media_blobs", null, values);
            }

            String root = computeSnapshotRecordsRoot(db, manifest);
            String blobsRoot = computeBlobsRoot(db);
            if (!root.equals(manifest.optString("recordsRoot", "")) ||
                !blobsRoot.equals(manifest.optString("blobsRoot", ""))) {
                throw new IllegalStateException("LOCAL_HUB_SNAPSHOT_INTEGRITY_INVALID");
            }
            ContentValues integrity = new ContentValues();
            integrity.put("id", 1);
            integrity.put("snapshot_id", snapshotId);
            integrity.put("records_root", root);
            integrity.put("record_count", count);
            integrity.put("verified_at", now);
            db.insertWithOnConflict("hub_integrity", null, integrity, SQLiteDatabase.CONFLICT_REPLACE);
            ContentValues snapshot = new ContentValues();
            snapshot.put("snapshot_id", snapshotId);
            snapshot.put("space_id", spaceId);
            snapshot.put("manifest_json", canonical(manifest));
            snapshot.put("records_root", root);
            snapshot.put("blobs_root", blobsRoot);
            snapshot.put("boundary_json", canonical(manifest.optJSONObject("boundary") == null
                ? new JSONObject()
                : manifest.getJSONObject("boundary")));
            snapshot.put("status", media.length() == 0 ? "restored" : "waiting_blobs");
            snapshot.put("created_at", manifest.optLong("createdAt", now));
            snapshot.put("updated_at", now);
            db.insertOrThrow("hub_snapshots", null, snapshot);
            putMeta(db, "snapshot_space_id", spaceId);
            putMeta(db, "last_snapshot_id", snapshotId);
            db.setTransactionSuccessful();
            return new JSONObject()
                .put("imported", true)
                .put("snapshotId", snapshotId)
                .put("spaceId", spaceId)
                .put("recordCount", count)
                .put("recordsRoot", root)
                .put("blobsRoot", blobsRoot)
                .put("mediaCount", media.length());
        } finally {
            db.endTransaction();
        }
    }

    public synchronized JSONObject mutateDocument(JSONObject input, byte[] syncKey) throws JSONException {
        SQLiteDatabase db = getWritableDatabase();
        JSONObject cluster = clusterState(db);
        if (!"active".equals(cluster.optString("role")) || !"stable".equals(cluster.optString("state"))) {
            throw new IllegalStateException("HUB_NOT_ACTIVE");
        }
        String requestId = required(input, "requestId");
        try (Cursor existing = db.rawQuery("SELECT result_json FROM hub_idempotency WHERE request_id=?", new String[]{requestId})) {
            if (existing.moveToFirst()) return new JSONObject(existing.getString(0));
        }
        String entityType = required(input, "entityType");
        String entityId = required(input, "entityId");
        String operation = input.optString("operation", "upsert");
        JSONObject payload = input.optJSONObject("payload");
        if (payload == null) payload = new JSONObject();
        JSONObject documentPayload = input.optJSONObject("documentPayload");
        if (documentPayload == null) documentPayload = payload;
        String payloadJson = canonical(payload);
        String documentPayloadJson = canonical(normalizeReplicatedDocument(
            entityType,
            documentPayload,
            currentDocumentPayload(db, entityType, entityId)
        ));
        long now = System.currentTimeMillis();
        String spaceId = cluster.getString("spaceId");
        String nodeId = cluster.getString("localNodeId");
        long epoch = cluster.getLong("epoch");
        long sequence = nextSequence(db, spaceId, nodeId);
        String previousHash = watermarkHash(db, spaceId, nodeId);
        long previousVersion = currentEntityVersion(db, entityType, entityId);
        long version = previousVersion + 1;
        String payloadHash = sha256(payloadJson);
        String operationId = UUID.randomUUID().toString();
        JSONObject result = new JSONObject()
            .put("protocolVersion", PROTOCOL_VERSION)
            .put("operationId", operationId)
            .put("spaceId", spaceId)
            .put("originNodeId", nodeId)
            .put("originSequence", sequence)
            .put("epoch", epoch)
            .put("entityType", entityType)
            .put("entityId", entityId)
            .put("operation", operation)
            .put("entityVersion", version)
            .put("previousEntityVersion", previousVersion > 0 ? previousVersion : JSONObject.NULL)
            .put("payload", payload)
            .put("payloadHash", payloadHash)
            .put("previousOperationHash", previousHash)
            .put("createdAt", now);
        String operationHash = sha256(canonical(operationHashMaterial(result)));
        result.put("operationHash", operationHash);
        result.put("authenticationTag", hmacSha256(syncKey, operationHash));
        db.beginTransaction();
        try {
            writeOperation(db, result);
            writeDocument(db, entityType, entityId, version, documentPayloadJson, "delete".equals(operation), now);
            writeEntityVersion(db, entityType, entityId, version, now);
            writeWatermark(db, spaceId, nodeId, sequence, operationHash, now);
            ContentValues idempotency = new ContentValues();
            idempotency.put("request_id", requestId);
            idempotency.put("result_json", canonical(result));
            idempotency.put("created_at", now);
            db.insertOrThrow("hub_idempotency", null, idempotency);
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
        return result;
    }

    public synchronized JSONObject mutateDocuments(JSONObject input, byte[] syncKey) throws JSONException {
        SQLiteDatabase db = getWritableDatabase();
        JSONObject cluster = clusterState(db);
        if (!"active".equals(cluster.optString("role")) || !"stable".equals(cluster.optString("state"))) {
            throw new IllegalStateException("HUB_NOT_ACTIVE");
        }
        String requestId = required(input, "requestId");
        try (Cursor existing = db.rawQuery(
            "SELECT result_json FROM hub_idempotency WHERE request_id=?",
            new String[]{requestId})) {
            if (existing.moveToFirst()) return new JSONObject(existing.getString(0));
        }
        JSONArray mutations = input.optJSONArray("mutations");
        if (mutations == null || mutations.length() < 1 || mutations.length() > 100) {
            throw new IllegalStateException("LOCAL_HUB_INPUT_INVALID");
        }
        String spaceId = cluster.getString("spaceId");
        String nodeId = cluster.getString("localNodeId");
        long epoch = cluster.getLong("epoch");
        JSONArray operations = new JSONArray();
        long now = System.currentTimeMillis();
        db.beginTransaction();
        try {
            for (int index = 0; index < mutations.length(); index += 1) {
                JSONObject mutation = mutations.getJSONObject(index);
                String entityType = required(mutation, "entityType");
                String entityId = required(mutation, "entityId");
                String operation = mutation.optString("operation", "upsert");
                JSONObject payload = mutation.optJSONObject("payload");
                if (payload == null) payload = new JSONObject();
                JSONObject documentPayload = mutation.optJSONObject("documentPayload");
                if (documentPayload == null) documentPayload = payload;
                long sequence = nextSequence(db, spaceId, nodeId);
                String previousHash = watermarkHash(db, spaceId, nodeId);
                long previousVersion = currentEntityVersion(db, entityType, entityId);
                long version = previousVersion + 1;
                JSONObject replicated = new JSONObject()
                    .put("protocolVersion", PROTOCOL_VERSION)
                    .put("operationId", UUID.randomUUID().toString())
                    .put("spaceId", spaceId)
                    .put("originNodeId", nodeId)
                    .put("originSequence", sequence)
                    .put("epoch", epoch)
                    .put("entityType", entityType)
                    .put("entityId", entityId)
                    .put("operation", operation)
                    .put("entityVersion", version)
                    .put("previousEntityVersion", previousVersion > 0 ? previousVersion : JSONObject.NULL)
                    .put("payload", payload)
                    .put("payloadHash", sha256(canonical(payload)))
                    .put("previousOperationHash", previousHash)
                    .put("createdAt", now + index);
                String operationHash = sha256(canonical(operationHashMaterial(replicated)));
                replicated.put("operationHash", operationHash);
                replicated.put("authenticationTag", hmacSha256(syncKey, operationHash));
                writeOperation(db, replicated);
                JSONObject normalizedDocument = normalizeReplicatedDocument(
                    entityType,
                    documentPayload,
                    currentDocumentPayload(db, entityType, entityId)
                );
                writeDocument(
                    db,
                    entityType,
                    entityId,
                    version,
                    canonical(normalizedDocument),
                    "delete".equals(operation),
                    now + index
                );
                writeEntityVersion(db, entityType, entityId, version, now + index);
                writeWatermark(db, spaceId, nodeId, sequence, operationHash, now + index);
                operations.put(replicated);
            }
            JSONObject result = new JSONObject().put("operations", operations);
            ContentValues idempotency = new ContentValues();
            idempotency.put("request_id", requestId);
            idempotency.put("result_json", canonical(result));
            idempotency.put("created_at", now);
            db.insertOrThrow("hub_idempotency", null, idempotency);
            db.setTransactionSuccessful();
            return result;
        } finally {
            db.endTransaction();
        }
    }

    public synchronized JSONObject applyOperations(JSONArray operations, byte[] syncKey) throws JSONException {
        SQLiteDatabase db = getWritableDatabase();
        int applied = 0;
        db.beginTransaction();
        try {
            for (int index = 0; index < operations.length(); index += 1) {
                JSONObject operation = operations.getJSONObject(index);
                String operationId = required(operation, "operationId");
                if (exists(db, "SELECT 1 FROM hub_operations WHERE operation_id=?", operationId)) continue;
                String spaceId = required(operation, "spaceId");
                String originNodeId = required(operation, "originNodeId");
                long sequence = positive(operation.optLong("originSequence", 0), "originSequence");
                validateOperation(db, operation, syncKey, spaceId, clusterState(db).getLong("epoch"));
                JSONObject payload = operation.optJSONObject("payload");
                if (payload == null) payload = new JSONObject();
                String entityType = required(operation, "entityType");
                String entityId = required(operation, "entityId");
                long version = positive(operation.optLong("entityVersion", 0), "entityVersion");
                long currentVersion = currentEntityVersion(db, entityType, entityId);
                Object previousValue = operation.opt("previousEntityVersion");
                long previousVersion = previousValue == null || previousValue == JSONObject.NULL
                    ? 0
                    : ((Number) previousValue).longValue();
                if (previousVersion != currentVersion || version != currentVersion + 1) {
                    throw new IllegalStateException("HUB_OPERATION_ENTITY_VERSION_CONFLICT");
                }
                JSONObject documentPayload = normalizeReplicatedDocument(
                    entityType,
                    payload,
                    currentDocumentPayload(db, entityType, entityId)
                );
                writeOperation(db, operation);
                writeDocument(db, entityType, entityId, version, canonical(documentPayload),
                    "delete".equals(operation.optString("operation")), operation.optLong("createdAt", System.currentTimeMillis()));
                writeEntityVersion(
                    db,
                    entityType,
                    entityId,
                    version,
                    operation.optLong("createdAt", System.currentTimeMillis())
                );
                writeWatermark(db, spaceId, originNodeId, sequence,
                    required(operation, "operationHash"), System.currentTimeMillis());
                applied += 1;
            }
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
        return new JSONObject().put("applied", applied).put("received", operations.length());
    }

    public synchronized JSONArray listDocuments(
        String entityType,
        boolean includeDeleted,
        String payloadField,
        String payloadValue
    ) throws JSONException {
        SQLiteDatabase db = getReadableDatabase();
        String sql = "SELECT entity_id,version,payload_json,deleted,updated_at FROM hub_documents WHERE entity_type=?" +
            (includeDeleted ? "" : " AND deleted=0") + " ORDER BY updated_at DESC,entity_id";
        JSONArray result = new JSONArray();
        try (Cursor cursor = db.rawQuery(sql, new String[]{entityType})) {
            while (cursor.moveToNext()) {
                JSONObject payload = new JSONObject(cursor.getString(2));
                if (!payloadField.isEmpty() && !payloadValue.equals(payload.optString(payloadField, ""))) {
                    continue;
                }
                result.put(new JSONObject()
                    .put("entityId", cursor.getString(0))
                    .put("version", cursor.getLong(1))
                    .put("payload", payload)
                    .put("deleted", cursor.getInt(3) != 0)
                    .put("updatedAt", cursor.getLong(4)));
            }
        }
        return result;
    }

    public synchronized JSONObject firstDocumentPayload(String entityType) throws JSONException {
        try (Cursor cursor = getReadableDatabase().rawQuery(
            "SELECT payload_json FROM hub_documents WHERE entity_type=? AND deleted=0 ORDER BY updated_at DESC LIMIT 1",
            new String[]{entityType})) {
            return cursor.moveToFirst() ? new JSONObject(cursor.getString(0)) : new JSONObject();
        }
    }

    public synchronized JSONObject verifyIntegrity() throws JSONException {
        SQLiteDatabase db = getWritableDatabase();
        String root;
        try (Cursor cursor = db.rawQuery("SELECT manifest_json FROM hub_snapshots ORDER BY updated_at DESC LIMIT 1", null)) {
            if (!cursor.moveToFirst()) throw new IllegalStateException("LOCAL_HUB_BOOTSTRAP_INCOMPLETE");
            root = computeSnapshotRecordsRoot(db, new JSONObject(cursor.getString(0)));
        }
        requireBootstrapCompleted(db);
        long count = scalarLong(db, "SELECT COUNT(*) FROM hub_documents WHERE deleted=0");
        long now = System.currentTimeMillis();
        ContentValues values = new ContentValues();
        values.put("id", 1);
        values.put("snapshot_id", meta("last_snapshot_id") == null ? "local" : meta("last_snapshot_id"));
        values.put("records_root", root);
        values.put("record_count", count);
        values.put("verified_at", now);
        db.insertWithOnConflict("hub_integrity", null, values, SQLiteDatabase.CONFLICT_REPLACE);
        return new JSONObject().put("recordsRoot", root).put("recordCount", count).put("verifiedAt", now);
    }

    public synchronized void requireBootstrapCompleted() {
        requireBootstrapCompleted(getReadableDatabase());
    }

    public synchronized JSONObject createSwitchPreflightProof(boolean providerCredentialsReadable)
        throws JSONException {
        SQLiteDatabase db = getWritableDatabase();
        JSONObject cluster = clusterState(db);
        String state = cluster.getString("state");
        if (!"stable".equals(state) && !"final_sync".equals(state) && !"integrity_check".equals(state)) {
            throw new IllegalStateException("SWITCH_CLUSTER_NOT_STABLE");
        }
        reconcileNodeRoles(db, cluster.getString("activeNodeId"), System.currentTimeMillis());
        String recordsRoot;
        try (Cursor cursor = db.rawQuery(
            "SELECT manifest_json FROM hub_snapshots ORDER BY updated_at DESC LIMIT 1", null)) {
            recordsRoot = cursor.moveToFirst()
                ? computeSwitchRecordsRoot(db, new JSONObject(cursor.getString(0)))
                : computeRecordsRoot(db);
        }
        JSONObject operationHeads = operationHeads(db, cluster.getString("spaceId"));
        String nodeStatus = "standby";
        try (Cursor cursor = db.rawQuery(
            "SELECT status FROM hub_nodes WHERE id=? LIMIT 1",
            new String[]{cluster.getString("localNodeId")})) {
            if (cursor.moveToFirst()) nodeStatus = cursor.getString(0);
        }
        boolean databaseHealthy = false;
        try (Cursor cursor = db.rawQuery("PRAGMA quick_check", null)) {
            databaseHealthy = cursor.moveToFirst() && "ok".equalsIgnoreCase(cursor.getString(0));
        }
        return new JSONObject()
            .put("protocolVersion", PROTOCOL_VERSION)
            .put("schemaVersion", NODE_SCHEMA_VERSION)
            .put("spaceId", cluster.getString("spaceId"))
            .put("nodeId", cluster.getString("localNodeId"))
            .put("activeNodeId", cluster.getString("activeNodeId"))
            .put("epoch", cluster.getLong("epoch"))
            .put("clusterState", state)
            .put("role", cluster.getString("role"))
            .put("nodeStatus", nodeStatus)
            .put("databaseHealthy", databaseHealthy)
            .put("providerCredentialsReadable", providerCredentialsReadable)
            .put("agentIdle", true)
            .put("pendingMediaCount", scalarLong(db,
                "SELECT COUNT(*) FROM hub_media_blobs WHERE status<>'verified'"))
            .put("busyBootstrapCount", scalarLong(db,
                "SELECT COUNT(*) FROM hub_snapshots WHERE status<>'completed'"))
            .put("recordsRoot", recordsRoot)
            .put("blobsRoot", computeBlobsRoot(db))
            .put("operationHeads", operationHeads)
            .put("generatedAt", System.currentTimeMillis());
    }

    public synchronized JSONObject applySwitchControl(
        JSONObject signed,
        byte[] syncKey,
        boolean localInitiator
    )
        throws JSONException {
        JSONObject control = signed == null ? null : signed.optJSONObject("control");
        if (control == null) throw new IllegalStateException("SWITCH_CONTROL_INVALID");
        String receivedTag = signed.optString("authenticationTag", "").toLowerCase();
        String expectedTag = hmacCanonical(syncKey, control);
        if (!receivedTag.matches("^[a-f0-9]{64}$") || !receivedTag.equals(expectedTag)) {
            throw new IllegalStateException("SWITCH_CONTROL_INVALID");
        }
        long issuedAt = control.optLong("issuedAt", -1);
        if (issuedAt < 0 || Math.abs(System.currentTimeMillis() - issuedAt) > 30_000L) {
            throw new IllegalStateException("SWITCH_CONTROL_EXPIRED");
        }
        SQLiteDatabase db = getWritableDatabase();
        JSONObject cluster = clusterState(db);
        String localNodeId = cluster.getString("localNodeId");
        String action = required(control, "action");
        String targetNodeId = required(control, "targetNodeId");
        String activeNodeId = required(control, "activeNodeId");
        String transitionId = required(control, "transitionId");
        String nextState = required(control, "state");
        long nextEpoch = control.optLong("epoch", -1);
        boolean validActor = localInitiator
            ? localNodeId.equals(activeNodeId) && !localNodeId.equals(targetNodeId)
            : localNodeId.equals(targetNodeId) && !localNodeId.equals(activeNodeId);
        if (!cluster.getString("spaceId").equals(control.optString("spaceId")) ||
            !validActor ||
            !cluster.getString("activeNodeId").equals(activeNodeId) ||
            nextEpoch < 1) {
            throw new IllegalStateException("SWITCH_CONTROL_CONTEXT_MISMATCH");
        }
        assertSwitchTransition(cluster, control);

        JSONObject persisted = persistedSwitchState(control);
        String stateHash = sha256(canonical(persisted));
        long now = System.currentTimeMillis();
        db.beginTransaction();
        try {
            ContentValues values = new ContentValues();
            values.put("active_node_id", persisted.getString("activeNodeId"));
            values.put("epoch", persisted.getLong("epoch"));
            values.put("state", persisted.getString("state"));
            values.put("role", localNodeId.equals(persisted.getString("activeNodeId")) ? "active" : "standby");
            values.put("transition_id", persisted.getString("transitionId"));
            values.put("transition_target_node_id", persisted.getString("transitionTargetNodeId"));
            if (persisted.isNull("transitionStartedAt")) values.putNull("transition_started_at");
            else values.put("transition_started_at", persisted.getLong("transitionStartedAt"));
            values.put("state_hash", stateHash);
            values.put("control_signature", receivedTag);
            values.put("updated_at", now);
            db.update("hub_cluster_state", values, "space_id=?",
                new String[]{cluster.getString("spaceId")});
            if ("commit".equals(action)) {
                reconcileNodeRoles(db, persisted.getString("activeNodeId"), now);
            }
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
        JSONObject ack = new JSONObject()
            .put("version", 1)
            .put("controlHash", sha256(canonical(control)))
            .put("nodeId", localNodeId)
            .put("state", persisted.getString("state"))
            .put("epoch", persisted.getLong("epoch"))
            .put("stateHash", stateHash)
            .put("appliedAt", now);
        return new JSONObject()
            .put("ack", ack)
            .put("authenticationTag", hmacCanonical(syncKey, ack));
    }

    public synchronized JSONObject pendingSwitchExchange() throws JSONException {
        String value = meta("pending_switch_exchange");
        return value == null || value.isEmpty() ? null : new JSONObject(value);
    }

    public synchronized void savePendingSwitchExchange(JSONObject exchange) {
        putMeta("pending_switch_exchange", exchange.toString());
    }

    public synchronized void clearPendingSwitchExchange() {
        getWritableDatabase().delete("hub_meta", "key=?", new String[]{"pending_switch_exchange"});
    }

    public synchronized JSONObject replicationConfig() throws JSONException {
        SQLiteDatabase db = getReadableDatabase();
        JSONObject cluster = clusterState(db);
        String spaceId = cluster.getString("spaceId");
        String localNodeId = cluster.getString("localNodeId");
        String peerNodeId = "";
        try (Cursor cursor = db.rawQuery(
            "SELECT id FROM hub_nodes WHERE space_id=? AND id<>? AND status<>'revoked' ORDER BY role='active' DESC,last_seen_at DESC LIMIT 1",
            new String[]{spaceId, localNodeId})) {
            if (cursor.moveToFirst()) peerNodeId = cursor.getString(0);
        }
        if (peerNodeId.isEmpty()) throw new IllegalStateException("LOCAL_HUB_PEER_UNAVAILABLE");
        JSONArray endpoints = new JSONArray();
        try (Cursor cursor = db.rawQuery(
            "SELECT transport,address,priority,fingerprint FROM hub_endpoints WHERE space_id=? AND node_id=? ORDER BY priority DESC",
            new String[]{spaceId, peerNodeId})) {
            while (cursor.moveToNext()) {
                endpoints.put(new JSONObject()
                    .put("transport", cursor.getString(0))
                    .put("address", cursor.getString(1))
                    .put("priority", cursor.getInt(2))
                    .put("certificateFingerprint", cursor.getString(3)));
            }
        }
        if (endpoints.length() == 0) throw new IllegalStateException("LOCAL_HUB_PEER_UNAVAILABLE");
        long after = 0;
        String operationHash = "";
        try (Cursor cursor = db.rawQuery(
            "SELECT contiguous_sequence,operation_hash FROM hub_watermarks WHERE space_id=? AND origin_node_id=?",
            new String[]{spaceId, peerNodeId})) {
            if (cursor.moveToFirst()) {
                after = cursor.getLong(0);
                operationHash = cursor.getString(1);
            }
        }
        return cluster
            .put("peerNodeId", peerNodeId)
            .put("endpoints", endpoints)
            .put("after", after)
            .put("operationHash", operationHash);
    }

    public synchronized JSONArray listOperationsAfter(String originNodeId, long after, int limit)
        throws JSONException {
        JSONArray result = new JSONArray();
        try (Cursor cursor = getReadableDatabase().rawQuery(
            "SELECT operation_id,space_id,origin_node_id,origin_sequence,epoch,entity_type," +
                "entity_id,operation,entity_version,payload_json,payload_hash," +
                "previous_operation_hash,operation_hash,authentication_tag,created_at " +
                "FROM hub_operations WHERE origin_node_id=? AND origin_sequence>? " +
                "ORDER BY origin_sequence LIMIT ?",
            new String[]{originNodeId, String.valueOf(after), String.valueOf(Math.max(1, Math.min(limit, 200))) })) {
            while (cursor.moveToNext()) {
                long entityVersion = cursor.getLong(8);
                result.put(new JSONObject()
                    .put("protocolVersion", PROTOCOL_VERSION)
                    .put("operationId", cursor.getString(0))
                    .put("spaceId", cursor.getString(1))
                    .put("originNodeId", cursor.getString(2))
                    .put("originSequence", cursor.getLong(3))
                    .put("epoch", cursor.getLong(4))
                    .put("entityType", cursor.getString(5))
                    .put("entityId", cursor.getString(6))
                    .put("operation", cursor.getString(7))
                    .put("entityVersion", entityVersion)
                    .put("previousEntityVersion", entityVersion <= 1 ? JSONObject.NULL : entityVersion - 1)
                    .put("payload", new JSONObject(cursor.getString(9)))
                    .put("payloadHash", cursor.getString(10))
                    .put("previousOperationHash", cursor.getString(11))
                    .put("operationHash", cursor.getString(12))
                    .put("authenticationTag", cursor.getString(13))
                    .put("createdAt", cursor.getLong(14)));
            }
        }
        return result;
    }

    public synchronized JSONObject operationHead(String originNodeId) throws JSONException {
        String normalizedOrigin = String.valueOf(originNodeId == null ? "" : originNodeId).trim();
        if (normalizedOrigin.isEmpty()) throw new IllegalArgumentException("originNodeId is required");
        SQLiteDatabase db = getReadableDatabase();
        String spaceId = clusterState(db).getString("spaceId");
        long originSequence = 0;
        String operationHash = "";
        try (Cursor cursor = db.rawQuery(
            "SELECT origin_sequence,operation_hash FROM hub_operations " +
                "WHERE space_id=? AND origin_node_id=? ORDER BY origin_sequence DESC LIMIT 1",
            new String[]{spaceId, normalizedOrigin})) {
            if (cursor.moveToFirst()) {
                originSequence = cursor.getLong(0);
                operationHash = cursor.getString(1);
            }
        }
        return new JSONObject()
            .put("originNodeId", normalizedOrigin)
            .put("originSequence", originSequence)
            .put("operationHash", operationHash);
    }

    public synchronized void recordSyncResult(JSONObject result) {
        putMeta("last_sync_result", result.toString());
        putMeta("last_sync_at", String.valueOf(System.currentTimeMillis()));
    }

    public synchronized JSONArray pendingBootstrapBlobs() throws JSONException {
        JSONArray result = new JSONArray();
        try (Cursor cursor = getReadableDatabase().rawQuery(
            "SELECT media_id,snapshot_id,mime_type,file_name,byte_size,content_hash,received_bytes,status,local_path " +
                "FROM hub_media_blobs WHERE status<>'verified' AND snapshot_id<>'incremental' ORDER BY media_id", null)) {
            while (cursor.moveToNext()) result.put(blobFromCursor(cursor));
        }
        return result;
    }

    public synchronized JSONArray pendingIncrementalBlobs() throws JSONException {
        JSONArray result = new JSONArray();
        try (Cursor cursor = getReadableDatabase().rawQuery(
            "SELECT media_id,snapshot_id,mime_type,file_name,byte_size,content_hash,received_bytes,status,local_path " +
                "FROM hub_media_blobs WHERE status<>'verified' AND snapshot_id='incremental' ORDER BY media_id", null)) {
            while (cursor.moveToNext()) result.put(blobFromCursor(cursor));
        }
        return result;
    }

    public synchronized JSONArray mergeMediaManifest(JSONArray items) throws JSONException {
        SQLiteDatabase db = getWritableDatabase();
        JSONArray reset = new JSONArray();
        long now = System.currentTimeMillis();
        db.beginTransaction();
        try {
            for (int index = 0; index < items.length(); index += 1) {
                JSONObject item = items.getJSONObject(index);
                String mediaId = required(item, "id");
                String contentHash = required(item, "contentHash").toLowerCase();
                long byteSize = Math.max(0, item.optLong("byteSize", -1));
                JSONObject existing = findMediaBlob(mediaId);
                boolean changed = existing != null && (
                    !contentHash.equals(existing.optString("contentHash")) ||
                    byteSize != existing.optLong("byteSize")
                );
                if (changed) reset.put(mediaId);
                if (existing != null && !changed) continue;
                ContentValues values = new ContentValues();
                values.put("media_id", mediaId);
                values.put("snapshot_id", "incremental");
                values.put("mime_type", required(item, "mimeType"));
                values.put("file_name", required(item, "fileName"));
                values.put("byte_size", byteSize);
                values.put("content_hash", contentHash);
                values.put("received_bytes", 0);
                values.put("status", "pending");
                values.put("local_path", "");
                values.put("updated_at", now);
                db.insertWithOnConflict("hub_media_blobs", null, values, SQLiteDatabase.CONFLICT_REPLACE);
                JSONObject document = new JSONObject()
                    .put("id", mediaId)
                    .put("user_id", "__CURRENT_USER__")
                    .put("mime_type", required(item, "mimeType"))
                    .put("file_name", required(item, "fileName"))
                    .put("byte_size", byteSize)
                    .put("content_hash", contentHash)
                    .put("preview_file_name", "")
                    .put("preview_byte_size", 0)
                    .put("created_at", Math.max(0, item.optLong("createdAt", now)));
                writeDocument(
                    db,
                    "media_assets",
                    mediaId,
                    Math.max(1, currentEntityVersion(db, "media_assets", mediaId) + 1),
                    canonical(document),
                    false,
                    now
                );
            }
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
        return reset;
    }

    public synchronized JSONObject findMediaBlob(String mediaId) throws JSONException {
        try (Cursor cursor = getReadableDatabase().rawQuery(
            "SELECT media_id,snapshot_id,mime_type,file_name,byte_size,content_hash,received_bytes,status,local_path " +
                "FROM hub_media_blobs WHERE media_id=?",
            new String[]{mediaId})) {
            return cursor.moveToFirst() ? blobFromCursor(cursor) : null;
        }
    }

    public synchronized JSONArray verifiedMediaBlobs() throws JSONException {
        JSONArray result = new JSONArray();
        try (Cursor cursor = getReadableDatabase().rawQuery(
            "SELECT media_id,snapshot_id,mime_type,file_name,byte_size,content_hash," +
                "received_bytes,status,local_path FROM hub_media_blobs " +
                "WHERE status='verified' ORDER BY media_id", null)) {
            while (cursor.moveToNext()) {
                JSONObject blob = blobFromCursor(cursor);
                JSONObject media = currentDocumentPayload(
                    getReadableDatabase(),
                    "media_assets",
                    blob.getString("mediaId")
                );
                blob.put("createdAt", media.optLong("created_at", 0));
                result.put(blob);
            }
        }
        return result;
    }

    public synchronized JSONObject registerLocalMedia(JSONObject input) throws JSONException {
        String mediaId = required(input, "mediaId");
        ContentValues values = new ContentValues();
        values.put("media_id", mediaId);
        values.put("snapshot_id", "local");
        values.put("mime_type", required(input, "mimeType"));
        values.put("file_name", required(input, "fileName"));
        values.put("byte_size", input.getLong("byteSize"));
        values.put("content_hash", required(input, "contentHash"));
        values.put("received_bytes", input.getLong("byteSize"));
        values.put("status", "verified");
        values.put("local_path", required(input, "localPath"));
        values.put("updated_at", System.currentTimeMillis());
        getWritableDatabase().insertWithOnConflict(
            "hub_media_blobs", null, values, SQLiteDatabase.CONFLICT_REPLACE
        );
        return findMediaBlob(mediaId);
    }

    public synchronized void updateBlobProgress(String mediaId, long receivedBytes, String status, String localPath) {
        ContentValues values = new ContentValues();
        values.put("received_bytes", receivedBytes);
        values.put("status", status);
        values.put("local_path", localPath == null ? "" : localPath);
        values.put("updated_at", System.currentTimeMillis());
        getWritableDatabase().update("hub_media_blobs", values, "media_id=?", new String[]{mediaId});
        if (scalarLong(getReadableDatabase(), "SELECT COUNT(*) FROM hub_media_blobs WHERE status<>'verified'") == 0) {
            ContentValues snapshot = new ContentValues();
            snapshot.put("status", "restored");
            snapshot.put("updated_at", System.currentTimeMillis());
            getWritableDatabase().update("hub_snapshots", snapshot, "status='waiting_blobs'", null);
        }
    }

    public synchronized JSONObject createCompletionProof() throws JSONException {
        SQLiteDatabase db = getReadableDatabase();
        JSONObject cluster = clusterState(db);
        JSONObject snapshot;
        try (Cursor cursor = db.rawQuery(
            "SELECT snapshot_id,manifest_json,status FROM hub_snapshots ORDER BY updated_at DESC LIMIT 1", null)) {
            if (!cursor.moveToFirst()) throw new IllegalStateException("LOCAL_HUB_BOOTSTRAP_MISSING");
            snapshot = new JSONObject()
                .put("snapshotId", cursor.getString(0))
                .put("manifest", new JSONObject(cursor.getString(1)))
                .put("status", cursor.getString(2));
        }
        if (!"restored".equals(snapshot.getString("status")) && !"completed".equals(snapshot.getString("status"))) {
            throw new IllegalStateException("LOCAL_HUB_BOOTSTRAP_INCOMPLETE");
        }
        if (scalarLong(db, "SELECT COUNT(*) FROM hub_media_blobs WHERE status<>'verified'") > 0) {
            throw new IllegalStateException("LOCAL_HUB_BOOTSTRAP_INCOMPLETE");
        }
        JSONObject manifest = snapshot.getJSONObject("manifest");
        String recordsRoot = computeSnapshotRecordsRoot(db, manifest);
        String blobsRoot = computeBlobsRoot(db);
        if (!recordsRoot.equals(manifest.optString("recordsRoot")) ||
            !blobsRoot.equals(manifest.optString("blobsRoot"))) {
            throw new IllegalStateException("LOCAL_HUB_SNAPSHOT_INTEGRITY_INVALID");
        }
        JSONObject heads = new JSONObject();
        try (Cursor cursor = db.rawQuery(
            "SELECT origin_node_id,contiguous_sequence,operation_hash FROM hub_watermarks WHERE space_id=? ORDER BY origin_node_id",
            new String[]{cluster.getString("spaceId")})) {
            while (cursor.moveToNext()) {
                heads.put(cursor.getString(0), new JSONObject()
                    .put("sequence", cursor.getLong(1))
                    .put("operationHash", cursor.getString(2)));
            }
        }
        return new JSONObject()
            .put("snapshotId", snapshot.getString("snapshotId"))
            .put("spaceId", cluster.getString("spaceId"))
            .put("nodeId", cluster.getString("localNodeId"))
            .put("epoch", cluster.getLong("epoch"))
            .put("recordsRoot", recordsRoot)
            .put("blobsRoot", blobsRoot)
            .put("operationHeads", heads)
            .put("generatedAt", System.currentTimeMillis());
    }

    public synchronized void markBootstrapCompleted(JSONObject receipt) throws JSONException {
        SQLiteDatabase db = getWritableDatabase();
        String snapshotId = required(receipt, "snapshotId");
        JSONObject cluster = clusterState(db);
        if (!snapshotId.equals(meta("last_snapshot_id")) ||
            !cluster.getString("spaceId").equals(receipt.optString("spaceId")) ||
            !cluster.getString("localNodeId").equals(receipt.optString("nodeId")) ||
            cluster.getLong("epoch") != receipt.optLong("epoch")) {
            throw new IllegalStateException("LOCAL_HUB_BOOTSTRAP_RECEIPT_INVALID");
        }
        long now = System.currentTimeMillis();
        ContentValues snapshot = new ContentValues();
        snapshot.put("status", "completed");
        snapshot.put("updated_at", now);
        db.update("hub_snapshots", snapshot, "snapshot_id=?", new String[]{snapshotId});
        ContentValues node = new ContentValues();
        node.put("status", "standby");
        node.put("last_seen_at", now);
        db.update("hub_nodes", node, "id=?", new String[]{cluster.getString("localNodeId")});
    }

    private static JSONObject blobFromCursor(Cursor cursor) throws JSONException {
        return new JSONObject()
            .put("mediaId", cursor.getString(0))
            .put("snapshotId", cursor.getString(1))
            .put("mimeType", cursor.getString(2))
            .put("fileName", cursor.getString(3))
            .put("byteSize", cursor.getLong(4))
            .put("contentHash", cursor.getString(5))
            .put("receivedBytes", cursor.getLong(6))
            .put("status", cursor.getString(7))
            .put("localPath", cursor.getString(8));
    }

    private static JSONObject persistedSwitchState(JSONObject control) throws JSONException {
        String action = required(control, "action");
        if ("phase".equals(action)) {
            return new JSONObject()
                .put("spaceId", required(control, "spaceId"))
                .put("epoch", control.getLong("epoch"))
                .put("activeNodeId", required(control, "activeNodeId"))
                .put("transitionId", required(control, "transitionId"))
                .put("transitionTargetNodeId", required(control, "targetNodeId"))
                .put("transitionStartedAt", control.getLong("transitionStartedAt"))
                .put("state", required(control, "state"));
        }
        if ("abort".equals(action)) {
            return new JSONObject()
                .put("spaceId", required(control, "spaceId"))
                .put("epoch", control.getLong("epoch"))
                .put("activeNodeId", required(control, "activeNodeId"))
                .put("transitionId", "")
                .put("transitionTargetNodeId", "")
                .put("transitionStartedAt", JSONObject.NULL)
                .put("state", "stable");
        }
        if (!"commit".equals(action)) throw new IllegalStateException("SWITCH_CONTROL_INVALID");
        return new JSONObject()
            .put("spaceId", required(control, "spaceId"))
            .put("epoch", control.getLong("epoch"))
            .put("activeNodeId", required(control, "targetNodeId"))
            .put("transitionId", "")
            .put("transitionTargetNodeId", "")
            .put("transitionStartedAt", JSONObject.NULL)
            .put("state", "stable");
    }

    private static void assertSwitchTransition(JSONObject cluster, JSONObject control)
        throws JSONException {
        String action = required(control, "action");
        String currentState = cluster.getString("state");
        long currentEpoch = cluster.getLong("epoch");
        long controlEpoch = control.getLong("epoch");
        String transitionId = control.getString("transitionId");
        String currentTransitionId = cluster.optString("transitionId", "");
        if ("phase".equals(action)) {
            String next = control.getString("state");
            String previous;
            switch (next) {
                case "preparing_switch": previous = "stable"; break;
                case "draining": previous = "preparing_switch"; break;
                case "final_sync": previous = "draining"; break;
                case "integrity_check": previous = "final_sync"; break;
                case "committing_switch": previous = "integrity_check"; break;
                default: throw new IllegalStateException("SWITCH_CONTROL_INVALID");
            }
            boolean first = "preparing_switch".equals(next) && "stable".equals(currentState);
            boolean advance = previous.equals(currentState) &&
                (first || currentTransitionId.equals(transitionId));
            boolean retry = next.equals(currentState) && currentTransitionId.equals(transitionId);
            if (controlEpoch == currentEpoch && (advance || retry)) return;
            throw new IllegalStateException("SWITCH_STATE_CONFLICT");
        }
        if ("commit".equals(action) &&
            "committing_switch".equals(currentState) &&
            currentTransitionId.equals(transitionId) &&
            controlEpoch == currentEpoch + 1) return;
        if ("abort".equals(action) &&
            !"stable".equals(currentState) &&
            currentTransitionId.equals(transitionId) &&
            controlEpoch == currentEpoch) return;
        throw new IllegalStateException("SWITCH_STATE_CONFLICT");
    }

    private static String hmacCanonical(byte[] key, JSONObject value) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return hex(mac.doFinal(canonical(value).getBytes(StandardCharsets.UTF_8)));
        } catch (Exception error) {
            throw new IllegalStateException(error);
        }
    }

    private static JSONObject operationHeads(SQLiteDatabase db, String spaceId)
        throws JSONException {
        JSONObject heads = new JSONObject();
        try (Cursor cursor = db.rawQuery(
            "SELECT origin_node_id,contiguous_sequence,operation_hash FROM hub_watermarks " +
                "WHERE space_id=? ORDER BY origin_node_id",
            new String[]{spaceId})) {
            while (cursor.moveToNext()) {
                heads.put(cursor.getString(0), new JSONObject()
                    .put("sequence", cursor.getLong(1))
                    .put("operationHash", cursor.getString(2)));
            }
        }
        return heads;
    }

    private JSONObject clusterState(SQLiteDatabase db) throws JSONException {
        try (Cursor cursor = db.rawQuery(
            "SELECT space_id,local_node_id,active_node_id,epoch,state,role," +
                "transition_id,transition_target_node_id,transition_started_at " +
                "FROM hub_cluster_state LIMIT 1", null)) {
            if (!cursor.moveToFirst()) throw new IllegalStateException("HUB_NOT_CONFIGURED");
            return new JSONObject()
                .put("spaceId", cursor.getString(0))
                .put("localNodeId", cursor.getString(1))
                .put("activeNodeId", cursor.getString(2))
                .put("epoch", cursor.getLong(3))
                .put("state", cursor.getString(4))
                .put("role", cursor.getString(5))
                .put("transitionId", cursor.getString(6))
                .put("transitionTargetNodeId", cursor.getString(7))
                .put("transitionStartedAt", cursor.isNull(8) ? JSONObject.NULL : cursor.getLong(8));
        }
    }

    private void writeOperation(SQLiteDatabase db, JSONObject operation) throws JSONException {
        ContentValues values = new ContentValues();
        values.put("operation_id", required(operation, "operationId"));
        values.put("space_id", required(operation, "spaceId"));
        values.put("origin_node_id", required(operation, "originNodeId"));
        values.put("origin_sequence", operation.getLong("originSequence"));
        values.put("epoch", operation.getLong("epoch"));
        values.put("entity_type", required(operation, "entityType"));
        values.put("entity_id", required(operation, "entityId"));
        values.put("operation", required(operation, "operation"));
        values.put("entity_version", operation.getLong("entityVersion"));
        JSONObject payload = operation.optJSONObject("payload");
        values.put("payload_json", canonical(payload == null ? new JSONObject() : payload));
        values.put("payload_hash", required(operation, "payloadHash"));
        values.put("previous_operation_hash", operation.optString("previousOperationHash", ""));
        values.put("operation_hash", required(operation, "operationHash"));
        values.put("authentication_tag", operation.optString("authenticationTag", ""));
        values.put("created_at", operation.optLong("createdAt", System.currentTimeMillis()));
        db.insertOrThrow("hub_operations", null, values);
    }

    private void writeDocument(SQLiteDatabase db, String type, String id, long version, String payload, boolean deleted, long now) {
        ContentValues values = new ContentValues();
        values.put("entity_type", type);
        values.put("entity_id", id);
        values.put("version", version);
        values.put("payload_json", payload);
        values.put("deleted", deleted ? 1 : 0);
        values.put("updated_at", now);
        db.insertWithOnConflict("hub_documents", null, values, SQLiteDatabase.CONFLICT_REPLACE);
    }

    private void writeSnapshotSingleton(SQLiteDatabase db, String type, JSONObject payload, long now) throws JSONException {
        writeDocument(db, type, type, 1, canonical(payload), false, now);
    }

    private void writeWatermark(SQLiteDatabase db, String spaceId, String nodeId, long sequence, String hash, long now) {
        ContentValues values = new ContentValues();
        values.put("space_id", spaceId);
        values.put("origin_node_id", nodeId);
        values.put("contiguous_sequence", sequence);
        values.put("operation_hash", hash);
        values.put("updated_at", now);
        db.insertWithOnConflict("hub_watermarks", null, values, SQLiteDatabase.CONFLICT_REPLACE);
    }

    private void writeEntityVersion(SQLiteDatabase db, String type, String id, long version, long now) {
        ContentValues values = new ContentValues();
        values.put("entity_type", type);
        values.put("entity_id", id);
        values.put("version", version);
        values.put("updated_at", now);
        db.insertWithOnConflict("hub_entity_versions", null, values, SQLiteDatabase.CONFLICT_REPLACE);
    }

    private long nextSequence(SQLiteDatabase db, String spaceId, String nodeId) {
        try (Cursor cursor = db.rawQuery("SELECT contiguous_sequence FROM hub_watermarks WHERE space_id=? AND origin_node_id=?",
            new String[]{spaceId, nodeId})) {
            return cursor.moveToFirst() ? cursor.getLong(0) + 1 : 1;
        }
    }

    private String watermarkHash(SQLiteDatabase db, String spaceId, String nodeId) {
        try (Cursor cursor = db.rawQuery("SELECT operation_hash FROM hub_watermarks WHERE space_id=? AND origin_node_id=?",
            new String[]{spaceId, nodeId})) {
            return cursor.moveToFirst() ? cursor.getString(0) : "";
        }
    }

    private long currentEntityVersion(SQLiteDatabase db, String type, String id) {
        try (Cursor cursor = db.rawQuery("SELECT version FROM hub_entity_versions WHERE entity_type=? AND entity_id=?",
            new String[]{type, id})) {
            return cursor.moveToFirst() ? cursor.getLong(0) : 0;
        }
    }

    private JSONObject currentDocumentPayload(SQLiteDatabase db, String type, String id) throws JSONException {
        try (Cursor cursor = db.rawQuery(
            "SELECT payload_json FROM hub_documents WHERE entity_type=? AND entity_id=?",
            new String[]{type, id})) {
            return cursor.moveToFirst() ? new JSONObject(cursor.getString(0)) : new JSONObject();
        }
    }

    private JSONObject normalizeReplicatedDocument(
        String entityType,
        JSONObject payload,
        JSONObject current
    ) throws JSONException {
        JSONObject result = new JSONObject(canonical(current));
        Iterator<String> keys = payload.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            result.put(key, payload.get(key));
        }
        if (!"messages".equals(entityType)) result.put("user_id", "__CURRENT_USER__");
        moveJsonField(result, "goals", "goals_json");
        moveJsonField(result, "value", "value_json");
        moveJsonField(result, "entities", "entities_json");
        moveJsonField(result, "traits", "traits_json");
        moveJsonField(result, "values", "values_json");
        moveJsonField(result, "participants", "participants_json");
        moveJsonField(result, "settings", "settings_json");
        moveJsonField(result, "tags", "tags_json");
        moveJsonField(result, "symbols", "symbols_json");
        moveJsonField(result, "raw_payload", "raw_payload_json");
        moveJsonField(result, "based_on_event_ids", "based_on_event_ids_json");
        if ("xuan_mood_state".equals(entityType) && result.has("state")) {
            moveJsonField(result, "state", "state_json");
        }
        if ("messages".equals(entityType) && result.has("payload")) {
            moveJsonField(result, "payload", "payload_json");
        }
        if ("ai_configs".equals(entityType) || "ai_image_configs".equals(entityType)) {
            result.remove("credential");
            result.put("encrypted_api_key", "");
        }
        normalizeBooleanInteger(result, "completed");
        normalizeBooleanInteger(result, "enabled");
        return result;
    }

    private static void normalizeBooleanInteger(JSONObject object, String key) throws JSONException {
        if (!object.has(key) || object.isNull(key)) return;
        Object value = object.get(key);
        if (value instanceof Boolean) {
            object.put(key, (Boolean) value ? 1 : 0);
        }
    }

    private static void moveJsonField(JSONObject object, String source, String target) throws JSONException {
        if (!object.has(source)) return;
        Object value = object.get(source);
        object.remove(source);
        object.put(target, canonical(value));
    }

    private static JSONObject operationHashMaterial(JSONObject operation) throws JSONException {
        return new JSONObject()
            .put("protocolVersion", operation.optInt("protocolVersion", PROTOCOL_VERSION))
            .put("operationId", required(operation, "operationId"))
            .put("spaceId", required(operation, "spaceId"))
            .put("originNodeId", required(operation, "originNodeId"))
            .put("originSequence", operation.getLong("originSequence"))
            .put("epoch", operation.getLong("epoch"))
            .put("entityType", required(operation, "entityType"))
            .put("entityId", required(operation, "entityId"))
            .put("operation", required(operation, "operation"))
            .put("entityVersion", operation.getLong("entityVersion"))
            .put("previousEntityVersion", operation.has("previousEntityVersion") ? operation.get("previousEntityVersion") : JSONObject.NULL)
            .put("payload", operation.optJSONObject("payload") == null ? new JSONObject() : operation.getJSONObject("payload"))
            .put("payloadHash", required(operation, "payloadHash"))
            .put("previousOperationHash", operation.optString("previousOperationHash", ""))
            .put("createdAt", operation.getLong("createdAt"));
    }

    private void validateOperation(
        SQLiteDatabase db,
        JSONObject operation,
        byte[] syncKey,
        String expectedSpaceId,
        long expectedEpoch
    ) throws JSONException {
        String spaceId = required(operation, "spaceId");
        String originNodeId = required(operation, "originNodeId");
        if (!expectedSpaceId.equals(spaceId) || operation.optLong("epoch", -1) != expectedEpoch) {
            throw new IllegalStateException("HUB_OPERATION_SCOPE_INVALID");
        }
        long sequence = positive(operation.optLong("originSequence", 0), "originSequence");
        long expected = nextSequence(db, spaceId, originNodeId);
        String previousHash = watermarkHash(db, spaceId, originNodeId);
        if (sequence != expected || !previousHash.equals(operation.optString("previousOperationHash", ""))) {
            throw new IllegalStateException("HUB_OPERATION_SEQUENCE_GAP");
        }
        JSONObject payload = operation.optJSONObject("payload");
        if (payload == null) payload = new JSONObject();
        String payloadJson = canonical(payload);
        if (!sha256(payloadJson).equals(operation.optString("payloadHash", ""))) {
            throw new IllegalStateException("HUB_OPERATION_PAYLOAD_INVALID");
        }
        String expectedOperationHash = sha256(canonical(operationHashMaterial(operation)));
        if (!expectedOperationHash.equals(operation.optString("operationHash", ""))) {
            throw new IllegalStateException("HUB_OPERATION_HASH_INVALID");
        }
        String expectedTag = hmacSha256(syncKey, expectedOperationHash);
        if (!expectedTag.equals(operation.optString("authenticationTag", ""))) {
            throw new IllegalStateException("HUB_OPERATION_AUTH_INVALID");
        }
    }

    private static String hmacSha256(byte[] key, String value) {
        if (key == null || key.length == 0) throw new IllegalStateException("LOCAL_HUB_CREDENTIAL_UNAVAILABLE");
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return hex(mac.doFinal(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception error) {
            throw new IllegalStateException(error);
        }
    }

    private String computeRecordsRoot(SQLiteDatabase db) {
        MessageDigest digest = digest();
        try (Cursor cursor = db.rawQuery(
            "SELECT entity_type,entity_id,version,payload_json,deleted FROM hub_documents ORDER BY entity_type,entity_id", null)) {
            while (cursor.moveToNext()) {
                String line = cursor.getString(0) + "\u0000" + cursor.getString(1) + "\u0000" +
                    cursor.getLong(2) + "\u0000" + cursor.getString(3) + "\u0000" + cursor.getInt(4) + "\n";
                digest.update(line.getBytes(StandardCharsets.UTF_8));
            }
        }
        return hex(digest.digest());
    }

    private String computeSnapshotRecordsRoot(SQLiteDatabase db, JSONObject manifest) throws JSONException {
        JSONArray declaredTables = manifest.optJSONArray("tables");
        if (declaredTables == null) throw new JSONException("manifest.tables is required");
        List<JSONObject> manifests = new ArrayList<>();
        for (int index = 0; index < declaredTables.length(); index += 1) {
            JSONObject declared = declaredTables.getJSONObject(index);
            String name = required(declared, "name");
            List<String> leaves = new ArrayList<>();
            try (Cursor cursor = db.rawQuery(
                "SELECT payload_json FROM hub_documents WHERE entity_type=? AND deleted=0",
                new String[]{name})) {
                while (cursor.moveToNext()) leaves.add(sha256(cursor.getString(0)));
            }
            if ("$credentials".equals(name) && leaves.isEmpty()) {
                String credentialHash = meta("credentials_leaf_hash");
                if (credentialHash != null && !credentialHash.isEmpty()) leaves.add(credentialHash);
            }
            Collections.sort(leaves);
            manifests.add(new JSONObject()
                .put("name", name)
                .put("rowCount", leaves.size())
                .put("root", merkleRoot(leaves)));
        }
        Collections.sort(manifests, (left, right) -> left.optString("name").compareTo(right.optString("name")));
        List<String> leaves = new ArrayList<>();
        for (JSONObject item : manifests) leaves.add(sha256(canonical(item)));
        return merkleRoot(leaves);
    }

    private String computeSwitchRecordsRoot(SQLiteDatabase db, JSONObject manifest) throws JSONException {
        JSONArray declaredTables = manifest.optJSONArray("tables");
        if (declaredTables == null) throw new JSONException("manifest.tables is required");
        List<JSONObject> manifests = new ArrayList<>();
        for (int index = 0; index < declaredTables.length(); index += 1) {
            JSONObject declared = declaredTables.getJSONObject(index);
            String name = required(declared, "name");
            List<String> leaves = new ArrayList<>();
            try (Cursor cursor = db.rawQuery(
                "SELECT payload_json FROM hub_documents WHERE entity_type=? AND deleted=0",
                new String[]{name})) {
                while (cursor.moveToNext()) {
                    JSONObject row = new JSONObject(cursor.getString(0));
                    leaves.add(sha256(canonical(normalizeSwitchIntegrityRow(row))));
                }
            }
            if ("$credentials".equals(name) && leaves.isEmpty()) {
                String credentialHash = meta("credentials_leaf_hash");
                if (credentialHash != null && !credentialHash.isEmpty()) leaves.add(credentialHash);
            }
            Collections.sort(leaves);
            manifests.add(new JSONObject()
                .put("name", name)
                .put("rowCount", leaves.size())
                .put("root", merkleRoot(leaves)));
        }
        Collections.sort(manifests, (left, right) -> left.optString("name").compareTo(right.optString("name")));
        List<String> leaves = new ArrayList<>();
        for (JSONObject item : manifests) leaves.add(sha256(canonical(item)));
        return merkleRoot(leaves);
    }

    private static JSONObject normalizeSwitchIntegrityRow(JSONObject row) throws JSONException {
        JSONObject result = new JSONObject(row.toString());
        List<String> keys = sortedKeys(result);
        for (String key : keys) {
            Object value = result.opt(key);
            if (!key.endsWith("_json") || !(value instanceof String)) continue;
            try {
                Object parsed = new JSONTokener((String) value).nextValue();
                result.put(key, canonical(parsed));
            } catch (JSONException ignored) {
                // A non-JSON text value remains byte-for-byte unchanged.
            }
        }
        removeRedundantJsonAliases(result);
        normalizeBooleanInteger(result, "completed");
        normalizeBooleanInteger(result, "enabled");
        return result;
    }

    private static void removeRedundantJsonAliases(JSONObject row) {
        String[][] aliases = new String[][]{
            {"goals", "goals_json"},
            {"value", "value_json"},
            {"entities", "entities_json"},
            {"traits", "traits_json"},
            {"values", "values_json"},
            {"participants", "participants_json"},
            {"settings", "settings_json"},
            {"tags", "tags_json"},
            {"symbols", "symbols_json"},
            {"raw_payload", "raw_payload_json"},
            {"based_on_event_ids", "based_on_event_ids_json"},
            {"state", "state_json"},
            {"payload", "payload_json"}
        };
        for (String[] alias : aliases) {
            if (row.has(alias[1])) row.remove(alias[0]);
        }
    }

    private static void reconcileNodeRoles(SQLiteDatabase db, String activeNodeId, long now) {
        ContentValues standby = new ContentValues();
        standby.put("role", "standby");
        standby.put("status", "standby");
        db.update("hub_nodes", standby, "id<>?", new String[]{activeNodeId});

        ContentValues active = new ContentValues();
        active.put("role", "active");
        active.put("status", "active");
        active.put("last_seen_at", now);
        db.update("hub_nodes", active, "id=?", new String[]{activeNodeId});
    }

    private String computeBlobsRoot(SQLiteDatabase db) throws JSONException {
        List<String> leaves = new ArrayList<>();
        try (Cursor cursor = db.rawQuery(
            "SELECT media_id,mime_type,byte_size,content_hash FROM hub_media_blobs ORDER BY media_id", null)) {
            while (cursor.moveToNext()) {
                JSONObject descriptor = new JSONObject()
                    .put("id", cursor.getString(0))
                    .put("mimeType", cursor.getString(1))
                    .put("byteSize", cursor.getLong(2))
                    .put("contentHash", cursor.getString(3));
                leaves.add(sha256(canonical(descriptor)));
            }
        }
        return merkleRoot(leaves);
    }

    private static String merkleRoot(List<String> input) throws JSONException {
        if (input.isEmpty()) return sha256(canonical(new JSONArray()));
        List<String> level = new ArrayList<>(input);
        while (level.size() > 1) {
            List<String> next = new ArrayList<>();
            for (int index = 0; index < level.size(); index += 2) {
                String left = level.get(index);
                String right = index + 1 < level.size() ? level.get(index + 1) : left;
                next.add(sha256(canonical(new JSONArray().put(left).put(right))));
            }
            level = next;
        }
        return level.get(0);
    }

    private String meta(String key) {
        try (Cursor cursor = getReadableDatabase().rawQuery("SELECT value FROM hub_meta WHERE key=?", new String[]{key})) {
            return cursor.moveToFirst() ? cursor.getString(0) : null;
        }
    }

    private void putMeta(String key, String value) {
        putMeta(getWritableDatabase(), key, value);
    }

    private void putMeta(SQLiteDatabase db, String key, String value) {
        ContentValues values = new ContentValues();
        values.put("key", key);
        values.put("value", value);
        db.insertWithOnConflict("hub_meta", null, values, SQLiteDatabase.CONFLICT_REPLACE);
    }

    private static void requireBootstrapCompleted(SQLiteDatabase db) {
        if (scalarLong(db, "SELECT COUNT(*) FROM hub_snapshots WHERE status='completed'") < 1) {
            throw new IllegalStateException("LOCAL_HUB_BOOTSTRAP_INCOMPLETE");
        }
    }

    private static void clearIncompleteReplica(SQLiteDatabase db) {
        db.delete("hub_documents", null, null);
        db.delete("hub_operations", null, null);
        db.delete("hub_watermarks", null, null);
        db.delete("hub_idempotency", null, null);
        db.delete("hub_integrity", null, null);
        db.delete("hub_entity_versions", null, null);
        db.delete("hub_media_blobs", null, null);
        db.delete("hub_snapshots", null, null);
        db.delete(
            "hub_meta",
            "key IN (?,?,?,?)",
            new String[]{"credentials_leaf_hash", "last_snapshot_id", "snapshot_space_id", "pending_switch_exchange"}
        );
    }

    private static boolean exists(SQLiteDatabase db, String sql, String value) {
        try (Cursor cursor = db.rawQuery(sql, new String[]{value})) {
            return cursor.moveToFirst();
        }
    }

    private static long scalarLong(SQLiteDatabase db, String sql) {
        try (Cursor cursor = db.rawQuery(sql, null)) {
            return cursor.moveToFirst() ? cursor.getLong(0) : 0;
        }
    }

    private static long positive(long value, String field) throws JSONException {
        if (value < 1) throw new JSONException(field + " must be positive");
        return value;
    }

    private static String required(JSONObject input, String key) throws JSONException {
        String value = input.optString(key, "").trim();
        if (value.isEmpty()) throw new JSONException(key + " is required");
        return value;
    }

    private static List<String> sortedKeys(JSONObject object) {
        List<String> keys = new ArrayList<>();
        Iterator<String> iterator = object.keys();
        while (iterator.hasNext()) keys.add(iterator.next());
        Collections.sort(keys);
        return keys;
    }

    private static String snapshotEntityId(String table, JSONObject row, String payload) {
        String id = row.optString("id", "").trim();
        if (!id.isEmpty()) return id;
        if ("module_settings".equals(table)) {
            String moduleId = row.optString("module_id", "").trim();
            if (!moduleId.isEmpty()) return moduleId;
        }
        if ("user_profiles".equals(table) || "assistant_profiles".equals(table)) return "profile";
        if ("ai_configs".equals(table) || "ai_image_configs".equals(table)) return "config";
        if ("memory_settings".equals(table) || "prompt_settings".equals(table)) return "settings";
        if ("xuan_mood_state".equals(table)) return "state";
        return sha256(table + "\n" + payload);
    }

    public static String canonical(Object value) throws JSONException {
        if (value == null || value == JSONObject.NULL) return "null";
        if (value instanceof JSONObject) {
            JSONObject object = (JSONObject) value;
            List<String> keys = sortedKeys(object);
            StringBuilder result = new StringBuilder("{");
            for (int index = 0; index < keys.size(); index += 1) {
                if (index > 0) result.append(',');
                String key = keys.get(index);
                result.append(quoteJsonString(key)).append(':').append(canonical(object.get(key)));
            }
            return result.append('}').toString();
        }
        if (value instanceof JSONArray) {
            JSONArray array = (JSONArray) value;
            StringBuilder result = new StringBuilder("[");
            for (int index = 0; index < array.length(); index += 1) {
                if (index > 0) result.append(',');
                result.append(canonical(array.get(index)));
            }
            return result.append(']').toString();
        }
        if (value instanceof String) return quoteJsonString((String) value);
        if (value instanceof Boolean || value instanceof Number) return String.valueOf(value);
        return quoteJsonString(String.valueOf(value));
    }

    static String quoteJsonString(String value) {
        StringBuilder result = new StringBuilder(value.length() + 2).append('"');
        for (int index = 0; index < value.length(); index += 1) {
            char character = value.charAt(index);
            switch (character) {
                case '"':
                    result.append("\\\"");
                    break;
                case '\\':
                    result.append("\\\\");
                    break;
                case '\b':
                    result.append("\\b");
                    break;
                case '\f':
                    result.append("\\f");
                    break;
                case '\n':
                    result.append("\\n");
                    break;
                case '\r':
                    result.append("\\r");
                    break;
                case '\t':
                    result.append("\\t");
                    break;
                default:
                    if (character <= 0x1f || isUnpairedSurrogate(value, index)) {
                        result.append(String.format("\\u%04x", (int) character));
                    } else {
                        result.append(character);
                    }
            }
        }
        return result.append('"').toString();
    }

    private static boolean isUnpairedSurrogate(String value, int index) {
        char character = value.charAt(index);
        if (Character.isHighSurrogate(character)) {
            return index + 1 >= value.length() || !Character.isLowSurrogate(value.charAt(index + 1));
        }
        return Character.isLowSurrogate(character) &&
            (index == 0 || !Character.isHighSurrogate(value.charAt(index - 1)));
    }

    public static String sha256(String value) {
        MessageDigest digest = digest();
        return hex(digest.digest(value.getBytes(StandardCharsets.UTF_8)));
    }

    public static String sha256(byte[] value) {
        MessageDigest digest = digest();
        return hex(digest.digest(value));
    }

    private static MessageDigest digest() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (Exception error) {
            throw new IllegalStateException(error);
        }
    }

    private static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) result.append(String.format("%02x", value & 0xff));
        return result.toString();
    }
}
