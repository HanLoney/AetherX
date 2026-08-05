const { randomUUID } = require("node:crypto");
const { HttpError } = require("../../lib/http-error");
const {
  controlHash,
  persistedState,
  signSwitchAck,
  signSwitchControl,
  stateHash,
  verifySwitchAck,
  verifySwitchControl
} = require("./switch-control-codec");

const PHASE_PREVIOUS = Object.freeze({
  preparing_switch: "stable",
  draining: "preparing_switch",
  final_sync: "draining",
  integrity_check: "final_sync",
  committing_switch: "integrity_check"
});
const ABORTABLE_STATES = new Set([
  "preparing_switch",
  "draining",
  "final_sync",
  "integrity_check"
]);

class SwitchStateMachineService {
  constructor({
    clusterService,
    clusterRepository,
    spaceKeyService,
    peerTransport,
    switchPreflightService,
    replicationScheduler,
    onClusterChanged = () => {},
    now = () => Date.now()
  }) {
    this.clusterService = clusterService;
    this.clusterRepository = clusterRepository;
    this.spaceKeyService = spaceKeyService;
    this.peerTransport = peerTransport;
    this.switchPreflightService = switchPreflightService;
    this.replicationScheduler = replicationScheduler;
    this.onClusterChanged = onClusterChanged;
    this.now = now;
  }

  async prepare(userId, input = {}) {
    const initial = this.clusterService.ensureSpace(userId);
    assertLocalActive(initial);
    if (initial.state !== "stable") {
      throw transitionConflict(initial);
    }
    const preflight = await this.switchPreflightService.inspect(userId, input);
    assertReady(preflight);
    const transitionId = randomUUID();
    const targetNodeId = preflight.targetNodeId;
    const transitionStartedAt = this.now();
    try {
      await this.advancePhase(userId, {
        transitionId,
        targetNodeId,
        transitionStartedAt,
        state: "preparing_switch"
      });
      await this.advancePhase(userId, {
        transitionId,
        targetNodeId,
        transitionStartedAt,
        state: "draining"
      });
      await this.advancePhase(userId, {
        transitionId,
        targetNodeId,
        transitionStartedAt,
        state: "final_sync"
      });
      const finalSync = await this.peerTransport.requestJson(
        userId,
        targetNodeId,
        {
          method: "POST",
          path: "/api/v1/peer/switch/final-sync",
          body: { transitionId }
        }
      );
      await this.advancePhase(userId, {
        transitionId,
        targetNodeId,
        transitionStartedAt,
        state: "integrity_check"
      });
      const integrity = await this.switchPreflightService.inspectTransition(
        userId,
        targetNodeId,
        transitionId
      );
      assertReady(integrity);
      return {
        transitionId,
        sourceNodeId: initial.local_node_id,
        targetNodeId,
        epoch: Number(initial.epoch),
        state: "integrity_check",
        readyToCommit: true,
        finalSync: finalSync.data,
        checks: integrity.checks
      };
    } catch (error) {
      await this.abortUnlocked(userId, transitionId, { bestEffort: true });
      throw error;
    }
  }

  async commit(userId, input = {}) {
    const context = this.clusterService.ensureSpace(userId);
    assertLocalActive(context);
    const transitionId = requireTransitionId(input.transitionId);
    if (
      context.transition_id !== transitionId ||
      !["integrity_check", "committing_switch"].includes(context.state)
    ) {
      throw transitionConflict(context);
    }
    const targetNodeId = requireTarget(context);
    if (context.state === "integrity_check") {
      const integrity = await this.switchPreflightService.inspectTransition(
        userId,
        targetNodeId,
        transitionId
      );
      assertReady(integrity);
      await this.advancePhase(userId, {
        transitionId,
        targetNodeId,
        transitionStartedAt: Number(context.transition_started_at),
        state: "committing_switch"
      });
    }
    const current = this.clusterService.ensureSpace(userId);
    const signed = this.signedControl(current, {
      action: "commit",
      state: "stable",
      epoch: Number(current.epoch) + 1,
      transitionId,
      targetNodeId,
      transitionStartedAt: Number(current.transition_started_at)
    });
    const remote = await this.peerTransport.requestJson(userId, targetNodeId, {
      method: "POST",
      path: "/api/v1/peer/switch/control",
      body: signed
    });
    this.verifyAck(current.space_id, targetNodeId, signed, remote.data, {
      state: "stable",
      epoch: Number(current.epoch) + 1
    });
    this.applySignedControl(userId, current.local_node_id, signed, {
      localInitiator: true
    });
    return {
      transitionId,
      committed: true,
      previousActiveNodeId: current.local_node_id,
      activeNodeId: targetNodeId,
      epoch: Number(current.epoch) + 1,
      cluster: this.clusterService.status(userId)
    };
  }

