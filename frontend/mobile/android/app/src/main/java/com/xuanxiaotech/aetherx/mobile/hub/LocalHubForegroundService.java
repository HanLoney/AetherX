package com.xuanxiaotech.aetherx.mobile.hub;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import com.xuanxiaotech.aetherx.mobile.MainActivity;
import com.xuanxiaotech.aetherx.mobile.R;

import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

public final class LocalHubForegroundService extends Service {
    private static final String TAG = "AetherXLocalHub";
    private static final String CHANNEL_ID = "aetherx_local_hub";
    private static final int NOTIFICATION_ID = 4319;
    private static final long KEEPALIVE_INTERVAL_SECONDS = 10;
    private final ExecutorService bootstrapExecutor = Executors.newSingleThreadExecutor();
    private final ScheduledExecutorService maintenanceExecutor =
        Executors.newSingleThreadScheduledExecutor();
    private PowerManager.WakeLock wakeLock;
    private LocalHubLanDiscovery lanDiscovery;
    private LocalHubLanAnnouncer lanAnnouncer;
    private long lastKeepAliveWarningAt;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        startForeground(NOTIFICATION_ID, buildNotification());
        PowerManager powerManager = getSystemService(PowerManager.class);
        wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "AetherX:LocalHub"
        );
        wakeLock.setReferenceCounted(false);
        wakeLock.acquire();
        LocalHubService localHubService = LocalHubService.get(getApplicationContext());
        lanDiscovery = new LocalHubLanDiscovery(localHubService);
        lanDiscovery.start();
        lanAnnouncer = new LocalHubLanAnnouncer(localHubService);
        lanAnnouncer.start();
        maintenanceExecutor.scheduleWithFixedDelay(
            this::keepPeerOnline,
            KEEPALIVE_INTERVAL_SECONDS,
            KEEPALIVE_INTERVAL_SECONDS,
            TimeUnit.SECONDS
        );
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        bootstrapExecutor.execute(() -> {
            try {
                LocalHubService.get(getApplicationContext()).startAndResumePendingSwitch();
            } catch (Exception error) {
                Log.e(TAG, "Failed to keep Android Local Hub online", error);
            }
        });
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        if (lanDiscovery != null) lanDiscovery.stop();
        lanDiscovery = null;
        if (lanAnnouncer != null) lanAnnouncer.stop();
        lanAnnouncer = null;
        bootstrapExecutor.shutdownNow();
        maintenanceExecutor.shutdownNow();
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void keepPeerOnline() {
        try {
            LocalHubService service = LocalHubService.get(getApplicationContext());
            service.ensureNetworkReachable();
            JSONObject status = service.status();
            String state = status.optString("state");
            if (!status.optBoolean("configured", false) ||
                !("stable".equals(state) || "forced_active".equals(state))) return;
            JSONObject heartbeat = service.keepPeerAlive();
            if (heartbeat.optBoolean("needsSynchronization", false)) service.synchronize();
        } catch (Exception error) {
            long now = System.currentTimeMillis();
            if (now - lastKeepAliveWarningAt < 60_000) return;
            lastKeepAliveWarningAt = now;
            Log.w(TAG, "Unable to keep the peer Hub route warm", error);
        }
    }

    private void createNotificationChannel() {
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "AetherX 手机 Hub",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("保持手机 Hub 可被已配对设备连接");
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    private Notification buildNotification() {
        Intent openApp = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            0,
            openApp,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
        return new Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.aetherx_app_icon)
            .setContentTitle("AetherX 手机 Hub")
            .setContentText("已为配对设备保持连接")
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .build();
    }
}
