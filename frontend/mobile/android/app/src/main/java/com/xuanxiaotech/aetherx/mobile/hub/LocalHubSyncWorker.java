package com.xuanxiaotech.aetherx.mobile.hub;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.util.concurrent.TimeUnit;

public final class LocalHubSyncWorker extends Worker {
    private static final String UNIQUE_WORK = "aetherx-local-hub-sync";

    public LocalHubSyncWorker(@NonNull Context context, @NonNull WorkerParameters parameters) {
        super(context, parameters);
    }

    @NonNull
    @Override
    public Result doWork() {
        try {
            LocalHubService service = LocalHubService.get(getApplicationContext());
            service.start();
            service.resumeReplication();
            service.verifyIntegrity();
            return Result.success();
        } catch (IllegalStateException error) {
            if (
                "HUB_NOT_CONFIGURED".equals(error.getMessage()) ||
                "LOCAL_HUB_PEER_UNAVAILABLE".equals(error.getMessage()) ||
                "LOCAL_HUB_CREDENTIAL_UNAVAILABLE".equals(error.getMessage()) ||
                "LOCAL_HUB_BOOTSTRAP_INCOMPLETE".equals(error.getMessage()) ||
                "LOCAL_HUB_BOOTSTRAP_MISSING".equals(error.getMessage())
            ) return Result.success();
            return Result.retry();
        } catch (Exception error) {
            return Result.retry();
        }
    }

    public static void schedule(Context context) {
        Constraints constraints = new Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build();
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
            LocalHubSyncWorker.class,
            15,
            TimeUnit.MINUTES
        ).setConstraints(constraints).build();
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            UNIQUE_WORK,
            ExistingPeriodicWorkPolicy.UPDATE,
            request
        );
    }
}
