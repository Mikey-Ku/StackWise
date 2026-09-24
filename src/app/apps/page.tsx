import type { Metadata } from "next";
import AppsRoot from "./AppsRoot";
import "./apps.css";

export const metadata: Metadata = {
  title: "Applications | StackWise",
  description: "Every application you've planned in this browser, and examples to open.",
};

/** The applications page: everything saved in this browser, with open, duplicate, delete, new, open a plan file, and the examples. */
export default function AppsPage() {
  return <AppsRoot />;
}
