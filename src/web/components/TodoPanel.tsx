import { useState, useCallback } from "react";
import { useTodos } from "../hooks/useTodos.js";

export function TodoPanel() {
  const { todos, loading, toggleTodo, addTodo, removeTodo } = useTodos();
  const [newTodo, setNewTodo] = useState("");

  const handleAdd = useCallback(() => {
    const trimmed = newTodo.trim();
    if (!trimmed) return;
    addTodo(trimmed);
    setNewTodo("");
  }, [newTodo, addTodo]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAdd();
      }
    },
    [handleAdd]
  );

  if (loading) {
    return <div className="p-6 text-zinc-500 text-sm">Loading...</div>;
  }

  const open = todos.filter((t) => t.status !== "completed" && t.status !== "cancelled");
  const done = todos.filter((t) => t.status === "completed");

  return (
    <div className="flex flex-col h-full p-6">
      <h2 className="text-lg font-semibold mb-4">Today's Todos</h2>

      <div className="flex gap-2 mb-6">
        <input
          value={newTodo}
          onChange={(e) => setNewTodo(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add a todo..."
          className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
        />
        <button
          onClick={handleAdd}
          disabled={!newTodo.trim()}
          className="px-4 py-2 bg-blue-600/20 text-blue-400 border border-blue-500/30 rounded-lg text-sm font-medium hover:bg-blue-600/30 transition-colors disabled:opacity-30"
        >
          Add
        </button>
      </div>

      {open.length === 0 && done.length === 0 ? (
        <p className="text-zinc-500 text-sm">No todos for today.</p>
      ) : (
        <>
          {open.length > 0 && (
            <div className="space-y-1 mb-4">
              {open.map((todo) => (
                <div
                  key={todo.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-zinc-800/40 group"
                >
                  <button
                    onClick={() => toggleTodo(todo.id)}
                    className="w-4 h-4 rounded border border-zinc-600 hover:border-zinc-400 shrink-0 transition-colors"
                  />
                  <span className="text-sm text-zinc-200 flex-1">{todo.content}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    todo.priority === "high"
                      ? "text-red-400 bg-red-400/10"
                      : todo.priority === "low"
                        ? "text-zinc-500 bg-zinc-500/10"
                        : "text-zinc-400 bg-zinc-400/10"
                  }`}>
                    {todo.priority}
                  </span>
                  <button
                    onClick={() => removeTodo(todo.id)}
                    className="text-zinc-600 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {done.length > 0 && (
            <div>
              <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Completed</p>
              <div className="space-y-1">
                {done.map((todo) => (
                  <div
                    key={todo.id}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg"
                  >
                    <button
                      onClick={() => toggleTodo(todo.id)}
                      className="w-4 h-4 rounded border border-emerald-600 bg-emerald-600/20 shrink-0 flex items-center justify-center"
                    >
                      <span className="text-emerald-400 text-[10px]">✓</span>
                    </button>
                    <span className="text-sm text-zinc-500 line-through flex-1">{todo.content}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
