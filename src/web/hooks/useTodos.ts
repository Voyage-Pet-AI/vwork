import { useState, useEffect, useCallback, useRef } from "react";
import type { AgentTodo } from "../lib/types.js";
import { getTodos, saveTodos } from "../lib/api.js";

export function useTodos() {
  const [todos, setTodos] = useState<AgentTodo[]>([]);
  const [loading, setLoading] = useState(true);
  const todosRef = useRef(todos);
  todosRef.current = todos;

  const refresh = useCallback(async () => {
    try {
      const data = await getTodos();
      setTodos(data.agentTodos);
    } catch {
      // best effort
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const save = useCallback(async (updated: AgentTodo[]) => {
    try {
      const data = await saveTodos(updated);
      setTodos(data.agentTodos);
    } catch {
      // best effort
    }
  }, []);

  const toggleTodo = useCallback(
    (id: string) => {
      const updated = todosRef.current.map((t) =>
        t.id === id
          ? { ...t, status: t.status === "completed" ? ("pending" as const) : ("completed" as const) }
          : t
      );
      save(updated);
    },
    [save]
  );

  const addTodo = useCallback(
    (content: string) => {
      const newTodo: AgentTodo = {
        id: crypto.randomUUID(),
        content,
        status: "pending",
        priority: "medium",
      };
      save([...todosRef.current, newTodo]);
    },
    [save]
  );

  const removeTodo = useCallback(
    (id: string) => {
      save(todosRef.current.filter((t) => t.id !== id));
    },
    [save]
  );

  return { todos, loading, refresh, toggleTodo, addTodo, removeTodo };
}
