import { Box, Text } from "ink";
import type { AgentTodo, TodoList } from "../todo/types.js";

interface TodoPanelProps {
  todos: TodoList;
}

interface TodoStatusLineProps {
  todos: TodoList;
}

function renderStatus(todo: AgentTodo): string {
  if (todo.status === "in_progress") return "•";
  if (todo.status === "completed") return "x";
  return " ";
}

function renderTodoLine(prefix: string, todo: AgentTodo): string {
  const pri = todo.priority !== "medium" ? ` [${todo.priority}]` : "";
  return `${prefix} ${todo.content}${pri}`;
}

export function TodoStatusLine({ todos }: TodoStatusLineProps) {
  return (
    <Box>
      <Text dimColor>
        Todos: {todos.active.length} active · {todos.blocked.length} blocked · Ctrl+T expand
      </Text>
    </Box>
  );
}

export function TodoPanel({ todos }: TodoPanelProps) {
  const open = [...todos.active, ...todos.blocked];

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>Todos</Text>

      <Text>
        Active ({todos.active.length})
      </Text>
      {todos.active.length === 0 ? (
        <Text dimColor>  - none</Text>
      ) : (
        todos.active.map((todo, idx) => (
          <Text key={todo.id}>  {renderTodoLine(`[${idx + 1}] [${renderStatus(todo)}]`, todo)}</Text>
        ))
      )}

      <Text>
        Blocked ({todos.blocked.length})
      </Text>
      {todos.blocked.length === 0 ? (
        <Text dimColor>  - none</Text>
      ) : (
        todos.blocked.map((todo, idx) => (
          <Text key={todo.id}>  {renderTodoLine(`[${todos.active.length + idx + 1}] [ ]`, todo)}</Text>
        ))
      )}

      <Text>
        Completed Today ({todos.completedToday.length})
      </Text>
      {todos.completedToday.length === 0 ? (
        <Text dimColor>  - none</Text>
      ) : (
        todos.completedToday.map((todo) => (
          <Text key={todo.id}>  {renderTodoLine("[x]", todo)}</Text>
        ))
      )}

      {open.length > 0 && (
        <Text dimColor>{"Ask naturally (e.g. 'mark no.1 as done')."}</Text>
      )}
      <Text dimColor>Ctrl+T minimize</Text>
    </Box>
  );
}
