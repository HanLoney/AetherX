const { randomUUID } = require("node:crypto");
const {
  encryptSpaceSecret,
  providerCredentialAad
} = require("../replication/space-secret-envelope");

class ReplicatedAiConfigRepository {
  constructor(repository, replicationUnitOfWork) {
    this.repository = repository;
    this.replicationUnitOfWork = replicationUnitOfWork;
  }

  getStored(userId) {
    return this.repository.getStored(userId);
  }

  getPublic(userId) {
    return this.repository.getPublic(userId);
  }

  getCredentials(userId) {
    return this.repository.getCredentials(userId);
  }

  getImageStored(userId) {
    return this.repository.getImageStored(userId);
  }

  getImagePublic(userId) {
    return this.repository.getImagePublic(userId);
  }

  getImageCredentials(userId) {
    return this.repository.getImageCredentials(userId);
  }

  save(userId, input) {
    return this.saveWithRequestId(userId, input, internalRequestId()).result;
  }

  saveWithRequestId(userId, input, requestId) {
    return this.replicationUnitOfWork.execute(
      userId,
      requestId,
      (context) => this.saveConfig(userId, input, context, false)
    );
  }

  saveImage(userId, input) {
    return this.saveImageWithRequestId(
      userId,
      input,
      internalRequestId()
    ).result;
  }

  saveImageWithRequestId(userId, input, requestId) {
    return this.replicationUnitOfWork.execute(
      userId,
      requestId,
      (context) => this.saveConfig(userId, input, context, true)
    );
  }

  saveConfig(userId, input, context, image) {
    const now = Date.now();
    const result = image
      ? this.repository.saveImage(userId, input, { now })
      : this.repository.save(userId, input, { now });
    const credentials = image
      ? this.repository.getImageCredentials(userId)
      : this.repository.getCredentials(userId);
    const entityType = image ? "ai_image_configs" : "ai_configs";
    const entityId = "config";
    const aad = providerCredentialAad(context.spaceId, entityType, entityId);
    return {
      result,
      changes: [{
        entityType,
        entityId,
        operation: "upsert",
        payload: {
          provider_id: credentials.providerId,
          provider_name: credentials.providerName,
          base_url: credentials.baseUrl,
          model: credentials.model,
          credential: encryptSpaceSecret(
            credentials.apiKey,
            context.syncKey,
            aad,
            context.keyVersion
          ),
          updated_at: now
        }
      }]
    };
  }
}

function internalRequestId() {
  return `internal:${randomUUID()}`;
}

module.exports = { ReplicatedAiConfigRepository };