  async abort(userId, input = {}) {
    const transitionId = requireTransitionId(input.transitionId);
    return this.abortUnlocked(userId, transitionId, { bestEffort: false });
  }

  async startMobileSwitch(userId, peerNodeId, input = {}) {
    const context = this.clusterService.ensureSpace(userId);
    assertLocalActive(context);
    if (context.state !== "stable") throw transitionConflict(context);
    const preflight = await this.switchPreflightService.inspectPeerProof(
      userId,
      peerNodeId,
      input.proof,
      "stable"
    );
    assertReady(preflight);
    const transitionId = randomUUID();
    const transitionStartedAt = this.now();
    return {
      done: false,
      transitionId,
      checks: preflight.checks,
      signedControl: this.signedControl(context, {
        action: "phase",
        state: "preparing_switch",
        epoch: Number(context.epoch),
        transitionId,
        targetNodeId: peerNodeId,
        transitionStartedAt
      })
    };
  }

  async advanceMobileSwitch(userId, peerNodeId, input = {}) {
    const signed = input.signedControl;
    const control = signed?.control || {};
    const context = this.clusterService.ensureSpace(userId);
    if (control.targetNodeId !== peerNodeId) {
      throw new HttpError(403, "SWITCH_CONTROL_ACTOR_INVALID", "手机 Hub 与切换目标不一致。");
    }
    const expectedState = persistedState(control);
    this.verifyAck(context.space_id, peerNodeId, signed, input.signedAck, {
      state: expectedState.state,
      epoch: expectedState.epoch
    });

    if (
      control.action === "commit" &&
      context.state === "stable" &&
      context.active_node_id === peerNodeId &&
      Number(context.epoch) === Number(control.epoch)
    ) {
      return mobileSwitchCompleted(context, control.transitionId);
    }

    assertLocalActive(context);
    this.applySignedControl(userId, context.local_node_id, signed, {
      localInitiator: true,
      allowStale: true
    });
    const current = this.clusterService.ensureSpace(userId);

    if (control.action === "commit") {
      return mobileSwitchCompleted(current, control.transitionId);
    }

    if (["final_sync", "integrity_check"].includes(current.state)) {
      const integrity = await this.switchPreflightService.inspectPeerProof(
        userId,
        peerNodeId,
        input.proof,
        current.state
      );
      assertReady(integrity);
    }

    const next = nextMobileControl(current, control.transitionId, peerNodeId, this.now());
    return {
      done: false,
      transitionId: control.transitionId,
      signedControl: this.signedControl(current, next)
    };
  }

  async abortUnlocked(userId, transitionId, options = {}) {
    const context = this.clusterService.ensureSpace(userId);
    if (context.state === "stable") {
      if (context.local_node_id !== context.active_node_id) {
        throw transitionConflict(context);
      }
      return {
        transitionId,
        aborted: true,
        alreadyStable: true,
        cluster: this.clusterService.status(userId)
      };
    }
    assertLocalActive(context);
    if (
      context.transition_id !== transitionId ||
      !ABORTABLE_STATES.has(context.state)
    ) {
      if (options.bestEffort) return { aborted: false };
      throw transitionConflict(context);
    }
    const targetNodeId = requireTarget(context);
    const signed = this.signedControl(context, {
      action: "abort",
      state: "stable",
      epoch: Number(context.epoch),
      transitionId,
      targetNodeId,
      transitionStartedAt: Number(context.transition_started_at)
    });
    let remoteAcknowledged = false;
    try {
      const remote = await this.peerTransport.requestJson(userId, targetNodeId, {
        method: "POST",
        path: "/api/v1/peer/switch/control",
        body: signed
      });
      this.verifyAck(context.space_id, targetNodeId, signed, remote.data, {
        state: "stable",
        epoch: Number(context.epoch)
      });
      remoteAcknowledged = true;
    } catch (error) {
      if (options.bestEffort) {
        return {
          transitionId,
          aborted: false,
          remoteAcknowledged: false,
          cluster: this.clusterService.status(userId)
        };
      }
      throw error;
    }
    this.applySignedControl(userId, context.local_node_id, signed, {
      localInitiator: true
    });
    return {
      transitionId,
      aborted: true,
      remoteAcknowledged,
      cluster: this.clusterService.status(userId)
    };
  }

