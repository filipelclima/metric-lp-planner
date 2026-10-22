import { Suspense } from "react";
import Planner from "@/components/Planner";

export default function Page() {
  return (
    <Suspense fallback={<div className="py-20 text-center text-muted">Loading…</div>}>
      <Planner />
    </Suspense>
  );
}
