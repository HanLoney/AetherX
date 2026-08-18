const http = require("node:http");
const { createRouter } = require("./lib/router");
const { openDatabase } = require("./infrastructure/database");
const { acquireDataDirLock } = require("./infrastructure/data-dir-lock");
const { createSecretBox } = require("./infrastructure/secret-box");
const { TodoRepository } = require("./modules/todos/todo-repository");
const { TodoService } = require("./modules/todos/todo-service");
const {
  ReplicatedTodoService
} = require("./modules/todos/replicated-todo-service");
const { registerTodoRoutes } = require("./modules/todos/todo-routes");
const { WalletRepository } = require("./modules/wallet/wallet-repository");
const { WalletService } = require("./modules/wallet/wallet-service");
const {
  ReplicatedWalletService
} = require("./modules/wallet/replicated-wallet-service");
const { registerWalletRoutes } = require("./modules/wallet/wallet-routes");
const { AiConfigRepository } = require("./modules/ai/ai-config-repository");
const {
  ReplicatedAiConfigRepository
} = require("./modules/ai/replicated-ai-config-repository");
const { AiProviderClient } = require("./modules/ai/ai-provider-client");
const { registerAiRoutes } = require("./modules/ai/ai-routes");
const { ProfileRepository } = require("./modules/profiles/profile-repository");
const { ProfileService } = require("./modules/profiles/profile-service");
const {
  ReplicatedProfileService
} = require("./modules/profiles/replicated-profile-service");
const { registerProfileRoutes } = require("./modules/profiles/profile-routes");
const {
  PreferenceRepository
} = require("./modules/preferences/preference-repository");
const { PreferenceService } = require("./modules/preferences/preference-service");
const {
  ReplicatedPreferenceService
} = require("./modules/preferences/replicated-preference-service");
const {
  registerPreferenceRoutes
} = require("./modules/preferences/preference-routes");
const { MemoryRepository } = require("./modules/memories/memory-repository");
const { MemoryService } = require("./modules/memories/memory-service");
const {
  ReplicatedMemoryEvidenceRepository,
  ReplicatedMemoryService
} = require("./modules/memories/replicated-memory-service");
const {
  MemoryEvidenceRepository
} = require("./modules/memories/memory-evidence-repository");
const {
  MemoryConsolidationService
} = require("./modules/memories/memory-consolidation-service");
const { registerMemoryRoutes } = require("./modules/memories/memory-routes");
const {
  ConversationRepository
} = require("./modules/conversations/conversation-repository");
const {
  ConversationService
} = require("./modules/conversations/conversation-service");
const {
  ReplicatedConversationService
} = require("./modules/conversations/replicated-conversation-service");
const {
  registerConversationRoutes
} = require("./modules/conversations/conversation-routes");
const {
  MemoryIntelligenceService
} = require("./modules/memories/memory-intelligence-service");
const {
  MemorySettingsRepository
} = require("./modules/memories/memory-settings-repository");
const {
  MemorySettingsService
} = require("./modules/memories/memory-settings-service");
const {
  ReplicatedMemorySettingsService
} = require("./modules/memories/replicated-memory-settings-service");
const {
  registerMemorySettingsRoutes
} = require("./modules/memories/memory-settings-routes");
const {
  AssistantMemoryRepository
} = require("./modules/assistant-memory/assistant-memory-repository");
const {
  AssistantMemoryService
} = require("./modules/assistant-memory/assistant-memory-service");
const {
  ReplicatedAssistantMemoryService
} = require("./modules/assistant-memory/replicated-assistant-memory-service");
const {
  registerAssistantMemoryRoutes
} = require("./modules/assistant-memory/assistant-memory-routes");
const {
  PromptSettingsRepository
} = require("./modules/prompt-settings/prompt-settings-repository");
const {
  PromptSettingsService
} = require("./modules/prompt-settings/prompt-settings-service");
const {
  ReplicatedPromptSettingsService
} = require("./modules/prompt-settings/replicated-prompt-settings-service");
const {
  PromptComposer
} = require("./modules/prompt-settings/prompt-composer");
const {
  registerPromptSettingsRoutes
} = require("./modules/prompt-settings/prompt-settings-routes");
const {
  TimeAwarenessRepository
} = require("./modules/time-awareness/time-awareness-repository");
const {
  TimeAwarenessService
} = require("./modules/time-awareness/time-awareness-service");
const {
  registerTimeAwarenessRoutes
} = require("./modules/time-awareness/time-awareness-routes");
const { JournalRepository } = require("./modules/journals/journal-repository");
const { JournalService } = require("./modules/journals/journal-service");
const {
  ReplicatedJournalService
} = require("./modules/journals/replicated-journal-service");
const { registerJournalRoutes } = require("./modules/journals/journal-routes");
const {
  XuanMoodRepository
} = require("./modules/xuan-mood/xuan-mood-repository");
const { XuanMoodService } = require("./modules/xuan-mood/xuan-mood-service");
const {
  ReplicatedXuanMoodService
} = require("./modules/xuan-mood/replicated-xuan-mood-service");
const {
  registerXuanMoodRoutes
} = require("./modules/xuan-mood/xuan-mood-routes");
const { AlbumRepository } = require("./modules/album/album-repository");
const { AlbumService } = require("./modules/album/album-service");
const {
  ReplicatedAlbumService
} = require("./modules/album/replicated-album-service");
const { registerAlbumRoutes } = require("./modules/album/album-routes");
const { DreamRepository } = require("./modules/dreams/dream-repository");
const { DreamService } = require("./modules/dreams/dream-service");
const {
  ReplicatedDreamService
} = require("./modules/dreams/replicated-dream-service");
const { registerDreamRoutes } = require("./modules/dreams/dream-routes");
const { GalleryRepository } = require("./modules/gallery/gallery-repository");
const { GalleryService } = require("./modules/gallery/gallery-service");
const { registerGalleryRoutes } = require("./modules/gallery/gallery-routes");
const { AuthRepository } = require("./modules/auth/auth-repository");
const { AuthService } = require("./modules/auth/auth-service");
const { registerAuthRoutes } = require("./modules/auth/auth-routes");
const { DeviceRepository } = require("./modules/devices/device-repository");
const { DeviceService } = require("./modules/devices/device-service");
const { registerDeviceRoutes } = require("./modules/devices/device-routes");
const { SyncRepository } = require("./modules/sync/sync-repository");
const { SyncService } = require("./modules/sync/sync-service");
const { SyncEventBroker } = require("./modules/sync/sync-event-broker");
const { registerSyncRoutes } = require("./modules/sync/sync-routes");
const {
  ClusterRepository
} = require("./modules/hub-cluster/cluster-repository");
const {
  ForcedTakeoverRepository
} = require("./modules/hub-cluster/forced-takeover-repository");
const {
  DivergenceRecoveryService
} = require("./modules/hub-cluster/divergence-recovery-service");
const { ClusterService } = require("./modules/hub-cluster/cluster-service");
const {
  MobileHubProbeService
} = require("./modules/hub-cluster/mobile-hub-probe-service");
const {
  HubEndpointRepository
} = require("./modules/hub-cluster/hub-endpoint-repository");
const {
  registerClusterRoutes
} = require("./modules/hub-cluster/cluster-routes");
const {
  SwitchPreflightService
} = require("./modules/hub-cluster/switch-preflight-service");
const {
  SwitchStateMachineService
} = require("./modules/hub-cluster/switch-state-machine-service");
const {
  SwitchRecoveryService
} = require("./modules/hub-cluster/switch-recovery-service");
const {
  ClientSessionHandoffService
} = require("./modules/hub-cluster/client-session-handoff-service");
const {
  ReplicationRepository
} = require("./modules/replication/replication-repository");
const {
  ReplicationUnitOfWork
} = require("./modules/replication/replication-unit-of-work");
const {
  MobileHubSyncNotifier
} = require("./modules/replication/mobile-hub-sync-notifier");
const {
  PeerReplicationService
} = require("./modules/replication/peer-replication-service");
const {
  SpaceKeyRepository
} = require("./modules/replication/space-key-repository");
const {
  SpaceKeyService
} = require("./modules/replication/space-key-service");
const {
  PeerCredentialRepository
} = require("./modules/replication/peer-credential-repository");
const {
  PeerAuthenticationService
} = require("./modules/replication/peer-authentication-service");
const { PeerTransport } = require("./modules/replication/peer-transport");
const {
  BootstrapCoordinator
} = require("./modules/replication/bootstrap-coordinator");
const {
  ReplicationHealthRepository
} = require("./modules/replication/replication-health-repository");
const {
  MediaReplicationRepository
} = require("./modules/replication/media-replication-repository");
const {
  IncrementalMediaReplicationService
} = require("./modules/replication/incremental-media-replication-service");
const {
  ReplicationScheduler
} = require("./modules/replication/replication-scheduler");
const {
  registerReplicationSchedulerRoutes
} = require("./modules/replication/replication-scheduler-routes");
const {
  ReplicationEntityApplier
} = require("./modules/replication/replication-entity-applier");
const {
  ReplicationApplyService
} = require("./modules/replication/replication-apply-service");
const {
  registerPeerRoutes
} = require("./modules/replication/peer-routes");
const {
  IntegrityRepository
} = require("./modules/replication/integrity-repository");
const {
  IntegrityService
} = require("./modules/replication/integrity-service");
const {
  HubPairingRepository
} = require("./modules/hub-pairing/hub-pairing-repository");
const {
  HubPairingService
} = require("./modules/hub-pairing/hub-pairing-service");
const {
  registerHubPairingRoutes
} = require("./modules/hub-pairing/hub-pairing-routes");
const {
  HubImportService
} = require("./modules/hub-pairing/hub-import-service");
const { createAgentToolRuntime } = require("./modules/agent/agent-tool-runtime");
const { AgentService } = require("./modules/agent/agent-service");
const { registerAgentRoutes } = require("./modules/agent/agent-routes");
const {
  AgentPermissionRepository
} = require("./modules/agent/agent-permission-repository");
const {
  ReplicatedAgentPermissionService
} = require("./modules/agent/replicated-agent-permission-service");
const { MediaRepository } = require("./modules/media/media-repository");
const { MediaService } = require("./modules/media/media-service");
const { registerMediaRoutes } = require("./modules/media/media-routes");
const { ArchiveService } = require("./modules/archive/archive-service");
const { registerArchiveRoutes } = require("./modules/archive/archive-routes");
const {
  ModuleSettingsRepository
} = require("./modules/module-settings/module-settings-repository");
const { ModuleManager } = require("./modules/module-settings/module-manager");
const {
  ReplicatedModuleManager
} = require("./modules/module-settings/replicated-module-manager");
const {
  registerModuleSettingsRoutes
} = require("./modules/module-settings/module-settings-routes");
const {
  ModuleActivityService
} = require("./modules/module-activity/module-activity-service");
const {
  registerModuleActivityRoutes
} = require("./modules/module-activity/module-activity-routes");
const { LanHubAnnouncer } = require("./infrastructure/lan-hub-announcer");

