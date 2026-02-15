import { platform } from "os";

function escapeAppleScript(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export async function sendNotification(title: string, subtitle: string, body: string): Promise<void> {
  if (platform() !== "darwin") return;

  const script = `display notification "${escapeAppleScript(body)}" with title "${escapeAppleScript(title)}" subtitle "${escapeAppleScript(subtitle)}"`;
  const proc = Bun.spawn(["osascript", "-e", script], {
    stdout: "ignore",
    stderr: "ignore",
  });
  await proc.exited;
}
