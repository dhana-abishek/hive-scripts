import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { loadZoneOverridesOnce } from "./hooks/useZoneOverrides";

// Load cloud-backed zone overrides before first render so module-level
// buildZoneLookup() calls include user-assigned merchants.
loadZoneOverridesOnce().finally(() => {
  createRoot(document.getElementById("root")!).render(<App />);
});
