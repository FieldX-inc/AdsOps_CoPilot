import Link from "next/link";

import { getHelpArticles } from "@/lib/store";

export default async function AdColumnPage({
  searchParams,
}: {
  searchParams: Promise<{ tags?: string }>;
}) {
  const query = await searchParams;
  const tags = (query.tags ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
  const articles = await getHelpArticles(tags);

  return (
    <div>
      <header>
        <h1 className="text-2xl font-semibold">Adコラム</h1>
        <p className="mt-1 text-sm text-muted">
          異常タイプ別にすぐ読める運用ナレッジ記事です。AI提案からもここに遷移します。
        </p>
        {tags.length > 0 && (
          <p className="mt-2 text-xs text-muted">絞り込みタグ: {tags.join(", ")}</p>
        )}
      </header>

      <section className="mt-6 grid gap-4 md:grid-cols-2">
        {articles.map((article) => (
          <article key={article.id} className="card rounded-2xl p-4">
            <p className="text-xs text-muted">{article.difficulty}</p>
            <h2 className="mt-1 text-lg font-semibold">{article.title}</h2>
            <p className="mt-2 line-clamp-3 text-sm text-muted">{article.body}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {article.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700">
                  {tag}
                </span>
              ))}
            </div>
            <Link
              href={`/ad-column/${article.id}`}
              className="mt-4 inline-flex rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              記事を読む
            </Link>
          </article>
        ))}
      </section>
    </div>
  );
}
