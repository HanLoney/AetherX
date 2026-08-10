package com.xuanxiaotech.aetherx.mobile;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.xuanxiaotech.aetherx.mobile.hub.LocalHubService;
import com.xuanxiaotech.aetherx.mobile.hub.LocalHubNetworkBridge;
import com.xuanxiaotech.aetherx.mobile.hub.LocalHubSyncWorker;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ConcurrentHashMap;

@CapacitorPlugin(name = "LocalHub")
public class LocalHubPlugin extends Plugin {
    private static final String TAG = "AetherXLocalHub";
    private final ExecutorService replicationExecutor = Executors.newSingleThreadExecutor();
    private final ConcurrentHashMap<String, PowerManager.WakeLock> networkWakeLocks =
        new ConcurrentHashMap<>();
    private final LocalHubNetworkBridge.RequestListener networkRequestListener = request -> {
        if (getActivity() == null) throw new IllegalStateException("LOCAL_HUB_RUNTIME_UNAVAILABLE");
        String requestId = request.optString("requestId", "");
        holdNetworkWakeLock(requestId);
        JSObject payload = JSObject.fromJSONObject(request);
        getActivity().runOnUiThread(() -> {
            // Xiaomi and other Android variants may pause the WebView as soon as the
            // activity leaves the foreground. A paired desktop request is useful work for
            // the foreground Hub service, so wake the existing page runtime before routing it.
            getBridge().getWebView().onResume();
            getBridge().getWebView().resumeTimers();
            notifyListeners("networkRequest", payload, true);
        });
    };

    @Override
    public void load() {
        LocalHubNetworkBridge.setListener(networkRequestListener);
        getBridge().getWebView().setRendererPriorityPolicy(
            android.webkit.WebView.RENDERER_PRIORITY_IMPORTANT,
            false
        );
        getBridge().getWebView().getSettings().setOffscreenPreRaster(true);
    }

    @PluginMethod
    public void start(PluginCall call) {
        replicationExecutor.execute(() -> runAction(call, () -> {
            JSONObject status = service().startAndResumePendingSwitch();
            LocalHubSyncWorker.schedule(getContext());
            return status;
        }));
    }

    @PluginMethod
    public void stop(PluginCall call) {
        resolve(call, () -> service().stop());
    }

    @PluginMethod
    public void status(PluginCall call) {
        resolve(call, () -> service().status());
    }

    @PluginMethod
    public void openBatteryOptimizationSettings(PluginCall call) {
        try {
            PowerManager manager = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            String packageName = getContext().getPackageName();
            boolean exempt = manager != null && manager.isIgnoringBatteryOptimizations(packageName);
            Intent intent = exempt
                ? new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
                : new Intent(
                    Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:" + packageName)
                );
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve(new JSObject().put("opened", true));
        } catch (Exception error) {
            call.reject("无法打开系统电池优化设置。", "BATTERY_SETTINGS_UNAVAILABLE", error);
        }
    }

    @PluginMethod
    public void configure(PluginCall call) {
        resolve(call, () -> service().configure(call.getData()));
    }

    @PluginMethod
    public void updatePeerEndpoints(PluginCall call) {
        JSArray endpoints = call.getArray("endpoints", new JSArray());
        resolve(call, () -> service().updatePeerEndpoints(endpoints));
    }

    @PluginMethod
    public void importSnapshot(PluginCall call) {
        resolve(call, () -> service().importSnapshot(call.getData()));
    }

    @PluginMethod
    public void applyOperations(PluginCall call) {
        JSArray operations = call.getArray("operations", new JSArray());
        resolve(call, () -> service().applyOperations(operations));
    }

    @PluginMethod
    public void mutateDocument(PluginCall call) {
        resolve(call, () -> service().mutateDocument(call.getData()));
    }

    @PluginMethod
    public void mutateDocuments(PluginCall call) {
        resolve(call, () -> service().mutateDocuments(call.getData()));
    }

