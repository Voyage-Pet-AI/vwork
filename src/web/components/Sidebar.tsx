type View = "chat" | "reports" | "todos" | "settings";

interface SidebarProps {
  active: View;
  onChange: (view: View) => void;
}

const NAV_ITEMS: { key: View; label: string; icon: string }[] = [
  { key: "chat", label: "Chat", icon: "💬" },
  { key: "reports", label: "Reports", icon: "📊" },
  { key: "todos", label: "Todos", icon: "✅" },
  { key: "settings", label: "Settings", icon: "⚙️" },
];

export function Sidebar({ active, onChange }: SidebarProps) {
  return (
    <nav className="w-48 border-r border-zinc-800 bg-zinc-900/50 flex flex-col py-2">
      {NAV_ITEMS.map((item) => (
        <button
          key={item.key}
          onClick={() => onChange(item.key)}
          className={`flex items-center gap-2.5 px-4 py-2.5 text-sm text-left transition-colors ${
            active === item.key
              ? "bg-zinc-800 text-zinc-100"
              : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
          }`}
        >
          <span className="text-base">{item.icon}</span>
          {item.label}
        </button>
      ))}
    </nav>
  );
}

export type { View };
