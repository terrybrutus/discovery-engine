import { Button } from "@/components/ui/button";
import { useEngineStore } from "@/store/engineStore";
import type { TabId } from "@/types";
import { AlertTriangle, ArrowLeft, RotateCw } from "lucide-react";
import { Component, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * Optional custom fallback render. Receives the caught error plus `retry`
   * (re-render children from current state) and `goBack` (navigate to the
   * previous route via the store's active tab) callbacks. When omitted, the
   * default error screen is used.
   */
  fallback?: (args: {
    error: Error;
    retry: () => void;
    goBack: () => void;
  }) => ReactNode;
  /**
   * Optional previous-tab hint used by the default Go Back button. When
   * omitted, Go Back navigates to the "features" tab as a safe default.
   */
  previousTab?: TabId;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Reusable React error boundary. Catches render errors via
 * `getDerivedStateFromError` + `componentDidCatch`, logs the full error to
 * `console.error` for debugging (without exposing stack traces to the
 * user), and renders a recoverable error screen with Retry and Go Back
 * actions.
 *
 * The boundary does NOT touch the Zustand store — in-memory data (loaded
 * datasets, generated features, pattern results) survives the error and
 * recovery. Retry resets the boundary's internal state so children
 * re-render from the current store state; Go Back navigates to the
 * previous route via the store's `setActiveTab` action.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: { componentStack: string }) {
    // Log the full error + component stack to the console for debugging.
    // The user-facing screen never shows the stack trace.
    console.error("[ErrorBoundary] render error caught:", error, info);
  }

  retry = () => {
    this.setState({ error: null });
  };

  goBack = () => {
    const previous = this.props.previousTab ?? "features";
    useEngineStore.getState().setActiveTab(previous);
    this.setState({ error: null });
  };

  override render() {
    const { error } = this.state;
    const { children, fallback } = this.props;

    if (!error) return children;

    if (fallback) {
      return fallback({
        error,
        retry: this.retry,
        goBack: this.goBack,
      });
    }

    return <DefaultErrorScreen onRetry={this.retry} onGoBack={this.goBack} />;
  }
}

/**
 * Default recoverable error screen. Shows a clear, non-technical message
 * with Retry (re-render the failed page from current store state) and Go
 * Back (navigate to the previous route) actions. Both preserve in-memory
 * store data — the boundary never mutates the store.
 */
function DefaultErrorScreen({
  onRetry,
  onGoBack,
}: {
  onRetry: () => void;
  onGoBack: () => void;
}) {
  return (
    <div
      data-ocid="error_state"
      className="flex min-h-[60vh] items-center justify-center px-4 py-12"
      role="alert"
      aria-live="assertive"
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-card px-6 py-8 text-center shadow-subtle">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle
            className="size-6 text-destructive"
            aria-hidden="true"
          />
        </div>
        <h2 className="font-display text-lg font-semibold text-foreground">
          Something went wrong
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This view hit an unexpected error while rendering. Your loaded data
          and generated features are safe — nothing was lost. Try again, or go
          back to a previous step.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Button
            data-ocid="error_state.retry_button"
            variant="default"
            onClick={onRetry}
          >
            <RotateCw className="size-4" aria-hidden="true" />
            Retry
          </Button>
          <Button
            data-ocid="error_state.go_back_button"
            variant="outline"
            onClick={onGoBack}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Go Back
          </Button>
        </div>
      </div>
    </div>
  );
}
