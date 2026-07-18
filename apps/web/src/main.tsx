import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

async function enableMocking(): Promise<void> {
  if (import.meta.env.VITE_USE_MOCKS !== "true") {
    return;
  }
  const { worker } = await import("./mocks/browser");
  await worker.start({ onUnhandledRequest: "bypass" });
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

void enableMocking().then(() => {
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
