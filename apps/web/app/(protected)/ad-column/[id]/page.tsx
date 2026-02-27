import Link from "next/link";
import { notFound } from "next/navigation";

import { getHelpArticleById, getHelpArticles } from "@/lib/store";

export default async function AdColumnArticlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const article = await getHelpArticleById(id);
  if (!article) {
    notFound();
  }

  const related = (await getHelpArticles(article.tags)).filter((item) => item.id !== id).slice(0, 3);

  return (
    <div>
      <Link
        href="/ad-column"
        className="text-sm text-accent underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
      >
        ← Adコラム一覧へ戻る
      </Link>

      <article className="card mt-4 rounded-2xl p-6">
        <p className="text-xs text-muted">{article.difficulty}</p>
        <h1 className="mt-1 text-2xl font-semibold">{article.title}</h1>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-700">{article.body}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {article.tags.map((tag) => (
            <span key={tag} className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700">
              {tag}
            </span>
          ))}
        </div>
      </article>

      {related.length > 0 && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold">関連記事</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {related.map((item) => (
              <Link
                key={item.id}
                href={`/ad-column/${item.id}`}
                className="card rounded-xl p-4 text-sm hover:bg-slate-50"
              >
                <p className="font-semibold">{item.title}</p>
                <p className="mt-1 text-muted">{item.tags.join(", ")}</p>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
