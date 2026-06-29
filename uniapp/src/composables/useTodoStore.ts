import { ref } from "vue";
import type { TodoItem } from "@/types/todo";

const STORAGE_KEY = "xuan-todo-items-v1";

function loadTodos(): TodoItem[] {
  try {
    const saved = uni.getStorageSync(STORAGE_KEY);
    const items = typeof saved === "string" ? JSON.parse(saved) : saved;
    if (!Array.isArray(items)) return [];
    return items.map((todo: Partial<TodoItem>) => {
      const fallbackStart = todo.createdAt || Date.now();
      return {
        id: todo.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        text: todo.text || "",
        startAt: todo.startAt || fallbackStart,
        endAt: todo.endAt || fallbackStart + 60 * 60 * 1000,
        completed: Boolean(todo.completed),
        createdAt: todo.createdAt || Date.now()
      };
    });
  } catch {
    return [];
  }
}

export function useTodoStore() {
  const todos = ref<TodoItem[]>(loadTodos());
  const saving = ref(false);
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  function persist() {
    saving.value = true;
    uni.setStorageSync(STORAGE_KEY, JSON.stringify(todos.value));
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saving.value = false;
    }, 260);
  }

  function createTodo(input: Omit<TodoItem, "id" | "createdAt" | "completed">) {
    todos.value.push({
      ...input,
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      completed: false,
      createdAt: Date.now()
    });
    persist();
  }

  function updateTodo(
    id: string,
    input: Pick<TodoItem, "text" | "startAt" | "endAt">
  ) {
    const todo = todos.value.find((item) => item.id === id);
    if (!todo) return;
    Object.assign(todo, input);
    persist();
  }

  function toggleTodo(id: string) {
    const todo = todos.value.find((item) => item.id === id);
    if (!todo) return;
    todo.completed = !todo.completed;
    persist();
  }

  function removeTodo(id: string) {
    todos.value = todos.value.filter((item) => item.id !== id);
    persist();
  }

  function clearCompleted() {
    todos.value = todos.value.filter((item) => !item.completed);
    persist();
  }

  return {
    todos,
    saving,
    createTodo,
    updateTodo,
    toggleTodo,
    removeTodo,
    clearCompleted
  };
}
