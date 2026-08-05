import "../../../desktop/tool-registry.js";
import "../../../desktop/todo-tools.js";
import "../../../desktop/wallet-tools.js";
import "../../../desktop/memory-tools.js";
import "../../../desktop/journal-illustrator.js";
import "../../../desktop/journal-tools.js";
import "../../../desktop/album-tools.js";
import "../../../desktop/dream-tools.js";
import "../../../desktop/image-tools.js";

export interface LocalToolDefinition {
  name: string;
  title?: string;
  description: string;
  risk: "read" | "write" | "destructive";
  inputSchema: Record<string, unknown>;
}

export interface LocalToolResult {
  ok: boolean;
  content: string;
  data?: unknown;
  image?: string;
  error?: { code?: string; message?: string };
}

export interface LocalToolRegistry {
  get(name: string): LocalToolDefinition | undefined;
  modelTools(): Array<Record<string, unknown>>;
  modelResult(name: string, result: LocalToolResult): Record<string, unknown>;
  call(name: string, rawInput: string | Record<string, unknown>): Promise<LocalToolResult>;
}

interface ToolGlobals extends Window {
  desktop: Record<string, unknown>;
  XuanToolRegistry: new (options: Record<string, unknown>) => LocalToolRegistry;
  XuanModelContext?: {
    sanitizeText(value: unknown, limit?: number): string;
  };
  registerTodoTools(registry: LocalToolRegistry): void;
  registerWalletTools(registry: LocalToolRegistry): void;
  registerMemoryTools(registry: LocalToolRegistry): void;
  registerJournalTools(registry: LocalToolRegistry, options?: Record<string, unknown>): void;
  registerAlbumTools(registry: LocalToolRegistry): void;
  registerDreamTools(registry: LocalToolRegistry): void;
  registerImageTools(registry: LocalToolRegistry, options?: Record<string, unknown>): void;
  AetherJournalIllustrator?: {
    stripAllPlaceholders(content: string): string;
    illustrate(content: string, options: Record<string, unknown>): Promise<string>;
    buildPrompt(description: string, selfie: boolean): string;
    imageSource(value: unknown): string;
    firstImage(value: unknown): unknown;
  };
}

const globals = globalThis as unknown as ToolGlobals;

export function createLocalToolRegistry(
  adapter: Record<string, unknown>,
  enabledModules: Set<string>,
  imageOptions: {
    enabled: boolean;
    personaImage: string;
    generateImage: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  }
) {
  globals.desktop = adapter;
  const moduleByPrefix: Record<string, string> = {
    todo: "todo",
    wallet: "wallet",
    memory: "memory",
    personality_event: "memory",
    shared_memory: "memory",
    journal: "autonomous-journal",
    album: "anniversary-album",
    dream: "dreams",
    image: "image-generation"
  };
  const registry = new globals.XuanToolRegistry({
    isEnabled: (toolName: string) => {
      const prefix = String(toolName || "").split(".")[0];
      const moduleId = moduleByPrefix[prefix];
      return !moduleId || enabledModules.has(moduleId);
    }
  });
  globals.registerTodoTools(registry);
  globals.registerWalletTools(registry);
  globals.registerMemoryTools(registry);
  globals.registerJournalTools(registry, {
    illustrate: async (content: string) => ({
      content: globals.AetherJournalIllustrator?.stripAllPlaceholders(content) || content,
      notes: []
    })
  });
  globals.registerAlbumTools(registry);
  globals.registerDreamTools(registry);
  globals.registerImageTools(registry, {
    generateImage: imageOptions.generateImage,
    getPersonaImage: () => imageOptions.personaImage,
    isImageEnabled: () => imageOptions.enabled,
    illustrator: globals.AetherJournalIllustrator
  });
  return registry;
}
