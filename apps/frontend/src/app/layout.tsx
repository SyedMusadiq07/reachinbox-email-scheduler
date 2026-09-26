import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "ReachInbox", description: "ReachInbox email scheduler" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}

