import { AetherApi } from "./api";

export interface HubPairingCode {
  protocolVersion: number;
  schemaVersion: number;
  spaceId: string;
  sourceNodeId: string;
  sessionId: string;
  secret: string;
  serverEphemeralPublicKey: string;
  endpoints: Array<{
    transport: "lan" | "anywhere";
    address: string;
    priority: number;
    certificateFingerprint?: string;
  }>;
  expiresAt: number;
  resolverServerUrl?: string;
}

export interface HubPairingReference {
  version: 2;
  serverUrls: string[];
  sessionId: string;
  secret: string;
  expiresAt: number;
}

interface ResolvedHubPairingReference {
  pairing: Record<string, unknown>;
  serverUrl: string;
}

interface LocalHubBridge {
  status: { value: { nodeId: string } | null };
  refresh(): Promise<{ nodeId: string } | null>;
  configure(input: Record<string, unknown>): Promise<unknown>;
  importSnapshot(input: {
    snapshotId: string;
    spaceId: string;
    tables: Record<string, unknown[]>;
    account: Record<string, unknown>;
    credentials: Record<string, unknown>;
    media: Array<Record<string, unknown>>;
    manifest: Record<string, unknown>;
    replication: Record<string, unknown>;
  }): Promise<unknown>;
  synchronize(): Promise<unknown>;
  bootstrapBlobs(): Promise<unknown>;
  finalizeBootstrap(): Promise<unknown>;
}

export function parseHubPairingCode(value: string): HubPairingCode {
  const parsed = decodeHubPairingValue(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw invalidHubPairingCode();
  }
  const input = parsed as Record<string, unknown>;
  const endpoints = Array.isArray(input.endpoints) ? input.endpoints : [];
  const result: HubPairingCode = {
    protocolVersion: Number(input.protocolVersion),
    schemaVersion: Number(input.schemaVersion),
    spaceId: required(input.spaceId, "spaceId"),
    sourceNodeId: required(input.sourceNodeId, "sourceNodeId"),
    sessionId: required(input.sessionId, "sessionId"),
    secret: required(input.secret, "secret"),
    serverEphemeralPublicKey: required(input.serverEphemeralPublicKey, "serverEphemeralPublicKey"),
    endpoints: endpoints.map((item) => {
      const endpoint = item as Record<string, unknown>;
      const transport = endpoint.transport === "anywhere" ? "anywhere" : "lan";
      const address = new URL(required(endpoint.address, "endpoint.address")).origin;
      return {
        transport,
        address,
        priority: Number(endpoint.priority) || 0,
        certificateFingerprint: String(endpoint.certificateFingerprint || "")
      };
    }),
    expiresAt: Number(input.expiresAt)
  };
  if (
    result.protocolVersion !== 1 ||
    !Number.isSafeInteger(result.schemaVersion) ||
    result.schemaVersion < 1 ||
    result.secret.length < 32 ||
    result.endpoints.length < 1 ||
    result.expiresAt <= Date.now()
  ) {
    throw new Error("手机 Hub 配对码已过期或与当前版本不兼容。 ");
  }
  return result;
}

export function parseHubPairingReference(value: string): HubPairingReference | null {
  const raw = String(value || "").trim();
  let input: Record<string, unknown>;
  try {
    if (/^aetherx:\/\/hub-pair\?/i.test(raw)) {
      const url = new URL(raw);
      if (url.searchParams.get("v") !== "2") return null;
      input = {
        version: 2,
        serverUrls: url.searchParams.getAll("s"),
        sessionId: url.searchParams.get("i"),
        secret: url.searchParams.get("k"),
        expiresAt: url.searchParams.get("e")
      };
    } else if (raw.startsWith("{")) {
      input = JSON.parse(raw) as Record<string, unknown>;
      if (Number(input.version) !== 2) return null;
    } else {
      return null;
    }
    const serverUrls = normalizeReferenceUrls(input.serverUrls, input.serverUrl);
    const reference = {
      version: 2 as const,
      serverUrls,
      sessionId: required(input.sessionId, "sessionId"),
      secret: required(input.secret, "secret"),
      expiresAt: Number(input.expiresAt)
    };
    if (
      reference.secret.length < 32 ||
      reference.expiresAt <= Date.now()
    ) {
      throw invalidHubPairingCode();
    }
    return reference;
  } catch (cause) {
    if (cause instanceof Error && cause.message === HUB_PAIRING_CODE_ERROR) throw cause;
    throw invalidHubPairingCode();
  }
}

