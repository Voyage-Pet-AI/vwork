import { Hono } from "hono";
import { listSchedules, addSchedule, removeSchedule, type Schedule } from "../../schedule/store.js";

export function scheduleRoutes() {
  const app = new Hono();

  app.get("/", (c) => {
    return c.json({ schedules: listSchedules() });
  });

  app.post("/", async (c) => {
    const body = await c.req.json<Omit<Schedule, "createdAt">>();

    const missing = (["name", "cron", "prompt"] as const).filter(
      (k) => typeof body[k] !== "string" || body[k].trim().length === 0,
    );
    if (missing.length > 0) {
      return c.json({ error: `Missing required fields: ${missing.join(", ")}` }, 400);
    }

    const schedule: Schedule = {
      ...body,
      createdAt: new Date().toISOString(),
    };
    addSchedule(schedule);
    return c.json({ ok: true, schedule });
  });

  app.delete("/:name", (c) => {
    const name = c.req.param("name");
    const removed = removeSchedule(name);
    if (!removed) {
      return c.json({ error: `No schedule named "${name}"` }, 404);
    }
    return c.json({ ok: true });
  });

  return app;
}
