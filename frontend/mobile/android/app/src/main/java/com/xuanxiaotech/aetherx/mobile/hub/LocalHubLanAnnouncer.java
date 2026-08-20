package com.xuanxiaotech.aetherx.mobile.hub;

import android.util.Log;

import org.json.JSONObject;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.concurrent.atomic.AtomicBoolean;

public final class LocalHubLanAnnouncer {
    private static final String TAG = "AetherXLocalHub";
    private static final String DISCOVERY_TYPE = "aetherx-hub-discovery";
    private static final long ANNOUNCE_INTERVAL_MS = 5_000L;

    private final LocalHubService service;
    private final AtomicBoolean running = new AtomicBoolean();
    private volatile DatagramSocket socket;
    private volatile Thread thread;

    public LocalHubLanAnnouncer(LocalHubService service) {
        this.service = service;
    }

    public void start() {
        if (!running.compareAndSet(false, true)) return;
        thread = new Thread(this::run, "aetherx-lan-announcer");
        thread.setDaemon(true);
        thread.start();
    }

    public void stop() {
        running.set(false);
        DatagramSocket current = socket;
        socket = null;
        if (current != null) current.close();
        Thread currentThread = thread;
        thread = null;
        if (currentThread != null) currentThread.interrupt();
    }

    private void run() {
        try (DatagramSocket current = new DatagramSocket()) {
            current.setBroadcast(true);
            socket = current;
            while (running.get()) {
                announce(current);
                try {
                    Thread.sleep(ANNOUNCE_INTERVAL_MS);
                } catch (InterruptedException ignored) {
                    Thread.currentThread().interrupt();
                    return;
                }
            }
        } catch (Exception error) {
            if (running.get()) Log.w(TAG, "Android Local Hub LAN announcer stopped", error);
        } finally {
            socket = null;
            running.set(false);
        }
    }

    private void announce(DatagramSocket current) {
        try {
            JSONObject status = service.status();
            int port = status.optInt("networkPort", 0);
            if (!status.optBoolean("configured", false) || port < 4319 || port > 4329) return;
            byte[] payload = new JSONObject()
                .put("type", DISCOVERY_TYPE)
                .put("version", 1)
                .put("platform", "android")
                .put("port", port)
                .toString()
                .getBytes(StandardCharsets.UTF_8);
            for (InetAddress address : broadcastAddresses()) {
                current.send(new DatagramPacket(
                    payload,
                    payload.length,
                    address,
                    LocalHubLanDiscovery.DISCOVERY_PORT
                ));
            }
        } catch (Exception error) {
            if (running.get()) Log.w(TAG, "Unable to announce Android Local Hub", error);
        }
    }

    static java.util.List<InetAddress> broadcastAddresses() throws Exception {
        java.util.List<InetAddress> result = new java.util.ArrayList<>();
        for (NetworkInterface network : Collections.list(NetworkInterface.getNetworkInterfaces())) {
            if (!network.isUp() || network.isLoopback()) continue;
            String name = network.getName().toLowerCase();
            if (name.contains("tun") || name.contains("tailscale") || name.contains("vpn")) continue;
            for (InterfaceAddress entry : network.getInterfaceAddresses()) {
                InetAddress local = entry.getAddress();
                InetAddress broadcast = entry.getBroadcast();
                if (!(local instanceof Inet4Address) ||
                    !local.isSiteLocalAddress() ||
                    broadcast == null) continue;
                result.add(broadcast);
            }
        }
        return result;
    }
}
