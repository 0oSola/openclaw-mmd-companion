import React from "react";
import { createRoot } from "react-dom/client";

import { MenuWindow } from "./MenuWindow";
import "./menuWindow.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MenuWindow />
  </React.StrictMode>,
);
