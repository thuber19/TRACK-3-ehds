import { Building2Icon, GlobeIcon, UserIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { REQUESTED_AS_LABEL } from "@/lib/constants";
import type { DataRequest } from "@/lib/types";

export function RequestSummary({ request }: { request: DataRequest }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-xs">{request.id}</CardDescription>
        <CardTitle>What was assessed</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <span className="flex items-center gap-1.5">
            <UserIcon className="size-4 text-muted-foreground" />
            {request.applicant.name}
          </span>
          <span className="flex items-center gap-1.5">
            <Building2Icon className="size-4 text-muted-foreground" />
            {request.applicant.organisation}
          </span>
          <span className="flex items-center gap-1.5">
            <GlobeIcon className="size-4 text-muted-foreground" />
            {request.applicant.country}
          </span>
          <Badge variant="secondary">{REQUESTED_AS_LABEL[request.requested_as]}</Badge>
        </div>
        <dl className="grid gap-4 text-sm">
          <div className="grid gap-1">
            <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Purpose</dt>
            <dd>{request.purpose}</dd>
          </div>
          <div className="grid gap-1">
            <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Question</dt>
            <dd>{request.question}</dd>
          </div>
          {request.justification && (
            <div className="grid gap-1">
              <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Why statistics are not enough
              </dt>
              <dd className="text-muted-foreground">{request.justification}</dd>
            </div>
          )}
          {request.definitions.length > 0 && (
            <div className="grid gap-2">
              <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Definitions</dt>
              <dd>
                <ul className="divide-y rounded-lg border">
                  {request.definitions.map((d, i) => (
                    <li key={i} className="grid gap-0.5 px-3 py-2 sm:grid-cols-[10rem_1fr] sm:gap-3">
                      {typeof d === "string" ? (
                        <span className="sm:col-span-2">{d}</span>
                      ) : (
                        <>
                          <span className="font-medium">{d.term}</span>
                          <span className="text-muted-foreground">{d.definition}</span>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          )}
        </dl>
      </CardContent>
    </Card>
  );
}
