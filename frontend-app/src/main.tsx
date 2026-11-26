import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";

// Guard against React SPA chunk 404 right after a new deployment (refresh at most once)
window.addEventListener("vite:preloadError", () => {
  const key = "chunk_reload_attempted";
  if (!sessionStorage.getItem(key)) {
    sessionStorage.setItem(key, "1");
    window.location.reload();
  }
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