export async function resolveHubPairingCode(
  value: string,
  resolver: (reference: HubPairingReference) => Promise<Record<string, unknown> | ResolvedHubPairingReference>
    = resolveHubPairingReference
) {
  const reference = parseHubPairingReference(value);
  if (!reference) return parseHubPairingCode(value);
  const resolved = await resolver(reference);
  const wrapped = "pairing" in resolved && "serverUrl" in resolved;
  const pairing = parseHubPairingCode(JSON.stringify(wrapped ? resolved.pairing : resolved));
  if (wrapped) pairing.resolverServerUrl = new URL(String(resolved.serverUrl)).origin;
  if (pairing.sessionId !== reference.sessionId || pairing.secret !== reference.secret) {
    throw new Error("电脑端返回的 Hub 配对资料与短码不一致。 ");
  }
  return pairing;
}

async function resolveHubPairingReference(reference: HubPairingReference) {
  const controllers = reference.serverUrls.map(() => new AbortController());
  const timers = controllers.map((controller) => globalThis.setTimeout(() => controller.abort(), 6_000));
  return new Promise<ResolvedHubPairingReference>((resolve, reject) => {
    let failures = 0;
    let settled = false;
    reference.serverUrls.forEach((serverUrl, index) => {
      const api = new AetherApi({ baseUrl: serverUrl });
      void api.resolveHubPairingSession(reference.sessionId, reference.secret, controllers[index].signal)
        .then((pairing) => {
          if (settled) return;
          settled = true;
          controllers.forEach((controller, controllerIndex) => {
            globalThis.clearTimeout(timers[controllerIndex]);
            if (controllerIndex !== index) controller.abort();
          });
          resolve({ pairing, serverUrl });
        })
        .catch(() => {
          globalThis.clearTimeout(timers[index]);
          failures += 1;
          if (!settled && failures === reference.serverUrls.length) {
            settled = true;
            reject(new Error("无法自动连接电脑 AetherX。已尝试 USB、局域网和 Anywhere，请确认电脑端仍在运行。"));
          }
        });
    });
  });
}

function normalizeReferenceUrls(values: unknown, fallback: unknown) {
  const candidates = Array.isArray(values) ? [...values] : [];
  if (!candidates.length && fallback) candidates.push(fallback);
  const serverUrls: string[] = [];
  candidates.forEach((value) => {
    const server = new URL(required(value, "serverUrl"));
    if (!["http:", "https:"].includes(server.protocol)) throw invalidHubPairingCode();
    if (!serverUrls.includes(server.origin)) serverUrls.push(server.origin);
  });
  if (!serverUrls.length) throw invalidHubPairingCode();
  return serverUrls.slice(0, 5);
}

