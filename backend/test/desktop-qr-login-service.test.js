const assert = require("node:assert/strict");
const test = require("node:test");
const { createDecipheriv, createHmac } = require("node:crypto");
const {
  createDesktopLoginSpaceProof,
  DesktopQrLoginService
} = require("../src/modules/auth/desktop-qr-login-service");
const { canonicalStringify } = require("../src/modules/replication/operation-codec");

function fixture() {
  let now = 10_000;
  const endpoints = [];
  const syncKey = Buffer.alloc(32, 7);
  let issued = 0;
  const context = {
    space_id: "dd54c57b-a2a0-46ea-ba8e-d1ed95248f58",
    local_user_id: "user-1",
    local_node_id: "desktop-1",
    active_node_id: "mobile-1",
    epoch: 7,
    state: "stable"
  };
  const service = new DesktopQrLoginService({
    now: () => now,
    ttlMs: 60_000,
    authService: {
      createHandoffSession(userId) {
        return {
          token: `token:${userId}`,
          user: { id: userId, username: "loney", displayName: "洛尼" },
          expiresAt: now + 86_400_000
        };
      }
    },
    clusterRepository: {
      findContextByUserId(userId) {
        return userId === "user-1" ? context : null;
      },
      findContextBySpaceId(spaceId) {
        return spaceId === context.space_id ? context : null;
      },
      findNode(spaceId, nodeId) {
        return spaceId === context.space_id && nodeId === "mobile-1"
          ? { id: nodeId, platform: "android", revoked_at: null }
          : null;
      }
    },
    endpointRepository: {
      upsertNodeEndpoint(spaceId, nodeId, endpoint) {
        endpoints.push({ spaceId, nodeId, endpoint });
        return endpoint;
      }
    },
    peerAuthenticationService: {
      issueCredential(userId, nodeId) {
        assert.equal(userId, "user-1");
        assert.equal(nodeId, "mobile-1");
        issued += 1;
        return {
          keyId: `00000000-0000-4000-8000-${String(issued).padStart(12, "0")}`,
          sharedSecret: Buffer.alloc(32, issued).toString("base64")
        };
      }
    },
    spaceKeyService: {
      ensure(spaceId) {
        assert.equal(spaceId, context.space_id);
        return { key: syncKey, keyVersion: 1 };
      }
    }
  });
  return {
    service,
    endpoints,
    syncKey,
    context,
    issued: () => issued,
    advance: (value) => { now += value; }
  };
}

test("desktop QR login authorizes a local challenge through an Android Peer", () => {
  const { service, endpoints } = fixture();
  const challenge = service.create("::ffff:127.0.0.1");
  assert.equal(service.poll(challenge.id, challenge.secret, "127.0.0.1").status, "pending");

  const authorization = service.authorize({
    userId: "user-1",
    spaceId: "dd54c57b-a2a0-46ea-ba8e-d1ed95248f58",
    peerNodeId: "mobile-1",
    remoteAddress: "::ffff:192.168.1.24",
    body: {
      challengeId: challenge.id,
      secret: challenge.secret,
      mobilePort: 4319
    }
  });
  assert.equal(authorization.authorized, true);
  assert.deepEqual(endpoints, [{
    spaceId: "dd54c57b-a2a0-46ea-ba8e-d1ed95248f58",
    nodeId: "mobile-1",
    endpoint: {
      transport: "lan",
      address: "http://192.168.1.24:4319",
      priority: 700,
      certificateFingerprint: ""
    }
  }]);

  const result = service.poll(challenge.id, challenge.secret, "::1");
  assert.equal(result.status, "authorized");
  assert.equal(result.token, "token:user-1");
  assert.equal(result.activeNodeId, "mobile-1");
  assert.equal(result.mobileEndpoint, "http://192.168.1.24:4319");
  assert.throws(
    () => service.poll(challenge.id, challenge.secret, "127.0.0.1"),
    (error) => error.code === "DESKTOP_LOGIN_CHALLENGE_NOT_FOUND"
  );
});

test("desktop QR challenges are local-only and expire", () => {
  const { service, advance } = fixture();
  assert.throws(
    () => service.create("192.168.1.5"),
    (error) => error.code === "DESKTOP_LOGIN_LOCAL_ONLY"
  );
  const challenge = service.create("127.0.0.1");
  advance(60_001);
  assert.throws(
    () => service.poll(challenge.id, challenge.secret, "127.0.0.1"),
    (error) => error.code === "DESKTOP_LOGIN_CHALLENGE_EXPIRED"
  );
});

