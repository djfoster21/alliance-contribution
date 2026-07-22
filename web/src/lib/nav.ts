import {
  LayoutDashboard,
  Trophy,
  User,
  CalendarCheck,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { to: string; label: string; icon: LucideIcon };
export type NavSection = { title: string; items: NavItem[] };

export const navSections: NavSection[] = [
  {
    title: "Dashboard",
    items: [
      { to: "/", label: "Overview", icon: LayoutDashboard },
      { to: "/rankings", label: "Ranking", icon: Trophy },
      { to: "/members", label: "Members", icon: User },
      { to: "/attendance", label: "Attendance", icon: CalendarCheck },
    ],
  },
  {
    title: "Manage",
    items: [{ to: "/admin", label: "Admin", icon: SlidersHorizontal }],
  },
];

/** Best-match page title for a pathname (handles nested/dynamic routes). */
export function titleForPath(pathname: string): string {
  if (pathname.startsWith("/admin")) return "Admin";
  if (pathname.startsWith("/rankings")) return "Ranking";
  if (pathname.startsWith("/members/")) return "Member Profile";
  for (const section of navSections) {
    for (const item of section.items) {
      if (item.to === pathname) return item.label;
    }
  }
  return "Alliance Tracker";
}

const subtitles: Record<string, string> = {
  "/": "Alliance participation at a glance",
  "/rankings": "Leaderboard by event week and all-time",
  "/rankings/overall": "Leaderboard by event week and all-time",
  "/members": "Alliance roster — pick anyone to open their profile",
  "/attendance": "Event-day coverage across the roster",
};

/** Best-match page subtitle for a pathname. */
export function subtitleForPath(pathname: string): string {
  if (pathname.startsWith("/admin")) return "Manage events, roster, aliases & scoring";
  if (pathname.startsWith("/members/")) return "Individual participation & history";
  return subtitles[pathname] ?? "";
}
