import type { Metadata } from "next";

import { ApplicantWorkspace } from "@/components/applicant/applicant-workspace";

export const metadata: Metadata = { title: "Submit a request · Health Data Access Body" };

export default function ApplicantPage() {
  return <ApplicantWorkspace />;
}