    @PluginMethod
    public void listDocuments(PluginCall call) {
        String entityType = call.getString("entityType", "").trim();
        if (entityType.isEmpty()) {
            call.reject("缺少实体类型。", "LOCAL_HUB_INPUT_INVALID");
            return;
        }
        resolve(call, () -> new JSONObject().put(
            "documents",
            service().listDocuments(
                entityType,
                call.getBoolean("includeDeleted", false),
                call.getString("payloadField", ""),
                call.getString("payloadValue", "")
            )
        ));
    }

    @PluginMethod
    public void localChanges(PluginCall call) {
        long after = call.getLong("after", 0L);
        int limit = call.getInt("limit", 100);
        resolve(call, () -> service().localChanges(after, limit));
    }

    @PluginMethod
    public void respondNetworkRequest(PluginCall call) {
        String requestId = call.getString("requestId", "");
        boolean accepted = LocalHubNetworkBridge.respond(call.getData());
        releaseNetworkWakeLock(requestId);
        call.resolve(new JSObject().put("accepted", accepted));
    }

    @PluginMethod
    public void verifyIntegrity(PluginCall call) {
        resolve(call, () -> service().verifyIntegrity());
    }

    @PluginMethod
    public void synchronize(PluginCall call) {
        replicationExecutor.execute(() -> runAction(call, () -> service().synchronize()));
    }

    @PluginMethod
    public void resume(PluginCall call) {
        replicationExecutor.execute(() -> runAction(call, () -> service().resumeReplication()));
    }

    @PluginMethod
    public void bootstrapBlobs(PluginCall call) {
        resolve(call, () -> service().bootstrapBlobs());
    }

    @PluginMethod
    public void finalizeBootstrap(PluginCall call) {
        resolve(call, () -> service().finalizeBootstrap());
    }

    @PluginMethod
    public void switchToLocal(PluginCall call) {
        replicationExecutor.execute(() -> runAction(call, () -> service().switchToLocal()));
    }

    @PluginMethod
    public void switchToPeer(PluginCall call) {
        replicationExecutor.execute(() -> runAction(call, () -> service().switchToPeer()));
    }

    @PluginMethod
    public void forceTakeover(PluginCall call) {
        replicationExecutor.execute(() -> runAction(call, () -> service().forceTakeover()));
    }

    @PluginMethod
    public void recoverDivergence(PluginCall call) {
        replicationExecutor.execute(() -> runAction(
            call,
            () -> service().recoverDivergence(call.getData())
        ));
    }

    @PluginMethod
    public void media(PluginCall call) {
        String mediaId = call.getString("mediaId", "").trim();
        if (mediaId.isEmpty()) {
            call.reject("缺少媒体 ID。", "LOCAL_HUB_INPUT_INVALID");
            return;
        }
        resolve(call, () -> service().media(mediaId));
    }

    @PluginMethod
    public void providerCredentials(PluginCall call) {
        resolve(call, () -> service().providerCredentials());
    }

    @PluginMethod
    public void imageProviderCredentials(PluginCall call) {
        resolve(call, () -> service().imageProviderCredentials());
    }

    @PluginMethod
    public void storeMedia(PluginCall call) {
        resolve(call, () -> service().storeMedia(call.getData()));
    }

    private LocalHubService service() {
        return LocalHubService.get(getContext());
    }

    private void resolve(PluginCall call, JsonAction action) {
        getBridge().execute(() -> runAction(call, action));
    }

    private void runAction(PluginCall call, JsonAction action) {
        try {
            call.resolve(JSObject.fromJSONObject(action.run()));
        } catch (IllegalStateException error) {
            Log.e(TAG, "Local Hub action failed: " + error.getMessage(), error);
            call.reject(localMessage(error.getMessage()), error.getMessage(), error);
        } catch (Exception error) {
            Log.e(TAG, "Local Hub action failed", error);
            call.reject("Android Local Hub 操作失败。", "LOCAL_HUB_FAILED", error);
        }
    }

    @Override
    protected void handleOnDestroy() {
        LocalHubNetworkBridge.clearListener(networkRequestListener);
        for (PowerManager.WakeLock wakeLock : networkWakeLocks.values()) {
            if (wakeLock.isHeld()) wakeLock.release();
        }
        networkWakeLocks.clear();
        replicationExecutor.shutdownNow();
    }

