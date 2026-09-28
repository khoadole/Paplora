import type { Metadata } from "next";
import "./globals.css";
import { WorkspaceProvider } from "@/lib/workspace";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  title: "Paplora",
  description:
    "A local research workspace: turn a set of papers into a comparison where every answer links to the passage it came from.",
};

/**
 * The provider lives here rather than in a page, so workspace state survives
 * navigation between the home screen, a project and the reader.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <WorkspaceProvider>
          <AppShell>{children}</AppShell>
        </WorkspaceProvider>
      </body>
    </html>
  );
}
