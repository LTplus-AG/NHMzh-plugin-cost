import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import logger from './utils/logger';

const mount = (el: HTMLElement) => {
  const root = ReactDOM.createRoot(el);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
};

const localRoot = document.getElementById("plugin-cost-root");
if (localRoot) {
  try {
    mount(localRoot);
  } catch (error) {
    logger.error("Error rendering plugin:", error);
  }
}

export { mount };