    private void holdNetworkWakeLock(String requestId) {
        if (requestId.isEmpty()) return;
        PowerManager manager = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        if (manager == null) return;
        PowerManager.WakeLock wakeLock = manager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "AetherX:LocalHubRequest"
        );
        wakeLock.setReferenceCounted(false);
        wakeLock.acquire(90_000L);
        PowerManager.WakeLock previous = networkWakeLocks.put(requestId, wakeLock);
        if (previous != null && previous.isHeld()) previous.release();
    }

    private void releaseNetworkWakeLock(String requestId) {
        PowerManager.WakeLock wakeLock = networkWakeLocks.remove(requestId);
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
    }

    private String localMessage(String code) {
        if ("HUB_NOT_ACTIVE".equals(code)) return "手机 Hub 当前不是活动节点，不能写入。";
        if ("HUB_NOT_CONFIGURED".equals(code)) return "手机 Hub 还没有完成配对。";
        if ("LOCAL_HUB_STOPPED".equals(code)) return "Android Local Hub 尚未启动。";
        if ("HUB_OPERATION_SEQUENCE_GAP".equals(code)) return "复制操作存在序列缺口，已停止应用。";
        if ("HUB_OPERATION_SCOPE_INVALID".equals(code)) return "复制操作不属于当前空间或 epoch。";
        if ("HUB_OPERATION_PAYLOAD_INVALID".equals(code)) return "复制操作内容校验失败。";
        if ("HUB_OPERATION_HASH_INVALID".equals(code)) return "复制操作哈希链校验失败。";
        if ("HUB_OPERATION_AUTH_INVALID".equals(code)) return "复制操作认证标签无效。";
        if ("HUB_OPERATION_ENTITY_VERSION_CONFLICT".equals(code)) return "复制操作的实体版本与本机副本冲突。";
        if ("LOCAL_HUB_CREDENTIAL_UNAVAILABLE".equals(code)) return "手机 Hub 的同步密钥不可用，请重新配对。";
        if ("LOCAL_HUB_PEER_UNAVAILABLE".equals(code)) return "手机 Hub 没有可用的电脑端点。";
        if ("LOCAL_HUB_SYNC_CURSOR_STALLED".equals(code)) return "手机 Hub 的复制游标没有继续前进。";
        if ("LOCAL_HUB_SYNC_FAILED".equals(code)) return "手机 Hub 暂时无法完成增量同步。";
        if ("LOCAL_HUB_SNAPSHOT_INTEGRITY_INVALID".equals(code)) return "手机 Hub 快照完整性校验失败。";
        if ("LOCAL_HUB_SNAPSHOT_INVALID".equals(code)) return "电脑端返回的完整快照无法解密或已经损坏。";
        if ("LOCAL_HUB_SNAPSHOT_IDENTITY_INVALID".equals(code)) return "电脑端快照与当前手机 Hub 身份不匹配。";
        if ("LOCAL_HUB_STRUCTURE_SYNC_FAILED".equals(code)) return "手机 Hub 无法重新拉取完整结构数据，请检查电脑端连接。";
        if ("LOCAL_HUB_BLOB_SYNC_FAILED".equals(code)) return "手机 Hub 原图同步失败，可稍后断点续传。";
        if ("LOCAL_HUB_BOOTSTRAP_INCOMPLETE".equals(code)) return "手机 Hub 仍有数据或原图没有同步完成。";
        if ("LOCAL_HUB_BOOTSTRAP_FINALIZE_FAILED".equals(code)) return "手机 Hub 完成证明未能通过电脑端校验。";
        if ("LOCAL_HUB_SWITCH_NOT_READY".equals(code)) return "手机 Hub 尚未完成全量同步，不能切换为当前 Hub。";
        if ("LOCAL_HUB_SWITCH_STALLED".equals(code)) return "手机 Hub 切换流程没有继续推进，请保持电脑在线后重试。";
        if ("LOCAL_HUB_SWITCH_FAILED".equals(code)) return "手机 Hub 安全切换失败，系统会保留进度并继续恢复。";
        if (code != null && code.startsWith("SWITCH_PREFLIGHT_FAILED")) {
            String[] parts = code.split(":", 2);
            if (parts.length < 2 || parts[1].isEmpty()) return "切换前完整性校验未通过，当前 Hub 未发生变化。";
            StringBuilder labels = new StringBuilder();
            for (String id : parts[1].split(",")) {
                String label = preflightLabel(id);
                if (label.isEmpty()) continue;
                if (labels.length() > 0) labels.append("、");
                labels.append(label);
            }
            return labels.length() == 0
                ? "切换前完整性校验未通过，当前 Hub 未发生变化。"
                : "切换前校验未通过：" + labels + "。当前 Hub 未发生变化，可同步后重试。";
        }
        if ("SWITCH_CONTROL_INVALID".equals(code) || "SWITCH_CONTROL_CONTEXT_MISMATCH".equals(code)) return "手机 Hub 收到的切换控制消息无效。";
        if ("SWITCH_CONTROL_EXPIRED".equals(code)) return "切换控制消息已过期，请重新尝试。";
        if ("SWITCH_STATE_CONFLICT".equals(code)) return "手机与电脑记录的切换阶段不一致，正在等待恢复。";
        if ("LOCAL_HUB_MEDIA_NOT_FOUND".equals(code)) return "手机 Hub 尚未缓存这张原图。";
        if ("LOCAL_HUB_AI_KEY_UNAVAILABLE".equals(code)) return "手机 Hub 没有可用的 AI Provider 凭证。";
        if ("LOCAL_HUB_IMAGE_KEY_UNAVAILABLE".equals(code)) return "手机 Hub 没有可用的图像 Provider 凭证。";
        if ("LOCAL_HUB_MEDIA_INVALID".equals(code)) return "手机 Hub 无法保存这张图片。";
        if ("LOCAL_HUB_PROVIDER_CREDENTIAL_INVALID".equals(code)) return "手机 Hub 无法解开同步来的 Provider 凭证。";
        if ("FORCED_TAKEOVER_NOT_ALLOWED".equals(code)) return "只有已完成同步的备用手机 Hub 才能强制接管。";
        if ("LOCAL_HUB_DIVERGENCE_DETECTED".equals(code)) return "电脑 Hub 存在旧代未确认写入，已停止自动覆盖并等待恢复处理。";
        if ("LOCAL_HUB_DIVERGENCE_RECOVERY_FAILED".equals(code)) return "手机 Hub 分歧恢复未能完成，双端仍保持冻结。";
        if (code != null && code.startsWith("DIVERGENCE_RECOVERY_")) return "手机 Hub 拒绝了无效的分歧恢复控制。";
        if ("LOCAL_HUB_FORCE_TAKEOVER_FAILED".equals(code)) return "手机 Hub 强制接管失败，原有 Hub 状态未被修改。";
        return "Android Local Hub 状态异常：" + String.valueOf(code);
    }

    private String preflightLabel(String id) {
        if ("proof".equals(id)) return "校验证明无效或已过期";
        if ("cluster".equals(id)) return "双方切换阶段不一致";
        if ("target".equals(id)) return "目标节点状态异常";
        if ("space".equals(id)) return "数据空间不一致";
        if ("epoch".equals(id)) return "活动节点代次不一致";
        if ("protocol".equals(id)) return "复制协议版本不一致";
        if ("schema".equals(id)) return "数据库版本不一致";
        if ("database".equals(id)) return "数据库健康检查失败";
        if ("credentials".equals(id)) return "AI 凭证尚未同步";
        if ("agent".equals(id)) return "仍有 Agent 正在运行";
        if ("operations".equals(id)) return "操作记录尚未追平";
        if ("records".equals(id)) return "结构化数据摘要不一致";
        if ("media".equals(id)) return "原图仍未完全同步";
        if ("bootstrap".equals(id)) return "全量迁入仍在进行";
        return "";
    }

    private interface JsonAction {
        JSONObject run() throws Exception;
    }
}
