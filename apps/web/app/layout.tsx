import "./globals.css";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Ad Insight Copilot",
  description: "広告運用ダッシュボード",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>
        <a
          href="#main-content"
          className="sr-only z-50 rounded bg-slate-900 px-3 py-2 text-white focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
        >
          メインコンテンツへスキップ
        </a>
        {children}
      </body>
    </html>
  );
}
