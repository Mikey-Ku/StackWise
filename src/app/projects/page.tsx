import type { Metadata } from "next";
import ProjectsRoot from "./ProjectsRoot";
import "../shell.css";
import "./projects.css";

export const metadata: Metadata = {
  title: "Projects | StackWise",
  description: "Every plan on this computer, the projects StackWise found in your folders, and the examples.",
};

export default function ProjectsPage() {
  return <ProjectsRoot />;
}
