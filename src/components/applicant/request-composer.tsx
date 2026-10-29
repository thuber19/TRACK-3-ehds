"use client";

import { useEffect, useRef, useState } from "react";
import { ClipboardPasteIcon, FileJsonIcon, LayoutGridIcon, UploadCloudIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { requestKindLabel } from "@/lib/constants";
import { cn } from "@/lib/utils";

type Source = "examples" | "paste" | "upload";

export function RequestComposer({
  text,
  onTextChange,
  invalid,
}: {
  text: string;
  onTextChange: (text: string) => void;
  invalid: boolean;
}) {
  const [source, setSource] = useState<Source>("examples");
  const [examples, setExamples] = useState<Record<string, unknown>[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.examples().then(setExamples).catch(() => setExamples([]));
  }, []);

  function pickExample(id: string) {
    const example = examples.find((r) => r.id === id);
    if (!example) return;
    setSelected(id);
    setFileName(null);
    onTextChange(JSON.stringify(example, null, 2));
  }

  async function readFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setSelected(null);
    onTextChange(await file.text());
  }

  return (
    <Tabs value={source} onValueChange={(v) => setSource(v as Source)} className="gap-4">
      <TabsList className="w-full sm:w-fit">
        <TabsTrigger value="examples" className="px-3">
          <LayoutGridIcon />
          Example requests
        </TabsTrigger>
        <TabsTrigger value="paste" className="px-3">
          <ClipboardPasteIcon />
          Paste JSON
        </TabsTrigger>
        <TabsTrigger value="upload" className="px-3">
          <UploadCloudIcon />
          Upload file
        </TabsTrigger>
      </TabsList>

      <TabsContent value="examples">
        <div className="grid gap-2 sm:grid-cols-2">
          {examples.map((r) => {
            const applicant = r.applicant as { organisation?: string } | undefined;
            const id = String(r.id ?? "");
            return (
            <button
              key={id}
              type="button"
              onClick={() => pickExample(id)}
              className={cn(
                "group flex flex-col gap-1.5 rounded-lg border bg-card p-3 text-left transition-all hover:border-primary/40 hover:bg-primary/[0.03]",
                selected === id && "border-primary bg-primary/5 ring-2 ring-primary/20",
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs font-semibold text-primary">{id}</span>
                <Badge variant="outline" className="text-[11px] font-normal">
                  {requestKindLabel(String(r.requested_as ?? ""))}
                </Badge>
              </span>
              <span className="line-clamp-2 text-sm leading-snug">{String(r.purpose ?? "")}</span>
              <span className="truncate text-xs text-muted-foreground">{applicant?.organisation}</span>
            </button>
            );
          })}
        </div>
      </TabsContent>

      <TabsContent value="paste">
        <JsonEditor text={text} onTextChange={(t) => { setSelected(null); setFileName(null); onTextChange(t); }} invalid={invalid} />
      </TabsContent>

      <TabsContent value="upload" className="grid gap-3">
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); readFile(e.dataTransfer.files[0]); }}
          className={cn(
            "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors hover:border-primary/50 hover:bg-primary/[0.03]",
            dragging && "border-primary bg-primary/5",
          )}
        >
          <span className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            {fileName ? <FileJsonIcon className="size-5" /> : <UploadCloudIcon className="size-5" />}
          </span>
          <span className="font-medium">{fileName ?? "Drop a .json file here"}</span>
          <span className="text-sm text-muted-foreground">{fileName ? "Click to choose another file" : "or click to browse"}</span>
        </button>
        <input ref={fileInput} type="file" accept=".json,application/json" className="hidden" onChange={(e) => readFile(e.target.files?.[0])} />
      </TabsContent>

      {source !== "paste" && text && (
        <div className="grid gap-2">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Request JSON — you can edit it</p>
          <JsonEditor text={text} onTextChange={(t) => { setSelected(null); onTextChange(t); }} invalid={invalid} compact />
        </div>
      )}
    </Tabs>
  );
}

function JsonEditor({
  text,
  onTextChange,
  invalid,
  compact,
}: {
  text: string;
  onTextChange: (t: string) => void;
  invalid: boolean;
  compact?: boolean;
}) {
  return (
    <Textarea
      value={text}
      onChange={(e) => onTextChange(e.target.value)}
      spellCheck={false}
      aria-invalid={invalid || undefined}
      placeholder={'{\n  "id": "R11",\n  "applicant": { "name": "…", "organisation": "…", "country": "AT" },\n  "requested_as": "statistics",\n  …\n}'}
      className={cn(
        "field-sizing-fixed resize-y bg-muted/30 font-mono text-xs leading-relaxed md:text-xs",
        compact ? "h-56" : "h-96",
      )}
    />
  );
}