test("desktop QR login rejects a non-Android Peer", () => {
  const { service } = fixture();
  const challenge = service.create("127.0.0.1");
  assert.throws(
    () => service.authorize({
      userId: "user-1",
      spaceId: "dd54c57b-a2a0-46ea-ba8e-d1ed95248f58",
      peerNodeId: "desktop-2",
      remoteAddress: "192.168.1.25",
      body: { challengeId: challenge.id, secret: challenge.secret, mobilePort: 4319 }
    }),
    (error) => error.code === "DESKTOP_LOGIN_MOBILE_HUB_REQUIRED"
  );
});

test("desktop QR login rotates an invalid Peer credential through a Space proof", () => {
  const { service, syncKey, context, issued } = fixture();
  const challenge = service.create("127.0.0.1");
  const input = {
    version: 1,
    purpose: "aetherx-desktop-login-space-proof",
    challengeId: challenge.id,
    secretHash: require("node:crypto").createHash("sha256")
      .update(challenge.secret)
      .digest("hex"),
    expiresAt: challenge.expiresAt,
    spaceId: context.space_id,
    nodeId: "mobile-1",
    mobilePort: 4319,
    nonce: "nonce-for-recovery-0001"
  };
  const body = {
    ...input,
    secret: challenge.secret,
    proof: createDesktopLoginSpaceProof(input, syncKey)
  };

  const result = service.authorizeWithSpaceProof({
    body,
    remoteAddress: "192.168.1.24"
  });
  assert.equal(result.authorized, false);
  assert.equal(result.credentialRotated, true);
  assert.equal(issued(), 1);
  assert.equal(result.envelope.aad.mobileNodeId, "mobile-1");
  assert.equal(result.envelope.aad.computerNodeId, "desktop-1");

  const key = createHmac("sha256", syncKey)
    .update(`aetherx-desktop-login-credential-v1:${challenge.id}`)
    .digest();
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(result.envelope.iv, "base64")
  );
  decipher.setAAD(Buffer.from(canonicalStringify(result.envelope.aad)));
  decipher.setAuthTag(Buffer.from(result.envelope.authenticationTag, "base64"));
  const payload = JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(result.envelope.ciphertext, "base64")),
    decipher.final()
  ]).toString("utf8"));
  assert.equal(payload.peerCredential.keyId, result.envelope.aad.keyId);

  const repeated = service.authorizeWithSpaceProof({ body, remoteAddress: "192.168.1.24" });
  assert.equal(repeated.envelope.aad.keyId, result.envelope.aad.keyId);
  assert.equal(issued(), 1);

  assert.equal(service.poll(challenge.id, challenge.secret, "127.0.0.1").status, "pending");
  const finalized = service.authorize({
    userId: "user-1",
    spaceId: context.space_id,
    peerNodeId: "mobile-1",
    remoteAddress: "192.168.1.24",
    body: {
      challengeId: challenge.id,
      secret: challenge.secret,
      mobilePort: 4319
    }
  });
  assert.equal(finalized.authorized, true);
  assert.throws(
    () => service.authorizeWithSpaceProof({ body, remoteAddress: "192.168.1.24" }),
    (error) => error.code === "DESKTOP_LOGIN_ALREADY_AUTHORIZED"
  );
  assert.equal(service.poll(challenge.id, challenge.secret, "127.0.0.1").status, "authorized");
});

test("desktop QR login rejects wrong Space proofs and inactive Android nodes", () => {
  const { service, syncKey, context, issued } = fixture();
  const challenge = service.create("127.0.0.1");
  const input = {
    version: 1,
    purpose: "aetherx-desktop-login-space-proof",
    challengeId: challenge.id,
    secretHash: require("node:crypto").createHash("sha256")
      .update(challenge.secret)
      .digest("hex"),
    expiresAt: challenge.expiresAt,
    spaceId: context.space_id,
    nodeId: "mobile-1",
    mobilePort: 4319,
    nonce: "nonce-for-recovery-0002"
  };
  assert.throws(
    () => service.authorizeWithSpaceProof({
      body: { ...input, secret: challenge.secret, proof: "0".repeat(64) },
      remoteAddress: "192.168.1.24"
    }),
    (error) => error.code === "DESKTOP_LOGIN_SPACE_PROOF_INVALID"
  );
  assert.equal(issued(), 0);

  context.active_node_id = "desktop-1";
  assert.throws(
    () => service.authorizeWithSpaceProof({
      body: {
        ...input,
        nonce: "nonce-for-recovery-0003",
        secret: challenge.secret,
        proof: createDesktopLoginSpaceProof({
          ...input,
          nonce: "nonce-for-recovery-0003"
        }, syncKey)
      },
      remoteAddress: "192.168.1.24"
    }),
    (error) => error.code === "DESKTOP_LOGIN_MOBILE_HUB_REQUIRED"
  );
  assert.equal(issued(), 0);
});
