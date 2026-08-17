package com.xuanxiaotech.aetherx.mobile.hub;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

public final class LocalHubBootReceiver extends BroadcastReceiver {
    private static final String TAG = "AetherXLocalHub";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        if (!new LocalHubSecretStore(context).isReady()) return;

        try {
            context.startForegroundService(new Intent(context, LocalHubForegroundService.class));
        } catch (Exception error) {
            Log.e(TAG, "Failed to restore the paired Android Local Hub after boot", error);
        }
    }
}
