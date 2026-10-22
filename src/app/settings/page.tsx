import type { Metadata } from "next";
import { loadCatalog } from "@/engine/load";
import SettingsView from "./SettingsView";
import "../shell.css";
import "../projects/projects.css";

export const metadata: Metadata = {
  title: "Settings | StackWise",
  description: "Your profile, the folders StackWise looks in, the coding agents on this computer, AI keys and the MCP server.",
};

// Read /data on every request, like the canvas, so a new builder shows up without a restart.
export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const { planning } = loadCatalog();
  return <SettingsView builders={planning.builders.map((b) => ({ id: b.id, label: b.label }))} priorities={planning.priorities.map((p) => ({ id: p.id, label: p.label }))} sizes={planning.sizes.map((s) => ({ id: s.id, label: s.label }))} />;
}
