const { randomUUID } = require("node:crypto");

class ReplicatedConversationService {
  constructor(service, replicationUnitOfWork) {
    this.service = service;
    this.replicationUnitOfWork = replicationUnitOfWork;
  }

  list(userId) {
    return this.service.list(userId);
  }

  page(userId, query = {}) {
    return this.service.page(userId, query);
  }

  get(userId, id) {
    return this.service.get(userId, id);
  }

  create(userId, input) {
    return this.createWithRequestId(userId, input, internalRequestId()).result;
  }

  createWithRequestId(userId, input, requestId) {
    return this.replicationUnitOfWork.execute(userId, requestId, () => {
      const conversation = this.service.create(userId, input);
      return {
        status: 201,
        result: conversation,
        changes: [conversationUpsert(conversation)]
      };
    });
  }

  saveMessages(userId, id, input) {
    return this.saveMessagesWithRequestId(userId, id, input, internalRequestId()).result;
  }

  saveMessagesWithRequestId(userId, id, input, requestId) {
    return this.replicationUnitOfWork.execute(userId, requestId, () => {
      const beforeConversation = this.service.get(userId, id).conversation;
      const beforeMessages = this.rawMessages(id);
      const result = this.service.saveMessages(userId, id, input);
      const afterConversation = this.service.get(userId, id).conversation;
      const afterMessages = this.rawMessages(id);
      const changes = [];
      if (!sameValue(beforeConversation, afterConversation)) {
        changes.push(conversationUpsert(afterConversation));
      }
      const beforeById = new Map(beforeMessages.map((message) => [message.id, message]));
      for (const message of afterMessages) {
        if (!sameValue(beforeById.get(message.id), message)) {
          changes.push(conversationMessageUpsert(message, id));
        }
        beforeById.delete(message.id);
      }
      for (const removed of beforeById.values()) {
        changes.push(conversationMessageDelete(removed, id));
      }
      return { result, changes };
    });
  }

  delete(userId, id) {
    this.deleteWithRequestId(userId, id, internalRequestId());
  }

  deleteWithRequestId(userId, id, requestId) {
    return this.replicationUnitOfWork.execute(userId, requestId, () => {
      const conversation = this.service.get(userId, id).conversation;
      const messages = this.rawMessages(id);
      this.service.delete(userId, id);
      return {
        status: 204,
        result: null,
        changes: [
          ...messages.map((message) => conversationMessageDelete(message, id)),
          conversationDelete(conversation)
        ]
      };
    });
  }

  rawMessages(conversationId) {
    return this.service.repository.messages(conversationId);
  }
}

function conversationUpsert(conversation) {
  return {
    entityType: "conversations",
    entityId: conversation.id,
    operation: "upsert",
    payload: {
      id: conversation.id,
      title: conversation.title,
      summary: conversation.summary,
      created_at: conversation.createdAt,
      updated_at: conversation.updatedAt
    }
  };
}

function conversationDelete(conversation) {
  return {
    entityType: "conversations",
    entityId: conversation.id,
    operation: "delete",
    payload: {
      id: conversation.id,
      deleted_version_updated_at: conversation.updatedAt
    }
  };
}

function conversationMessageUpsert(message, conversationId) {
  return {
    entityType: "messages",
    entityId: message.id,
    operation: "upsert",
    payload: {
      id: message.id,
      conversation_id: conversationId,
      stream_type: message.stream,
      position: message.position,
      role: message.role,
      content: message.content,
      payload: message.payload,
      created_at: message.createdAt
    }
  };
}

function conversationMessageDelete(message, conversationId) {
  return {
    entityType: "messages",
    entityId: message.id,
    operation: "delete",
    payload: {
      id: message.id,
      conversation_id: conversationId,
      deleted_version_created_at: message.createdAt
    }
  };
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function internalRequestId() {
  return `internal:${randomUUID()}`;
}

module.exports = {
  conversationDelete,
  conversationMessageDelete,
  conversationMessageUpsert,
  conversationUpsert,
  ReplicatedConversationService
};
