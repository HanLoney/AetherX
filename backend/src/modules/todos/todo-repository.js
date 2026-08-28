class TodoRepository {
  constructor(database) {
    this.database = database;
  }

  list(userId) {
    return this.database
      .prepare(
        `SELECT id, text, start_at, end_at, completed, created_at, updated_at
         FROM todos WHERE user_id = ? ORDER BY start_at, created_at`
      )
      .all(userId)
      .map(mapTodo);
  }

  findById(userId, id) {
    return mapTodo(
      this.database
        .prepare(
          `SELECT id, text, start_at, end_at, completed, created_at, updated_at
           FROM todos WHERE user_id = ? AND id = ?`
        )
        .get(userId, id)
    );
  }

  create(userId, todo) {
    this.database
      .prepare(
        `INSERT INTO todos(
          id, user_id, text, start_at, end_at, completed, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        todo.id,
        userId,
        todo.text,
        todo.startAt,
        todo.endAt,
        todo.completed ? 1 : 0,
        todo.createdAt,
        todo.updatedAt
      );
    return this.findById(userId, todo.id);
  }

  update(userId, id, changes) {
    const current = this.findById(userId, id);
    if (!current) return null;
    const next = { ...current, ...changes, updatedAt: Date.now() };
    this.database
      .prepare(
        `UPDATE todos SET text = ?, start_at = ?, end_at = ?,
          completed = ?, updated_at = ? WHERE user_id = ? AND id = ?`
      )
      .run(
        next.text,
        next.startAt,
        next.endAt,
        next.completed ? 1 : 0,
        next.updatedAt,
        userId,
        id
      );
    return this.findById(userId, id);
  }

  delete(userId, id) {
    return (
      this.database
        .prepare("DELETE FROM todos WHERE user_id = ? AND id = ?")
        .run(userId, id).changes > 0
    );
  }

  deleteCompleted(userId) {
    return this.database
      .prepare("DELETE FROM todos WHERE user_id = ? AND completed = 1")
      .run(userId).changes;
  }
}

function mapTodo(row) {
  if (!row) return null;
  return {
    id: row.id,
    text: row.text,
    startAt: row.start_at,
    endAt: row.end_at,
    completed: Boolean(row.completed),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

module.exports = { TodoRepository };
