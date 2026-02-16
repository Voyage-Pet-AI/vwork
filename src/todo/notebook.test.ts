import { describe, expect, test } from "bun:test";
import { formatNotebook, parseTodos } from "./notebook.js";

describe("todo notebook parser", () => {
  test("parses active blocked and completed sections with tags and descriptions", () => {
    const markdown = [
      "# Notes",
      "",
      "## Active",
      "- [ ] Build todo list #reporter #tui",
      "  - keep parsing simple",
      "## Blocked",
      "- [ ] Launch mobile app (waiting on review) #mobile",
      "## Completed Today",
      "- [x] Fix login #bug",
      "",
    ].join("\n");

    const todos = parseTodos(markdown);
    expect(todos.active.length).toBe(1);
    expect(todos.blocked.length).toBe(1);
    expect(todos.completedToday.length).toBe(1);
    expect(todos.active[0].tags).toEqual(["reporter", "tui"]);
    expect(todos.active[0].description).toBe("keep parsing simple");
    expect(todos.blocked[0].note).toBe("waiting on review");
  });

  test("handles markdown with missing todo sections", () => {
    const todos = parseTodos("# Random\n- [ ] Not a todo section");
    expect(todos.active.length).toBe(0);
    expect(todos.blocked.length).toBe(0);
    expect(todos.completedToday.length).toBe(0);
  });

  test("formatNotebook preserves unrelated content", () => {
    const existing = [
      "# Daily Log",
      "Some notes",
      "",
      "## Active",
      "- [ ] Old task",
      "",
      "## Blocked",
      "<!-- none -->",
      "",
      "## Completed Today",
      "<!-- none -->",
      "",
      "## Other Section",
      "Keep this",
    ].join("\n");

    const rendered = formatNotebook(existing, {
      active: [{ id: "a", title: "New task", tags: ["x"], status: "active" }],
      blocked: [],
      completedToday: [{ id: "d", title: "Done task", tags: [], status: "done" }],
    });

    expect(rendered.includes("## Other Section")).toBe(true);
    expect(rendered.includes("Keep this")).toBe(true);
    expect(rendered.includes("- [ ] New task #x")).toBe(true);
    expect(rendered.includes("- [x] Done task")).toBe(true);
  });
});
