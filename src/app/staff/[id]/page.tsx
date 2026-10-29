import type { Metadata } from "next";

import { RequestDetailView } from "@/components/staff/request-detail";

export async function generateMetadata({ params }: PageProps<"/staff/[id]">): Promise<Metadata> {
  const { id } = await params;
  return { title: `${decodeURIComponent(id)} · Staff · Health Data Access Body` };
}

export default async function StaffDetailPage({ params }: PageProps<"/staff/[id]">) {
  const { id } = await params;
  return <RequestDetailView id={decodeURIComponent(id)} />;
}
