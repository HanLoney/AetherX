package com.xuanxiaotech.aetherx.mobile.hub;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.IBinder;
import android.util.Log;

import com.xuanxiaotech.aetherx.mobile.MainActivity;
import com.xuanxiaotech.aetherx.mobile.R;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class LocalHubForegroundService extends Service {
    private static final String TAG = "AetherXLocalHub";
    private static final String CHANNEL_ID = "aetherx_local_hub";
    private static final int NOTIFICATION_ID = 4319;
    private final ExecutorService bootstrapExecutor = Executors.newSingleThreadExecutor();

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        startForeground(NOTIFICATION_ID, buildNotification());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        bootstrapExecutor.execute(() -> {
            try {
                LocalHubService.get(getApplicationContext()).start();
            } catch (Exception error) {
                Log.e(TAG, "Failed to keep Android Local Hub online", error);
            }
        });
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        bootstrapExecutor.shutdownNow();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
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
