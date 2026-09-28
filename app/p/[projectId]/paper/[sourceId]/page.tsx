import { Suspense } from "react";
import { Reader } from "@/components/reader";

export default function Page() {
  return (
    <Suspense fallback={<div className="p-6 text-[13px]">Opening paper…</div>}>
      <Reader />
    </Suspense>
  );
}
