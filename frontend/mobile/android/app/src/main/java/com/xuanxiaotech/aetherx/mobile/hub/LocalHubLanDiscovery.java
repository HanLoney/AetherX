package com.xuanxiaotech.aetherx.mobile.hub;

import android.util.Log;

import org.json.JSONObject;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;

public final class LocalHubLanDiscovery {
    static final int DISCOVERY_PORT = 4317;
    private static final String DISCOVERY_TYPE = "aetherx-hub-discovery";
    private static final String TAG = "AetherXLocalHub";
    private static final long RETRY_INTERVAL_MS = 15_000L;

    private final LocalHubService service;
    private final AtomicBoolean running = new AtomicBoolean();
    private volatile DatagramSocket socket;
    private volatile String lastCandidate = "";
    private volatile long lastAttemptAt;

    public LocalHubLanDiscovery(LocalHubService service) {
        this.service = service;
    }

    public void start() {
        if (!running.compareAndSet(false, true)) return;
        Thread listener = new Thread(this::listen, "aetherx-lan-discovery");
        listener.setDaemon(true);
        listener.start();
    }

    public void stop() {
        running.set(false);
        DatagramSocket current = socket;
        socket = null;
        if (current != null) current.close();
    }

    private void listen() {
        try (DatagramSocket current = new DatagramSocket(null)) {
            current.setReuseAddress(true);
            current.bind(new InetSocketAddress(DISCOVERY_PORT));
            socket = current;
            byte[] buffer = new byte[512];
            while (running.get()) {
                DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                current.receive(packet);
                String candidate = candidateEndpoint(packet);
                long now = System.currentTimeMillis();
                if (candidate.isEmpty() ||
                    candidate.equals(lastCandidate) && now - lastAttemptAt < RETRY_INTERVAL_MS) continue;
                lastCandidate = candidate;
                lastAttemptAt = now;
                try {
                    JSONObject result = service.acceptDiscoveredPeerEndpoint(candidate);
                    LocalHubDiscoveryBridge.publish(result);
                    Log.i(TAG, "Discovered authenticated desktop Hub: " + candidate);
                } catch (Exception error) {
                    Log.w(TAG, "Rejected LAN Hub discovery candidate: " + candidate, error);
                }
            }
        } catch (Exception error) {
            if (running.get()) Log.e(TAG, "LAN Hub discovery listener stopped", error);
        } finally {
            socket = null;
            running.set(false);
        }
    }

    static String candidateEndpoint(DatagramPacket packet) {
        try {
            if (!(packet.getAddress() instanceof Inet4Address) || !packet.getAddress().isSiteLocalAddress()) return "";
            JSONObject payload = new JSONObject(new String(
                packet.getData(),
                packet.getOffset(),
                packet.getLength(),
                StandardCharsets.UTF_8
            ));
            int port = payload.optInt("port", 0);
            if (!DISCOVERY_TYPE.equals(payload.optString("type")) ||
                payload.optInt("version", 0) != 1 || port < 1 || port > 65535) return "";
            return "http://" + packet.getAddress().getHostAddress() + ":" + port;
        } catch (Exception ignored) {
            return "";
        }
    }
}