function decodeHubPairingValue(value: unknown, depth = 0): unknown {
  if (depth > 6) throw invalidHubPairingCode();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if ("protocolVersion" in record && "sessionId" in record) return record;
    for (const key of ["ScanResult", "scanResult", "rawValue", "text", "content", "value", "data"]) {
      if (typeof record[key] === "string") return decodeHubPairingValue(record[key], depth + 1);
    }
    throw invalidHubPairingCode();
  }

  const raw = String(value || "")
    .replace(/^[\s\u200B-\u200D\u2060\uFEFF]+|[\s\u200B-\u200D\u2060\uFEFF]+$/g, "")
    .replace(/^```(?:text)?\s*|\s*```$/gi, "")
    .trim();
  if (!raw) throw invalidHubPairingCode();

  if (raw.startsWith('"') || raw.startsWith("{") || raw.startsWith("[")) {
    try {
      return decodeHubPairingValue(JSON.parse(raw), depth + 1);
    } catch (cause) {
      if (cause instanceof Error && cause.message === HUB_PAIRING_CODE_ERROR) throw cause;
    }
  }

  const uri = raw.match(/aetherx:\/\/hub-pair\?[^\s"'<>]+/i)?.[0];
  if (uri) {
    try {
      const payload = new URL(uri).searchParams.get("payload");
      if (!payload) throw invalidHubPairingCode();
      return decodeHubPairingValue(
        new TextDecoder().decode(base64UrlDecode(payload)),
        depth + 1
      );
    } catch {
      throw invalidHubPairingCode();
    }
  }

  if (/^[A-Za-z0-9_-]+$/.test(raw)) {
    try {
      return decodeHubPairingValue(
        new TextDecoder().decode(base64UrlDecode(raw)),
        depth + 1
      );
    } catch {
      // Fall through to the single user-facing format error below.
    }
  }
  throw invalidHubPairingCode();
}

const HUB_PAIRING_CODE_ERROR = "手机 Hub 配对码无法识别，请重新生成后扫描或粘贴。";

function invalidHubPairingCode() {
  return new Error(HUB_PAIRING_CODE_ERROR);
}

export async function pairAndroidLocalHub(
  code: string,
  localHub: LocalHubBridge,
  onState?: (state: string) => void
) {
  onState?.("正在自动检测 USB、局域网与 Anywhere…");
  const pairing = await resolveHubPairingCode(code);
  onState?.("正在创建手机 Hub 身份…");
  const localStatus = localHub.status.value || await localHub.refresh();
  if (!localStatus?.nodeId) throw new Error("Android Local Hub 还没有准备好。 ");
  const identity = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const ephemeral = await crypto.subtle.generateKey(
    { name: "X25519" } as AlgorithmIdentifier,
    true,
    ["deriveBits"]
  ) as CryptoKeyPair;
  const publicIdentity = base64Encode(await crypto.subtle.exportKey("spki", identity.publicKey));
  const clientEphemeralPublicKey = base64Encode(await crypto.subtle.exportKey("spki", ephemeral.publicKey));
  const claim = {
    sessionId: pairing.sessionId,
    spaceId: pairing.spaceId,
    nodeId: localStatus.nodeId,
    nodeName: "Android Local Hub",
    platform: "android",
    publicIdentity,
    clientEphemeralPublicKey,
    protocolVersion: pairing.protocolVersion,
    schemaVersion: pairing.schemaVersion,
    endpoints: [] as unknown[]
  };
  const rawSignature = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    identity.privateKey,
    new TextEncoder().encode(canonicalStringify({ version: 1, ...claim }))
  ));
  onState?.("正在连接电脑 Hub…");
  const pairingApi = await claimThroughReachableEndpoint(pairing, {
    secret: pairing.secret,
    ...claim,
    identityProof: base64Encode(ecdsaSignatureToDer(rawSignature))
  });
  onState?.("等待电脑端确认手机 Hub…");
  const deadline = Math.min(pairing.expiresAt, Date.now() + 10 * 60_000);
  let redeemed: Awaited<ReturnType<AetherApi["redeemHubPairingSession"]>> | null = null;
  while (Date.now() < deadline) {
    try {
      redeemed = await pairingApi.redeemHubPairingSession(pairing.sessionId, pairing.secret);
      break;
    } catch (cause) {
      if (!isErrorCode(cause, "HUB_PAIRING_STATE_CONFLICT")) throw cause;
      await delay(1_500);
    }
  }
  if (!redeemed) throw new Error("电脑端没有及时确认，请重新生成手机 Hub 配对码。 ");
  onState?.("正在解开副本密钥…");
  const clientPrivateKey = await crypto.subtle.exportKey("pkcs8", ephemeral.privateKey);
  const packageValue = await unwrapPairingEnvelope(
    redeemed.envelope,
    clientPrivateKey
  );
  if (packageValue.localNodeId !== localStatus.nodeId || packageValue.spaceId !== pairing.spaceId) {
    throw new Error("电脑端返回的 Hub 身份与本机不一致。 ");
  }
  packageValue.endpoints = includeResolvedPeerEndpoint(
    packageValue.endpoints,
    String(packageValue.peerNodeId),
    pairingApi.serverUrl
  );
  await localHub.configure(packageValue);
  onState?.("正在复制完整结构化数据…");
  const bootstrap = await downloadStructuredSnapshot(packageValue, pairingApi.serverUrl);
  await localHub.importSnapshot({
    snapshotId: bootstrap.snapshotId,
    spaceId: packageValue.spaceId,
    tables: bootstrap.tables,
    account: bootstrap.account,
    credentials: bootstrap.credentials,
    media: bootstrap.media,
    manifest: bootstrap.manifest,
    replication: bootstrap.replication
  });
  onState?.("正在校验并缓存原图…");
  await localHub.bootstrapBlobs();
  onState?.("正在确认手机 Hub 可接管…");
  await localHub.finalizeBootstrap();
  onState?.("手机 Hub 已成为可接管的完整备用节点");
  return {
    spaceId: packageValue.spaceId as string,
    localNodeId: packageValue.localNodeId as string,
    sourceNodeId: packageValue.peerNodeId as string,
    snapshotId: bootstrap.snapshotId,
    recordCount: Object.values(bootstrap.tables).reduce((sum, rows) => sum + rows.length, 0)
  };
}

