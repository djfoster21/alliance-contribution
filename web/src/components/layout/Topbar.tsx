import { Menu } from "lucide-react";
import { useLocation } from "react-router-dom";
import { titleForPath, subtitleForPath } from "@/lib/nav";
import { Button } from "@/components/ui/button";
import { ApiKeyDialog } from "./ApiKeyDialog";
import { ThemeToggle } from "./ThemeToggle";

export function Topbar({ onMenuClick }: { onMenuClick: () => void }) {
  const { pathname } = useLocation();
  const subtitle = subtitleForPath(pathname);
  return (
    <header className="sticky top-0 z-20 flex h-[61px] shrink-0 items-center justify-between gap-2 border-b border-border bg-surface/85 px-4 backdrop-blur-md md:px-7">
      <div className="flex min-w-0 items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={onMenuClick}
          aria-label="Open navigation"
        >
          <Menu />
        </Button>
        <div className="min-w-0 leading-tight">
          <h1 className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">
            {titleForPath(pathname)}
          </h1>
          {subtitle && <p className="truncate text-[12px] text-muted">{subtitle}</p>}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <ThemeToggle />
        <ApiKeyDialog />
      </div>
    </header>
  );
}