function createApp(config) {
  const lanHubAnnouncer = new LanHubAnnouncer({ hubPort: config.port });
  const releaseDataDirLock = acquireDataDirLock(config.dataDir);
  let database;
  try {
    database = openDatabase(config.dataDir);
  } catch (error) {
    releaseDataDirLock();
    throw error;
  }
  const secretBox = createSecretBox(config.dataDir, config.masterKey);
  let archiveService = null;
  const authService = new AuthService(new AuthRepository(database), {
    registrationMode: config.registrationMode,
    registrationSecret: config.registrationSecret,
    sessionTtlDays: config.sessionTtlDays
  });
  const syncRepository = new SyncRepository(database);
  const syncService = new SyncService(syncRepository);
  const syncEventBroker = new SyncEventBroker(syncRepository);
  const clusterRepository = new ClusterRepository(database);
  const endpointRepository = new HubEndpointRepository(database);
  const localEndpointProvider = (userId) => {
    const context = clusterRepository.findContextByUserId(userId);
    if (!context) return [];
    const remoteEndpoints = endpointRepository
      .listForNode(context.space_id, context.local_node_id)
      .filter((endpoint) => endpoint.transport !== "lan")
      .map((endpoint) => ({
        transport: endpoint.transport,
        address: endpoint.address,
        priority: endpoint.priority,
        certificateFingerprint: endpoint.certificateFingerprint
      }));
    return [...lanHubAnnouncer.endpoints(), ...remoteEndpoints].slice(0, 8);
  };
  const deviceService = new DeviceService(new DeviceRepository(database), {
    localHubEndpointRegistrar(userId, nodeId, endpoints, now) {
      const context = clusterRepository.findContextByUserId(userId);
      const node = context && clusterRepository.findNode(context.space_id, nodeId);
      if (!context || !node || node.revoked_at !== null || String(node.platform).toLowerCase() !== "android") {
        return;
      }
      endpointRepository.replaceNodeEndpoints(context.space_id, nodeId, endpoints, now);
    }
  });
  const replicationHealthRepository = new ReplicationHealthRepository(database);
  const forcedTakeoverRepository = new ForcedTakeoverRepository(database);
  const clusterService = new ClusterService(clusterRepository, {
    mobileHealthProvider: (userId) => deviceService.listMobileHealth(userId),
    replicationHealthProvider: (spaceId, nodeId) =>
      replicationHealthRepository.find(spaceId, nodeId),
    forcedTakeoverProvider: (spaceId) => forcedTakeoverRepository.status(spaceId)
  });
  const mobileHubSyncNotifier = new MobileHubSyncNotifier({
    clusterService,
    syncEventBroker,
    localEndpointProvider
  });
  const replicationRepository = new ReplicationRepository(database);
  const spaceKeyService = new SpaceKeyService({
    repository: new SpaceKeyRepository(database),
    secretBox
  });
  const replicationUnitOfWork = new ReplicationUnitOfWork({
    repository: replicationRepository,
    clusterService,
    spaceKeyService,
    onOperationsCommitted: (userId, change) =>
      mobileHubSyncNotifier.notify(userId, change)
  });
  const peerReplicationService = new PeerReplicationService({
    repository: replicationRepository,
    clusterService,
    clusterRepository,
    spaceKeyService,
    takeoverRepository: forcedTakeoverRepository,
    healthRepository: replicationHealthRepository,
    onClusterChanged: (userId, change) =>
      syncEventBroker.publish(userId, "cluster-change", change)
  });
  const peerAuthenticationService = new PeerAuthenticationService({
    repository: new PeerCredentialRepository(database),
    clusterService,
    clusterRepository,
    secretBox
  });
  const peerTransport = new PeerTransport({
    endpointRepository,
    clusterService,
    clusterRepository,
    peerAuthenticationService,
    localEndpointProvider
  });
  const mobileHubProbeService = new MobileHubProbeService({
    clusterService,
    peerTransport
  });
  const replicationApplyService = new ReplicationApplyService({
    repository: replicationRepository,
    clusterService,
    clusterRepository,
    spaceKeyService,
    entityApplier: new ReplicationEntityApplier(database, {
      secretBox,
      spaceKeyService
    })
  });
  const hubPairingService = new HubPairingService({
    repository: new HubPairingRepository(database),
    clusterService,
    clusterRepository,
    endpointRepository,
    peerAuthenticationService,
    spaceKeyService,
    secretBox
  });
  const hubImportService = new HubImportService({
    database,
    clusterRepository,
    endpointRepository,
    clusterService,
    peerAuthenticationService,
    spaceKeyService
  });
  const moduleManager = new ReplicatedModuleManager(
    new ModuleManager(new ModuleSettingsRepository(database)),
    replicationUnitOfWork
  );
  const moduleActivityService = new ModuleActivityService();
  const agentPermissionRepository = new ReplicatedAgentPermissionService(
    new AgentPermissionRepository(database),
    replicationUnitOfWork
  );
  const router = createRouter({
    corsOrigin: config.corsOrigin,
    authenticate: (authorization) => authService.authenticate(authorization),
    authenticatePeer: (input) => peerAuthenticationService.verifyBySpace(input),
    isWriteLocked: (userId) => {
      if (archiveService?.isUserLocked(userId) === true) {
        return {
          scope: "archive",
          code: "ARCHIVE_WRITE_LOCKED",
          message: "完整存档任务正在进行，暂时不能修改数据。"
        };
      }
      const context = clusterRepository.findContextByUserId(userId);
      if (context && context.state !== "stable") {
        return {
          scope: "cluster",
          code: "HUB_SWITCH_IN_PROGRESS",
          message: "当前 Hub 正在安全切换，暂时不能修改数据。",
          details: {
            state: context.state,
            transitionId: context.transition_id,
            targetNodeId: context.transition_target_node_id || ""
          }
        };
      }
      return false;
    },
    isModuleEnabled: (userId, moduleId) =>
      moduleManager.isEnabled(userId, moduleId)
  });

  const todoRepository = new TodoRepository(database);
  const todoService = new ReplicatedTodoService(
    new TodoService(todoRepository),
    replicationUnitOfWork
  );
  const walletService = new ReplicatedWalletService(
    new WalletService(new WalletRepository(database)),
    replicationUnitOfWork
  );
  const aiConfigRepository = new ReplicatedAiConfigRepository(
    new AiConfigRepository(database, secretBox),
    replicationUnitOfWork
  );
  const aiProviderClient = new AiProviderClient();
  const profileService = new ReplicatedProfileService(
    new ProfileService(new ProfileRepository(database)),
    replicationUnitOfWork
  );
  const preferenceService = new ReplicatedPreferenceService(
    new PreferenceService(new PreferenceRepository(database)),
    replicationUnitOfWork
  );
  const memoryEvidenceRepository = new MemoryEvidenceRepository(database);
  const memoryService = new ReplicatedMemoryService(
    new MemoryService(new MemoryRepository(database)),
    replicationUnitOfWork,
    memoryEvidenceRepository
  );
  const assistantMemoryService = new ReplicatedAssistantMemoryService(
    new AssistantMemoryService(new AssistantMemoryRepository(database)),
    replicationUnitOfWork
  );
  const memoryConsolidationService = new MemoryConsolidationService(
    memoryService,
    new ReplicatedMemoryEvidenceRepository(
      memoryEvidenceRepository,
      replicationUnitOfWork
    ),
    { preferenceService, profileService, assistantMemoryService }
  );
  const memorySettingsService = new ReplicatedMemorySettingsService(
    new MemorySettingsService(new MemorySettingsRepository(database)),
    replicationUnitOfWork
  );
  const conversationService = new ReplicatedConversationService(
    new ConversationService(new ConversationRepository(database)),
    replicationUnitOfWork
  );
  const promptSettingsService = new ReplicatedPromptSettingsService(
    new PromptSettingsService(
      new PromptSettingsRepository(database),
      new PromptComposer(),
      assistantMemoryService
    ),
    replicationUnitOfWork
  );
  const timeAwarenessService = new TimeAwarenessService(
    new TimeAwarenessRepository(database)
  );
  const journalService = new ReplicatedJournalService(
    new JournalService(new JournalRepository(database)),
    replicationUnitOfWork
  );
  const xuanMoodService = new ReplicatedXuanMoodService(
    new XuanMoodService({
      repository: new XuanMoodRepository(database),
      configRepository: aiConfigRepository,
      providerClient: aiProviderClient
    }),
    replicationUnitOfWork
  );
  const albumService = new ReplicatedAlbumService(
    new AlbumService(new AlbumRepository(database)),
    replicationUnitOfWork
  );
  const dreamService = new ReplicatedDreamService(
    new DreamService(new DreamRepository(database)),
    replicationUnitOfWork
  );
  const galleryService = new GalleryService(new GalleryRepository(database));
  const mediaRepository = new MediaRepository(database);
  const mediaService = new MediaService(mediaRepository, config.dataDir);
  mediaService.migrateLegacyConversationImages();
  const memoryIntelligenceService = new MemoryIntelligenceService({
    profileService,
    preferenceService,
    memoryService,
    memorySettingsService,
    memoryConsolidationService,
    assistantMemoryService,
    configRepository: aiConfigRepository,
    providerClient: aiProviderClient
  });
  const agentServices = {
    todoService,
    walletService,
    aiConfigRepository,
    providerClient: aiProviderClient,
    profileService,
    memoryService,
    assistantMemoryService,
    memoryIntelligenceService,
    promptSettingsService,
    timeAwarenessService,
    journalService,
    xuanMoodService,
    albumService,
    dreamService,
    conversationService,
    mediaService,
    moduleManager,
    moduleActivityService,
    agentPermissionRepository
  };
  const agentService = new AgentService(
    agentServices,
    createAgentToolRuntime(agentServices)
  );
  archiveService = new ArchiveService({
    database,
    secretBox,
    dataDir: config.dataDir,
    isAgentBusy: (userId) => agentService.isBusy(userId)
  });
  const integrityService = new IntegrityService({
    repository: new IntegrityRepository(database),
    replicationRepository,
    clusterService,
    clusterRepository,
    archiveService,
    spaceKeyService
  });
  const switchPreflightService = new SwitchPreflightService({
    clusterService,
    clusterRepository,
    integrityService,
    peerTransport
  });
  const bootstrapCoordinator = new BootstrapCoordinator({
    clusterService,
    clusterRepository,
    replicationRepository,
    replicationApplyService,
    integrityService,
    peerTransport
  });
  const mediaReplicationService = new IncrementalMediaReplicationService({
    mediaRepository,
    stagingRepository: new MediaReplicationRepository(database),
    clusterService,
    clusterRepository,
    dataDir: config.dataDir
  });
  const divergenceRecoveryService = new DivergenceRecoveryService({
    database,
    clusterService,
    clusterRepository,
    repository: forcedTakeoverRepository,
    replicationRepository,
    archiveService,
    spaceKeyService,
    syncEventBroker
  });
  const replicationScheduler = new ReplicationScheduler({
    repository: replicationHealthRepository,
    clusterService,
    clusterRepository,
    peerTransport,
    bootstrapCoordinator,
    mediaReplicationService,
    pollIntervalMs: config.replicationPollIntervalMs,
    maxBackoffMs: config.replicationMaxBackoffMs
  });
  const switchStateMachineService = new SwitchStateMachineService({
    clusterService,
    clusterRepository,
    spaceKeyService,
    peerTransport,
    switchPreflightService,
    replicationScheduler,
    onClusterChanged: (userId, change) =>
      syncEventBroker.publish(userId, "cluster-change", change)
  });
  const switchRecoveryService = new SwitchRecoveryService({
    clusterService,
    clusterRepository,
    switchStateMachineService,
    pollIntervalMs: config.replicationPollIntervalMs,
    maxBackoffMs: config.replicationMaxBackoffMs
  });
  const clientSessionHandoffService = new ClientSessionHandoffService({
    clusterService,
    clusterRepository,
    peerTransport,
    authService
  });

  router.add(
    "GET",
    "/health",
    () => ({
      data: {
        status: "ok",
        service: "aetherx-backend",
        mobile: deviceService.getMobileHealthSummary()
      }
    }),
    { public: true }
  );
  registerAuthRoutes(router, authService);
  registerDeviceRoutes(router, deviceService);
  registerSyncRoutes(router, syncService, syncEventBroker, deviceService);
  registerClusterRoutes(
    router,
    clusterService,
    switchPreflightService,
    switchStateMachineService,
    switchRecoveryService,
    clientSessionHandoffService,
    syncEventBroker,
    divergenceRecoveryService,
    peerTransport,
    mobileHubProbeService
  );
  registerHubPairingRoutes(
    router,
    hubPairingService,
    hubImportService,
    integrityService,
    bootstrapCoordinator
  );
  registerPeerRoutes(router, {
    peerReplicationService,
    replicationApplyService,
    integrityService,
    mediaReplicationService,
    clusterService,
    switchStateMachineService,
    clientSessionHandoffService,
    divergenceRecoveryService,
    replicationScheduler
  });
  registerReplicationSchedulerRoutes(router, replicationScheduler);
  registerModuleSettingsRoutes(router, moduleManager);
  registerModuleActivityRoutes(router, moduleActivityService);
  registerTodoRoutes(router, todoService);
  registerWalletRoutes(router, walletService);
  registerAiRoutes(
    router,
    aiConfigRepository,
    aiProviderClient,
    timeAwarenessService,
    moduleManager
  );
  registerAgentRoutes(router, agentService, agentPermissionRepository);
  registerProfileRoutes(router, profileService);
  registerPreferenceRoutes(router, preferenceService);
  registerMemorySettingsRoutes(router, memorySettingsService);
  registerMemoryRoutes(
    router,
    memoryService,
    memoryIntelligenceService,
    memoryConsolidationService
  );
  registerAssistantMemoryRoutes(router, assistantMemoryService);
  registerJournalRoutes(router, journalService);
  registerXuanMoodRoutes(router, xuanMoodService);
  registerAlbumRoutes(router, albumService);
  registerDreamRoutes(router, dreamService);
  registerGalleryRoutes(router, galleryService);
  registerMediaRoutes(router, mediaService);
  registerArchiveRoutes(router, archiveService);
  registerPromptSettingsRoutes(router, promptSettingsService);
  registerTimeAwarenessRoutes(router, timeAwarenessService);
  registerConversationRoutes(router, conversationService);

  const server = http.createServer((request, response) =>
    router.handle(request, response)
  );

  return {
    server,
    database,
    clusterService,
    hubPairingService,
    hubImportService,
    peerAuthenticationService,
    peerTransport,
    mobileHubProbeService,
    bootstrapCoordinator,
    mediaReplicationService,
    replicationScheduler,
    peerReplicationService,
    replicationApplyService,
    integrityService,
    switchPreflightService,
    switchStateMachineService,
    switchRecoveryService,
    divergenceRecoveryService,
    clientSessionHandoffService,
    replicationUnitOfWork,
    spaceKeyService,
    mobileHealth() {
      return deviceService.listAllMobileHealth();
    },
    listen() {
      return new Promise((resolve) => {
        server.listen(config.port, config.host, () => {
          if (!["127.0.0.1", "::1", "localhost"].includes(String(config.host).toLowerCase())) {
            lanHubAnnouncer.start();
          }
          if (config.replicationSchedulerEnabled === true) replicationScheduler.start();
          if (config.switchRecoveryEnabled === true) switchRecoveryService.start();
          resolve(server.address());
        });
      });
    },
    async close() {
      try {
        lanHubAnnouncer.close();
        await switchRecoveryService.stop();
        await replicationScheduler.stop();
        mobileHubSyncNotifier.close();
        return await new Promise((resolve, reject) => {
          syncEventBroker.close();
          server.close((error) => {
            database.close();
            if (error) reject(error);
            else resolve();
          });
        });
      } finally {
        releaseDataDirLock();
      }
    }
  };
}

module.exports = { createApp };
