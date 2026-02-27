import Link from "next/link";

const links = [
  { href: "/dashboard", label: "ダッシュボード" },
  { href: "/bi", label: "BI分析" },
  { href: "/ad-column", label: "Adコラム" },
  { href: "/settings/data-source", label: "データ連携" },
];

export function Sidebar() {
  return (
    <aside className="fixed left-0 top-0 z-30 h-screen w-[250px] shrink-0 overflow-y-auto border-r border-slate-200 bg-white/90 p-4 backdrop-blur">
      <div className="rounded-xl bg-slate-900 p-4 text-white">
        <p className="text-xs uppercase tracking-wide text-slate-300">MVP</p>
        <p className="mt-1 text-lg font-semibold">Ad Insight Copilot</p>
      </div>

      <nav aria-label="メインナビゲーション" className="mt-6 grid gap-2">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
          >
            {link.label}
          </Link>
        ))}
      </nav>

      <form action="/api/auth/logout" method="post" className="mt-8">
        <button
          type="submit"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
        >
          ログアウト
        </button>
      </form>
    </aside>
  );
}
