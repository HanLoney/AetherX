const http = require("node:http");
const { createRouter } = require("./lib/router");
const { openDatabase } = require("./infrastructure/database");
const { createSecretBox } = require("./infrastructure/secret-box");
const { TodoRepository } = require("./modules/todos/todo-repository");
const { TodoService } = require("./modules/todos/todo-service");
const { registerTodoRoutes } = require("./modules/todos/todo-routes");
const { AiConfigRepository } = require("./modules/ai/ai-config-repository");
const { AiProviderClient } = require("./modules/ai/ai-provider-client");
const { registerAiRoutes } = require("./modules/ai/ai-routes");
const { ProfileRepository } = require("./modules/profiles/profile-repository");
const { ProfileService } = require("./modules/profiles/profile-service");
const { registerProfileRoutes } = require("./modules/profiles/profile-routes");
const {
  PreferenceRepository
} = require("./modules/preferences/preference-repository");
const { PreferenceService } = require("./modules/preferences/preference-service");
const {
  registerPreferenceRoutes
} = require("./modules/preferences/preference-routes");
const { MemoryRepository } = require("./modules/memories/memory-repository");
const { MemoryService } = require("./modules/memories/memory-service");
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
  registerMemorySettingsRoutes
} = require("./modules/memories/memory-settings-routes");
const {
  AssistantMemoryRepository
} = require("./modules/assistant-memory/assistant-memory-repository");
const {
  AssistantMemoryService
} = require("./modules/assistant-memory/assistant-memory-service");
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
const { registerJournalRoutes } = require("./modules/journals/journal-routes");
const {
  XuanMoodRepository
} = require("./modules/xuan-mood/xuan-mood-repository");
const { XuanMoodService } = require("./modules/xuan-mood/xuan-mood-service");
const {
  registerXuanMoodRoutes
} = require("./modules/xuan-mood/xuan-mood-routes");
const { AlbumRepository } = require("./modules/album/album-repository");
const { AlbumService } = require("./modules/album/album-service");
const { registerAlbumRoutes } = require("./modules/album/album-routes");

function createApp(config) {
  const database = openDatabase(config.dataDir);
  const secretBox = createSecretBox(config.dataDir, config.masterKey);
  const router = createRouter({ corsOrigin: config.corsOrigin });

  const todoRepository = new TodoRepository(database);
  const todoService = new TodoService(todoRepository);
  const aiConfigRepository = new AiConfigRepository(database, secretBox);
  const aiProviderClient = new AiProviderClient();
  const profileService = new ProfileService(new ProfileRepository(database));
  const preferenceService = new PreferenceService(
    new PreferenceRepository(database)
  );
  const memoryService = new MemoryService(new MemoryRepository(database));
  const assistantMemoryService = new AssistantMemoryService(
    new AssistantMemoryRepository(database)
  );
  const memoryConsolidationService = new MemoryConsolidationService(
    memoryService,
    new MemoryEvidenceRepository(database),
    { preferenceService, profileService, assistantMemoryService }
  );
  const memorySettingsService = new MemorySettingsService(
    new MemorySettingsRepository(database)
  );
  const conversationService = new ConversationService(
    new ConversationRepository(database)
  );
  const promptSettingsService = new PromptSettingsService(
    new PromptSettingsRepository(database),
    new PromptComposer(),
    assistantMemoryService
  );
  const timeAwarenessService = new TimeAwarenessService(
    new TimeAwarenessRepository(database)
  );
  const journalService = new JournalService(new JournalRepository(database));
  const xuanMoodService = new XuanMoodService({
    repository: new XuanMoodRepository(database),
    configRepository: aiConfigRepository,
    providerClient: aiProviderClient
  });
  const albumService = new AlbumService(new AlbumRepository(database));
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

  router.add("GET", "/health", () => ({
    data: { status: "ok", service: "aetherx-backend" }
  }));
  registerTodoRoutes(router, todoService);
  registerAiRoutes(
    router,
    aiConfigRepository,
    aiProviderClient,
    timeAwarenessService
  );
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
  registerPromptSettingsRoutes(router, promptSettingsService);
  registerTimeAwarenessRoutes(router, timeAwarenessService);
  registerConversationRoutes(router, conversationService);

  const server = http.createServer((request, response) =>
    router.handle(request, response)
  );

  return {
    server,
    database,
    listen() {
      return new Promise((resolve) => {
        server.listen(config.port, config.host, () => resolve(server.address()));
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          database.close();
          if (error) reject(error);
          else resolve();
        });
      });
    }
  };
}

module.exports = { createApp };
