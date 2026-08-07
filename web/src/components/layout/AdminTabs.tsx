import { NavLink } from "react-router-dom";
import { useApiKey } from "@/lib/apiKey";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/admin/events", label: "Events" },
  { to: "/admin/roster", label: "Roster" },
  { to: "/admin/aliases", label: "Aliases" },
  { to: "/admin/scoring", label: "Scoring & Activities" },
  { to: "/admin/rewards", label: "Rewards", adminOnly: true },
  { to: "/admin/backup", label: "Export / Import", adminOnly: true },
];

export function AdminTabs() {
  const { role } = useApiKey();
  const visibleTabs = TABS.filter((tab) => !tab.adminOnly || role === "admin");

  return (
    <div className="inline-flex flex-wrap items-center gap-1 rounded-[10px] border border-border bg-muted-surface p-1">
      {visibleTabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          className={({ isActive }) =>
            cn(
              "rounded-[7px] px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-150",
              isActive
                ? "bg-surface font-semibold text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
                : "text-muted hover:text-foreground",
            )
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </div>
  );
}
