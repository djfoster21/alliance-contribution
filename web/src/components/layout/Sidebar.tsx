import { NavLink } from "react-router-dom";
import { navSections } from "@/lib/nav";
import { cn } from "@/lib/utils";

/** Brand header + nav list, shared by the desktop aside and the mobile drawer. */
export function SidebarNav() {
  return (
    <>
      {/* Brand */}
      <div className="flex items-center gap-3 border-b border-border px-[18px] py-4">
        <div className="flex size-9 items-center justify-center rounded-[9px] bg-foreground font-mono text-[14px] font-semibold tracking-[-0.03em] text-accent-foreground">
          AT
        </div>
        <div className="leading-tight">
          <div className="text-[14px] font-semibold tracking-[-0.01em] text-foreground">
            Alliance Tracker
          </div>
          <div className="text-[11px] text-muted">Participation Tracker</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-4 px-3 py-4">
        {navSections.map((section) => (
          <div key={section.title} className="flex flex-col gap-[3px]">
            <p className="px-2.5 pb-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] text-faint">
              {section.title}
            </p>
            {section.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-[11px] rounded-[8px] border px-[11px] py-2 text-[13.5px] transition-colors duration-150",
                    isActive
                      ? "border-border bg-surface font-semibold text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.05)]"
                      : "border-transparent font-medium text-secondary hover:bg-surface hover:text-foreground",
                  )
                }
              >
                <item.icon className="size-[17px]" />
                {item.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
    </>
  );
}

export function Sidebar() {
  return (
    <aside className="scr hidden w-[250px] shrink-0 flex-col overflow-y-auto border-r border-border bg-background md:flex">
      <SidebarNav />
    </aside>
  );
}
