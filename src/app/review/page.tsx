import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { reviewHidden } from "@/engine/review-store";
import ReviewView from "./ReviewView";
import "../apps/apps.css";
import "./review.css";

// Checked on every request, so STACKWISE_HOSTED takes effect without a rebuild.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Review facts | StackWise",
  description: "Check StackWise's facts against their sources, the ones behind the default picks first.",
};

/**
 * The fact review: one fact at a time with its source, for the person who keeps StackWise's data.
 * It writes to data/ through /api/review, so a hosted StackWise (STACKWISE_HOSTED=1) doesn't have it.
 */
export default function ReviewPage() {
  if (reviewHidden()) notFound();
  return <ReviewView />;
}