async function claimThroughReachableEndpoint(
  pairing: HubPairingCode,
  claim: Record<string, unknown>
) {
  let lastError: unknown = null;
  const addresses = [
    pairing.resolverServerUrl,
    ...[...pairing.endpoints]
      .sort((left, right) => right.priority - left.priority)
      .map((endpoint) => endpoint.address)
  ].filter((address, index, values): address is string => Boolean(address) && values.indexOf(address) === index);
  for (const address of addresses) {
    const candidate = new AetherApi({ baseUrl: address });
    try {
      await withConnectionTimeout((signal) => candidate.health(signal), 6_000);
    } catch (cause) {
      lastError = cause;
      continue;
    }
    try {
      await withConnectionTimeout(
        (signal) => candidate.claimHubPairingSession(pairing.sessionId, claim, signal),
        15_000
      );
      return candidate;
    } catch (cause) {
      lastError = cause;
      if (
        cause &&
        typeof cause === "object" &&
        "status" in cause &&
        Number(cause.status) > 0
      ) throw cause;
    }
  }
  throw lastError || new Error("无法自动连接电脑 Hub，已尝试 USB、局域网和 Anywhere。 ");
}

function includeResolvedPeerEndpoint(value: unknown, nodeId: string, serverUrl: string) {
  const endpoints = Array.isArray(value) ? [...value] : [];
  const address = new URL(serverUrl).origin;
  const existing = endpoints.findIndex((item) => String(item?.address || "") === address);
  if (existing >= 0) {
    const [endpoint] = endpoints.splice(existing, 1);
    endpoints.unshift({ ...endpoint, priority: Math.max(1000, Number(endpoint?.priority) || 0) });
    return endpoints;
  }
  endpoints.unshift({
    nodeId,
    transport: "lan",
    address,
    priority: 1000,
    certificateFingerprint: ""
  });
  return endpoints;
}

