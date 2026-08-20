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
const localHubServiceSource = readFileSync(
  new URL(
    "../../android/app/src/main/java/com/xuanxiaotech/aetherx/mobile/hub/LocalHubService.java",
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
const networkBridgeSource = readFileSync(
  new URL(
    "../../android/app/src/main/java/com/xuanxiaotech/aetherx/mobile/hub/LocalHubNetworkBridge.java",
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
const secureSessionSource = readFileSync(
  new URL(
    "../../android/app/src/main/java/com/xuanxiaotech/aetherx/mobile/SecureSessionPlugin.java",
    import.meta.url
  ),
  "utf8"
);
const lanDiscoverySource = readFileSync(
  new URL(
    "../../android/app/src/main/java/com/xuanxiaotech/aetherx/mobile/hub/LocalHubLanDiscovery.java",
    import.meta.url
  ),
  "utf8"
);
const lanAnnouncerSource = readFileSync(
  new URL(
    "../../android/app/src/main/java/com/xuanxiaotech/aetherx/mobile/hub/LocalHubLanAnnouncer.java",
    import.meta.url
  ),
  "utf8"
);
const bootReceiverSource = readFileSync(
  new URL(
    "../../android/app/src/main/java/com/xuanxiaotech/aetherx/mobile/hub/LocalHubBootReceiver.java",
    import.meta.url
  ),
  "utf8"
);
const androidManifestSource = readFileSync(
  new URL("../../android/app/src/main/AndroidManifest.xml", import.meta.url),
  "utf8"
);
const capacitorConfigSource = readFileSync(
  new URL("../../capacitor.config.ts", import.meta.url),
  "utf8"
);
const capacitorPatchSource = readFileSync(
  new URL("../../scripts/patch-capacitor-android.mjs", import.meta.url),
  "utf8"
);

describe("Android Local Hub replication envelope", () => {
  it("discovers a changed desktop LAN address and authenticates it before persistence", () => {
    expect(lanDiscoverySource).toContain('DISCOVERY_TYPE = "aetherx-hub-discovery"');
    expect(lanDiscoverySource).toContain("packet.getAddress().isSiteLocalAddress()");
    expect(lanDiscoverySource).toContain('!"desktop".equals(payload.optString("platform"))');
    expect(lanDiscoverySource).toContain("service.acceptDiscoveredPeerEndpoint(candidate)");
    expect(peerSyncSource).toContain("public JSONObject acceptDiscoveredEndpoint(String endpoint)");
    expect(peerSyncSource).toContain('throw new IllegalStateException("PEER_IDENTITY_MISMATCH")');
    expect(peerSyncSource.indexOf("hello(endpoint, config, credential, secrets)"))
      .toBeLessThan(peerSyncSource.indexOf("database.updatePeerEndpoints(merged)"));
    expect(foregroundServiceSource).toContain("lanDiscovery.start()");
    expect(foregroundServiceSource).toContain("lanDiscovery.stop()");
    expect(foregroundServiceSource).toContain("lanAnnouncer.start()");
    expect(foregroundServiceSource).toContain("lanAnnouncer.stop()");
    expect(lanAnnouncerSource).toContain('.put("platform", "android")');
    expect(lanAnnouncerSource).toContain('status.optBoolean("configured", false)');
    expect(lanAnnouncerSource).toContain("LocalHubLanDiscovery.DISCOVERY_PORT");
    expect(foregroundServiceSource).toContain("JSONObject heartbeat = service.keepPeerAlive()");
    expect(foregroundServiceSource).toContain('heartbeat.optBoolean("needsSynchronization", false)');
    expect(peerSyncSource).toContain('.put("needsSynchronization", needsSynchronization(active, localSequence, remoteSequence))');
  });

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
    expect(serviceSource).toContain("public JSONObject recoverDivergence");
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
    expect(serviceSource).toContain("public JSONObject startAndResumePendingSwitch()");
    expect(serviceSource).toContain("scheduleRecovery()");
    expect(serviceSource).toContain("recoveryScheduled.compareAndSet(false, true)");
    expect(serviceSource).toContain('put("recoveryPending", true)');
    expect(serviceSource).toContain("if (pending) return true;");
    expect(serviceSource).toContain(
      'if (!("stable".equals(state) || "forced_active".equals(state))) return false;'
    );
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
    expect(networkServerSource).toContain("ensureReachable()");
    expect(networkServerSource).toContain("probeHealth(listeningPort)");
    expect(networkServerSource).toContain("clearStoppedListener(Thread.currentThread())");
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
    expect(networkServerSource).toContain('"/api/v1/peer/status"');
    expect(networkServerSource).toContain('"/api/v1/peer/operations"');
    expect(networkServerSource).toContain("return service.peerOperations(");
    expect(serviceSource).toContain("public JSONObject peerOperations(");
    expect(serviceSource).toContain('.put("headSequence", headSequence)');
    expect(networkServerSource).toContain('"/api/v1/peer/hello"');
    expect(networkServerSource).toContain("return service.peerHello(request.body)");
    expect(serviceSource).toContain("public JSONObject peerHello(JSONObject input)");
    expect(serviceSource).toContain('database.updatePeerEndpoints(endpoints)');
    expect(networkServerSource).toContain('"/api/v1/peer/acknowledgements"');
    expect(networkServerSource).toContain("return service.peerAcknowledgements(request.body)");
    expect(serviceSource).toContain("public JSONObject peerAcknowledgements(JSONObject input)");
    expect(peerSyncSource).toContain('throw new IllegalStateException("LOCAL_HUB_PEER_UNREACHABLE", error)');
    expect(peerSyncSource).toContain("public JSONObject authorizeDesktopLogin(JSONObject input)");
    expect(peerSyncSource).toContain('"/api/v1/auth/desktop-login/authorize"');
    expect(peerSyncSource).toContain('"aetherx-desktop-login-space-proof"');
    expect(peerSyncSource).toContain("decryptDesktopLoginCredential");
    expect(peerSyncSource).toContain('secretStore.merge(new JSONObject().put("peerCredential", credential))');
    expect(peerSyncSource).toContain("JSONObject peer = hello(endpoint, config, credential, refreshedSecrets)");
    expect(peerSyncSource).toContain("isAetherXBackend(endpoint, 2_500)");
    expect(serviceSource).toContain("public JSONObject authorizeDesktopLogin(JSONObject input)");
    expect(networkServerSource).toContain('"/api/v1/peer/client-sessions/mint"');
    expect(networkServerSource).toContain("JSONObject data = service.peerClientSession()");
    expect(serviceSource).toContain("public JSONObject peerClientSession()");
    expect(serviceSource).toContain("SecureSessionPlugin.loadStoredSession(appContext)");
    expect(secureSessionSource).toContain("public static JSONObject loadStoredSession(Context context)");
    expect(networkServerSource).toContain('"/api/v1/peer/media/manifest"');
    expect(networkServerSource).toContain("return service.peerMediaManifest(");
    expect(serviceSource).toContain("public JSONObject peerMediaManifest(String cursor, int limit)");
    expect(networkServerSource).toContain("servePeerMediaChunk(output, request)");
    expect(networkServerSource).toContain('"X-AetherX-Chunk-Hash: "');
    expect(networkServerSource).toContain('"/api/v1/peer/synchronize"');
    expect(networkServerSource).toContain('"/api/v1/peer/switch/control"');
    expect(networkServerSource).toContain('"/api/v1/peer/switch/final-sync"');
    expect(networkServerSource).toContain('"/api/v1/peer/mobile-switch/request"');
    expect(networkServerSource).toContain("return service.switchToPeer()");
    expect(peerSyncSource).toContain("public JSONObject createSwitchPreflightProof()");
    expect(peerSyncSource).toContain("public JSONObject applyPeerSwitchControl(JSONObject signedControl)");
    expect(peerSyncSource).toContain("public JSONObject runPeerFinalSync(JSONObject input)");
    expect(peerSyncSource).toContain("Final sync state conflict:");
    expect(peerSyncSource).toContain("requestedTransitionId");
    expect(serviceSource).toContain("public JSONObject createPeerSwitchPreflightProof()");
    expect(serviceSource).not.toContain(
      "public synchronized JSONObject createPeerSwitchPreflightProof()"
    );
    expect(serviceSource).toContain("replicationOperationLock.tryLock(5, TimeUnit.SECONDS)");
    expect(serviceSource).toContain('throw new IllegalStateException("LOCAL_HUB_BUSY")');
    expect(serviceSource).toContain("public JSONObject applyPeerSwitchControl");
    expect(serviceSource).toContain("public JSONObject runPeerFinalSync");
    expect(networkServerSource).toContain('"LOCAL_HUB_BUSY".equals(code)');
    expect(networkServerSource.indexOf("dispatchNativePeer(request)"))
      .toBeLessThan(networkServerSource.indexOf("LocalHubNetworkBridge.dispatch("));
    expect(networkServerSource).toContain("BRIDGE_WORKER_COUNT = 6");
    expect(networkServerSource).toContain("BRIDGE_QUEUE_TIMEOUT_SECONDS = 20");
    expect(networkServerSource).toContain("HTTP_WORKER_COUNT = 16");
    expect(networkServerSource).toContain("client.setSoTimeout(15_000)");
    expect(networkServerSource).toContain(
      "bridgeWorkers.tryAcquire(BRIDGE_QUEUE_TIMEOUT_SECONDS, TimeUnit.SECONDS)"
    );
    expect(networkServerSource).toContain("bridgeWorkers.release()");
  });

  it("keeps the peer route warm while Android is locked", () => {
    expect(foregroundServiceSource).toContain("KEEPALIVE_INTERVAL_SECONDS = 10");
    expect(foregroundServiceSource).toContain("scheduleWithFixedDelay");
    expect(foregroundServiceSource).toContain("service.keepPeerAlive()");
    expect(foregroundServiceSource).toContain("service.ensureNetworkReachable()");
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

  it("starts the native Local Hub listener after the Capacitor bridge is ready", () => {
    expect(mainActivitySource).toContain("LocalHubService.get(getApplicationContext()).start()");
    expect(mainActivitySource).toContain("startForegroundService");
    expect(mainActivitySource).toContain('"aetherx-local-hub-bootstrap"');
    expect(mainActivitySource.indexOf("registerPlugin(SecureSessionPlugin.class)")).toBeLessThan(
      mainActivitySource.indexOf("super.onCreate(savedInstanceState)")
    );
    expect(mainActivitySource.indexOf("startForegroundService")).toBeGreaterThan(
      mainActivitySource.indexOf("super.onCreate(savedInstanceState)")
    );
    expect(mainActivitySource.indexOf("LocalHubService.get")).toBeGreaterThan(
      mainActivitySource.indexOf("super.onCreate(savedInstanceState)")
    );
    expect(capacitorConfigSource).toContain('androidScheme: "http"');
    expect(capacitorConfigSource).toContain("allowMixedContent: false");
    expect(localHubServiceSource).toContain('.put("allowInsecureLan", BuildConfig.ALLOW_INSECURE_LAN)');
  });

  it("guards Capacitor lifecycle events until the page bridge is injected", () => {
    expect(capacitorPatchSource).toContain('const unsafeCall = "window.Capacitor.triggerEvent("');
    expect(capacitorPatchSource).toContain('const guardedCall = "window.Capacitor?.triggerEvent?.("');
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
    expect(pluginSource).toContain('finally {\n                notifyListeners("networkRequest", payload, true);');
    expect(networkBridgeSource).toContain("REQUEST_TIMEOUT_SECONDS = 15");
    expect(networkBridgeSource).toContain('IllegalStateException("LOCAL_HUB_RUNTIME_UNAVAILABLE", error)');
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

  it("restores only a configured Android Hub after the phone reboots", () => {
    expect(androidManifestSource).toContain("android.permission.RECEIVE_BOOT_COMPLETED");
    expect(androidManifestSource).toContain(".hub.LocalHubBootReceiver");
    expect(androidManifestSource).toContain("android.intent.action.BOOT_COMPLETED");
    expect(bootReceiverSource).toContain("Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())");
    expect(bootReceiverSource).toContain("new LocalHubSecretStore(context).isReady()");
    expect(bootReceiverSource).toContain("context.startForegroundService");
  });
});
