import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./lp.css";

type PlatformMark = "google" | "meta" | "yahoo";
type IllustrationType =
  | "thinking"
  | "laptop"
  | "chart"
  | "briefcase"
  | "head"
  | "clipboard"
  | "chat"
  | "operator"
  | "cta";

const pains: Array<[IllustrationType, string, string]> = [
  ["thinking", "数字は見ているけど、次に何をすべきか わからない", "指標は追えても、改善のヒントが見つからず、手が止まってしまう。"],
  ["laptop", "分析やレポート作成に時間がかかり、実行の時間が取れない", "日々の確認や資料作りに追われ、本来やるべき施策が後回しに。"],
  ["chart", "施策の優先順位や効果の見極めに自信が持てない", "これで合っているのか不安なまま、広告費だけが消化されていく。"],
];

const features: Array<[IllustrationType, string, string]> = [
  ["briefcase", "広告開始前の設計相談", "事業目標やターゲットから、訴求設計・KPI・媒体の選定まで相談できます。"],
  ["head", "パフォーマンス分析", "広告データの変化をわかりやすく解説。原因仮説と改善の方向性を提示します。"],
  ["clipboard", "人間向け作業手順", "優先度の高いタスクを手順つきで提案。チームで迷わず実行できます。"],
  ["chat", "実施後の学習", "施策の結果を一緒に振り返り、次の改善につなげます。"],
];

const platformLogos: Array<[string, PlatformMark]> = [
  ["Google Ads", "google"],
  ["Meta Ads", "meta"],
  ["Yahoo Ads", "yahoo"],
];

const generatedAssets: Partial<Record<IllustrationType, string>> = {
  thinking: "/lp-assets/pain-thinking.png",
  laptop: "/lp-assets/pain-report.png",
  chart: "/lp-assets/pain-priority.png",
  briefcase: "/lp-assets/feature-planning.png",
  head: "/lp-assets/feature-analysis.png",
  clipboard: "/lp-assets/feature-tasks.png",
  chat: "/lp-assets/feature-learning.png",
  operator: "/lp-assets/advisor-operator.png",
  cta: "/lp-assets/advisor-operator.png",
};

function PlatformLogo({ name, mark }: { name: string; mark: PlatformMark }) {
  return (
    <div className={`platform-logo platform-${mark}`}>
      <span className="platform-mark-wrap">
        <img className={`platform-mark ${mark}`} src={`/brand/${mark === "google" ? "google-ads" : mark}.svg`} alt="" />
      </span>
      <span>{name}</span>
    </div>
  );
}

function Sparkline() {
  return (
    <svg className="sparkline" viewBox="0 0 78 24" aria-hidden="true">
      <path d="M3 17 L16 13 L28 15 L39 8 L50 12 L62 6 L75 9" />
    </svg>
  );
}

