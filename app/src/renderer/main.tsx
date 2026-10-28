import { createRoot } from "react-dom/client";
import App from "./App";

import { installRendererErrorDiagnostics } from "./services/runtime-diagnostics";

installRendererErrorDiagnostics();

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Unable to mount What About It? Studio: missing root element.");
}

createRoot(rootElement).render(<App />);

