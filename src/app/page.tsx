import Link from "next/link";
import { ArrowRightIcon, ClipboardListIcon, FileSearchIcon, HospitalIcon } from "lucide-react";

import { HOSPITALS } from "@/lib/constants";

const ENTRIES = [
  {
    href: "/applicant",
    icon: FileSearchIcon,
    title: "Applicant",
    text: "Submit a request as JSON and get a decision, statistics or access to a secure environment.",
  },
  {
    href: "/staff",
    icon: ClipboardListIcon,
    title: "Staff",
    text: "Review every request, its decision and a step-by-step log of how it was assessed.",
  },
];

export default function Home() {
  return (
    <div className="mx-auto grid max-w-5xl gap-12 px-4 py-16 sm:px-6 sm:py-24">
      <div className="grid gap-4 text-center">
        <span className="mx-auto inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground">
          <HospitalIcon className="size-3.5" />
          Federated across {HOSPITALS.join(", ")}
        </span>
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Health data access, decided in under a minute
        </h1>
        <p className="mx-auto max-w-2xl text-lg text-pretty text-muted-foreground">
          Requests are checked against the European Health Data Space rules. Small groups are protected and patient-level
          data never leaves the secure environment.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {ENTRIES.map(({ href, icon: Icon, title, text }) => (
          <Link
            key={href}
            href={href}
            className="group grid gap-4 rounded-2xl border bg-card p-6 shadow-xs transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
          >
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Icon className="size-5" />
            </span>
            <span className="grid gap-1">
              <span className="flex items-center gap-2 text-lg font-semibold">
                {title}
                <ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-1" />
              </span>
              <span className="text-muted-foreground">{text}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