function ProductMock() {
  const metrics = [
    ["CPA", "¥4,250", "+12.4%", "要確認"],
    ["CVR", "2.35%", "▼ 8.7%", "低下"],
    ["CTR", "1.28%", "▼ 6.1%", "低下"],
    ["CPC", "¥112", "▲ 3.2%", "上昇"],
    ["ROAS", "380%", "▲ 15.8%", "改善"],
  ];

  return (
    <div className="product-mock">
      <header className="mock-head">
        <div className="mock-brand">
          <span className="brand-mark small">ち</span>
          <strong>ちょこっとインハウス</strong>
        </div>
        <div className="mock-badges">
          <span>OAuth連携</span>
          <span>承認付き変更</span>
        </div>
      </header>
      <div className="mock-body">
        <aside className="mock-menu" aria-label="モックナビゲーション">
          {["ダッシュボード", "キャンペーン分析", "AIアドバイザー", "やることリスト", "レポート", "設定"].map((item, index) => (
            <span className={index === 0 ? "active" : ""} key={item}>{item}</span>
          ))}
        </aside>
        <div className="mock-main">
          <section className="metric-strip" aria-label="広告KPIの要約">
            {metrics.map(([label, value, trend, status]) => (
              <article key={label} className="mock-metric">
                <span>{label}</span>
                <strong>{value}</strong>
                <em>{trend}</em>
                <small>{status}</small>
                <Sparkline />
              </article>
            ))}
          </section>
          <section className="advisor-card hero-advisor">
            <div className="mock-section-head">
              <h3>AIアドバイザー</h3>
              <span>分析結果</span>
            </div>
            <div className="question">CPAが悪化した理由を教えて</div>
            <div className="answer">
              <p className="label">結論</p>
              <p>検索キャンペーンのCPA悪化は、CVRの低下とCPCの上昇が主因です。特に一部のキーワードで競合が強まり、クリック単価が上がっています。</p>
              <p className="label">原因仮説</p>
              <ul>
                <li>検索意図のミスマッチで成果につながりにくい流入が増加</li>
                <li>LPの表示速度低下により、CVRが低下</li>
              </ul>
              <p className="label">人間向け作業手順</p>
              <ol>
                <li>検索語句レポートでCPA上位のキーワードを確認</li>
                <li>除外キーワード候補を整理</li>
                <li>上記対応後、CPAの推移を再確認</li>
              </ol>
              <div className="confidence">
                <span>自信度</span>
                <strong>高（0.78）</strong>
              </div>
            </div>
          </section>
        </div>
        <aside className="mock-side">
          <section className="todo-card hero-todo">
            <div className="mock-section-head">
              <h3>やることリスト</h3>
              <span>4件</span>
            </div>
            {["検索語句レポートを確認", "除外キーワードを追加", "LPの表示速度を計測", "CPAの推移を再確認"].map(
              (task) => (
                <label key={task}>
                  <input type="checkbox" readOnly />
                  <span>{task}</span>
                </label>
              ),
            )}
            <button type="button">一覧で確認する</button>
          </section>
          <section className="connection-box">
            <strong>データ連携状況</strong>
            {platformLogos.map(([name, mark]) => (
              <PlatformLogo key={name} name={name} mark={mark} />
            ))}
          </section>
        </aside>
      </div>
    </div>
  );
}

function LineIllustration({ type }: { type: IllustrationType }) {
  const asset = generatedAssets[type];

  if (asset) {
    return <img className={`line-illust raster-illust ${type}`} src={asset} alt="" aria-hidden="true" />;
  }

  const isFeature = ["briefcase", "head", "clipboard", "chat"].includes(type);

  if (isFeature) {
    return (
      <div className={`line-illust feature-icon ${type}`} aria-hidden="true">
        <svg viewBox="0 0 64 64">
          <rect className="icon-bg" x="5" y="5" width="54" height="54" rx="8" />
          {type === "briefcase" && (
            <>
              <path d="M22 25v-5a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v5" />
              <rect x="16" y="25" width="32" height="23" rx="5" />
              <path d="M16 33h32M29 33v4h6v-4" />
            </>
          )}
          {type === "head" && (
            <>
              <path d="M22 45v-7c-4-3-6-7-6-12 0-9 7-16 16-16s16 7 16 16c0 7-4 12-10 15v7" />
              <path d="M25 25h.1M39 25h.1M26 34c4 3 8 3 12 0" />
              <path d="M44 31h7M46 38h5" />
            </>
          )}
          {type === "clipboard" && (
            <>
              <rect x="19" y="15" width="26" height="36" rx="5" />
              <path d="M27 15a5 5 0 0 1 10 0M26 28h12M26 36h12M26 44h8" />
            </>
          )}
          {type === "chat" && (
            <>
              <path d="M17 19h30v22H29l-10 8v-8h-2V19Z" />
              <path d="M25 28h14M25 35h10" />
              <circle className="icon-dot" cx="47" cy="18" r="7" />
            </>
          )}
        </svg>
      </div>
    );
  }

  return (
    <div className={`line-illust ${type}`} aria-hidden="true">
      <svg viewBox="0 0 160 150">
        <path className="person-line" d="M61 118v-9c0-18 12-32 30-32s30 14 30 32v9" />
        <path className="person-line" d="M91 76c-14 0-24-10-24-24s10-25 24-25 24 11 24 25-10 24-24 24Z" />
        {type === "thinking" && (
          <>
            <path className="person-line" d="M49 42c-8 0-14 5-14 12 0 5 3 9 8 11l-4 9 11-7h7" />
            <circle className="dot-pattern" cx="122" cy="36" r="3" />
            <circle className="dot-pattern" cx="136" cy="36" r="3" />
            <circle className="dot-pattern" cx="129" cy="49" r="3" />
            <circle className="dot-pattern" cx="143" cy="49" r="3" />
          </>
        )}
        {type === "laptop" && (
          <>
            <rect className="person-line" x="87" y="79" width="44" height="31" rx="3" />
            <path className="person-line" d="M78 115h64" />
            <circle className="mint-disc" cx="128" cy="91" r="15" />
          </>
        )}
        {type === "chart" && (
          <>
            <circle className="mint-disc" cx="127" cy="72" r="23" />
            <path className="teal-fill" d="M127 49a23 23 0 0 1 20 34l-20-11V49Z" />
            <path className="person-line" d="M133 102v18" />
          </>
        )}
        {type === "operator" && (
          <>
            <rect className="person-line" x="86" y="83" width="48" height="31" rx="4" />
            <path className="person-line" d="M42 119h102" />
            <path className="teal-line" d="M117 41h26M130 28v26" />
          </>
        )}
        {type === "cta" && (
          <>
            <path className="person-line" d="M119 44c8 7 12 15 12 25" />
            <path className="yellow-line" d="M42 25 32 12M58 21l-2-17M75 25l12-14" />
          </>
        )}
      </svg>
    </div>
  );
}

