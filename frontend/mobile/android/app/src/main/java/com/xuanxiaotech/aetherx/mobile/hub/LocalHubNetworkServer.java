package com.xuanxiaotech.aetherx.mobile.hub;

import android.content.Context;
import android.util.Base64;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

public final class LocalHubNetworkServer {
    private static final String TAG = "AetherXLocalHubHttp";
    private static final int MAX_BODY_BYTES = 4 * 1024 * 1024;
    private static final long PEER_ALLOWED_SKEW_MS = 5 * 60 * 1000;
    private static final int LAST_PORT = LocalHubService.DEFAULT_PORT + 10;
    private static final int HTTP_WORKER_COUNT = 16;
    private static final int BRIDGE_WORKER_COUNT = 6;
    private static final long BRIDGE_QUEUE_TIMEOUT_SECONDS = 20;

    private final LocalHubService service;
    private final LocalHubSecretStore secretStore;
    private final LocalHubClientSessionStore sessionStore;
    private final ThreadPoolExecutor clients =
        (ThreadPoolExecutor) Executors.newFixedThreadPool(HTTP_WORKER_COUNT);
    private final Semaphore bridgeWorkers = new Semaphore(BRIDGE_WORKER_COUNT);
    private final Map<String, Long> peerNonces = new ConcurrentHashMap<>();
    private volatile ServerSocket socket;
    private volatile Thread acceptThread;
    private volatile int port;

    public LocalHubNetworkServer(
        Context context,
        LocalHubService service,
        LocalHubSecretStore secretStore
    ) {
        this.service = service;
        this.secretStore = secretStore;
        this.sessionStore = new LocalHubClientSessionStore(context);
        // Avoid creating Android threads while a large SQLite sync is applying changes.
        clients.prestartAllCoreThreads();
    }

    public synchronized int start() {
        if (socket != null && !socket.isClosed() && acceptThread != null && acceptThread.isAlive()) {
            return port;
        }
        closeListener();
        for (int candidate = LocalHubService.DEFAULT_PORT; candidate <= LAST_PORT; candidate += 1) {
            try {
                ServerSocket next = new ServerSocket(candidate, 128, InetAddress.getByName("0.0.0.0"));
                next.setReuseAddress(true);
                socket = next;
                port = next.getLocalPort();
                acceptThread = new Thread(this::acceptLoop, "aetherx-local-hub-http");
                acceptThread.setDaemon(true);
                acceptThread.start();
                Log.i(TAG, "Android Local Hub listening on " + port);
                return port;
            } catch (Exception ignored) {
                // Try the next reserved port when another local service already owns this one.
            }
        }
        throw new IllegalStateException("LOCAL_HUB_NETWORK_PORT_UNAVAILABLE");
    }

    public synchronized int ensureReachable() {
        int listeningPort = start();
        if (probeHealth(listeningPort)) return listeningPort;

        Log.w(TAG, "Android Local Hub listener is unresponsive; restarting");
        closeListener();
        return start();
    }

    public synchronized void stop() {
        closeListener();
    }

    private void closeListener() {
        ServerSocket current = socket;
        Thread thread = acceptThread;
        socket = null;
        acceptThread = null;
        port = 0;
        if (current != null) {
            try { current.close(); } catch (Exception ignored) {}
        }
        if (thread != null && thread != Thread.currentThread()) thread.interrupt();
    }

    public int port() {
        return port;
    }

