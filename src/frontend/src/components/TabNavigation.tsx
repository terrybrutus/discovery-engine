import { cn } from "@/lib/utils";
import type { CompletedStep, TabId } from "@/types";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { Lock } from "lucide-react";

interface TabDef {
  id: TabId;
  label: string;
  /** Step that must be completed before this tab unlocks. */
  requires: CompletedStep;
  shortLabel: string;
}

const TABS: TabDef[] = [
  {
    id: "features",
    label: "Feature Generator",
    requires: "dataLoaded",
    shortLabel: "Features",
  },
  {
    id: "discovery",
    label: "Pattern Discovery",
    requires: "featuresGenerated",
    shortLabel: "Discover",
  },
  {
    id: "validation",
    label: "Validation",
    requires: "discoveryComplete",
    shortLabel: "Validate",
  },
  {
    id: "report",
    label: "Report",
    requires: "validationComplete",
    shortLabel: "Report",
  },
  {
    id: "savedRuns",
    label: "Saved Runs",
    requires: "dataLoaded",
    shortLabel: "Saved",
  },
];

interface TabNavigationProps {
  activeTab: TabId;
  completedSteps: Set<CompletedStep>;
  onTabChange: (tab: TabId) => void;
}

/**
 * Four-tab navigation with progressive unlock. Active tab gets a green
 * underline; locked tabs show a lock icon and are disabled.
 */
export function TabNavigation({
  activeTab,
  completedSteps,
  onTabChange,
}: TabNavigationProps) {
  return (
    <TabsPrimitive.Root
      value={activeTab}
      onValueChange={(v) => onTabChange(v as TabId)}
      data-ocid="tab_navigation"
      className="w-full"
    >
      <TabsPrimitive.List
        data-ocid="tab_navigation.list"
        className="flex w-full items-stretch gap-0 border-b border-border bg-card px-2 md:px-6"
      >
        {TABS.map((tab, idx) => {
          const unlocked = completedSteps.has(tab.requires);
          const isActive = activeTab === tab.id;
          return (
            <TabsPrimitive.Trigger
              key={tab.id}
              value={tab.id}
              disabled={!unlocked}
              data-ocid={`tab_navigation.tab.${tab.id}`}
              className={cn(
                "relative flex flex-1 items-center justify-center gap-2 px-3 py-3 text-sm font-medium transition-smooth outline-none",
                "focus-visible:ring-2 focus-visible:ring-ring/50",
                isActive
                  ? "text-primary"
                  : unlocked
                    ? "text-muted-foreground hover:text-foreground"
                    : "text-muted-foreground/40",
                "disabled:cursor-not-allowed",
              )}
            >
              <span className="font-mono text-xs tabular-nums opacity-60">
                {String(idx + 1).padStart(2, "0")}
              </span>
              <span className="hidden sm:inline">{tab.label}</span>
              <span className="sm:hidden">{tab.shortLabel}</span>
              {!unlocked ? (
                <Lock className="size-3.5 opacity-60" aria-hidden="true" />
              ) : null}
              <span
                className={cn(
                  "absolute bottom-0 left-0 right-0 h-0.5 transition-smooth",
                  isActive ? "bg-primary" : "bg-transparent",
                )}
                aria-hidden="true"
              />
            </TabsPrimitive.Trigger>
          );
        })}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  );
}