function App() {
  return (
    <main className="site-shell">
      <header className="site-nav">
        <a className="brand" href="#top">
          <span className="brand-mark">ち</span>
          <span>ちょこっとインハウス</span>
        </a>
        <nav className="nav-links">
          <a href="#features">できること</a>
          <a href="#safety">安心設計</a>
          <a href="#demo">利用イメージ</a>
        </nav>
        <a className="nav-cta" href="#entry">事前登録する</a>
      </header>

      <section id="top" className="hero">
        <div className="hero-copy">
          <h1>
            <span>広告運用を</span>
            <span className="h1-second">
              <span>ちょこっと、</span>
              <span>インハウス化。</span>
            </span>
          </h1>
          <p className="hero-role">自社で広告運用するチームのためのAI広告相談役</p>
          <p className="hero-lead">広告管理画面の数字を、次の一手に変える。</p>
          <div className="hero-actions">
            <a className="button primary" href="#entry">事前登録する</a>
            <a className="button secondary" href="#demo">デモを相談する</a>
          </div>
          <p className="safety-note">AIが広告設定を勝手に変更することはありません</p>
          <div className="hero-platforms">
            {platformLogos.map(([name, mark]) => (
              <PlatformLogo key={name} name={name} mark={mark} />
            ))}
          </div>
        </div>
        <ProductMock />
      </section>

      <section className="problem-section lp-card">
        <div className="section-heading center">
          <h2>広告管理画面を見ても、次の一手がわからない。</h2>
        </div>
        <div className="pain-grid">
          {pains.map(([icon, title, body]) => (
            <article className="pain-card" key={title}>
              <LineIllustration type={icon} />
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="solution-section lp-card mint">
        <div className="section-heading center">
          <h2>数字を、相談できる形に。</h2>
          <p>
            ちょこっとインハウスは、広告管理画面のデータを読み取り、改善のヒントや優先度の高い一手をAIが提案します。人が判断し、実行することで、広告運用を着実に前進させます。
          </p>
        </div>
        <div className="flow-grid">
          <article>
            <p className="flow-title">各媒体のデータをOAuth連携</p>
            {platformLogos.map(([name, mark]) => (
              <PlatformLogo key={name} name={name} mark={mark} />
            ))}
          </article>
          <span className="flow-arrow">→</span>
          <article>
            <p className="flow-title">AIが分析し、相談に応える</p>
            <ul><li>変化の要因を解説</li><li>優先度の高い一手を提案</li><li>疑問にもその場で回答</li></ul>
          </article>
          <span className="flow-arrow">→</span>
          <article>
            <p className="flow-title">人が判断し、実行する</p>
            <ul><li>やることリストに整理</li><li>チームで共有し実行</li><li>結果を確認して学習</li></ul>
          </article>
        </div>
      </section>

      <section id="features" className="feature-section">
        <div className="section-heading center">
          <h2>ちょこっとインハウスの主な機能</h2>
        </div>
        <div className="feature-grid">
          {features.map(([icon, title, body]) => (
            <article className="feature-card" key={title}>
              <LineIllustration type={icon} />
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="safety" className="safety-section lp-card">
        <div className="safety-copy">
          <p className="eyebrow">安心の設計</p>
          <h2>人が主役の運用を、AIが支えます。</h2>
          <div className="safety-point">
            <strong>AIが広告設定を勝手に変更することはありません</strong>
            <p>ちょこっとインハウスは提案と承認付き操作に特化。Google Adsの予算やcampaign statusは、人が確認して承認した場合だけAPI経由で実行します。</p>
          </div>
          <div className="safety-point">
            <strong>OAuth tokenとsecretを安全に扱います</strong>
            <p>広告配信データと承認付き操作はサーバー側で扱い、tokenやdeveloper tokenをブラウザやAI回答に出しません。</p>
          </div>
        </div>
        <div className="operator-card">
          <LineIllustration type="operator" />
          <h3>AIは相談役、あなたが意思決定者。</h3>
          <ul><li>提案の最終判断は人が行います</li><li>チームで合意して実行します</li><li>小さく試し、着実に改善します</li></ul>
        </div>
      </section>

      <section id="demo" className="demo-section lp-card">
        <div className="section-heading center">
          <h2>利用イメージ</h2>
          <p>気になることをチャットで相談できます</p>
        </div>
        <div className="demo-layout">
          <div className="demo-question">CPAが悪化した理由を教えて</div>
          <article className="demo-answer">
            <p className="label">結論</p>
            <p>検索キャンペーンのCPA悪化は、CVRの低下とCPCの上昇が主因です。特に一部のキーワードで競合が強まり、クリック単価が上がっています。</p>
            <p className="label">原因仮説</p>
            <ul><li>検索意図の拡張により、意図していないキーワードの流入が増加</li><li>LPの表示速度低下により、CVRが低下</li></ul>
            <p className="label">人間向け作業手順</p>
            <ol><li>検索語句レポートでCPA上位のキーワードを確認</li><li>除外キーワード候補を整理</li><li>LPの表示速度を計測し、改善余地を確認</li></ol>
            <div className="confidence wide"><span>自信度</span><strong>高（0.78）</strong></div>
          </article>
          <aside className="demo-todo">
            <h3>やることリスト</h3>
            {["検索語句レポートを確認", "除外キーワードを追加", "LPの表示速度を計測", "CPAの推移を再確認"].map((task) => (
              <label key={task}><input type="checkbox" readOnly /><span>{task}</span></label>
            ))}
            <button type="button">一覧で確認する</button>
          </aside>
        </div>
      </section>

      <section id="entry" className="final-cta">
        <div>
          <h2>まずは、ちょこっと相談してみませんか？</h2>
          <p>サービスの詳細や活用方法を、実際の画面を見ながらご案内します。</p>
          <div className="hero-actions center">
            <a className="button yellow" href="mailto:hello@example.com?subject=ちょこっとインハウス事前登録">事前登録する</a>
            <a className="button white" href="mailto:hello@example.com?subject=ちょこっとインハウスデモ相談">デモを相談する</a>
          </div>
        </div>
        <LineIllustration type="cta" />
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
