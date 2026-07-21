/* Entry point: mount the trainer component at #root.
 *
 * The host page (trainer.html) provides window.storage (bridged to the shared
 * account layer). If none is present we fall back to localStorage so the
 * bundle also runs on a bare page. */
import React from "react";
import { createRoot } from "react-dom/client";
import SkewbTrainer from "./skewb-trainer.jsx";

if (!window.storage) {
  window.storage = {
    async get(key) { const v = localStorage.getItem(key); return v == null ? null : { key, value: v }; },
    async set(key, value) { localStorage.setItem(key, value); return { key, value }; },
  };
}

createRoot(document.getElementById("root")).render(React.createElement(SkewbTrainer));
