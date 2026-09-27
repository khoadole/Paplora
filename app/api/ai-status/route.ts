import { NextResponse } from "next/server";
import { readAiConfig } from "@/lib/extract/model";

/** Truthful AI status for Settings. Never returns the key, only whether one is present. */
export function GET() {
  const config = readAiConfig();
  return NextResponse.json({
    configured: config.configured,
    model: config.model,
    hasKey: config.hasKey,
    reason: config.reason,
  });
}
