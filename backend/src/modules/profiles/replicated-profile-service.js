const { randomUUID } = require("node:crypto");

class ReplicatedProfileService {
  constructor(service, replicationUnitOfWork) {
    this.service = service;
    this.replicationUnitOfWork = replicationUnitOfWork;
  }

  get(userId) {
    return this.service.get(userId);
  }

  save(userId, input) {
    return this.saveWithRequestId(userId, input, internalRequestId()).result;
  }

  saveWithRequestId(userId, input, requestId) {
    return this.replicationUnitOfWork.execute(userId, requestId, () => {
      const profile = this.service.save(userId, input);
      return { result: profile, changes: [profileUpsert(profile)] };
    });
  }

  patch(userId, input) {
    return this.patchWithRequestId(userId, input, internalRequestId()).result;
  }

  patchWithRequestId(userId, input, requestId) {
    return this.replicationUnitOfWork.execute(userId, requestId, () => {
      const profile = this.service.patch(userId, input);
      return { result: profile, changes: [profileUpsert(profile)] };
    });
  }
}

function profileUpsert(profile) {
  return {
    entityType: "user_profiles",
    entityId: "profile",
    operation: "upsert",
    payload: {
      display_name: profile.displayName,
      preferred_name: profile.preferredName,
      birthday: profile.birthday,
      bio: profile.bio,
      occupation: profile.occupation,
      goals: profile.goals,
      avatar_data_url: profile.avatarDataUrl,
      updated_at: profile.updatedAt
    }
  };
}

function internalRequestId() {
  return `internal:${randomUUID()}`;
}

module.exports = { profileUpsert, ReplicatedProfileService };
