import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { CompletionNoticeWindow } from "./CompletionNoticeWindow";
import "./notification.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CompletionNoticeWindow />
  </StrictMode>,
);
