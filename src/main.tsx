import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
createRoot(document.getElementById("root")!).render(<App />);
if (import.meta.env.PROD) {
  // Keep the first paint lean, but warm the calendar chunk once the app is idle
  // so opening a date picker (and offline use) stays instant.
  const prefetch = () => {
    void import("./components/CalendarCore").catch(() => {});
  };
  const idle = (
    window as Window & {
      requestIdleCallback?: (
        callback: () => void,
        options?: { timeout: number },
      ) => number;
    }
  ).requestIdleCallback;
  if (idle) idle(prefetch, { timeout: 2500 });
  else setTimeout(prefetch, 1800);
}
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () =>
    navigator.serviceWorker.register("/sw.js").catch(() => {}),
  );
}
