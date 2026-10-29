import { ARTICLES } from "@/lib/constants";
import type { ArticleCitation } from "@/lib/types";

export function ArticleList({ articles }: { articles: ArticleCitation[] }) {
  return (
    <ul className="grid gap-2">
      {articles.map((a) => (
        <li key={a.article} className="flex items-start gap-3 rounded-lg border bg-background/60 p-3">
          <span className="inline-flex h-6 shrink-0 items-center rounded-md bg-primary/10 px-2 font-mono text-xs font-semibold text-primary">
            Art. {a.article}
          </span>
          <div className="min-w-0 text-sm">
            <span className="font-medium">{ARTICLES[Number(a.article)]?.title ?? "Article"}</span>
            <span className="text-muted-foreground"> — {a.explanation.replace(/^Art\. \d+:\s*/, "")}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ArticleChipsInline({ articles }: { articles: number[] }) {
  if (articles.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {articles.map((a) => (
        <span
          key={a}
          title={ARTICLES[a]?.title}
          className="inline-flex h-5 items-center rounded bg-muted px-1.5 font-mono text-[11px] font-medium text-muted-foreground"
        >
          {a}
        </span>
      ))}
    </div>
  );
}
