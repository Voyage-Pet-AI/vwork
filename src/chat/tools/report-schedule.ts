import type { LLMTool, ToolCall } from "../../llm/provider.js";
import { addSchedule, getSchedule, listSchedules, removeSchedule } from "../../schedule/store.js";
import { installCrontabEntry, parseTimeExpression, removeCrontabEntry } from "../../schedule/crontab.js";

function isValidName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(name);
}

function resolveCron(input: Record<string, unknown>): { cron: string; frequencyLabel: string } {
  if (typeof input.cron === "string" && input.cron.trim()) {
    return {
      cron: input.cron.trim(),
      frequencyLabel:
        typeof input.frequency_label === "string" && input.frequency_label.trim()
          ? input.frequency_label.trim()
          : `Cron: ${input.cron.trim()}`,
    };
  }

  if (typeof input.time_expression === "string" && input.time_expression.trim()) {
    const parsed = parseTimeExpression(input.time_expression.trim());
    return { cron: parsed.cron, frequencyLabel: parsed.label };
  }

  return { cron: "0 9 * * *", frequencyLabel: "Daily at 9am" };
}

export const reportScheduleTools: LLMTool[] = [
  {
    name: "reporter__report_list_schedules",
    description: "List report schedules and recent status.",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "reporter__report_add_schedule",
    description:
      "Create a report schedule. Provide name and either time_expression (e.g. 9am, */6h, */15m) or cron.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Schedule name (lowercase, numbers, hyphens)" },
        prompt: { type: "string", description: "Custom report prompt (optional)" },
        time_expression: { type: "string", description: "Examples: 9am, */6h, */15m" },
        cron: { type: "string", description: "Raw cron expression (optional)" },
        frequency_label: { type: "string", description: "Optional display label when using cron" },
      },
      required: ["name"],
    },
  },
  {
    name: "reporter__report_remove_schedule",
    description: "Remove a report schedule by name and uninstall its crontab entry.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Schedule name" },
      },
      required: ["name"],
    },
  },
  {
    name: "reporter__report_update_schedule",
    description:
      "Update an existing report schedule. You can change name, prompt, time_expression, cron, or frequency_label.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Existing schedule name" },
        new_name: { type: "string", description: "New schedule name (optional)" },
        prompt: { type: "string", description: "Updated custom report prompt (optional)" },
        time_expression: { type: "string", description: "Examples: 9am, */6h, */15m" },
        cron: { type: "string", description: "Raw cron expression (optional)" },
        frequency_label: { type: "string", description: "Optional display label when using cron" },
      },
      required: ["name"],
    },
  },
];

export async function executeReportScheduleTool(tc: ToolCall): Promise<string> {
  switch (tc.name) {
    case "reporter__report_list_schedules": {
      const schedules = listSchedules();
      if (schedules.length === 0) return "No schedules configured.";
      return schedules
        .map(
          (s) =>
            `- ${s.name}: ${s.frequencyLabel} (cron: ${s.cron})${s.prompt ? `\n  prompt: ${s.prompt}` : ""}`
        )
        .join("\n");
    }
    case "reporter__report_add_schedule": {
      const name = String(tc.input.name ?? "").trim();
      if (!name) return "Error: missing required field 'name'.";
      if (!isValidName(name)) {
        return "Error: invalid name. Use lowercase letters, numbers, and hyphens.";
      }
      if (getSchedule(name)) {
        return `Error: schedule "${name}" already exists.`;
      }

      const { cron, frequencyLabel } = resolveCron(tc.input);
      const prompt = typeof tc.input.prompt === "string" ? tc.input.prompt : "";

      addSchedule({
        name,
        prompt,
        cron,
        frequencyLabel,
        createdAt: new Date().toISOString(),
      });

      const installed = await installCrontabEntry(name, cron);
      if (!installed) {
        return `Schedule "${name}" added (${frequencyLabel}), but failed to install crontab entry.`;
      }
      return `Schedule "${name}" added (${frequencyLabel}) and crontab entry installed.`;
    }
    case "reporter__report_remove_schedule": {
      const name = String(tc.input.name ?? "").trim();
      if (!name) return "Error: missing required field 'name'.";
      const removed = removeSchedule(name);
      if (!removed) return `Error: schedule "${name}" not found.`;
      await removeCrontabEntry(name);
      return `Schedule "${name}" removed.`;
    }
    case "reporter__report_update_schedule": {
      const name = String(tc.input.name ?? "").trim();
      if (!name) return "Error: missing required field 'name'.";

      const existing = getSchedule(name);
      if (!existing) return `Error: schedule "${name}" not found.`;

      const newName = String(tc.input.new_name ?? name).trim();
      if (!isValidName(newName)) {
        return "Error: invalid new_name. Use lowercase letters, numbers, and hyphens.";
      }
      if (newName !== name && getSchedule(newName)) {
        return `Error: schedule "${newName}" already exists.`;
      }

      const hasTimingUpdate =
        (typeof tc.input.cron === "string" && tc.input.cron.trim().length > 0) ||
        (typeof tc.input.time_expression === "string" && tc.input.time_expression.trim().length > 0);
      const resolved = hasTimingUpdate
        ? resolveCron(tc.input)
        : { cron: existing.cron, frequencyLabel: existing.frequencyLabel };

      const updatedPrompt =
        typeof tc.input.prompt === "string" ? tc.input.prompt : existing.prompt;

      // Replace record in store
      removeSchedule(name);
      addSchedule({
        name: newName,
        prompt: updatedPrompt,
        cron: resolved.cron,
        frequencyLabel: resolved.frequencyLabel,
        createdAt: existing.createdAt,
      });

      await removeCrontabEntry(name);
      const installed = await installCrontabEntry(newName, resolved.cron);
      if (!installed) {
        return `Schedule "${name}" updated to "${newName}" (${resolved.frequencyLabel}), but failed to install crontab entry.`;
      }
      return `Schedule "${name}" updated to "${newName}" (${resolved.frequencyLabel}).`;
    }
    default:
      throw new Error(`Unknown report schedule tool: ${tc.name}`);
  }
}