async function withConnectionTimeout<T>(task: (signal: AbortSignal) => Promise<T>, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await task(controller.signal);
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function unwrapPairingEnvelope(envelopeValue: Record<string, unknown>, privateKeyBytes: ArrayBuffer) {
  const envelope = envelopeValue as {
    version: number;
    algorithm: string;
    aad: Record<string, unknown>;
    aadHash: string;
    iv: string;
    authenticationTag: string;
    ciphertext: string;
  };
  if (envelope.version !== 1 || envelope.algorithm !== "X25519+HKDF-SHA256+A256GCM") {
    throw new Error("手机 Hub 配对密钥包版本无效。 ");
  }
  if (await sha256Hex(canonicalStringify(envelope.aad)) !== envelope.aadHash) {
    throw new Error("手机 Hub 配对密钥包校验失败。 ");
  }
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyBytes,
    { name: "X25519" } as AlgorithmIdentifier,
    false,
    ["deriveBits"]
  );
  const publicKey = await crypto.subtle.importKey(
    "spki",
    base64Decode(String(envelope.aad.serverEphemeralPublicKey || "")),
    { name: "X25519" } as AlgorithmIdentifier,
    false,
    []
  );
  const shared = await crypto.subtle.deriveBits(
    { name: "X25519", public: publicKey } as EcdhKeyDeriveParams,
    privateKey,
    256
  );
  const hkdfKey = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  const wrappingKey = await crypto.subtle.deriveKey({
    name: "HKDF",
    hash: "SHA-256",
    salt: new TextEncoder().encode(String(envelope.aad.sessionId || "")),
    info: new TextEncoder().encode("aetherx-hub-pairing-v1")
  }, hkdfKey, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const clear = await crypto.subtle.decrypt({
    name: "AES-GCM",
    iv: base64Decode(envelope.iv),
    additionalData: new TextEncoder().encode(canonicalStringify(envelope.aad)),
    tagLength: 128
  }, wrappingKey, concatBytes(base64Decode(envelope.ciphertext), base64Decode(envelope.authenticationTag)));
  return JSON.parse(new TextDecoder().decode(clear)) as Record<string, any>;
}

async function downloadStructuredSnapshot(secrets: Record<string, any>, sourceServerUrl: string) {
  const credential = secrets.peerCredential as { keyId: string; sharedSecret: string };
  const peer = {
    baseUrl: new URL(sourceServerUrl).origin,
    spaceId: String(secrets.spaceId),
    nodeId: String(secrets.localNodeId),
    keyId: String(credential.keyId),
    sharedSecret: String(credential.sharedSecret)
  };
  const manifest = await peerJson(peer, "POST", "/api/v1/peer/snapshots", {});
  const snapshotId = required(manifest.id, "snapshot.id");
  const payload = await peerJson(
    peer,
    "GET",
    `/api/v1/peer/snapshots/${encodeURIComponent(snapshotId)}/payload`,
    {}
  );
  const snapshotPackage = await decryptSnapshotEnvelope(payload.envelope, String(secrets.spaceSyncKey));
  if (snapshotPackage.snapshotId !== snapshotId || snapshotPackage.manifest?.spaceId !== secrets.spaceId) {
    throw new Error("手机 Hub 快照身份校验失败。 ");
  }
  return {
    snapshotId,
    tables: snapshotPackage.metadata?.records as Record<string, unknown[]>,
    account: snapshotPackage.metadata?.account as Record<string, unknown>,
    credentials: snapshotPackage.metadata?.credentials as Record<string, unknown>,
    media: snapshotPackage.metadata?.media as Array<Record<string, unknown>>,
    manifest: snapshotPackage.manifest as Record<string, unknown>,
    replication: snapshotPackage.replication as Record<string, unknown>
  };
}

async function decryptSnapshotEnvelope(envelope: any, syncKey: string) {
  if (envelope?.version !== 1 || envelope?.algorithm !== "A256GCM") {
    throw new Error("手机 Hub 快照加密格式无效。 ");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    base64Decode(syncKey),
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );
  const clear = await crypto.subtle.decrypt({
    name: "AES-GCM",
    iv: base64Decode(envelope.iv),
    additionalData: new TextEncoder().encode(canonicalStringify(envelope.aad)),
    tagLength: 128
  }, key, concatBytes(base64Decode(envelope.ciphertext), base64Decode(envelope.authenticationTag)));
  return JSON.parse(new TextDecoder().decode(clear));
}

async function peerJson(
  peer: { baseUrl: string; spaceId: string; nodeId: string; keyId: string; sharedSecret: string },
  method: string,
  path: string,
  body: Record<string, unknown>
) {
  const timestamp = Date.now();
  const nonce = crypto.randomUUID();
  const material = {
    version: 1,
    spaceId: peer.spaceId,
    nodeId: peer.nodeId,
    keyId: peer.keyId,
    method,
    path,
    timestamp,
    nonce,
    bodyHash: await sha256Hex(canonicalStringify(body))
  };
  const materialHash = await sha256Hex(canonicalStringify(material));
  const key = await crypto.subtle.importKey(
    "raw",
    base64Decode(peer.sharedSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = hex(new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(materialHash)
  )));
  const response = await fetch(new URL(path, peer.baseUrl), {
    method,
    headers: {
      "X-AetherX-Peer-Space": peer.spaceId,
      "X-AetherX-Peer-Node": peer.nodeId,
      "X-AetherX-Peer-Key": peer.keyId,
      "X-AetherX-Peer-Timestamp": String(timestamp),
      "X-AetherX-Peer-Nonce": nonce,
      "X-AetherX-Peer-Signature": signature,
      ...(method === "GET" ? {} : { "Content-Type": "application/json" })
    },
    ...(method === "GET" ? {} : { body: canonicalStringify(body) }),
    redirect: "error"
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || `手机 Hub 复制请求失败（HTTP ${response.status}）。`);
  }
  return payload.data as Record<string, any>;
}

export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalStringify(object[key])}`).join(",")}}`;
}

function ecdsaSignatureToDer(signature: Uint8Array) {
  if (signature[0] === 0x30) return signature;
  if (signature.length !== 64) throw new Error("手机 Hub 身份签名格式无效。 ");
  const r = derInteger(signature.slice(0, 32));
  const s = derInteger(signature.slice(32));
  return new Uint8Array([0x30, r.length + s.length, ...r, ...s]);
}

function derInteger(value: Uint8Array) {
  let offset = 0;
  while (offset < value.length - 1 && value[offset] === 0) offset += 1;
  const bytes = value.slice(offset);
  const prefix = bytes[0] & 0x80 ? [0] : [];
  return new Uint8Array([0x02, bytes.length + prefix.length, ...prefix, ...bytes]);
}

async function sha256Hex(value: string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

function hex(value: Uint8Array) {
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function concatBytes(left: ArrayBuffer, right: ArrayBuffer) {
  const first = new Uint8Array(left);
  const second = new Uint8Array(right);
  const result = new Uint8Array(first.length + second.length);
  result.set(first, 0);
  result.set(second, first.length);
  return result;
}

function base64Encode(value: ArrayBuffer | Uint8Array) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64Decode(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return base64Decode(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
}

function required(value: unknown, field: string) {
  const result = String(value || "").trim();
  if (!result) throw new Error(`手机 Hub 配对码字段 ${field} 无效。 `);
  return result;
}

function isErrorCode(value: unknown, code: string) {
  return value instanceof Error && "code" in value && value.code === code;
}

function delay(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
