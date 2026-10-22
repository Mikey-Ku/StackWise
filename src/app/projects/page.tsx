import type { Metadata } from "next";
import { readMe } from "@/local/home";
import { readDiskLibrary } from "@/local/library";
import ProjectsView from "./ProjectsView";
import "../shell.css";
import "./projects.css";

export const metadata: Metadata = {
  title: "Projects | StackWise",
  description: "Every plan on this computer, the projects StackWise found in your folders, and the examples.",
};

// Read ~/.stackwise on every request, so the page always shows the library as it is.
export const dynamic = "force-dynamic";

export default function ProjectsPage() {
  return <ProjectsView initialMe={readMe()} initialLibrary={readDiskLibrary(process.cwd())} />;
}
