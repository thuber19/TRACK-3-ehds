import { NextResponse } from "next/server";

import { logDownloadAttempt } from "@/lib/mock/store";

export const dynamic = "force-dynamic";

/** Always 403: data cannot leave the secure processing environment. */
export async function POST(_request: Request, ctx: RouteContext<"/api/spe/[id]/download">) {
  const { id } = await ctx.params;
  const event = logDownloadAttempt(id);
  return NextResponse.json(
    {
      error: "forbidden",
      message: "Data cannot leave the secure processing environment (Art. 73).",
      logged: Boolean(event),
    },
    { status: 403 },
  );
}
