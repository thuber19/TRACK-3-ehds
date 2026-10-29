import { NextResponse } from "next/server";

import { get } from "@/lib/mock/store";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: RouteContext<"/api/requests/[id]">) {
  const { id } = await ctx.params;
  const detail = get(id);
  if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(detail);
}