  applyPeerControl(userId, peerNodeId, signed) {
    return this.applySignedControl(userId, peerNodeId, signed, {
      localInitiator: false
    });
  }

  async runPeerFinalSync(userId, peerNodeId, input = {}) {
    const context = this.clusterService.ensureSpace(userId);
    if (
      peerNodeId !== context.active_node_id ||
      context.local_node_id === context.active_node_id ||
      context.state !== "final_sync" ||
      context.transition_id !== requireTransitionId(input.transitionId) ||
      context.transition_target_node_id !== context.local_node_id
    ) {
      throw transitionConflict(context);
    }
    return this.replicationScheduler.runNow(userId, { allowTransition: true });
  }

  async advancePhase(userId, input) {
    const context = this.clusterService.ensureSpace(userId);
    const signed = this.signedControl(context, {
      action: "phase",
      epoch: Number(context.epoch),
      ...input
    });
    this.applySignedControl(userId, context.local_node_id, signed, {
      localInitiator: true
    });
    const remote = await this.peerTransport.requestJson(
      userId,
      input.targetNodeId,
      {
        method: "POST",
        path: "/api/v1/peer/switch/control",
        body: signed
      }
    );
    this.verifyAck(context.space_id, input.targetNodeId, signed, remote.data, {
      state: input.state,
      epoch: Number(context.epoch)
    });
  }

  applySignedControl(userId, actorNodeId, signed, options = {}) {
    const context = this.clusterService.ensureSpace(userId);
    const key = this.spaceKeyService.ensure(context.space_id).key;
    const control = verifySwitchControl(
      signed,
      key,
      options.allowStale === true ? Number(signed?.control?.issuedAt) : this.now()
    );
    assertControlContext(context, control);
    assertActor(context, control, actorNodeId, options.localInitiator === true);
    if (control.action === "phase") assertPhaseTransition(context, control);
    if (control.action === "abort") assertAbortTransition(context, control);
    if (control.action === "commit") assertCommitTransition(context, control);
    const state = persistedState(control);
    const nextStateHash = stateHash(state);
    this.clusterRepository.transaction(() => {
      this.clusterRepository.updateClusterState({
        ...state,
        stateHash: nextStateHash,
        controlSignature: signed.authenticationTag,
        updatedAt: this.now()
      });
      if (control.action === "abort") {
        this.clusterRepository.updateNodeStatus(
          context.space_id,
          control.activeNodeId,
          "active",
          this.now()
        );
        this.clusterRepository.updateNodeStatus(
          context.space_id,
          control.targetNodeId,
          "standby",
          this.now()
        );
      }
      if (control.action === "commit") {
        this.clusterRepository.updateNodeStatus(
          context.space_id,
          control.activeNodeId,
          "standby",
          this.now()
        );
        this.clusterRepository.updateNodeStatus(
          context.space_id,
          control.targetNodeId,
          "active",
          this.now()
        );
      }
    });
    const cluster = this.clusterService.status(userId);
    try {
      this.onClusterChanged(userId, {
        action: control.action,
        state: cluster.state,
        activeNodeId: cluster.activeNodeId,
        epoch: cluster.epoch,
        cluster
      });
    } catch (error) {
      console.warn("Unable to publish Hub cluster change.", error?.message || error);
    }
    return signSwitchAck({
      controlHash: controlHash(control),
      nodeId: context.local_node_id,
      state: state.state,
      epoch: state.epoch,
      stateHash: nextStateHash,
      appliedAt: this.now()
    }, key);
  }

  signedControl(context, input) {
    return signSwitchControl({
      version: 1,
      spaceId: context.space_id,
      activeNodeId: context.active_node_id,
      issuedAt: this.now(),
      ...input
    }, this.spaceKeyService.ensure(context.space_id).key);
  }

  verifyAck(spaceId, nodeId, signedControl, signedAck, expected) {
    const expectedStateHash = stateHash(persistedState(signedControl.control));
    return verifySwitchAck(
      signedAck,
      this.spaceKeyService.ensure(spaceId).key,
      {
        controlHash: controlHash(signedControl.control),
        nodeId,
        stateHash: expectedStateHash,
        ...expected
      }
    );
  }
}

