import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/theme";

// Single button flipping light <-> dark in one click.
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const dark = theme === "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(dark ? "light" : "dark")}
      title={dark ? "Dark theme" : "Light theme"}
      aria-label={`Switch to ${dark ? "light" : "dark"} theme`}
    >
      {dark ? <Moon /> : <Sun />}
    </Button>
  );
}
