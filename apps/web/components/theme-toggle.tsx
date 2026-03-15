"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const themes = ["light", "dark", "system"] as const;
const icons = { light: Sun, dark: Moon, system: Monitor };
const labels = { light: "Light", dark: "Dark", system: "System" };

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <button
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-sidebar-muted-foreground"
        aria-label="Toggle theme"
      >
        <Monitor className="h-4 w-4" />
      </button>
    );
  }

  const current = (theme ?? "system") as (typeof themes)[number];
  const nextIndex = (themes.indexOf(current) + 1) % themes.length;
  const next = themes[nextIndex];
  const Icon = icons[current];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={() => setTheme(next)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-sidebar-muted-foreground transition-colors hover:text-sidebar-foreground hover:bg-sidebar-accent"
          aria-label={`Switch to ${labels[next]} theme`}
          suppressHydrationWarning
        >
          <Icon
            className="h-4 w-4 transition-transform duration-200 ease-out"
            key={current}
          />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {labels[current]} mode
      </TooltipContent>
    </Tooltip>
  );
}
