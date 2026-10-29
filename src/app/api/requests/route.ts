import { NextResponse } from "next/server";

import { list, submit } from "@/lib/mock/store";
import { validateRequestText } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(list());
}

export async function POST(request: Request) {
  const text = await request.text();
  const validation = validateRequestText(text);
  if (!validation.ok) {
    return NextResponse.json({ error: "Invalid request", issues: validation.issues }, { status: 422 });
  }
  const entry = submit(JSON.parse(text));
  // Simulate processing time so the progress UI is visible.
  await new Promise((resolve) => setTimeout(resolve, Math.min(entry.outcome?.processing_ms ?? 2000, 7000)));
  return NextResponse.json(entry.outcome);
}
