import { WorkspaceProvider } from "@/lib/workspace";
import { WorkspaceView } from "@/components/workspace-view";

/** The root route is the workspace itself. There is no marketing page to get past. */
export default function Page() {
  return (
    <WorkspaceProvider>
      <WorkspaceView />
    </WorkspaceProvider>
  );
}
