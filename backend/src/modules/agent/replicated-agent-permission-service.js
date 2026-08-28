const { randomUUID } = require("node:crypto");
const {
  moduleSettingUpsert
} = require("../module-settings/replicated-module-manager");
const {
  AUTO_APPROVE_WRITES_SETTING_ID
} = require("./agent-permission-repository");

class ReplicatedAgentPermissionService {
  constructor(repository, replicationUnitOfWork) {
    this.repository = repository;
    this.replicationUnitOfWork = replicationUnitOfWork;
  }

  get(userId) {
    return this.repository.get(userId);
  }

  set(userId, autoApproveWrites) {
    return this.setWithRequestId(
      userId,
      autoApproveWrites,
      internalRequestId()
    ).result;
  }

  setWithRequestId(userId, autoApproveWrites, requestId) {
    return this.replicationUnitOfWork.execute(userId, requestId, () => {
      const result = this.repository.set(userId, autoApproveWrites);
      return {
        result,
        changes: [moduleSettingUpsert({
          id: AUTO_APPROVE_WRITES_SETTING_ID,
          enabled: result.autoApproveWrites,
          updatedAt: result.updatedAt
        })]
      };
    });
  }
}

function internalRequestId() {
  return `internal:${randomUUID()}`;
}

module.exports = { ReplicatedAgentPermissionService };
