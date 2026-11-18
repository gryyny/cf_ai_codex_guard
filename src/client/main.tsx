import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const mock = new URLSearchParams(window.location.search).get("mock") === "1";
const root = document.getElementById("root");

if (root) {
  createRoot(root).render(
    <StrictMode>
      <App mock={mock} />
    </StrictMode>,
  );
}
