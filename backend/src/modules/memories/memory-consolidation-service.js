const {
  isInvalidMemorySource,
  isSystemFeedback
} = require("./memory-content-policy");

class MemoryConsolidationService {
  constructor(
    memoryService,
    evidenceRepository,
    { preferenceService, profileService, assistantMemoryService } = {}
  ) {
    this.memoryService = memoryService;
    this.evidenceRepository = evidenceRepository;
    this.preferenceService = preferenceService;
    this.profileService = profileService;
    this.assistantMemoryService = assistantMemoryService;
  }

  consolidateCandidate(userId, candidate, source = {}) {
    const evidence = String(source.evidence || candidate.sourceExcerpt || "").trim();
    const conversationId = String(source.conversationId || "");
    const memoryKey = canonicalKey(candidate);
    const evidenceHash = evidence
      ? this.evidenceRepository.hash(conversationId, evidence)
      : "";
    const existing = this.memoryService.list(userId, {});
    const linked = evidenceHash
      ? this.evidenceRepository.listByHash(userId, evidenceHash)
      : [];

    const linkedMatch = linked
      .map((item) => existing.find((memory) => memory.id === item.memoryId))
      .filter(Boolean)
      .find((memory) => similarity(memory.content, candidate.content) >= 0.18);
    const keyMatch = existing.find(
      (memory) => memoryKey && memory.memoryKey === memoryKey
    );
    const contentMatch = existing.find(
      (memory) =>
        memory.type === candidate.type &&
        similarity(memory.content, candidate.content) >= 0.72
    );
    const match = linkedMatch || keyMatch || contentMatch;

    if (match) {
      const alreadyLinked = linked.some((item) => item.memoryId === match.id);
      if (alreadyLinked) {
        return { action: "duplicate", memory: match, evidenceAdded: false };
      }
      const updated = this.memoryService.update(userId, match.id, {
        ...mergeMemory(match, { ...candidate, memoryKey }),
        mergeCount: match.mergeCount + 1
      });
      if (evidence) {
        this.evidenceRepository.add(userId, updated.id, {
          evidence,
          conversationId,
          evidenceHash,
          confidence: candidate.confidence
        });
      }
      return { action: "merged", memory: updated, evidenceAdded: Boolean(evidence) };
    }

    const created = this.memoryService.create(userId, {
      ...candidate,
      memoryKey,
      mergeCount: 1,
      sourceExcerpt: evidence
    });
    if (evidence) {
      this.evidenceRepository.add(userId, created.id, {
        evidence,
        conversationId,
        evidenceHash,
        confidence: candidate.confidence
      });
    }
    return { action: "created", memory: created, evidenceAdded: Boolean(evidence) };
  }

  consolidateExisting(userId) {
    const memories = this.memoryService.list(userId, {});
    let merged = 0;
    let removedInvalid = 0;
    let migratedPreferences = 0;
    let migratedGoals = 0;
    let removedInvalidShared = 0;
    let removedInvalidPersonalityEvents = 0;

    for (const memory of [...memories]) {
      if (
        isInvalidMemorySource(memory.sourceExcerpt) ||
        isSystemFeedback(memory.content)
      ) {
        this.memoryService.delete(userId, memory.id);
        const index = memories.findIndex((item) => item.id === memory.id);
        if (index >= 0) memories.splice(index, 1);
        removedInvalid += 1;
        continue;
      }
      const preference = derivePreference(memory);
      if (preference && this.preferenceService) {
        this.preferenceService.save(userId, {
          ...preference,
          source: memory.source,
          confidence: memory.confidence,
          sensitivity: memory.sensitivity
        });
        this.memoryService.delete(userId, memory.id);
        const index = memories.findIndex((item) => item.id === memory.id);
        if (index >= 0) memories.splice(index, 1);
        migratedPreferences += 1;
        continue;
      }
      const goal = deriveGoal(memory);
      if (goal && this.profileService) {
        const profile = this.profileService.get(userId);
        if (!(profile.goals || []).some((item) => similarity(item, goal) >= 0.72)) {
          this.profileService.patch(userId, {
            goals: [...(profile.goals || []), goal]
          });
        }
        this.memoryService.delete(userId, memory.id);
        const index = memories.findIndex((item) => item.id === memory.id);
        if (index >= 0) memories.splice(index, 1);
        migratedGoals += 1;
        continue;
      }
      if (memory.sourceExcerpt) {
        this.evidenceRepository.add(userId, memory.id, {
          evidence: memory.sourceExcerpt,
          conversationId: "",
          confidence: memory.confidence
        });
      }
    }

    let changed = true;
    while (changed) {
      changed = false;
      const current = this.memoryService.list(userId, {});
      pairSearch:
      for (let leftIndex = 0; leftIndex < current.length; leftIndex += 1) {
        for (
          let rightIndex = leftIndex + 1;
          rightIndex < current.length;
          rightIndex += 1
        ) {
          const left = current[leftIndex];
          const right = current[rightIndex];
          if (!shouldMerge(left, right)) continue;
          const preferred = preferMemory(left, right);
          const discarded = preferred.id === left.id ? right : left;
          const combined = mergeMemory(preferred, discarded);
          const updated = this.memoryService.update(userId, preferred.id, {
            ...combined,
            memoryKey: preferred.memoryKey || canonicalKey(preferred),
            mergeCount: preferred.mergeCount + discarded.mergeCount
          });
          for (const evidence of this.evidenceRepository.listForMemory(
            userId,
            discarded.id
          )) {
            this.evidenceRepository.add(userId, updated.id, evidence);
          }
          if (discarded.sourceExcerpt) {
            this.evidenceRepository.add(userId, updated.id, {
              evidence: discarded.sourceExcerpt,
              confidence: discarded.confidence
            });
          }
          this.memoryService.delete(userId, discarded.id);
          merged += 1;
          changed = true;
          break pairSearch;
        }
      }
    }

    if (this.assistantMemoryService) {
      for (const memory of this.assistantMemoryService.listSharedMemories(userId)) {
        if (
          !isSystemFeedback(memory.content) &&
          !isInvalidMemorySource(memory.evidence)
        ) continue;
        this.assistantMemoryService.deleteSharedMemory(userId, memory.id);
        removedInvalidShared += 1;
      }
      for (const event of this.assistantMemoryService.listEvents(userId)) {
        if (
          !isSystemFeedback(event.content) &&
          !isInvalidMemorySource(event.evidence)
        ) continue;
        this.assistantMemoryService.deleteEvent(userId, event.id);
        removedInvalidPersonalityEvents += 1;
      }
    }

    return {
      merged,
      removedInvalid,
      removedInvalidShared,
      removedInvalidPersonalityEvents,
      migratedPreferences,
      migratedGoals,
      remaining: this.memoryService.list(userId, {}).length
    };
  }
}

