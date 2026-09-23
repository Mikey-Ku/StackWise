"use client";

import dynamic from "next/dynamic";
import type { Catalog } from "@/engine";

// The workspace keeps its plan in localStorage, so it renders only in the browser.
const Workspace = dynamic(() => import("./Workspace"), {
  ssr: false,
  loading: () => <div className="ws-loading">Loading StackWise...</div>,
});

export default function ClientRoot(props: { catalog: Catalog; problems: string[] }) {
  return <Workspace {...props} />;
}