    public JSONArray endpoints() {
        JSONArray result = new JSONArray();
        if (port <= 0) return result;
        try {
            for (NetworkInterface network : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!network.isUp() || network.isLoopback()) continue;
                String interfaceName = network.getName().toLowerCase();
                for (InetAddress address : Collections.list(network.getInetAddresses())) {
                    if (!(address instanceof Inet4Address) || address.isLoopbackAddress() || address.isLinkLocalAddress()) {
                        continue;
                    }
                    String host = address.getHostAddress();
                    if (isTailscale(host)) {
                        result.put(endpoint("tailscale", host, 350));
                    } else if (isPrivateLan(host) && isLanInterface(interfaceName)) {
                        result.put(endpoint("lan", host, 500));
                    }
                }
            }
        } catch (Exception error) {
            Log.w(TAG, "Unable to enumerate Local Hub endpoints", error);
        }
        return result;
    }

    private JSONObject endpoint(String transport, String host, int priority) throws Exception {
        return new JSONObject()
            .put("transport", transport)
            .put("address", "http://" + host + ":" + port)
            .put("priority", priority);
    }

    private void acceptLoop() {
        try {
            while (true) {
                ServerSocket current = socket;
                if (current == null || current.isClosed()) return;
                try {
                    Socket client = current.accept();
                    client.setSoTimeout(15_000);
                    try {
                        clients.execute(() -> handle(client));
                    } catch (RuntimeException error) {
                        try { client.close(); } catch (Exception ignored) {}
                        throw error;
                    }
                } catch (SocketException error) {
                    if (socket != current || current.isClosed()) return;
                    Log.w(TAG, "Transient Local Hub listener failure; continuing", error);
                } catch (Exception error) {
                    Log.w(TAG, "Unable to accept Local Hub connection", error);
                }
            }
        } finally {
            clearStoppedListener(Thread.currentThread());
        }
    }

    private synchronized void clearStoppedListener(Thread stoppedThread) {
        if (acceptThread != stoppedThread) return;
        ServerSocket stoppedSocket = socket;
        socket = null;
        acceptThread = null;
        port = 0;
        if (stoppedSocket != null) {
            try { stoppedSocket.close(); } catch (Exception ignored) {}
        }
    }

    private boolean probeHealth(int listeningPort) {
        try (Socket probe = new Socket()) {
            probe.connect(new InetSocketAddress("127.0.0.1", listeningPort), 1_500);
            probe.setSoTimeout(1_500);
            OutputStream output = probe.getOutputStream();
            output.write((
                "GET /health HTTP/1.1\r\n" +
                "Host: 127.0.0.1\r\n" +
                "Connection: close\r\n\r\n"
            ).getBytes(StandardCharsets.US_ASCII));
            output.flush();
            byte[] status = new byte[15];
            int read = probe.getInputStream().read(status);
            return read > 0 && new String(status, 0, read, StandardCharsets.US_ASCII)
                .startsWith("HTTP/1.1 200");
        } catch (Exception ignored) {
            return false;
        }
    }

    private void handle(Socket client) {
        try (Socket ignored = client;
             BufferedInputStream input = new BufferedInputStream(client.getInputStream());
             BufferedOutputStream output = new BufferedOutputStream(client.getOutputStream())) {
            try {
                Request request = readRequest(input);
                if ("OPTIONS".equals(request.method)) {
                    writeJson(output, 204, new JSONObject());
                    return;
                }
                if ("GET".equals(request.method) && "/health".equals(request.pathname)) {
                    writeData(output, 200, new JSONObject()
                        .put("status", "ok")
                        .put("service", "aetherx-android-local-hub"));
                    return;
                }
                if (request.pathname.startsWith("/api/v1/peer/")) {
                    verifyPeer(request);
                    if ("GET".equals(request.method) &&
                        request.pathname.startsWith("/api/v1/peer/media/") &&
                        request.pathname.endsWith("/blob")) {
                        servePeerMediaChunk(output, request);
                        return;
                    }
                    JSONObject nativeResponse = dispatchNativePeer(request);
                    if (nativeResponse != null) {
                        writeData(output, 200, nativeResponse);
                        return;
                    }
                    JSONObject response = dispatchBridge(
                        request.method,
                        request.path,
                        request.body
                    );
                    if (response.optInt("status", 200) >= 400) {
                        writeBridgeResponse(output, response);
                        return;
                    }
                    if ("POST".equals(request.method) &&
                        "/api/v1/peer/client-sessions/mint".equals(request.pathname)) {
                        JSONObject data = response.optJSONObject("data");
                        if (data == null) data = new JSONObject();
                        LocalHubClientSessionStore.Session session = sessionStore.issue();
                        data.put("token", session.token).put("expiresAt", session.expiresAt);
                        writeData(output, 200, data);
                    } else {
                        writeBridgeResponse(output, response);
                    }
                    return;
                }
                String token = bearer(request.headers.get("authorization"));
                if (token.isEmpty()) token = queryParameter(request.path, "access_token");
                if (!sessionStore.validate(token)) {
                    writeError(output, 401, "AUTH_REQUIRED", "请先完成 Hub 会话交接。");
                    return;
                }
                if ("GET".equals(request.method) && request.pathname.startsWith("/api/v1/media/")) {
                    serveMedia(output, request.pathname.substring("/api/v1/media/".length()));
                    return;
                }
                if (!request.pathname.startsWith("/api/v1/")) {
                    writeError(output, 404, "ROUTE_NOT_FOUND", "Local Hub 没有这个接口。");
                    return;
                }
                writeBridgeResponse(output, dispatchBridge(
                    request.method,
                    request.path,
                    request.body
                ));
            } catch (PeerAuthException error) {
                int status = "PEER_REQUEST_REPLAYED".equals(error.getMessage()) ? 409 : 401;
                writeError(output, status, error.getMessage(), "Hub 间认证失败。");
            } catch (IllegalStateException error) {
                String code = String.valueOf(error.getMessage());
                int status = "LOCAL_HUB_RUNTIME_UNAVAILABLE".equals(code) ||
                    "LOCAL_HUB_BUSY".equals(code)
                    ? 503
                    : code.startsWith("SWITCH_") ? 409 : 500;
                writeError(output, status, code, localErrorMessage(error));
            }
        } catch (Exception error) {
            Log.w(TAG, "Local Hub request failed", error);
        }
    }

    private JSONObject dispatchBridge(String method, String path, JSONObject body) throws Exception {
        if (!bridgeWorkers.tryAcquire(BRIDGE_QUEUE_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
            throw new IllegalStateException("LOCAL_HUB_BUSY");
        }
        try {
            return LocalHubNetworkBridge.dispatch(method, path, body);
        } finally {
            bridgeWorkers.release();
        }
    }

    private JSONObject dispatchNativePeer(Request request) throws Exception {
        if ("GET".equals(request.method) && "/api/v1/peer/status".equals(request.pathname)) {
            return service.status();
        }
        if ("GET".equals(request.method) && "/api/v1/peer/operations".equals(request.pathname)) {
            return service.peerOperations(
                queryParameter(request.path, "origin"),
                queryLong(request.path, "after", 0),
                (int) queryLong(request.path, "limit", 200)
            );
        }
        if ("GET".equals(request.method) && "/api/v1/peer/media/manifest".equals(request.pathname)) {
            return service.peerMediaManifest(
                queryParameter(request.path, "cursor"),
                (int) queryLong(request.path, "limit", 200)
            );
        }
        if (!"POST".equals(request.method)) return null;
        if ("/api/v1/peer/hello".equals(request.pathname)) {
            return service.peerHello(request.body);
        }
        if ("/api/v1/peer/acknowledgements".equals(request.pathname)) {
            return service.peerAcknowledgements(request.body);
        }
        if ("/api/v1/peer/client-sessions/mint".equals(request.pathname)) {
            JSONObject data = service.peerClientSession();
            LocalHubClientSessionStore.Session session = sessionStore.issue();
            return data.put("token", session.token).put("expiresAt", session.expiresAt);
        }
        if ("/api/v1/peer/switch/preflight".equals(request.pathname)) {
            return service.createPeerSwitchPreflightProof();
        }
        if ("/api/v1/peer/synchronize".equals(request.pathname)) {
            return service.synchronize();
        }
        if ("/api/v1/peer/switch/control".equals(request.pathname)) {
            return service.applyPeerSwitchControl(request.body);
        }
        if ("/api/v1/peer/switch/final-sync".equals(request.pathname)) {
            return service.runPeerFinalSync(request.body);
        }
        if ("/api/v1/peer/mobile-switch/request".equals(request.pathname)) {
            return service.switchToPeer();
        }
        return null;
    }

    private void servePeerMediaChunk(OutputStream output, Request request) throws Exception {
        String prefix = "/api/v1/peer/media/";
        String suffix = "/blob";
        String encodedMediaId = request.pathname.substring(
            prefix.length(),
            request.pathname.length() - suffix.length()
        );
        String mediaId = URLDecoder.decode(encodedMediaId, StandardCharsets.UTF_8.name());
        JSONObject media = service.media(mediaId);
        File file = new File(media.getString("path"));
        long byteSize = media.getLong("byteSize");
        long offset = queryLong(request.path, "offset", 0);
        int length = (int) Math.min(
            1024 * 1024,
            queryLong(request.path, "length", 1024 * 1024)
        );
        if (!file.isFile() || file.length() != byteSize || offset >= byteSize || length < 1) {
            writeError(output, 416, "MEDIA_RANGE_INVALID", "媒体分块范围无效。");
            return;
        }
        int expected = (int) Math.min(length, byteSize - offset);
        byte[] bytes = new byte[expected];
        int read = 0;
        try (FileInputStream fileInput = new FileInputStream(file)) {
            long skipped = 0;
            while (skipped < offset) {
                long next = fileInput.skip(offset - skipped);
                if (next <= 0) throw new IllegalStateException("LOCAL_HUB_MEDIA_READ_FAILED");
                skipped += next;
            }
            while (read < expected) {
                int next = fileInput.read(bytes, read, expected - read);
                if (next < 0) break;
                read += next;
            }
        }
        if (read != expected) throw new IllegalStateException("LOCAL_HUB_MEDIA_READ_FAILED");
        String headers = "HTTP/1.1 200 OK\r\n" +
            "Content-Type: application/octet-stream\r\n" +
            "Content-Length: " + bytes.length + "\r\n" +
            "Cache-Control: no-store\r\n" +
            "Accept-Ranges: bytes\r\n" +
            "X-AetherX-Blob-Hash: " + media.getString("contentHash") + "\r\n" +
            "X-AetherX-Chunk-Hash: " + LocalHubDatabase.sha256(bytes) + "\r\n" +
            "X-AetherX-Blob-Offset: " + offset + "\r\n" +
            "X-AetherX-Blob-Size: " + byteSize + "\r\n" +
            "Connection: close\r\n\r\n";
        output.write(headers.getBytes(StandardCharsets.US_ASCII));
        output.write(bytes);
        output.flush();
    }

    private void serveMedia(OutputStream output, String encodedMediaId) throws Exception {
        String mediaId = URLDecoder.decode(encodedMediaId, StandardCharsets.UTF_8.name());
        JSONObject media = service.media(mediaId);
        File file = new File(media.getString("path"));
        if (!file.isFile()) {
            writeError(output, 404, "LOCAL_HUB_MEDIA_NOT_FOUND", "手机 Hub 尚未缓存这张图片。");
            return;
        }
        String headers = "HTTP/1.1 200 OK\r\n" +
            "Content-Type: " + media.optString("mimeType", "application/octet-stream") + "\r\n" +
            "Content-Length: " + file.length() + "\r\n" +
            "Cache-Control: private, max-age=31536000, immutable\r\n" +
            "Access-Control-Allow-Origin: *\r\n" +
            "Connection: close\r\n\r\n";
        output.write(headers.getBytes(StandardCharsets.US_ASCII));
        try (InputStream fileInput = new FileInputStream(file)) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = fileInput.read(buffer)) >= 0) output.write(buffer, 0, read);
        }
        output.flush();
    }

    private void verifyPeer(Request request) throws Exception {
        JSONObject secrets = secretStore.load();
        JSONObject credential = secrets == null ? null : secrets.optJSONObject("peerCredential");
        if (secrets == null || credential == null) throw new PeerAuthException("PEER_AUTH_INVALID");
        String spaceId = requiredHeader(request, "x-aetherx-peer-space");
        String nodeId = requiredHeader(request, "x-aetherx-peer-node");
        String keyId = requiredHeader(request, "x-aetherx-peer-key");
        String timestampValue = requiredHeader(request, "x-aetherx-peer-timestamp");
        String nonce = requiredHeader(request, "x-aetherx-peer-nonce");
        String signature = requiredHeader(request, "x-aetherx-peer-signature").toLowerCase();
        long timestamp;
        try { timestamp = Long.parseLong(timestampValue); }
        catch (Exception error) { throw new PeerAuthException("PEER_TIMESTAMP_INVALID"); }
        long now = System.currentTimeMillis();
        if (Math.abs(now - timestamp) > PEER_ALLOWED_SKEW_MS) {
            throw new PeerAuthException("PEER_REQUEST_EXPIRED");
        }
        if (!spaceId.equals(secrets.optString("spaceId")) ||
            !nodeId.equals(secrets.optString("peerNodeId")) ||
            !keyId.equals(credential.optString("keyId")) ||
            !nonce.matches("^[A-Za-z0-9:_-]{16,200}$") ||
            !signature.matches("^[a-f0-9]{64}$")) {
            throw new PeerAuthException("PEER_AUTH_INVALID");
        }
        byte[] sharedSecret = Base64.decode(credential.optString("sharedSecret"), Base64.DEFAULT);
        if (sharedSecret.length != 32) throw new PeerAuthException("PEER_AUTH_INVALID");
        JSONObject material = new JSONObject()
            .put("version", 1)
            .put("spaceId", spaceId)
            .put("nodeId", nodeId)
            .put("keyId", keyId)
            .put("method", request.method)
            .put("path", request.path)
            .put("timestamp", timestamp)
            .put("nonce", nonce)
            .put("bodyHash", LocalHubDatabase.sha256(LocalHubDatabase.canonical(request.body)));
        String canonicalHash = LocalHubDatabase.sha256(LocalHubDatabase.canonical(material));
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(sharedSecret, "HmacSHA256"));
        byte[] expected = mac.doFinal(canonicalHash.getBytes(StandardCharsets.UTF_8));
        if (!MessageDigest.isEqual(expected, hexBytes(signature))) {
            throw new PeerAuthException("PEER_AUTH_INVALID");
        }
        peerNonces.entrySet().removeIf(entry -> entry.getValue() < now - PEER_ALLOWED_SKEW_MS * 2);
        if (peerNonces.putIfAbsent(spaceId + "\n" + nodeId + "\n" + nonce, now) != null) {
            throw new PeerAuthException("PEER_REQUEST_REPLAYED");
        }
    }

    private Request readRequest(BufferedInputStream input) throws Exception {
        String requestLine = readLine(input);
        String[] parts = requestLine.split(" ", 3);
        if (parts.length != 3 || !parts[2].startsWith("HTTP/1.")) {
            throw new IllegalArgumentException("invalid request line");
        }
        String method = parts[0].toUpperCase();
        String path = parts[1];
        if (!path.startsWith("/") || path.startsWith("//")) throw new IllegalArgumentException("invalid path");
        Map<String, String> headers = new HashMap<>();
        while (true) {
            String line = readLine(input);
            if (line.isEmpty()) break;
            int colon = line.indexOf(':');
            if (colon > 0) headers.put(
                line.substring(0, colon).trim().toLowerCase(),
                line.substring(colon + 1).trim()
            );
        }
        int length = 0;
        try { length = Integer.parseInt(headers.getOrDefault("content-length", "0")); }
        catch (Exception error) { throw new IllegalArgumentException("invalid content length"); }
        if (length < 0 || length > MAX_BODY_BYTES) throw new IllegalArgumentException("request too large");
        byte[] bytes = new byte[length];
        int offset = 0;
        while (offset < length) {
            int read = input.read(bytes, offset, length - offset);
            if (read < 0) throw new IllegalArgumentException("request body truncated");
            offset += read;
        }
        JSONObject body = length == 0
            ? new JSONObject()
            : new JSONObject(new String(bytes, StandardCharsets.UTF_8));
        int query = path.indexOf('?');
        return new Request(method, path, query < 0 ? path : path.substring(0, query), headers, body);
    }

    private String readLine(BufferedInputStream input) throws Exception {
        ByteArrayOutputStream line = new ByteArrayOutputStream();
        int current;
        while ((current = input.read()) >= 0) {
            if (current == '\n') break;
            if (current != '\r') line.write(current);
            if (line.size() > 16 * 1024) throw new IllegalArgumentException("header line too long");
        }
        if (current < 0 && line.size() == 0) throw new IllegalArgumentException("connection closed");
        return line.toString(StandardCharsets.UTF_8.name());
    }

    private void writeBridgeResponse(OutputStream output, JSONObject response) throws Exception {
        int status = response.optInt("status", 200);
        if (status >= 400) {
            JSONObject error = response.optJSONObject("error");
            writeError(
                output,
                status,
                error == null ? "LOCAL_HUB_REQUEST_FAILED" : error.optString("code", "LOCAL_HUB_REQUEST_FAILED"),
                error == null ? "手机 Hub 请求失败。" : error.optString("message", "手机 Hub 请求失败。")
            );
            return;
        }
        writeData(output, status, response.opt("data"));
    }

    private void writeData(OutputStream output, int status, Object data) throws Exception {
        writeJson(output, status, new JSONObject().put("data", data == null ? JSONObject.NULL : data));
    }

    private void writeError(OutputStream output, int status, String code, String message) throws Exception {
        writeJson(output, status, new JSONObject().put("error", new JSONObject()
            .put("code", code)
            .put("message", message)));
    }

    private void writeJson(OutputStream output, int status, JSONObject payload) throws Exception {
        byte[] body = payload.toString().getBytes(StandardCharsets.UTF_8);
        String headers = "HTTP/1.1 " + status + " " + reason(status) + "\r\n" +
            "Content-Type: application/json; charset=utf-8\r\n" +
            "Content-Length: " + body.length + "\r\n" +
            "Cache-Control: no-store\r\n" +
            "Access-Control-Allow-Origin: *\r\n" +
            "Access-Control-Allow-Headers: Authorization, Content-Type, X-Request-Id\r\n" +
            "Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS\r\n" +
            "Connection: close\r\n\r\n";
        output.write(headers.getBytes(StandardCharsets.US_ASCII));
        if (status != 204) output.write(body);
        output.flush();
    }

    private static String requiredHeader(Request request, String name) {
        String value = request.headers.getOrDefault(name, "").trim();
        if (value.isEmpty()) throw new PeerAuthException("PEER_AUTH_REQUIRED");
        return value;
    }

    private static String bearer(String value) {
        if (value == null || !value.regionMatches(true, 0, "Bearer ", 0, 7)) return "";
        return value.substring(7).trim();
    }

    private static String queryParameter(String path, String name) {
        int query = path.indexOf('?');
        if (query < 0) return "";
        for (String pair : path.substring(query + 1).split("&")) {
            String[] parts = pair.split("=", 2);
            try {
                if (URLDecoder.decode(parts[0], "UTF-8").equals(name)) {
                    return parts.length > 1 ? URLDecoder.decode(parts[1], "UTF-8") : "";
                }
            } catch (Exception ignored) {}
        }
        return "";
    }

    private static long queryLong(String path, String name, long fallback) {
        try {
            return Math.max(0, Long.parseLong(queryParameter(path, name)));
        } catch (Exception ignored) {
            return fallback;
        }
    }

    private static byte[] hexBytes(String value) {
        byte[] bytes = new byte[value.length() / 2];
        for (int index = 0; index < bytes.length; index += 1) {
            bytes[index] = (byte) Integer.parseInt(value.substring(index * 2, index * 2 + 2), 16);
        }
        return bytes;
    }

    private static boolean isPrivateLan(String host) {
        String[] parts = host.split("\\.");
        if (parts.length != 4) return false;
        int first = Integer.parseInt(parts[0]);
        int second = Integer.parseInt(parts[1]);
        return first == 10 || (first == 172 && second >= 16 && second <= 31) ||
            (first == 192 && second == 168);
    }

    private static boolean isTailscale(String host) {
        String[] parts = host.split("\\.");
        if (parts.length != 4) return false;
        int first = Integer.parseInt(parts[0]);
        int second = Integer.parseInt(parts[1]);
        return first == 100 && second >= 64 && second <= 127;
    }

    private static boolean isLanInterface(String name) {
        return name.startsWith("wlan") ||
            name.startsWith("wifi") ||
            name.startsWith("eth") ||
            name.startsWith("en") ||
            name.startsWith("rndis");
    }

    private static String reason(int status) {
        if (status == 200) return "OK";
        if (status == 204) return "No Content";
        if (status == 400) return "Bad Request";
        if (status == 401) return "Unauthorized";
        if (status == 403) return "Forbidden";
        if (status == 404) return "Not Found";
        if (status == 409) return "Conflict";
        if (status == 416) return "Range Not Satisfiable";
        if (status == 501) return "Not Implemented";
        if (status == 503) return "Service Unavailable";
        return "Internal Server Error";
    }

    private static String localErrorMessage(IllegalStateException error) {
        if ("LOCAL_HUB_RUNTIME_UNAVAILABLE".equals(error.getMessage())) {
            return "手机 Hub 的应用运行时尚未准备好，请打开 AetherX 手机端。";
        }
        return "手机 Hub 网络服务暂时不可用。";
    }

    private static final class Request {
        final String method;
        final String path;
        final String pathname;
        final Map<String, String> headers;
        final JSONObject body;

        Request(String method, String path, String pathname, Map<String, String> headers, JSONObject body) {
            this.method = method;
            this.path = path;
            this.pathname = pathname;
            this.headers = headers;
            this.body = body;
        }
    }

    private static final class PeerAuthException extends IllegalStateException {
        PeerAuthException(String code) { super(code); }
    }
}