function shouldMerge(left, right) {
  if (left.memoryKey && right.memoryKey && left.memoryKey === right.memoryKey) {
    return true;
  }
  const score = similarity(left.content, right.content);
  if (
    left.sourceExcerpt &&
    left.sourceExcerpt === right.sourceExcerpt &&
    score >= 0.18
  ) {
    return true;
  }
  return left.type === right.type && score >= 0.72;
}

function mergeMemory(current, incoming) {
  const incomingPreferred =
    current.source !== "explicit" &&
    Number(incoming.confidence || 0) >= Number(current.confidence || 0) &&
    String(incoming.content || "").length < current.content.length;
  return {
    content: incomingPreferred ? incoming.content : current.content,
    domain: current.domain,
    type: current.type,
    entities: [...new Set([...(current.entities || []), ...(incoming.entities || [])])],
    source: current.source === "explicit" ? "explicit" : incoming.source || current.source,
    confidence: Math.max(current.confidence || 0, incoming.confidence || 0),
    importance: Math.max(current.importance || 0, incoming.importance || 0),
    sensitivity:
      current.sensitivity === "sensitive" || incoming.sensitivity === "sensitive"
        ? "sensitive"
        : current.sensitivity,
    status:
      current.status === "active" || incoming.status === "active"
        ? "active"
        : current.status,
    memoryKey: current.memoryKey || incoming.memoryKey || canonicalKey(current)
  };
}

function preferMemory(left, right) {
  const score = (memory) =>
    (memory.source === "explicit" ? 100 : 0) +
    (memory.status === "active" ? 20 : 0) +
    memory.confidence * 10 -
    memory.content.length / 1000;
  return score(left) >= score(right) ? left : right;
}

function canonicalKey(memory) {
  const provided = String(memory.memoryKey || memory.canonicalKey || "")
    .toLowerCase()
    .replace(/[^a-z0-9._:-]/g, "")
    .slice(0, 200);
  if (provided) return provided;
  const entities = (memory.entities || [])
    .map(normalize)
    .filter(Boolean)
    .sort()
    .slice(0, 3)
    .join(".");
  return `${memory.domain || "life"}:${memory.type || "fact"}:${entities || normalize(memory.content).slice(0, 32)}`;
}

function similarity(left, right) {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return 0;
  if (a === b || a.includes(b) || b.includes(a)) return 1;
  const leftPairs = bigrams(a);
  const rightPairs = bigrams(b);
  const overlap = [...leftPairs].filter((item) => rightPairs.has(item)).length;
  return (2 * overlap) / (leftPairs.size + rightPairs.size);
}

function normalize(value) {
  return String(value).toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}

function bigrams(value) {
  const result = new Set();
  for (let index = 0; index < value.length - 1; index += 1) {
    result.add(value.slice(index, index + 2));
  }
  return result;
}

function derivePreference(memory) {
  const text = `${memory.sourceExcerpt} ${memory.content}`;
  if (!/(喜欢|偏好|希望|要求)/.test(text)) return null;
  if (/颜文字/.test(text)) {
    return {
      category: "communication",
      key: "kaomoji_style",
      value: /可爱/.test(text) ? "喜欢可爱的颜文字风格" : "喜欢使用颜文字"
    };
  }
  if (/(emoji|表情符号)/i.test(text)) {
    return {
      category: "communication",
      key: "emoji_style",
      value: "喜欢在交流中使用 Emoji"
    };
  }
  if (/(交流风格|说话风格|语气|口头禅)/.test(text)) {
    return {
      category: "communication",
      key: "communication_style",
      value: memory.content.replace(/^用户/, "")
    };
  }
  return null;
}

function deriveGoal(memory) {
  const text = `${memory.sourceExcerpt} ${memory.content}`;
  if (memory.type !== "plan") return "";
  if (!memory.sourceExcerpt && !/^用户/.test(memory.content)) return "";
  if (!/(长期|持续|打造|做一款|全能.{0,4}(助手|伙伴)|成为)/.test(text)) {
    return "";
  }
  return (
    memory.sourceExcerpt ||
    memory.content.replace(/^用户(计划|希望|想要?|准备)?/, "")
  ).slice(0, 500);
}

module.exports = {
  MemoryConsolidationService,
  canonicalKey,
  similarity
};
