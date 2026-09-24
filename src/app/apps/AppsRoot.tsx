"use client";

import dynamic from "next/dynamic";

// The applications live in localStorage, so the list renders only in the browser.
const AppsView = dynamic(() => import("./AppsView"), {
  ssr: false,
  loading: () => <div className="ws-loading">Loading your applications...</div>,
});

export default function AppsRoot() {
  return <AppsView />;
}
