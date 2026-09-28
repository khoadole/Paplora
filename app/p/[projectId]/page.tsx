import { Suspense } from "react";
import { ProjectWorkspace } from "@/components/project-workspace";

/** Project data lives in the browser, so this route renders a shell and fills in on the client. */
export default function Page() {
  return (
    <Suspense fallback={<div className="p-6 text-[13px]">Opening project…</div>}>
      <ProjectWorkspace />
    </Suspense>
  );
}
