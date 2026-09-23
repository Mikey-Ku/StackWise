import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import "../styles/mk-ui.css";
import "../styles/theme-apple.css";
import "./globals.css";

// San Francisco comes from the system on Apple devices; Inter and Geist Mono stand in everywhere else.
const body = Inter({ subsets: ["latin"], variable: "--font-body" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "StackWise",
  description: "Plan a web app stack you understand. Every connection is checked against sourced facts, then handed to your AI builder as a spec.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
