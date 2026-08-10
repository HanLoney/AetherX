import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const databaseSource = readFileSync(
  new URL(
    "../../android/app/src/main/java/com/xuanxiaotech/aetherx/mobile/hub/LocalHubDatabase.java",
    import.meta.url
  ),
  "utf8"
);
const peerSyncSource = readFileSync(
  new URL(
    "../../android/app/src/main/java/com/xuanxiaotech/aetherx/mobile/hub/LocalHubPeerSync.java",
    import.meta.url
  ),
  "utf8"
);
const networkServerSource = readFileSync(
  new URL(
    "../../android/app/src/main/java/com/xuanxiaotech/aetherx/mobile/hub/LocalHubNetworkServer.java",
    import.meta.url
  ),
  "utf8"
);
const networkApiSource = readFileSync(
  new URL("./local-hub-network-api.ts", import.meta.url),
  "utf8"
);
const localHubClientSource = readFileSync(
  new URL("./local-hub-client.ts", import.meta.url),
  "utf8"
);
const mainActivitySource = readFileSync(
  new URL(
    "../../android/app/src/main/java/com/xuanxiaotech/aetherx/mobile/MainActivity.java",
    import.meta.url
  ),
  "utf8"
);
const pluginSource = readFileSync(
  new URL(
    "../../android/app/src/main/java/com/xuanxiaotech/aetherx/mobile/LocalHubPlugin.java",
    import.meta.url
  ),
  "utf8"
);
const foregroundServiceSource = readFileSync(
  new URL(
    "../../android/app/src/main/java/com/xuanxiaotech/aetherx/mobile/hub/LocalHubForegroundService.java",
    import.meta.url
  ),
  "utf8"
);
const androidManifestSource = readFileSync(
  new URL("../../android/app/src/main/AndroidManifest.xml", import.meta.url),
  "utf8"
);

