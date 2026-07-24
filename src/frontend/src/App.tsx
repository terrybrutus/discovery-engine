import { AppShell } from "@/components/AppShell";

/**
 * Root application component. The engine store preloads the sample dataset
 * on initialization (see store/engineStore.ts), so the app starts ready to
 * run. AppShell owns the header, tab navigation, and content area.
 */
export default function App() {
  return <AppShell />;
}
