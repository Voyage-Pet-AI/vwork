import { useState, useEffect, useCallback } from "react";
import { getAuthStatus, logoutService, getSchedules, deleteSchedule } from "../lib/api.js";
import type { AuthStatus as AuthStatusType, Schedule } from "../lib/types.js";

export function SettingsPanel() {
  const [auth, setAuth] = useState<AuthStatusType | null>(null);
  const [schedules, setSchedules] = useState<Schedule[]>([]);

  const refreshAuth = useCallback(async () => {
    try {
      const data = await getAuthStatus();
      setAuth(data);
    } catch {
      // best effort
    }
  }, []);

  const refreshSchedules = useCallback(async () => {
    try {
      const data = await getSchedules();
      setSchedules(data.schedules);
    } catch {
      // best effort
    }
  }, []);

  useEffect(() => {
    refreshAuth();
    refreshSchedules();
  }, [refreshAuth, refreshSchedules]);

  const handleLogout = useCallback(
    async (service: string) => {
      try {
        await logoutService(service);
        await refreshAuth();
      } catch {
        // best effort
      }
    },
    [refreshAuth]
  );

  const handleDeleteSchedule = useCallback(
    async (name: string) => {
      try {
        await deleteSchedule(name);
        await refreshSchedules();
      } catch {
        // best effort
      }
    },
    [refreshSchedules]
  );

  return (
    <div className="flex flex-col h-full p-6 space-y-8 overflow-y-auto">
      {/* Auth Status */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Connected Services</h2>
        {!auth ? (
          <p className="text-zinc-500 text-sm">Loading...</p>
        ) : (
          <div className="space-y-2">
            {Object.entries(auth.services).map(([name, { connected }]) => (
              <div
                key={name}
                className="flex items-center justify-between px-4 py-3 rounded-lg bg-zinc-800/40 border border-zinc-700/50"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      connected ? "bg-emerald-400" : "bg-zinc-600"
                    }`}
                  />
                  <span className="text-sm text-zinc-200 capitalize">{name}</span>
                </div>
                {connected && (
                  <button
                    onClick={() => handleLogout(name)}
                    className="text-xs text-zinc-500 hover:text-red-400 transition-colors"
                  >
                    Disconnect
                  </button>
                )}
                {!connected && (
                  <span className="text-xs text-zinc-600">
                    Run <code className="text-zinc-500">vwork login {name}</code> in terminal
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Schedules */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Report Schedules</h2>
        {schedules.length === 0 ? (
          <p className="text-zinc-500 text-sm">No schedules configured.</p>
        ) : (
          <div className="space-y-2">
            {schedules.map((s) => (
              <div
                key={s.name}
                className="flex items-center justify-between px-4 py-3 rounded-lg bg-zinc-800/40 border border-zinc-700/50"
              >
                <div>
                  <span className="text-sm text-zinc-200 font-medium">{s.name}</span>
                  <span className="text-xs text-zinc-500 ml-3">{s.frequencyLabel}</span>
                  {s.prompt && (
                    <p className="text-xs text-zinc-500 mt-1 truncate max-w-md">{s.prompt}</p>
                  )}
                </div>
                <button
                  onClick={() => handleDeleteSchedule(s.name)}
                  className="text-xs text-zinc-500 hover:text-red-400 transition-colors"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