function nextMobileControl(context, transitionId, targetNodeId, issuedAt) {
  const common = {
    transitionId,
    targetNodeId,
    transitionStartedAt: Number(context.transition_started_at),
    epoch: Number(context.epoch)
  };
  if (context.state === "preparing_switch") {
    return { ...common, action: "phase", state: "draining", issuedAt };
  }
  if (context.state === "draining") {
    return { ...common, action: "phase", state: "final_sync", issuedAt };
  }
  if (context.state === "final_sync") {
    return { ...common, action: "phase", state: "integrity_check", issuedAt };
  }
  if (context.state === "integrity_check") {
    return { ...common, action: "phase", state: "committing_switch", issuedAt };
  }
  if (context.state === "committing_switch") {
    return {
      ...common,
      action: "commit",
      state: "stable",
      epoch: Number(context.epoch) + 1,
      issuedAt
    };
  }
  throw transitionConflict(context);
}

function mobileSwitchCompleted(context, transitionId) {
  return {
    done: true,
    transitionId,
    activeNodeId: context.active_node_id,
    epoch: Number(context.epoch),
    state: context.state
  };
}

function assertControlContext(context, control) {
  if (control.spaceId !== context.space_id) {
    throw new HttpError(409, "SWITCH_SPACE_MISMATCH", "切换控制消息不属于当前数据空间。");
  }
  const target = context.transition_target_node_id || control.targetNodeId;
  if (
    control.activeNodeId !== context.active_node_id &&
    !(control.action === "commit" &&
      context.state === "stable" &&
      context.active_node_id === control.targetNodeId)
  ) {
    throw transitionConflict(context);
  }
  if (target && target !== control.targetNodeId) throw transitionConflict(context);
}

function assertActor(context, control, actorNodeId, localInitiator) {
  const validLocal = localInitiator && actorNodeId === context.local_node_id &&
    context.local_node_id === context.active_node_id;
  const validPeer = !localInitiator &&
    actorNodeId === context.active_node_id &&
    context.local_node_id === control.targetNodeId;
  const retryAfterCommit = !localInitiator &&
    control.action === "commit" &&
    context.state === "stable" &&
    context.active_node_id === control.targetNodeId &&
    actorNodeId === control.activeNodeId;
  if (!validLocal && !validPeer && !retryAfterCommit) {
    throw new HttpError(403, "SWITCH_CONTROL_ACTOR_INVALID", "切换控制消息的节点角色无效。");
  }
}

function assertPhaseTransition(context, control) {
  if (
    control.epoch === Number(context.epoch) &&
    ((context.state === control.state &&
      context.transition_id === control.transitionId) ||
      (context.state === PHASE_PREVIOUS[control.state] &&
        (control.state === "preparing_switch" ||
          context.transition_id === control.transitionId)))
  ) return;
  throw transitionConflict(context);
}

function assertAbortTransition(context, control) {
  if (
    context.state === "stable" &&
    context.active_node_id === control.activeNodeId &&
    Number(context.epoch) === control.epoch
  ) return;
  if (
    control.epoch === Number(context.epoch) &&
    context.transition_id === control.transitionId &&
    ABORTABLE_STATES.has(context.state)
  ) return;
  throw transitionConflict(context);
}

function assertCommitTransition(context, control) {
  if (
    context.state === "stable" &&
    context.active_node_id === control.targetNodeId &&
    Number(context.epoch) === control.epoch
  ) return;
  if (
    context.state === "committing_switch" &&
    context.transition_id === control.transitionId &&
    Number(context.epoch) + 1 === control.epoch
  ) return;
  throw transitionConflict(context);
}

function assertLocalActive(context) {
  if (context.local_node_id === context.active_node_id) return;
  throw new HttpError(
    409,
    "SWITCH_SOURCE_NOT_ACTIVE",
    "只有当前活动 Hub 可以控制计划切换。",
    { activeNodeId: context.active_node_id }
  );
}

function assertReady(preflight) {
  if (preflight.ready) return;
  throw new HttpError(
    409,
    "SWITCH_PREFLIGHT_FAILED",
    "计划切换的完整性门禁未通过。",
    { failedChecks: preflight.checks.filter((item) => !item.passed) }
  );
}

function requireTransitionId(value) {
  const result = String(value || "").trim();
  if (!result || result.length > 256) {
    throw new HttpError(400, "SWITCH_TRANSITION_ID_INVALID", "切换事务 ID 无效。");
  }
  return result;
}

function requireTarget(context) {
  const result = String(context.transition_target_node_id || "").trim();
  if (!result) throw transitionConflict(context);
  return result;
}

function transitionConflict(context) {
  return new HttpError(
    409,
    "SWITCH_STATE_CONFLICT",
    "切换状态与请求不匹配。",
    {
      state: context.state,
      epoch: Number(context.epoch),
      transitionId: context.transition_id,
      targetNodeId: context.transition_target_node_id || ""
    }
  );
}

module.exports = { SwitchStateMachineService };
