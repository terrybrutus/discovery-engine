import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Header } from "@/components/Header";
import { TabNavigation } from "@/components/TabNavigation";
import { Toaster } from "@/components/ui/sonner";
import { useEngineStore } from "@/store/engineStore";
import type { TabId } from "@/types";
import { Suspense, lazy, useEffect } from "react";
import { toast } from "sonner";

// Page components will be created in the next wave. Lazy-load them so this
// foundation compiles even before the page files exist; the Suspense
// fallback renders a placeholder div that the page tasks will replace.
const FeatureGeneratorPage = lazy(() =>
  import("@/pages/FeatureGeneratorPage")
    .then((m) => ({ default: m.default }))
    .catch(() => ({
      default: () => <PlaceholderPage title="Feature Generator" />,
    })),
);
const PatternDiscoveryPage = lazy(() =>
  import("@/pages/PatternDiscoveryPage")
    .then((m) => ({ default: m.default }))
    .catch(() => ({
      default: () => <PlaceholderPage title="Pattern Discovery" />,
    })),
);
const ValidationPage = lazy(() =>
  import("@/pages/ValidationPage")
    .then((m) => ({ default: m.default }))
    .catch(() => ({
      default: () => <PlaceholderPage title="Validation" />,
    })),
);
const CrossReferencePage = lazy(() =>
  import("@/components/CrossReferencePage")
    .then((m) => ({ default: m.default }))
    .catch(() => ({
      default: () => <PlaceholderPage title="Cross-Reference" />,
    })),
);
const ReportPage = lazy(() =>
  import("@/pages/ReportPage")
    .then((m) => ({ default: m.default }))
    .catch(() => ({
      default: () => <PlaceholderPage title="Report" />,
    })),
);
const SavedRunsPage = lazy(() =>
  import("@/pages/SavedRunsPage")
    .then((m) => ({ default: m.SavedRunsPage }))
    .catch(() => ({
      default: () => <PlaceholderPage title="Saved Runs" />,
    })),
);

function PlaceholderPage({ title }: { title: string }) {
  return (
    <div
      data-ocid="page.placeholder"
      className="flex min-h-[60vh] items-center justify-center"
    >
      <div className="rounded-lg border border-dashed border-border bg-card/40 px-8 py-12 text-center">
        <p className="font-display text-lg font-semibold text-foreground">
          {title}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          This page will be built in the next step.
        </p>
      </div>
    </div>
  );
}

function PageForTab({ tab }: { tab: TabId }) {
  // Per-page error boundary: a crash on one routed page is contained and
  // recoverable without losing other pages' state. The boundary's Go Back
  // navigates to the "features" tab as a safe default via the store's
  // setActiveTab action; the boundary itself never mutates the store, so
  // in-memory data (datasets, features, patterns) survives the crash.
  return (
    <ErrorBoundary previousTab="features">{renderPage(tab)}</ErrorBoundary>
  );
}

function renderPage(tab: TabId) {
  switch (tab) {
    case "features":
      return <FeatureGeneratorPage />;
    case "discovery":
      return <PatternDiscoveryPage />;
    case "validation":
      return <ValidationPage />;
    case "crossReference":
      return <CrossReferencePage />;
    case "report":
      return <ReportPage />;
    case "savedRuns":
      return <SavedRunsPage />;
    default:
      return <FeatureGeneratorPage />;
  }
}

/**
 * Main application shell: header, tab navigation, and a content area that
 * renders the active tab page. Responsive — desktop shows full layout,
 * tablet/mobile stacks.
 */
export function AppShell() {
  const activeTab = useEngineStore((s) => s.activeTab);
  const completedSteps = useEngineStore((s) => s.completedSteps);
  const setActiveTab = useEngineStore((s) => s.setActiveTab);
  const restoreRecoveryAction = useEngineStore((s) => s.restoreRecoveryAction);
  const recoveryMessage = useEngineStore((s) => s.recoveryMessage);
  const clearRecoveryNotice = useEngineStore((s) => s.clearRecoveryNotice);

  useEffect(() => {
    void restoreRecoveryAction();
  }, [restoreRecoveryAction]);

  useEffect(() => {
    if (!recoveryMessage) return;
    toast.success("Local workspace recovered", {
      description: `${recoveryMessage} Raw rows remained on this device.`,
      duration: 8_000,
    });
    clearRecoveryNotice();
  }, [clearRecoveryNotice, recoveryMessage]);

  return (
    <div
      data-ocid="app_shell"
      className="flex min-h-screen flex-col bg-background text-foreground"
    >
      <Header />
      <TabNavigation
        activeTab={activeTab}
        completedSteps={completedSteps}
        onTabChange={setActiveTab}
      />
      <main data-ocid="app_shell.content" className="flex-1 overflow-x-hidden">
        <Suspense fallback={<PlaceholderPage title="Loading…" />}>
          <PageForTab tab={activeTab} />
        </Suspense>
      </main>
      <Toaster theme="dark" position="bottom-right" />
      <footer
        data-ocid="app_shell.footer"
        className="border-t border-border bg-card px-4 py-3 text-center md:px-6"
      >
        <p className="text-xs text-muted-foreground">
          © {new Date().getFullYear()}. Built with love using{" "}
          <a
            href={`https://caffeine.ai?utm_source=caffeine-footer&utm_medium=referral&utm_content=${encodeURIComponent(
              typeof window !== "undefined"
                ? window.location.hostname
                : "localhost",
            )}`}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            caffeine.ai
          </a>
          {" · "}Research rows and statistical computation remain in your
          browser; optional AI definition requests send only schema summaries
          you approve.
        </p>
      </footer>
    </div>
  );
}