describe("Android Local Hub replication envelope", () => {
  it("keeps Android on schema 42 and exposes the complete divergence recovery bridge", () => {
    const pluginSource = readFileSync(
      new URL(
        "../../android/app/src/main/java/com/xuanxiaotech/aetherx/mobile/LocalHubPlugin.java",
        import.meta.url
      ),
      "utf8"
    );
    const serviceSource = readFileSync(
      new URL(
        "../../android/app/src/main/java/com/xuanxiaotech/aetherx/mobile/hub/LocalHubService.java",
        import.meta.url
      ),
      "utf8"
    );

    expect(databaseSource).toContain("public static final int NODE_SCHEMA_VERSION = 42");
    expect(databaseSource).toContain("public synchronized JSONObject exportRecoverySnapshot");
    expect(databaseSource).toContain("public synchronized JSONObject applyDivergenceRecovery");
    expect(databaseSource).toContain("public synchronized JSONObject divergenceRecoveryAcknowledgement");
    expect(databaseSource).toContain('putMeta(db, "recovery_ack_json", canonical(signedAck))');
    expect(peerSyncSource).toContain("public JSONObject recoverDivergence");
    expect(peerSyncSource).toContain("database.divergenceRecoveryAcknowledgement(recoveryId)");
    expect(peerSyncSource).toContain("private JSONObject acknowledgeRecovery");
    expect(peerSyncSource).toContain('Cipher.getInstance("AES/GCM/NoPadding")');
    expect(peerSyncSource).toContain('"/snapshot/complete"');
    expect(peerSyncSource).toContain('"/ack"');
    expect(serviceSource).toContain("public synchronized JSONObject recoverDivergence");
    expect(pluginSource).toContain("public void recoverDivergence(PluginCall call)");
  });

  it("includes the protocol version when sending locally created operations to the peer Hub", () => {
    const serializer = databaseSource.match(
      /public synchronized JSONArray listOperationsAfter[\s\S]*?return result;/
    )?.[0];

    expect(serializer).toBeTruthy();
    expect(serializer).toContain('.put("protocolVersion", PROTOCOL_VERSION)');
  });

  it("reports a verified operation head after both pull and push synchronization", () => {
    expect(databaseSource).toContain("public synchronized JSONObject operationHead");
    expect(peerSyncSource).toContain('"/api/v1/peer/sync-complete"');
    expect(peerSyncSource.match(/reportSyncComplete\(/g)?.length).toBeGreaterThanOrEqual(3);
    expect(peerSyncSource).toContain("database.operationHead(origin)");
    expect(peerSyncSource).toContain("database.operationHead(localNodeId)");
  });

  it("publishes live dual Hub synchronization progress", () => {
    const serviceSource = readFileSync(
      new URL(
        "../../android/app/src/main/java/com/xuanxiaotech/aetherx/mobile/hub/LocalHubService.java",
        import.meta.url
      ),
      "utf8"
    );

    expect(databaseSource).toContain("public synchronized JSONObject lastSyncStatus");
    expect(serviceSource).toContain('put("synchronization", synchronizationStatus())');
    expect(serviceSource).toContain('put("peerEndpoints", database.peerEndpoints())');
    expect(serviceSource).toContain('put("batteryOptimizationExempt", batteryOptimizationExempt())');
    expect(androidManifestSource).toContain("android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS");
    expect(pluginSource).toContain("Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS");
    expect(databaseSource).toContain("public synchronized JSONArray peerEndpoints()");
    expect(serviceSource).toContain("this::updateSynchronization");
    expect(peerSyncSource).toContain("ProgressListener");
    expect(peerSyncSource).toContain('progress("operations"');
    expect(peerSyncSource).toContain("reportMediaProgress");
  });

  it("normalizes local documents and ignores redundant JSON aliases during switch checks", () => {
    expect(databaseSource.match(/normalizeReplicatedDocument\(/g)?.length).toBeGreaterThanOrEqual(3);
    expect(databaseSource).toContain("removeRedundantJsonAliases(result)");
    expect(databaseSource).toContain('{"raw_payload", "raw_payload_json"}');
    expect(databaseSource).toContain('{"payload", "payload_json"}');
    expect(databaseSource.match(/normalizeBooleanInteger\(result, "completed"\)/g)?.length)
      .toBeGreaterThanOrEqual(2);
    expect(databaseSource.match(/normalizeBooleanInteger\(result, "enabled"\)/g)?.length)
      .toBeGreaterThanOrEqual(2);
  });

  it("resumes an interrupted Hub switch from the native start path", () => {
    const pluginSource = readFileSync(
      new URL(
        "../../android/app/src/main/java/com/xuanxiaotech/aetherx/mobile/LocalHubPlugin.java",
        import.meta.url
      ),
      "utf8"
    );
    const serviceSource = readFileSync(
      new URL(
        "../../android/app/src/main/java/com/xuanxiaotech/aetherx/mobile/hub/LocalHubService.java",
        import.meta.url
      ),
      "utf8"
    );
    const foregroundServiceSource = readFileSync(
      new URL(
        "../../android/app/src/main/java/com/xuanxiaotech/aetherx/mobile/hub/LocalHubForegroundService.java",
        import.meta.url
      ),
      "utf8"
    );

    expect(pluginSource).toContain("service().startAndResumePendingSwitch()");
    expect(serviceSource).toContain("public synchronized JSONObject startAndResumePendingSwitch()");
    expect(serviceSource).toContain("return resumeReplication()");
    expect(foregroundServiceSource).toContain(
      "LocalHubService.get(getApplicationContext()).startAndResumePendingSwitch()"
    );
  });

  it("does not leave a zombie Local Hub listener after a transient socket failure", () => {
    expect(networkServerSource).toContain("acceptThread.isAlive()");
    expect(networkServerSource).toContain("closeListener()");
    expect(networkServerSource).toContain("if (socket != current || current.isClosed()) return;");
    expect(networkServerSource).not.toContain(
      'Log.w(TAG, "Local Hub listener stopped unexpectedly", error);\n                return;'
    );
  });

  it("authenticates every native peer route with Hub HMAC instead of a client session", () => {
    expect(networkServerSource).toContain('request.pathname.startsWith("/api/v1/peer/")');
    expect(networkServerSource).toContain("verifyPeer(request)");
    expect(networkServerSource.indexOf('request.pathname.startsWith("/api/v1/peer/")'))
      .toBeLessThan(networkServerSource.indexOf("sessionStore.validate(token)"));
  });

  it("handles Hub switch control in native code while the WebView is suspended", () => {
    const serviceSource = readFileSync(
      new URL(
        "../../android/app/src/main/java/com/xuanxiaotech/aetherx/mobile/hub/LocalHubService.java",
        import.meta.url
      ),
      "utf8"
    );

    expect(networkServerSource).toContain("dispatchNativePeer(request)");
    expect(networkServerSource).toContain('"/api/v1/peer/switch/preflight"');
    expect(networkServerSource).toContain('"/api/v1/peer/synchronize"');
    expect(networkServerSource).toContain('"/api/v1/peer/switch/control"');
    expect(networkServerSource).toContain('"/api/v1/peer/switch/final-sync"');
    expect(networkServerSource).toContain('"/api/v1/peer/mobile-switch/request"');
    expect(networkServerSource).toContain("return service.switchToPeer()");
    expect(peerSyncSource).toContain("public JSONObject createSwitchPreflightProof()");
    expect(peerSyncSource).toContain("public JSONObject applyPeerSwitchControl(JSONObject signedControl)");
    expect(peerSyncSource).toContain("public JSONObject runPeerFinalSync(JSONObject input)");
    expect(serviceSource).toContain("public synchronized JSONObject applyPeerSwitchControl");
    expect(serviceSource).toContain("public synchronized JSONObject runPeerFinalSync");
    expect(networkServerSource.indexOf("dispatchNativePeer(request)"))
      .toBeLessThan(networkServerSource.indexOf("LocalHubNetworkBridge.dispatch("));
  });

  it("keeps the peer route warm while Android is locked", () => {
    expect(foregroundServiceSource).toContain("KEEPALIVE_INTERVAL_SECONDS = 10");
    expect(foregroundServiceSource).toContain("scheduleWithFixedDelay");
    expect(foregroundServiceSource).toContain("service.keepPeerAlive()");
    expect(peerSyncSource).toContain("public JSONObject keepAlive()");
    expect(peerSyncSource).toContain('"/api/v1/peer/hello"');
  });

  it("routes cold-start network requests from native Hub state instead of the page session", () => {
    expect(networkApiSource).toContain("const [local, stored] = await Promise.all");
    expect(networkApiSource).toContain("localHub.refresh()");
    expect(networkApiSource).toContain("loadSession()");
    expect(networkApiSource).toContain("new LocalHubClient(stored.user, localHub)");
    expect(networkApiSource).not.toContain("useSessionStore");
  });

  it("filters conversation messages inside the native Hub before crossing the WebView bridge", () => {
    expect(databaseSource).toContain("String payloadField");
    expect(databaseSource).toContain('payload.optString(payloadField, "")');
    expect(localHubClientSource).toContain('payloadField: "conversation_id"');
    expect(networkApiSource).toContain("api.conversation(decode(match[1]))");
  });

  it("starts the native Local Hub listener without waiting for the WebView", () => {
    expect(mainActivitySource).toContain("LocalHubService.get(getApplicationContext()).start()");
    expect(mainActivitySource).toContain("startForegroundService");
    expect(mainActivitySource).toContain('"aetherx-local-hub-bootstrap"');
    expect(mainActivitySource.indexOf("LocalHubService.get")).toBeLessThan(
      mainActivitySource.indexOf("super.onCreate(savedInstanceState)")
    );
  });

  it("retains cold-start network requests until the page bridge is listening", () => {
    const pluginSource = readFileSync(
      new URL(
        "../../android/app/src/main/java/com/xuanxiaotech/aetherx/mobile/LocalHubPlugin.java",
        import.meta.url
      ),
      "utf8"
    );

    expect(pluginSource).toContain("getBridge().getWebView().onResume()");
    expect(pluginSource).toContain("getBridge().getWebView().resumeTimers()");
    expect(pluginSource).toContain("PowerManager.PARTIAL_WAKE_LOCK");
    expect(pluginSource).toContain("setRendererPriorityPolicy");
    expect(pluginSource).toContain("setOffscreenPreRaster(true)");
    expect(pluginSource).toContain('notifyListeners("networkRequest", payload, true)');
  });

  it("keeps the paired Android Hub reachable while its activity is in the background", () => {
    expect(foregroundServiceSource).toContain("startForeground(NOTIFICATION_ID");
    expect(foregroundServiceSource).toContain(
      "LocalHubService.get(getApplicationContext()).startAndResumePendingSwitch()"
    );
    expect(foregroundServiceSource).toContain("return START_STICKY");
    expect(foregroundServiceSource).toContain("PowerManager.PARTIAL_WAKE_LOCK");
    expect(foregroundServiceSource).toContain("wakeLock.acquire()");
    expect(foregroundServiceSource).toContain("wakeLock.release()");
    expect(androidManifestSource).toContain('android:foregroundServiceType="connectedDevice"');
    expect(androidManifestSource).toContain("android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE");
    expect(androidManifestSource).toContain("android.permission.WAKE_LOCK");
    expect(pluginSource).toContain("Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS");
  });
});
