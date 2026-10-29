import type { Metadata } from "next";

import { RequestList } from "@/components/staff/request-list";

export const metadata: Metadata = { title: "Requests · Staff · Health Data Access Body" };

export default function StaffPage() {
  return <RequestList />;
}
