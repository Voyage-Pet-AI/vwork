import { Box, Text } from "ink";
import type { TodoList } from "../todo/types.js";

interface TodoPanelProps {
  todos: TodoList;
}

function renderTodoLine(prefix: string, title: string, tags: string[]): string {
  const tagsText = tags.length > 0 ? ` ${tags.map((tag) => `#${tag}`).join(" ")}` : "";
  return `${prefix} ${title}${tagsText}`;
}

export function TodoPanel({ todos }: TodoPanelProps) {
  const open = [...todos.active, ...todos.blocked];

  return (
    <Box flexDirection="column" borderStyle="round" paddingLeft={1} paddingRight={1} marginBottom={1}>
      <Text bold>Todos</Text>

      <Text>
        Active ({todos.active.length})
      </Text>
      {todos.active.length === 0 ? (
        <Text dimColor>  - none</Text>
      ) : (
        todos.active.map((todo, idx) => (
          <Text key={todo.id}>  {renderTodoLine(`[${idx + 1}] [ ]`, todo.title, todo.tags)}</Text>
        ))
      )}

      <Text>
        Blocked ({todos.blocked.length})
      </Text>
      {todos.blocked.length === 0 ? (
        <Text dimColor>  - none</Text>
      ) : (
        todos.blocked.map((todo, idx) => (
          <Text key={todo.id}>  {renderTodoLine(`[${todos.active.length + idx + 1}] [ ]`, todo.title, todo.tags)}</Text>
        ))
      )}

      <Text>
        Completed Today ({todos.completedToday.length})
      </Text>
      {todos.completedToday.length === 0 ? (
        <Text dimColor>  - none</Text>
      ) : (
        todos.completedToday.map((todo) => (
          <Text key={todo.id}>  {renderTodoLine("[x]", todo.title, todo.tags)}</Text>
        ))
      )}

      {open.length > 0 && (
        <Text dimColor>{"Use `/todo done <index|text>` to complete."}</Text>
      )}
      <Text dimColor>Press Ctrl+T to minimize.</Text>
    </Box>
  );
}
