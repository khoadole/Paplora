import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Paplora — compare papers with the evidence attached",
  description:
    "A local research workspace: turn a set of PDFs into a comparison table where every extracted answer links to the passage it came from.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
