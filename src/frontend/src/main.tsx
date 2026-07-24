import { ErrorBoundary } from "@/components/ErrorBoundary";
import { InternetIdentityProvider } from "@caffeineai/core-infrastructure";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

BigInt.prototype.toJSON = function () {
  return this.toString();
};

declare global {
  interface BigInt {
    toJSON(): string;
  }
}

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <InternetIdentityProvider withAttributes={false}>
      {/* App-root error boundary: any uncaught render crash shows a
          recoverable error screen instead of a black screen. The boundary
          never touches the Zustand store, so in-memory data survives. */}
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </InternetIdentityProvider>
  </QueryClientProvider>,
);
