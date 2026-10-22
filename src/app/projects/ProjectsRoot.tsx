"use client";

import dynamic from "next/dynamic";

// The page reads the store from localStorage, so it renders only in the browser.
const ProjectsView = dynamic(() => import("./ProjectsView"), {
  ssr: false,
  loading: () => <div className="ws-loading">Loading your projects...</div>,
});

export default function ProjectsRoot() {
  return <ProjectsView />;
}
