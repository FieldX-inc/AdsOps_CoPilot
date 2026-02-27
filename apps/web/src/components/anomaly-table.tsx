type AnomalyRow = {
  date: string;
  type: string;
  platform: string;
  detail: string;
  severity: "High" | "Medium" | "Low";
};

const severityColor = {
  High: "bg-red-100 text-red-700",
  Medium: "bg-amber-100 text-amber-700",
  Low: "bg-slate-100 text-slate-700",
};

export function AnomalyTable({ anomalies }: { anomalies: AnomalyRow[] }) {
  return (
    <section className="card mt-6 overflow-hidden rounded-2xl">
      <header className="border-b border-slate-200 px-4 py-3">
        <h2 className="text-base font-semibold">異常一覧</h2>
      </header>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">日付</th>
              <th className="px-4 py-3">種別</th>
              <th className="px-4 py-3">媒体</th>
              <th className="px-4 py-3">詳細</th>
              <th className="px-4 py-3">重要度</th>
            </tr>
          </thead>
          <tbody>
            {anomalies.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-muted" colSpan={5}>
                  異常は検知されていません。
                </td>
              </tr>
            ) : (
              anomalies.map((item, idx) => (
                <tr key={`${item.date}-${item.type}-${idx}`} className="border-t border-slate-100">
                  <td className="px-4 py-3">{item.date}</td>
                  <td className="px-4 py-3">{item.type}</td>
                  <td className="px-4 py-3">{item.platform}</td>
                  <td className="px-4 py-3 text-slate-700">{item.detail}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${severityColor[item.severity]}`}
                    >
                      {item.severity}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
