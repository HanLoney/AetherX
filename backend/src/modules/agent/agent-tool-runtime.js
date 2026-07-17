const path = require("node:path");
const { AsyncLocalStorage } = require("node:async_hooks");

const contextStorage = new AsyncLocalStorage();
const toolRoot = resolveToolRoot();
const { ToolRegistry } = require(path.join(toolRoot, "tool-registry.js"));
const { registerTodoTools } = require(path.join(toolRoot, "todo-tools.js"));
const { registerMemoryTools } = require(path.join(toolRoot, "memory-tools.js"));
const illustrator = require(path.join(toolRoot, "journal-illustrator.js"));
const { registerJournalTools } = require(path.join(toolRoot, "journal-tools.js"));
const { registerAlbumTools } = require(path.join(toolRoot, "album-tools.js"));
const { registerDreamTools } = require(path.join(toolRoot, "dream-tools.js"));
const { registerImageTools } = require(path.join(toolRoot, "image-tools.js"));

installBrowserCompatibility();

function createAgentToolRuntime(services) {
  installDesktopProxy();
  const registry = new ToolRegistry({
    isEnabled: (toolName) => {
      const context = currentContext();
      return !toolName.startsWith("image.") || context.imageEnabled;
    }
  });
  registerTodoTools(registry);
  registerMemoryTools(registry);
  registerJournalTools(registry, {
    illustrate: (content) => illustrateJournal(content)
  });
  registerAlbumTools(registry);
  registerDreamTools(registry);
  registerImageTools(registry, {
    generateImage: (payload) => currentContext().adapter.generateImage(payload),
    getPersonaImage: () => currentContext().personaImage,
    isImageEnabled: () => currentContext().imageEnabled,
    illustrator
  });

  return {
    async forUser(userId, callback) {
      const imageConfig = services.aiConfigRepository.getImagePublic(userId);
      const assistantProfile = services.assistantMemoryService.getProfile(userId);
      const context = {
        userId,
        imageEnabled: Boolean(imageConfig.hasApiKey),
        personaImage: String(assistantProfile.personaImageDataUrl || ""),
        adapter: createServiceAdapter(userId, services)
      };
      return contextStorage.run(context, () => callback(registry));
    }
  };
}

function createServiceAdapter(userId, services) {
  return {
    listTodos: (filters = {}) => services.todoService.list(userId, filters),
    getTodo: (id) => services.todoService.get(userId, id),
    createTodo: (input) => services.todoService.create(userId, input),
    updateTodo: (id, input) => services.todoService.update(userId, id, input),
    deleteTodo: (id) => services.todoService.delete(userId, id),

    listMemories: (filters = {}) => services.memoryService.list(userId, filters),
    createMemory: (input) => services.memoryService.create(userId, input),
    updateMemory: (id, input) => services.memoryService.update(userId, id, input),
    confirmMemory: (id) => services.memoryService.confirm(userId, id),
    deleteMemory: (id) => services.memoryService.delete(userId, id),

    getProfile: () => services.profileService.get(userId),
    updateProfile: (input) => services.profileService.patch(userId, input),
    getAssistantProfile: () => services.assistantMemoryService.getProfile(userId),
    updateAssistantProfile: (input) => services.assistantMemoryService.saveProfile(userId, input),

    listPersonalityEvents: (filters = {}) => services.assistantMemoryService.listEvents(userId, filters),
    createPersonalityEvent: (input) => services.assistantMemoryService.recordEvent(userId, input),
    confirmPersonalityEvent: (id) => services.assistantMemoryService.confirmEvent(userId, id),
    listSharedMemories: (filters = {}) => services.assistantMemoryService.listSharedMemories(userId, filters),
    createSharedMemory: (input) => services.assistantMemoryService.createSharedMemory(userId, input),
    confirmSharedMemory: (id) => services.assistantMemoryService.confirmSharedMemory(userId, id),

    listJournals: (filters = {}) => services.journalService.list(userId, filters),
    getJournalMaterial: (from, to) => services.journalService.sourceMaterial(userId, { from, to }),
    saveJournal: (input) => services.journalService.save(userId, input),
    deleteJournal: (id) => services.journalService.delete(userId, id),

    listAlbumSourceCandidates: (filters = {}) => services.albumService.listSourceCandidates(userId, filters),
    listAlbumMoments: (filters = {}) => services.albumService.listMoments(userId, filters),
    createAlbumMoment: (input) => services.albumService.createMoment(userId, input),
    updateAlbumMoment: (id, input) => services.albumService.updateMoment(userId, id, input),
    addAlbumMomentSource: (id, input) => services.albumService.addSource(userId, id, input),

    listDreams: (filters = {}) => services.dreamService.listDreams(userId, filters),
    createDream: (input) => services.dreamService.createDream(userId, input),
    deleteDream: (id) => services.dreamService.deleteDream(userId, id),

    generateImage: (payload) => services.providerClient.image(
      services.aiConfigRepository.getImageCredentials(userId),
      payload
    )
  };
}

async function illustrateJournal(content) {
  const context = currentContext();
  const notes = [];
  if (!context.imageEnabled) {
    return { content: illustrator.stripAllPlaceholders(content), notes };
  }
  const illustrated = await illustrator.illustrate(content, {
    generateImage: (payload) => context.adapter.generateImage(payload),
    personaImage: context.personaImage,
    maxImages: 2,
    onImage: ({ description, selfie }) =>
      notes.push(`${selfie ? "自拍" : "配图"}「${description}」`)
  });
  return { content: illustrated, notes };
}

function currentContext() {
  const context = contextStorage.getStore();
  if (!context) throw new Error("Agent 工具缺少用户执行上下文。");
  return context;
}

function installDesktopProxy() {
  if (globalThis.desktop?.__aetherAgentProxy) return;
  const proxy = new Proxy({ __aetherAgentProxy: true }, {
    get(target, property) {
      if (property === "__aetherAgentProxy") return true;
      const value = currentContext().adapter[property];
      return typeof value === "function" ? value.bind(currentContext().adapter) : value;
    }
  });
  globalThis.desktop = proxy;
}

function installBrowserCompatibility() {
  if (typeof globalThis.CustomEvent !== "function") {
    globalThis.CustomEvent = class CustomEvent {
      constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail;
      }
    };
  }
  if (typeof globalThis.dispatchEvent !== "function") {
    globalThis.dispatchEvent = () => true;
  }
}

function resolveToolRoot() {
  const sourceRoot = path.resolve(__dirname, "../../../../frontend/desktop");
  try {
    require.resolve(path.join(sourceRoot, "tool-registry.js"));
    return sourceRoot;
  } catch {
    return path.resolve(__dirname, "../../../../agent-tools");
  }
}

module.exports = { createAgentToolRuntime };
