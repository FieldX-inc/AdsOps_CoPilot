import { StrictMode, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./lp.css";

type FeatureVariant = "analysis" | "tasks" | "setup";

const pains = [
  {
    icon: "▰",
    title: "数字は見ているけど、次に何をすべきかわからない",
    body: "CPAやROASが変化しても、まず確認する指標やレポートが絞れず、判断が止まってしまう。",
  },
  {
    icon: "⌁",
    title: "分析やレポート作成に時間がかかる",
    body: "日々の集計や説明資料づくりに追われ、改善施策を考えて実行する時間が残らない。",
  },
  {
    icon: "◒",
    title: "施策の優先順位に自信が持てない",
    body: "候補は出せても、なぜ今それをやるのか、どのリスクがあるのかを社内に説明しにくい。",
  },
];

const features: Array<{
  number: string;
  variant: FeatureVariant;
  title: string;
  body: string;
  tags: string[];
}> = [
  {
    number: "01",
    variant: "analysis",
    title: "広告の変化を、確認する順番に。",
    body: "費用、CV、CPA、CTR、CPC、CVR、ROASなどの変化を比較し、どの指標やキャンペーンから確認するかを整理します。数字を並べるだけでなく、次に見る場所を明確にします。",
    tags: ["KPI比較", "異常検知", "原因仮説"],
  },
  {
    number: "02",
    variant: "tasks",
    title: "施策を、実行できる手順に。",
    body: "推奨アクションを、担当者が確認できる手順へ落とします。実施前チェック、リスク、実施後に観察する指標まで一つの回答にまとめます。",
    tags: ["優先順位", "作業手順", "観察計画"],
  },
  {
    number: "03",
    variant: "setup",
    title: "広告開始前の迷いを、作成案に。",
    body: "一問一答の広告準備で、事業目標、商材、対象、予算、KPI、媒体、計測方法を確認します。AIはキャンペーン作成案と手順を作りますが、キャンペーン自体は自動作成しません。",
    tags: ["初期設計", "計測確認", "手動実行"],
  },
];

const functions = [
  ["ダッシュボード", "費用・CV・CPA・ROASなどのKPI、前期間比較、日別推移、キャンペーン状況を確認"],
  ["AI Advisor", "広告データの変化、原因仮説、優先度の高い確認事項を相談"],
  ["広告準備", "質問票の回答から、キャンペーン作成案・根拠・実施前チェック・手順を作成"],
  ["改善レポート", "3日ごとにKPI比較、変化、仮説、改善候補、リスク、観察ポイントを整理"],
  ["承認付き変更", "Google Adsのstatus / budget変更を対象・現在値・理由・戻し条件つきで確認"],
  ["ヘルプ", "KPIの見方、OAuth連携、承認付き変更の注意点を必要なときに確認"],
];

const plans = [
  {
    name: "MINIMUM",
    label: "ミニマム",
    price: "9,800",
    setupFee: "50,000",
    description: "まずは定期レポートから始めたいチームへ",
    features: ["2名まで", "Google Ads 1アカウント", "AI初期設定", "3日ごとの改善レポート"],
  },
  {
    name: "STANDARD",
    label: "スタンダード",
    price: "49,800",
    setupFee: "70,000",
    description: "自社で判断しながら運用を進めるチームへ",
    features: ["2名まで", "Google Ads 3アカウント", "AI初期設定", "AIチャット", "承認付き変更", "3日ごとの改善レポート"],
    featured: true,
  },
  {
    name: "PREMIUM",
    label: "プレミアム",
    price: "69,800",
    setupFee: "70,000",
    description: "複数アカウント・有人支援が必要なチームへ",
    features: ["5名まで", "Google Ads 10アカウント", "AI初期設定", "大きいAI利用枠", "承認付き変更", "予約制の初期有人支援"],
  },
];

const flowSteps = [
  ["01", "サービス資料・画面を確認", "まずはサービスの考え方と実際の利用イメージをご確認ください。"],
  ["02", "広告運用の状況を相談", "現在見ている媒体、KPI、運用体制、困っている判断をお聞きします。"],
  ["03", "Google AdsをOAuth連携", "必要な広告アカウントを選び、分析に使うデータの範囲を確認します。"],
  ["04", "AIに任せる範囲を決める", "まず確認したいテーマを一つに絞り、人が確認するポイントを合わせます。"],
  ["05", "分析・提案・手順を確認", "AIの回答にある根拠、リスク、作業手順を見て実施可否を判断します。"],
  ["06", "人が実行し、結果を振り返る", "媒体管理画面または承認付きAPIで実行し、実施後の変化を確認します。"],
];

const faqs = [
  ["AIが広告設定を自動で変更しますか？", "いいえ。AIは分析、提案、作業手順の作成を行います。Google Adsのstatus / budget変更は、対象・現在値・理由・戻し条件を人が確認し、明示的に承認した場合だけ実行します。キャンペーン作成は自動実行しません。"],
  ["どの広告媒体に対応していますか？", "Google Adsを先行して対応します。Meta Ads / Yahoo Adsは、公開時点の対応状況に合わせて案内します。"],
  ["APIキーを渡す必要がありますか？", "基本の連携はOAuthで行います。OAuth tokenやAPIキーなどの秘密情報をAI回答やブラウザに表示しない設計です。"],
  ["どのような質問をAIにできますか？", "「CPAが悪化した理由」「次に確認する指標」「広告開始前に見直す項目」など、広告データの変化や運用手順について相談できます。"],
  ["無料トライアルはありますか？", "現行プランでは無料トライアルを設定していません。料金や導入条件は、サービス資料または相談で確認できます。"],
];

function BrandLogo({ compact = false }: { compact?: boolean }) {
  return <img className={`brand-logo${compact ? " compact" : ""}`} src="/brand/chokotto-inhouse-logo.png" alt="ちょこっとインハウス" />;
}

function Arrow({ direction = "right" }: { direction?: "right" | "down" }) {
  return <span className={`arrow-icon ${direction}`} aria-hidden="true">{direction === "down" ? "↓" : "→"}</span>;
}

function Reveal({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return <div className={`reveal ${className}`} style={{ "--reveal-delay": `${delay}ms` } as CSSProperties}>{children}</div>;
}

function SectionHeading({ eyebrow, title, children }: { eyebrow: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="section-heading">
      <p className="section-eyebrow"><span className="eyebrow-mark" />{eyebrow}</p>
      <h2>{title}</h2>
      {children ? <p className="section-lead">{children}</p> : null}
    </div>
  );
}

function Sparkline({ accent = "teal" }: { accent?: "teal" | "yellow" | "red" }) {
  return <svg className={`mini-chart ${accent}`} viewBox="0 0 150 52" aria-hidden="true"><path d="M2 42 C20 40, 21 26, 36 31 S58 13, 74 25 S95 9, 111 18 S127 10, 148 4" /></svg>;
}

function ProductMock() {
  return (
    <div className="product-mock">
      <div className="mock-topbar">
        <BrandLogo compact />
        <div className="mock-topbar-actions"><span>OAuth連携</span><span>承認付き変更</span><i /></div>
      </div>
      <div className="mock-layout">
        <aside className="mock-sidebar">
          <span className="mock-side-label">WORKSPACE</span>
          {["ダッシュボード", "広告準備", "ヘルプ", "データ連携"].map((item, index) => <span className={index === 0 ? "active" : ""} key={item}><b>{["⌂", "□", "?", "↗"][index]}</b>{item}</span>)}
          <span className="mock-side-label lower">ACCOUNT</span>
          <span><b>◉</b>設定</span>
        </aside>
        <div className="mock-content">
          <div className="mock-content-head"><div><small>2026.07.01 — 07.14</small><h3>広告運用ダッシュボード</h3></div><button type="button">Google Ads　⌄</button></div>
          <div className="mock-kpis">
            {["費用", "CV", "CPA", "ROAS"].map((label, index) => <div key={label}><span>{label}</span><strong>{["¥385,600", "64件", "¥6,025", "265.6%"][index]}</strong><em className={index === 2 ? "down" : "up"}>{["前週比 +8.4%", "前週比 +12.1%", "前週比 -4.2%", "前週比 +15.8%"][index]}</em></div>)}
          </div>
          <div className="mock-grid">
            <div className="mock-panel chart-panel"><div className="mock-panel-head"><strong>成果の推移</strong><span>費用 / CV</span></div><Sparkline /><div className="chart-axis"><span>07/01</span><span>07/07</span><span>07/14</span></div></div>
            <div className="mock-panel advisor-panel"><div className="mock-panel-head"><strong>AI Advisor</strong><span className="status-pill">分析結果</span></div><div className="mock-question">CPAが悪化した理由は？</div><p>CVRの低下とCPCの上昇を優先して確認します。</p><div className="mock-answer-line"><b>次に確認すること</b><span>検索語句レポート・LP表示速度</span></div></div>
          </div>
          <div className="mock-bottom-row"><div className="mock-panel campaign-panel"><div className="mock-panel-head"><strong>キャンペーン</strong><span>4件</span></div>{["検索_新規獲得", "P-MAX_商品", "Meta_リターゲティング"].map((item, index) => <div className="campaign-row" key={item}><span className={`dot ${index === 1 ? "yellow" : ""}`} />{item}<b>{["¥4,250", "¥5,810", "¥7,430"][index]}</b></div>)}</div><div className="mock-panel task-panel"><div className="mock-panel-head"><strong>やること</strong><span>3件</span></div>{["検索語句レポートを確認", "LPの表示速度を計測", "CPAの推移を再確認"].map((item) => <div className="task-row" key={item}><span>○</span>{item}</div>)}</div></div>
        </div>
      </div>
    </div>
  );
}

function FeatureVisual({ variant }: { variant: FeatureVariant }) {
  if (variant === "analysis") {
    return <div className="feature-screen analysis-screen"><div className="screen-toolbar"><strong>パフォーマンス分析</strong><span>前期間と比較</span></div><div className="analysis-main"><div className="analysis-chart"><div className="chart-labels"><b>CPA</b><strong>¥6,025</strong><span>▼ 4.2%</span></div><Sparkline /><div className="bar-chart">{[42, 65, 48, 74, 59, 82, 68, 91, 75, 96].map((height, index) => <i style={{ height: `${height}%` }} className={index > 7 ? "hot" : ""} key={index} />)}</div></div><div className="insight-card"><span className="insight-label">AI INSIGHT</span><strong>優先して確認</strong><p>CVR低下とCPC上昇の要因を検索語句から確認します。</p><button type="button">回答を見る <Arrow /></button></div></div><div className="screen-footer"><span>データ取得: 07/14 09:00</span><span className="ready-dot">● 分析可能</span></div></div>;
  }
  if (variant === "tasks") {
    return <div className="feature-screen tasks-screen"><div className="screen-toolbar"><strong>AIからの提案</strong><span className="status-pill">確認待ち 3</span></div><div className="task-focus"><span className="task-index">01</span><div><small>HIGH PRIORITY</small><h4>検索語句レポートを確認</h4><p>CPA上位のキーワードから、流入意図とCVなし費用を確認します。</p></div><span className="task-check">○</span></div><div className="task-focus muted"><span className="task-index">02</span><div><small>MEDIUM PRIORITY</small><h4>LPの表示速度を計測</h4><p>デバイス別にCVRの差と表示時間を確認します。</p></div><span className="task-check">○</span></div><div className="task-focus muted"><span className="task-index">03</span><div><small>OBSERVATION</small><h4>CPAの推移を再確認</h4><p>実施後の変化を3日間観察します。</p></div><span className="task-check">○</span></div></div>;
  }
  return <div className="feature-screen setup-screen"><div className="screen-toolbar"><strong>広告準備</strong><span>03 / 05</span></div><div className="setup-progress"><i /><i /><i className="active" /><i /><i /></div><div className="setup-question"><small>QUESTION 03</small><h4>今回の広告で、何を成果としますか？</h4><div className="choice-grid"><span className="selected">問い合わせフォーム送信 <b>✓</b></span><span>資料ダウンロード</span><span>購入・申込み</span><span>その他</span></div></div><div className="setup-note"><span>AIが回答をもとに作成案と手順を準備します</span><Arrow /></div></div>;
}

function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeFaq, setActiveFaq] = useState<number | null>(0);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.14 });
    document.querySelectorAll(".reveal").forEach((element) => revealObserver.observe(element));
    return () => {
      window.removeEventListener("scroll", onScroll);
      revealObserver.disconnect();
    };
  }, []);

  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="lp-page">
      <header className={`site-nav${scrolled ? " is-scrolled" : ""}`}>
        <a className="nav-brand" href="#top" onClick={closeMenu}><BrandLogo /></a>
        <nav className={`nav-links${menuOpen ? " is-open" : ""}`} aria-label="メインナビゲーション">
          <a href="#features" onClick={closeMenu}>特徴</a>
          <a href="#functions" onClick={closeMenu}>機能</a>
          <a href="#flow" onClick={closeMenu}>ご利用の流れ</a>
          <a href="#price" onClick={closeMenu}>料金</a>
          <a href="#faq" onClick={closeMenu}>FAQ</a>
          <a className="mobile-nav-cta" href="#contact" onClick={closeMenu}>相談する <Arrow /></a>
        </nav>
        <div className="nav-actions"><a className="nav-outline" href="#contact">相談する</a><a className="nav-primary" href="#contact">資料を見る <Arrow /></a></div>
        <button className={`menu-toggle${menuOpen ? " is-open" : ""}`} type="button" aria-label={menuOpen ? "メニューを閉じる" : "メニューを開く"} aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}><span /><span /><span /></button>
      </header>

      <main>
        <section id="top" className="hero-section">
          <div className="hero-backdrop" />
          <div className="hero-inner">
            <Reveal className="hero-copy">
              <p className="hero-eyebrow">自社で広告運用するチームのためのAI広告相談役</p>
              <h1>広告運用を、<br /><span>ちょこっと</span>インハウス化。</h1>
              <p className="hero-lead">広告管理画面の数字を、<br />次の一手に変える。</p>
              <p className="hero-body">広告データを読み取り、変化の理由や確認する順番、優先度の高い作業手順までAIが整理します。人が確認・判断・実行するから、社内の広告運用を少しずつ強くできます。</p>
              <div className="hero-cta-row"><a className="button button-light" href="#contact">サービス資料を見る <Arrow /></a><a className="button button-ghost" href="#contact">画面を見ながら相談 <Arrow /></a></div>
              <p className="hero-safety"><span>✓</span>AIが広告設定を勝手に変更することはありません。</p>
            </Reveal>
            <Reveal className="hero-visual" delay={160}><div className="hero-visual-orbit orbit-one" /><div className="hero-visual-orbit orbit-two" /><ProductMock /></Reveal>
          </div>
          <div className="hero-scroll"><span>SCROLL</span><i /></div>
        </section>

        <section className="proof-strip"><div className="proof-inner"><p>広告データを読み取り、判断に必要な材料をそろえる。</p><div className="proof-items"><span><b>◎</b> Google Ads 先行対応</span><span><b>↗</b> OAuth連携</span><span><b>✓</b> 人間の確認・承認</span><span><b>≡</b> 監査ログ</span></div></div></section>

        <section id="problem" className="section-shell problem-section">
          <div className="ghost-word">Problem</div>
          <Reveal><SectionHeading eyebrow="PROBLEM" title={<>こんなお悩み<br /><em>ありませんか？</em></>} /></Reveal>
          <div className="pain-grid">{pains.map((pain, index) => <Reveal className="pain-card" delay={index * 90} key={pain.title}><div className="pain-icon">{pain.icon}</div><h3>{pain.title}</h3><p>{pain.body}</p><span className="card-number">0{index + 1}</span></Reveal>)}</div>
          <Reveal className="section-transition"><p>数字は見えている。けれど、どこから確認し、何を優先し、誰が動くかまでは決まらない。</p><span><Arrow direction="down" /></span></Reveal>
        </section>

        <section id="features" className="section-shell features-section">
          <div className="ghost-word right">Features</div>
          <Reveal><SectionHeading eyebrow="FEATURES" title={<>サービスの<em>特徴</em></>}><>AIに任せるのは、判断を置き換えることではありません。広告運用の状況を整理し、人が判断して動けるところまでを支援します。</></SectionHeading></Reveal>
          <div className="feature-rows">{features.map((feature, index) => <div className={`feature-row ${index % 2 === 1 ? "reverse" : ""}`} key={feature.number}><Reveal className="feature-visual" delay={index * 80}><FeatureVisual variant={feature.variant} /></Reveal><Reveal className="feature-copy" delay={index * 80 + 120}><p className="feature-kicker">FEATURES - {feature.number}</p><h3>{feature.title}</h3><p>{feature.body}</p><div className="tag-list">{feature.tags.map((tag) => <span key={tag}>{tag}</span>)}</div></Reveal></div>)}</div>
          <Reveal className="wide-cta"><a href="#contact">サービスの特徴について相談する <Arrow /></a></Reveal>
        </section>

        <section id="functions" className="section-shell functions-section">
          <div className="ghost-word">Function</div>
          <Reveal><SectionHeading eyebrow="FUNCTION" title={<>主な<em>機能</em></>} /></Reveal>
          <div className="function-grid">{functions.map(([title, body], index) => <Reveal className="function-card" delay={(index % 3) * 70} key={title}><div className="function-icon">{["▦", "✦", "□", "◷", "✓", "? "][index]}</div><h3>{title}</h3><p>{body}</p><span className="function-arrow"><Arrow /></span></Reveal>)}</div>
        </section>

        <section id="use-case" className="section-shell demo-section">
          <Reveal><SectionHeading eyebrow="USE CASE" title={<>たとえば、CPAが<br /><em>悪化したとき。</em></>}><>答えを出して終わりではなく、担当者が次に確認できるところまで整理します。</></SectionHeading></Reveal>
          <div className="demo-stage"><Reveal className="demo-chat"><span className="chat-avatar">ち</span><p>CPAが悪化した理由と、<br />次に確認することを教えて。</p></Reveal><Reveal className="demo-response" delay={140}><div className="response-head"><span>AI Advisor</span><small>分析結果</small></div><div className="response-block"><b>結論</b><p>CPA悪化の主因を、CVRとCPCの変化に分けて確認します。</p></div><div className="response-block"><b>原因仮説</b><ul><li>検索意図のずれにより、成果につながりにくい流入が増えている</li><li>LP表示速度やフォームでCVRが低下している</li></ul></div><div className="response-block"><b>人間向け作業手順</b><ol><li>検索語句レポートを確認</li><li>LPの表示速度と計測状態を確認</li><li>実施後のCPAを再確認</li></ol></div><div className="confidence-line"><span>自信度</span><i><b /></i><strong>中</strong></div></Reveal><Reveal className="demo-tasks" delay={240}><div className="response-head"><span>やることリスト</span><small>3件</small></div>{["検索語句レポートを確認", "LPの表示速度を計測", "CPAの推移を再確認"].map((task, index) => <div className="demo-task" key={task}><span>{index === 0 ? "01" : index === 1 ? "02" : "03"}</span>{task}<b>○</b></div>)}</Reveal></div>
        </section>

        <section className="safety-band"><div className="safety-band-inner"><Reveal><p className="section-eyebrow light"><span className="eyebrow-mark" />SAFETY BY DESIGN</p><h2>人が主役の広告運用を、<br /><em>AIが支えます。</em></h2><p>AIが広告設定を勝手に変更することはありません。提案の根拠、リスク、実施後の観察まで確認してから、人が判断・実行できます。</p><a className="button button-light" href="#faq">安心設計を詳しく見る <Arrow /></a></Reveal><Reveal className="safety-card" delay={160}><div className="safety-card-orbit" /><div className="safety-check">✓</div><strong>AIは相談役、<br />あなたが意思決定者。</strong><ul><li>提案の最終判断は人が行います</li><li>変更前後を監査ログに残します</li><li>小さく試し、結果を観察します</li></ul></Reveal></div></section>

        <section id="price" className="section-shell price-section"><Reveal><SectionHeading eyebrow="PRICE" title={<>料金<em>プラン</em></>}><>すべてのプランでAI初期設定と3日ごとの改善レポートを利用できます。AIチャット、広告アカウント数、承認付き変更、有人支援の範囲でプランが分かれます。</></SectionHeading></Reveal><div className="price-grid">{plans.map((plan, index) => <Reveal className={`price-card${plan.featured ? " featured" : ""}`} delay={index * 90} key={plan.name}>{plan.featured ? <span className="recommended">おすすめ</span> : null}<p className="plan-name">{plan.name}</p><h3>{plan.label}</h3><p className="plan-description">{plan.description}</p><div className="plan-price"><span>¥</span><strong>{plan.price}</strong><small>/月</small></div><p className="setup-fee">初期費用 ¥{plan.setupFee.toLocaleString()}</p><ul>{plan.features.map((item) => <li key={item}><b>✓</b>{item}</li>)}</ul><a href="#contact">プランについて相談する <Arrow /></a></Reveal>)}</div><Reveal className="price-note">※ Standard / PremiumのAI利用枠などの詳細は、公開時点で確定した内容をご案内します。</Reveal></section>

        <section id="flow" className="section-shell flow-section"><div className="ghost-word right">Flow</div><Reveal><SectionHeading eyebrow="FLOW" title={<>ご利用の<em>流れ</em></>} /></Reveal><div className="flow-list">{flowSteps.map(([number, title, body], index) => <Reveal className="flow-item" delay={index * 55} key={number}><span className="flow-number">STEP<br /><b>{number}</b></span><div><h3>{title}</h3><p>{body}</p></div><Arrow /></Reveal>)}</div></section>

        <section id="faq" className="section-shell faq-section"><Reveal><SectionHeading eyebrow="FAQ" title={<>よくある<em>質問</em></>} /></Reveal><div className="faq-list">{faqs.map(([question, answer], index) => <Reveal className={`faq-item${activeFaq === index ? " is-open" : ""}`} delay={(index % 2) * 60} key={question}><button type="button" aria-expanded={activeFaq === index} onClick={() => setActiveFaq(activeFaq === index ? null : index)}><span className="faq-q">Q</span><strong>{question}</strong><span className="faq-plus">{activeFaq === index ? "−" : "+"}</span></button><div className="faq-answer"><span className="faq-a">A</span><p>{answer}</p></div></Reveal>)}</div></section>

        <section id="contact" className="contact-section"><div className="contact-backdrop" /><div className="contact-inner"><Reveal><p className="section-eyebrow light"><span className="eyebrow-mark" />CONTACT</p><h2>まずは、自社の広告運用を<br /><em>見ながら相談してみませんか？</em></h2><p>どの数字を見て、何を判断し、誰が実行しているか。実際の運用フローを確認しながら、最初にAIへ任せる範囲と、人が確認するポイントを一緒に整理します。</p><div className="contact-actions"><a className="button button-yellow" href="mailto:hello@example.com?subject=ちょこっとインハウス資料請求">サービス資料を見る <Arrow /></a><a className="button button-white" href="mailto:hello@example.com?subject=ちょこっとインハウス相談">画面を見ながら相談 <Arrow /></a></div></Reveal><Reveal className="contact-mark" delay={160}><div className="contact-mark-ring"><span>ち</span></div><div className="contact-dots">•••</div></Reveal></div></section>
      </main>

      <footer className="site-footer"><div className="footer-inner"><BrandLogo /><p>広告管理画面の数字を、次の一手に変える。</p><div><a href="#top">TOP</a><a href="#features">特徴</a><a href="#functions">機能</a><a href="#price">料金</a><a href="#faq">FAQ</a></div><small>© 2026 ちょこっとインハウス. All rights reserved.</small></div></footer>
      <a className="floating-cta" href="#contact"><span className="floating-icon">□</span><span>資料請求で<br /><strong>次の一手を始める</strong></span><b><Arrow direction="down" /></b></a>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
