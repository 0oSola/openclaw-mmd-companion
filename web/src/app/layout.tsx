import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "MMD Virtual Assistant",
  description: "Browser MMD assistant powered by OpenClaw",
  icons: { icon: "/images/aether-companion-mark-crop.png" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
