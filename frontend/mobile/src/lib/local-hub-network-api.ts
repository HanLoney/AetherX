import { ApiError } from "./api";
import { LocalHubClient } from "./local-hub-client";
import { useLocalHub } from "./local-hub";
import { loadSession } from "./storage";

interface NetworkRequest {
  requestId: string;
  method: string;
  path: string;
  body: Record<string, any>;
}

export async function dispatchLocalHubNetworkRequest(request: NetworkRequest) {
  const localHub = useLocalHub();
  const [local, stored] = await Promise.all([localHub.refresh(), loadSession()]);
  if (
    !local?.configured ||
    local.role !== "active" ||
    local.state !== "stable" ||
    local.bootstrap?.status !== "completed"
  ) {
    throw new ApiError("手机 Hub 当前不是活动节点。", 409, "HUB_NOT_ACTIVE");
  }
  if (!stored?.user) {
    throw new ApiError(
      "手机 Hub 缺少可用的本机会话。",
      503,
      "LOCAL_HUB_SESSION_UNAVAILABLE"
    );
  }
  const api = new LocalHubClient(stored.user, localHub);
  await api.ensureActiveHub();
  const method = String(request.method || "GET").toUpperCase();
  const url = new URL(request.path, "http://local-hub");
  const path = url.pathname;
  const body = request.body || {};
  const query = Object.fromEntries(url.searchParams.entries());

  if (method === "POST" && path === "/api/v1/peer/client-sessions/mint") {
    const [auth, cluster] = await Promise.all([api.session(), api.clusterStatus()]);
    return {
      user: auth.user,
      spaceId: cluster.spaceId,
      nodeId: cluster.localNodeId,
      activeNodeId: cluster.activeNodeId,
      epoch: cluster.epoch
    };
  }
  if (method === "GET" && path === "/api/v1/auth/session") return api.session();
  if (method === "POST" && path === "/api/v1/auth/logout") return null;
  if (method === "GET" && path === "/api/v1/cluster/status") return api.clusterStatus();
  if (method === "GET" && path === "/api/v1/sync/changes") {
    return api.syncChanges(number(query.after, 0), number(query.limit, 100));
  }
  if (method === "POST" && path === "/api/v1/agent/chat") return api.agentChat({
    conversationId: body.conversationId,
    content: String(body.content || ""),
    runtime: body.runtime
  });
  let match = path.match(/^\/api\/v1\/agent\/runs\/([^/]+)\/approve$/);
  if (method === "POST" && match) return api.approveAgentRun(decode(match[1]), body.approved === true);

  if (method === "GET" && path === "/api/v1/modules") return api.listModules();
  match = path.match(/^\/api\/v1\/modules\/([^/]+)$/);
  if (method === "PATCH" && match) return api.updateModule(decode(match[1]), body.enabled === true);
  if (method === "GET" && path === "/api/v1/modules/activity") return api.moduleActivity(query);
  if (method === "GET" && path === "/api/v1/agent/permissions") return api.agentPermissions();
  if (method === "GET" && path === "/api/v1/ai/config") return api.aiConfig();
  if (method === "GET" && path === "/api/v1/ai/image-config") return api.aiImageConfig();

  if (method === "GET" && path === "/api/v1/profile") return api.profile();
  if ((method === "PUT" || method === "PATCH") && path === "/api/v1/profile") {
    return api.updateProfile(body);
  }
  if (method === "GET" && path === "/api/v1/assistant/profile") return api.assistantProfile();
  if (method === "PATCH" && path === "/api/v1/assistant/profile") return api.updateAssistantProfile(body);

  if (path === "/api/v1/todos" && method === "GET") return api.listTodos(query.status || "all");
  if (path === "/api/v1/todos" && method === "POST") return api.createTodo({
    text: String(body.text || ""),
    startAt: Number(body.startAt),
    endAt: Number(body.endAt)
  });
  match = path.match(/^\/api\/v1\/todos\/([^/]+)$/);
  if (match && method === "GET") {
    const todoId = decode(match[1]);
    const todo = (await api.listTodos("all")).find((item) => item.id === todoId);
    if (!todo) throw new ApiError("未找到指定待办。", 404, "TODO_NOT_FOUND");
    return todo;
  }
  if (match && method === "PATCH") return api.updateTodo(decode(match[1]), body);
  if (match && method === "DELETE") return api.deleteTodo(decode(match[1]));

  if (method === "GET" && path === "/api/v1/wallet") return api.getWalletSummary();
  if (method === "POST" && path === "/api/v1/wallet/accounts") return api.createWalletAccount(body);
  match = path.match(/^\/api\/v1\/wallet\/accounts\/([^/]+)\/transactions$/);
  if (method === "GET" && match) return api.listWalletTransactions(decode(match[1]));
  match = path.match(/^\/api\/v1\/wallet\/accounts\/([^/]+)\/transactions\/([^/]+)$/);
  if (method === "PATCH" && match) {
    return api.updateWalletTransaction(decode(match[1]), decode(match[2]), body);
  }
  match = path.match(/^\/api\/v1\/wallet\/accounts\/([^/]+)\/adjust$/);
  if (method === "POST" && match) return api.adjustWalletAccount(decode(match[1]), body);
  match = path.match(/^\/api\/v1\/wallet\/accounts\/([^/]+)$/);
  if (method === "PATCH" && match) return api.updateWalletAccount(decode(match[1]), body);
  if (method === "DELETE" && match) return api.deleteWalletAccount(decode(match[1]));

  if (method === "GET" && path === "/api/v1/conversations") return api.listConversations();
  if (method === "GET" && path === "/api/v1/conversations/page") {
    return api.conversationPage(number(query.offset, 0), number(query.limit, 12));
  }
  if (method === "POST" && path === "/api/v1/conversations") return api.createConversation(body.title);
  match = path.match(/^\/api\/v1\/conversations\/([^/]+)\/message-page$/);
  if (method === "GET" && match) {
    return api.conversationMessagePage(
      decode(match[1]),
      number(query.afterPosition, -1),
      number(query.limit, 500)
    );
  }
  match = path.match(/^\/api\/v1\/conversations\/([^/]+)\/messages$/);
  if (method === "PUT" && match) {
    return api.saveConversationMessages(decode(match[1]), Array.isArray(body.messages) ? body.messages : []);
  }
  match = path.match(/^\/api\/v1\/conversations\/([^/]+)$/);
  if (method === "GET" && match) return api.conversation(decode(match[1]));
  if (method === "DELETE" && match) return api.deleteConversation(decode(match[1]));

  if (method === "GET" && path === "/api/v1/assistant/gallery/summary") {
    return api.gallerySummary(number(query.limit, 3));
  }
  if (method === "GET" && path === "/api/v1/assistant/gallery/page") {
    return api.galleryPage(number(query.offset, 0), number(query.limit, 24));
  }
  if (method === "GET" && path === "/api/v1/assistant/gallery") {
    const page = await api.galleryPage(number(query.offset, 0), number(query.limit, 100));
    return page.items;
  }

  if (method === "GET" && path === "/api/v1/assistant/journals") {
    return api.listJournals(query);
  }
  if (method === "GET" && path === "/api/v1/assistant/journals/material") {
    return api.getJournalMaterial(number(query.from, 0), number(query.to, Date.now()));
  }
  if (method === "PUT" && path === "/api/v1/assistant/journals") return api.saveJournal(body);
  match = path.match(/^\/api\/v1\/assistant\/journals\/([^/]+)\/([^/]+)$/);
  if (method === "GET" && match) return api.journal(decode(match[1]), decode(match[2]));
  match = path.match(/^\/api\/v1\/assistant\/journals\/([^/]+)$/);
  if (method === "DELETE" && match) return api.deleteJournal(decode(match[1]));

  if (method === "GET" && path === "/api/v1/preferences") return api.listPreferences(query);
  if (method === "GET" && path === "/api/v1/memories/settings") return api.memorySettings();
  if (method === "POST" && path === "/api/v1/memories/recall") {
    return api.recallMemories(String(body.query || ""));
  }
  if (method === "POST" && path === "/api/v1/memories/consolidate") {
    return { merged: 0, removedInvalid: 0, localReadOnly: true };
  }
  if (method === "GET" && path === "/api/v1/memories") return api.listMemories(query);
  if (method === "POST" && path === "/api/v1/memories") return api.createMemory(body);
  match = path.match(/^\/api\/v1\/memories\/([^/]+)\/confirm$/);
  if (method === "POST" && match) return api.confirmMemory(decode(match[1]));
  match = path.match(/^\/api\/v1\/memories\/([^/]+)$/);
  if (method === "GET" && match) {
    const memoryId = decode(match[1]);
    const memory = (await api.listMemories()).find((item) => item.id === memoryId);
    if (!memory) throw new ApiError("没有找到指定记忆。", 404, "MEMORY_NOT_FOUND");
    return memory;
  }
  if (method === "PATCH" && match) return api.updateMemory(decode(match[1]), body);
  if (method === "DELETE" && match) return api.deleteMemory(decode(match[1]));

  if (method === "GET" && path === "/api/v1/prompt-settings") return api.promptSettings();
  if (method === "GET" && path === "/api/v1/prompt-settings/versions") return api.promptVersions();
  if (method === "GET" && path === "/api/v1/xuan-mood/home") return api.xuanMoodHome();

  if (method === "GET" && path === "/api/v1/assistant/personality-events") {
    return api.listPersonalityEvents(query);
  }
  if (method === "POST" && path === "/api/v1/assistant/personality-events") {
    return api.createPersonalityEvent(body);
  }
  match = path.match(/^\/api\/v1\/assistant\/personality-events\/([^/]+)\/confirm$/);
  if (method === "POST" && match) return api.confirmPersonalityEvent(decode(match[1]));

  if (method === "GET" && path === "/api/v1/shared-memories") return api.listSharedMemories(query);
  if (method === "POST" && path === "/api/v1/shared-memories") return api.createSharedMemory(body);
  match = path.match(/^\/api\/v1\/shared-memories\/([^/]+)\/confirm$/);
  if (method === "POST" && match) return api.confirmSharedMemory(decode(match[1]));

  if (method === "GET" && path === "/api/v1/album/moments") return api.listAlbumMoments(query);
  if (method === "POST" && path === "/api/v1/album/moments") return api.createAlbumMoment(body);
  if (method === "GET" && path === "/api/v1/album/source-candidates") {
    return api.listAlbumSourceCandidates(query);
  }
  match = path.match(/^\/api\/v1\/album\/moments\/([^/]+)\/sources$/);
  if (method === "POST" && match) return api.addAlbumMomentSource(decode(match[1]), body);
  match = path.match(/^\/api\/v1\/album\/moments\/([^/]+)$/);
  if (method === "PATCH" && match) return api.updateAlbumMoment(decode(match[1]), body);

  if (method === "GET" && path === "/api/v1/dreams") return api.listDreams(query);
  if (method === "GET" && path === "/api/v1/dreams/material") {
    return api.dreamMaterial(number(query.from, 0), number(query.to, Date.now()), number(query.limit, 60));
  }
  match = path.match(/^\/api\/v1\/dreams\/by-date\/([^/]+)$/);
  if (method === "GET" && match) return api.dreamByDate(decode(match[1]));
  if (method === "POST" && path === "/api/v1/dreams") return api.createDream(body);
  match = path.match(/^\/api\/v1\/dreams\/([^/]+)$/);
  if (method === "GET" && match) {
    const dream = (await api.listDreams()).find((item: any) => item.id === decode(match[1]));
    if (!dream) throw new ApiError("没有找到这段梦境。", 404, "DREAM_NOT_FOUND");
    return dream;
  }
  if (method === "DELETE" && match) return api.deleteDream(decode(match[1]));

  throw new ApiError(`手机 Hub 尚未开放 ${method} ${path}。`, 501, "LOCAL_HUB_ROUTE_UNSUPPORTED");
}

function number(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function decode(value: string) {
  return decodeURIComponent(value);
}
