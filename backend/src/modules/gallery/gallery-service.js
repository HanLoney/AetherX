const MARKDOWN_IMAGE = /!\[([^\]]*)\]\((data:image\/[^)\s]+)\)/g;
const DEFAULT_LIMIT = 80;
const MAX_LIMIT = 200;

class GalleryService {
  constructor(repository) {
    this.repository = repository;
  }

  list(userId, query = {}) {
    const limit = Math.max(
      1,
      Math.min(MAX_LIMIT, Number(query.limit) || DEFAULT_LIMIT)
    );
    const items = [
      ...this.journalImages(userId),
      ...this.conversationImages(userId)
    ];
    items.sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));
    return items.slice(0, limit);
  }

  journalImages(userId) {
    const images = [];
    for (const journal of this.repository.journalImageRows(userId)) {
      MARKDOWN_IMAGE.lastIndex = 0;
      let match;
      let index = 0;
      while ((match = MARKDOWN_IMAGE.exec(journal.content))) {
        const source = String(match[2] || "").trim();
        if (!source) continue;
        images.push({
          id: `journal:${journal.id}:${index}`,
          source,
          description: String(match[1] || "").trim(),
          origin: "journal",
          refId: journal.id,
          refTitle: journal.title,
          refType: journal.type,
          createdAt: journal.createdAt
        });
        index += 1;
      }
    }
    return images;
  }

  conversationImages(userId) {
    const images = [];
    for (const row of this.repository.conversationImageRows(userId)) {
      let payload;
      try {
        payload = JSON.parse(row.payloadJson || "{}");
      } catch {
        continue;
      }
      const image = payload && payload.image;
      const source = image && String(image.source || "").trim();
      if (!source || !source.startsWith("data:image/")) continue;
      images.push({
        id: `chat:${row.id}`,
        source,
        description: String(image.description || "").trim(),
        selfie: Boolean(image.selfie),
        origin: "chat",
        refId: row.conversationId,
        refTitle: row.conversationTitle,
        createdAt: row.createdAt
      });
    }
    return images;
  }
}

module.exports = { GalleryService };
