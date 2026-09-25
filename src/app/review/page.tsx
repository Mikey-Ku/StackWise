import type { Metadata } from "next";
import ReviewView from "./ReviewView";
import "../apps/apps.css";
import "./review.css";

export const metadata: Metadata = {
  title: "Review facts | StackWise",
  description: "Check StackWise's facts against their sources, the ones behind the default picks first.",
};

/**
 * The fact review: one fact at a time with its source, for the person who keeps StackWise's data.
 * It writes to data/ through /api/review, which only answers StackWise's own page on this computer.
 */
export default function ReviewPage() {
  return <ReviewView />;
}
