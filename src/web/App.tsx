import { useState } from "react";
import { Header } from "./components/Header.js";
import { Sidebar, type View } from "./components/Sidebar.js";
import { ChatView } from "./components/ChatView.js";
import { ReportHistory } from "./components/ReportHistory.js";
import { TodoPanel } from "./components/TodoPanel.js";
import { SettingsPanel } from "./components/SettingsPanel.js";

export function App() {
  const [view, setView] = useState<View>("chat");

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar active={view} onChange={setView} />
        <main className="flex-1 overflow-hidden">
          {view === "chat" && <ChatView />}
          {view === "reports" && <ReportHistory />}
          {view === "todos" && <TodoPanel />}
          {view === "settings" && <SettingsPanel />}
        </main>
      </div>
    </div>
  );
}
