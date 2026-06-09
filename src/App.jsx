import { useState, useEffect, useMemo } from "react";

const STORAGE_KEY = "km_tracker_data";

const defaultData = {
  trips: [],
  rates: [],
  recipients: [],
  vehicle: "My Vehicle",
};

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...defaultData, ...JSON.parse(raw) } : defaultData;
  } catch {
    return defaultData;
  }
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function formatZAR(n) {
  return `R ${Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

function formatKm(n) {
  return `${Number(n).toLocaleString()} km`;
}

function getMonthYear(dateStr) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function getWeek(dateStr) {
  const d = new Date(dateStr);
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

function monthLabel(my) {
  const [y, m] = my.split("-");
  return new Date(y, m - 1, 1).toLocaleString("en-ZA", { month: "long", year: "numeric" });
}

export default function KmTracker() {
  const [data, setData] = useState(loadData);
  const [tab, setTab] = useState("log");
  const [toast, setToast] = useState(null);

  // Forms
  const [tripForm, setTripForm] = useState({
    date: new Date().toISOString().split("T")[0],
    openKm: "",
    closeKm: "",
    description: "",
  });
  const [rateForm, setRateForm] = useState({ month: getMonthYear(new Date().toISOString()), rate: "" });
  const [recipientInput, setRecipientInput] = useState("");
  const [vehicleInput, setVehicleInput] = useState("");

  // Report filters
  const [reportType, setReportType] = useState("monthly");
  const [reportMonth, setReportMonth] = useState(getMonthYear(new Date().toISOString()));
  const [reportWeek, setReportWeek] = useState(getWeek(new Date().toISOString()));
  const [emailSending, setEmailSending] = useState(false);

  useEffect(() => { saveData(data); }, [data]);

  function showToast(msg, type = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  function addTrip() {
    const { date, openKm, closeKm, description } = tripForm;
    if (!date || !openKm || !closeKm || !description.trim()) return showToast("Fill in all fields", "error");
    const open = parseFloat(openKm);
    const close = parseFloat(closeKm);
    if (close <= open) return showToast("Closing km must be greater than opening km", "error");
    const trip = { id: Date.now(), date, openKm: open, closeKm: close, description: description.trim(), km: close - open };
    setData(d => ({ ...d, trips: [trip, ...d.trips].sort((a, b) => b.date.localeCompare(a.date)) }));
    setTripForm(f => ({ ...f, openKm: String(close), closeKm: "", description: "" }));
    showToast("Trip logged ✓");
  }

  function deleteTrip(id) {
    setData(d => ({ ...d, trips: d.trips.filter(t => t.id !== id) }));
    showToast("Trip removed");
  }

  function saveRate() {
    if (!rateForm.rate || isNaN(rateForm.rate)) return showToast("Enter a valid rate", "error");
    const rate = { month: rateForm.month, rate: parseFloat(rateForm.rate) };
    setData(d => {
      const filtered = d.rates.filter(r => r.month !== rate.month);
      return { ...d, rates: [...filtered, rate].sort((a, b) => b.month.localeCompare(a.month)) };
    });
    showToast("Rate saved ✓");
  }

  function addRecipient() {
    const email = recipientInput.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showToast("Enter a valid email", "error");
    if (data.recipients.includes(email)) return showToast("Already added", "error");
    setData(d => ({ ...d, recipients: [...d.recipients, email] }));
    setRecipientInput("");
    showToast("Recipient added ✓");
  }

  function removeRecipient(email) {
    setData(d => ({ ...d, recipients: d.recipients.filter(r => r !== email) }));
  }

  function saveVehicle() {
    if (!vehicleInput.trim()) return;
    setData(d => ({ ...d, vehicle: vehicleInput.trim() }));
    setVehicleInput("");
    showToast("Vehicle updated ✓");
  }

  function getRateForMonth(month) {
    const found = data.rates.find(r => r.month === month);
    return found ? found.rate : null;
  }

  const filteredTrips = useMemo(() => {
    if (reportType === "monthly") return data.trips.filter(t => getMonthYear(t.date) === reportMonth);
    if (reportType === "weekly") return data.trips.filter(t => getWeek(t.date) === reportWeek);
    return data.trips;
  }, [data.trips, reportType, reportMonth, reportWeek]);

  const reportStats = useMemo(() => {
    const totalKm = filteredTrips.reduce((s, t) => s + t.km, 0);
    // Group by month to apply correct rates
    const byMonth = {};
    filteredTrips.forEach(t => {
      const m = getMonthYear(t.date);
      if (!byMonth[m]) byMonth[m] = { km: 0, rate: getRateForMonth(m) };
      byMonth[m].km += t.km;
    });
    const totalReimb = Object.values(byMonth).reduce((s, m) => {
      return s + (m.rate ? m.km * m.rate : 0);
    }, 0);
    const missingRates = Object.entries(byMonth).filter(([, v]) => !v.rate).map(([m]) => monthLabel(m));
    return { totalKm, totalReimb, byMonth, missingRates };
  }, [filteredTrips, data.rates]);

  function buildReportText() {
    const title = reportType === "monthly" ? monthLabel(reportMonth) : reportType === "weekly" ? `Week ${reportWeek}` : "All Trips";
    let text = `KM REIMBURSEMENT REPORT — ${title}\nVehicle: ${data.vehicle}\n\n`;
    text += `${"DATE".padEnd(12)}${"OPEN KM".padEnd(12)}${"CLOSE KM".padEnd(12)}${"KM".padEnd(8)}DESCRIPTION\n`;
    text += "─".repeat(70) + "\n";
    filteredTrips.forEach(t => {
      text += `${t.date.padEnd(12)}${String(t.openKm).padEnd(12)}${String(t.closeKm).padEnd(12)}${String(t.km).padEnd(8)}${t.description}\n`;
    });
    text += "\n── SUMMARY ──\n";
    text += `Total Trips: ${filteredTrips.length}\nTotal KM: ${formatKm(reportStats.totalKm)}\n\n`;
    Object.entries(reportStats.byMonth).forEach(([m, v]) => {
      text += `${monthLabel(m)}: ${formatKm(v.km)} @ ${v.rate ? `R${v.rate}/km` : "NO RATE SET"} = ${v.rate ? formatZAR(v.km * v.rate) : "—"}\n`;
    });
    text += `\nTOTAL REIMBURSEMENT: ${formatZAR(reportStats.totalReimb)}\n`;
    if (reportStats.missingRates.length) text += `\n⚠ Missing rates for: ${reportStats.missingRates.join(", ")}\n`;
    return text;
  }

  async function sendReport() {
    if (!data.recipients.length) return showToast("Add at least one recipient", "error");
    if (!filteredTrips.length) return showToast("No trips in selected period", "error");
    setEmailSending(true);
    const subject = `KM Report — ${reportType === "monthly" ? monthLabel(reportMonth) : reportType === "weekly" ? `Week ${reportWeek}` : "All Trips"}`;
    const body = buildReportText();
    const mailto = `mailto:${data.recipients.join(",")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailto;
    setTimeout(() => {
      setEmailSending(false);
      showToast("Email client opened ✓");
    }, 1000);
  }

  const months = useMemo(() => {
    const set = new Set(data.trips.map(t => getMonthYear(t.date)));
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [data.trips]);

  const weeks = useMemo(() => {
    const set = new Set(data.trips.map(t => getWeek(t.date)));
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [data.trips]);

  const tabs = [
    { id: "log", label: "Log Trip", icon: "➕" },
    { id: "trips", label: "Trips", icon: "📋" },
    { id: "report", label: "Report", icon: "📊" },
    { id: "settings", label: "Settings", icon: "⚙️" },
  ];

  return (
    <div style={{ fontFamily: "'DM Mono', 'Courier New', monospace", minHeight: "100vh", background: "#0D0D0D", color: "#E8E4DC" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@700;800&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: #111; } ::-webkit-scrollbar-thumb { background: #333; }
        input, select, textarea { font-family: inherit; }
        .card { background: #161616; border: 1px solid #242424; border-radius: 12px; padding: 20px; margin-bottom: 16px; }
        .label { font-size: 10px; letter-spacing: 0.15em; color: #666; text-transform: uppercase; margin-bottom: 6px; display: block; }
        .input { width: 100%; background: #0D0D0D; border: 1px solid #2A2A2A; border-radius: 8px; padding: 12px; color: #E8E4DC; font-size: 14px; outline: none; transition: border-color 0.2s; }
        .input:focus { border-color: #C8F04A; }
        .btn { border: none; border-radius: 8px; padding: 13px 20px; font-family: inherit; font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.15s; letter-spacing: 0.05em; }
        .btn-primary { background: #C8F04A; color: #0D0D0D; width: 100%; font-size: 14px; font-weight: 500; }
        .btn-primary:active { transform: scale(0.98); background: #b8e030; }
        .btn-ghost { background: transparent; color: #666; border: 1px solid #2A2A2A; font-size: 12px; padding: 8px 12px; }
        .btn-ghost:hover { border-color: #444; color: #aaa; }
        .btn-danger { background: transparent; color: #ff4444; border: 1px solid #2a1a1a; font-size: 11px; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-family: inherit; }
        .trip-row { border-bottom: 1px solid #1a1a1a; padding: 14px 0; }
        .trip-row:last-child { border-bottom: none; }
        .tag { display: inline-block; background: #1a1f0a; color: #C8F04A; border: 1px solid #2d3d0a; border-radius: 20px; font-size: 11px; padding: 3px 10px; }
        .stat-box { background: #0D0D0D; border: 1px solid #1e1e1e; border-radius: 10px; padding: 16px; flex: 1; }
        .stat-val { font-family: 'Syne', sans-serif; font-size: 22px; font-weight: 800; color: #C8F04A; line-height: 1; margin-bottom: 4px; }
        .stat-lbl { font-size: 10px; color: #555; letter-spacing: 0.1em; text-transform: uppercase; }
        .section-title { font-family: 'Syne', sans-serif; font-size: 18px; font-weight: 800; margin-bottom: 16px; }
        .rate-chip { display: flex; justify-content: space-between; align-items: center; background: #111; border: 1px solid #222; border-radius: 8px; padding: 10px 14px; margin-bottom: 8px; font-size: 13px; }
        .email-chip { display: flex; justify-content: space-between; align-items: center; background: #111; border: 1px solid #222; border-radius: 8px; padding: 10px 14px; margin-bottom: 8px; }
        .toast { position: fixed; bottom: 90px; left: 50%; transform: translateX(-50%); background: #C8F04A; color: #0D0D0D; padding: 10px 20px; border-radius: 30px; font-size: 13px; font-weight: 500; z-index: 999; white-space: nowrap; animation: fadeIn 0.2s; }
        .toast.error { background: #ff4444; color: #fff; }
        @keyframes fadeIn { from { opacity: 0; transform: translateX(-50%) translateY(10px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
        .nav { position: fixed; bottom: 0; left: 0; right: 0; background: #111; border-top: 1px solid #1e1e1e; display: flex; z-index: 100; padding-bottom: env(safe-area-inset-bottom); }
        .nav-btn { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 12px 8px; background: none; border: none; cursor: pointer; color: #444; font-family: inherit; font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; transition: color 0.15s; }
        .nav-btn.active { color: #C8F04A; }
        .nav-icon { font-size: 18px; line-height: 1; }
        .header { padding: 20px 20px 0; }
        .header-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4px; }
        .page-title { font-family: 'Syne', sans-serif; font-size: 26px; font-weight: 800; line-height: 1.1; }
        .page-sub { font-size: 11px; color: #444; letter-spacing: 0.1em; text-transform: uppercase; }
        .content { padding: 16px 20px 100px; }
        .select { width: 100%; background: #0D0D0D; border: 1px solid #2A2A2A; border-radius: 8px; padding: 12px; color: #E8E4DC; font-size: 14px; font-family: inherit; outline: none; }
        .select:focus { border-color: #C8F04A; }
        .report-table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 12px; }
        .report-table th { text-align: left; color: #555; letter-spacing: 0.1em; text-transform: uppercase; padding: 6px 8px; border-bottom: 1px solid #1e1e1e; font-weight: 400; font-size: 10px; }
        .report-table td { padding: 10px 8px; border-bottom: 1px solid #161616; vertical-align: top; }
        .report-table tr:last-child td { border-bottom: none; }
        .warn { background: #1a120a; border: 1px solid #3a2010; border-radius: 8px; padding: 10px 14px; font-size: 12px; color: #f0930a; margin-bottom: 12px; }
        .divider { border: none; border-top: 1px solid #1e1e1e; margin: 16px 0; }
        .flex-gap { display: flex; gap: 10px; }
      `}</style>

      {/* HEADER */}
      <div className="header">
        <div className="header-top">
          <div>
            <div className="page-title">
              {tab === "log" && "Log Trip"}
              {tab === "trips" && "Trip History"}
              {tab === "report" && "Reports"}
              {tab === "settings" && "Settings"}
            </div>
            <div className="page-sub" style={{ marginTop: 4 }}>
              {tab === "log" && data.vehicle}
              {tab === "trips" && `${data.trips.length} trips total`}
              {tab === "report" && "reimbursement calculator"}
              {tab === "settings" && "configure your tracker"}
            </div>
          </div>
          {tab === "log" && data.trips.length > 0 && (
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 11, color: "#555", marginBottom: 2 }}>Last close</div>
              <div style={{ color: "#C8F04A", fontSize: 14, fontWeight: 500 }}>{formatKm(data.trips[0]?.closeKm)}</div>
            </div>
          )}
        </div>
      </div>

      {/* CONTENT */}
      <div className="content">

        {/* LOG TRIP TAB */}
        {tab === "log" && (
          <>
            <div className="card">
              <label className="label">Date</label>
              <input className="input" type="date" value={tripForm.date} onChange={e => setTripForm(f => ({ ...f, date: e.target.value }))} />
            </div>
            <div className="card">
              <div className="flex-gap">
                <div style={{ flex: 1 }}>
                  <label className="label">Opening KM</label>
                  <input className="input" type="number" inputMode="numeric" placeholder="0" value={tripForm.openKm} onChange={e => setTripForm(f => ({ ...f, openKm: e.target.value }))} />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="label">Closing KM</label>
                  <input className="input" type="number" inputMode="numeric" placeholder="0" value={tripForm.closeKm} onChange={e => setTripForm(f => ({ ...f, closeKm: e.target.value }))} />
                </div>
              </div>
              {tripForm.openKm && tripForm.closeKm && parseFloat(tripForm.closeKm) > parseFloat(tripForm.openKm) && (
                <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: "#555" }}>Distance</span>
                  <span className="tag">{formatKm(parseFloat(tripForm.closeKm) - parseFloat(tripForm.openKm))}</span>
                </div>
              )}
            </div>
            <div className="card">
              <label className="label">Description / Purpose</label>
              <input className="input" type="text" placeholder="e.g. Client visit — Sandton" value={tripForm.description} onChange={e => setTripForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <button className="btn btn-primary" onClick={addTrip}>Log Trip</button>

            {/* Quick stats */}
            {data.trips.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <div style={{ fontSize: 10, color: "#444", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>This Month</div>
                <div className="flex-gap">
                  <div className="stat-box">
                    <div className="stat-val">
                      {data.trips.filter(t => getMonthYear(t.date) === getMonthYear(new Date().toISOString())).reduce((s, t) => s + t.km, 0).toLocaleString()}
                    </div>
                    <div className="stat-lbl">km logged</div>
                  </div>
                  <div className="stat-box">
                    <div className="stat-val">
                      {data.trips.filter(t => getMonthYear(t.date) === getMonthYear(new Date().toISOString())).length}
                    </div>
                    <div className="stat-lbl">trips</div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* TRIPS TAB */}
        {tab === "trips" && (
          <>
            {data.trips.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px 0", color: "#333" }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🚗</div>
                <div style={{ fontSize: 13 }}>No trips logged yet</div>
              </div>
            ) : (
              <div className="card" style={{ padding: "4px 20px" }}>
                {data.trips.map(t => (
                  <div className="trip-row" key={t.id}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontSize: 12, color: "#555", marginBottom: 4 }}>{t.date}</div>
                        <div style={{ fontSize: 14, marginBottom: 6 }}>{t.description}</div>
                        <div style={{ display: "flex", gap: 8, fontSize: 11, color: "#666" }}>
                          <span>{t.openKm.toLocaleString()} → {t.closeKm.toLocaleString()}</span>
                          <span className="tag">{formatKm(t.km)}</span>
                        </div>
                      </div>
                      <button className="btn-danger" onClick={() => deleteTrip(t.id)}>✕</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* REPORT TAB */}
        {tab === "report" && (
          <>
            <div className="card">
              <label className="label">Report Period</label>
              <select className="select" value={reportType} onChange={e => setReportType(e.target.value)}>
                <option value="monthly">Monthly</option>
                <option value="weekly">Weekly</option>
                <option value="all">All Time</option>
              </select>
              {reportType === "monthly" && (
                <div style={{ marginTop: 12 }}>
                  <label className="label">Month</label>
                  <select className="select" value={reportMonth} onChange={e => setReportMonth(e.target.value)}>
                    {months.length === 0 && <option value={getMonthYear(new Date().toISOString())}>{monthLabel(getMonthYear(new Date().toISOString()))}</option>}
                    {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
                  </select>
                </div>
              )}
              {reportType === "weekly" && (
                <div style={{ marginTop: 12 }}>
                  <label className="label">Week</label>
                  <select className="select" value={reportWeek} onChange={e => setReportWeek(e.target.value)}>
                    {weeks.length === 0 && <option value={getWeek(new Date().toISOString())}>Current week</option>}
                    {weeks.map(w => <option key={w} value={w}>{w}</option>)}
                  </select>
                </div>
              )}
            </div>

            {reportStats.missingRates.length > 0 && (
              <div className="warn">⚠ No rate set for: {reportStats.missingRates.join(", ")} — go to Settings → Monthly Rates</div>
            )}

            {/* Summary stats */}
            <div className="flex-gap" style={{ marginBottom: 16 }}>
              <div className="stat-box">
                <div className="stat-val">{reportStats.totalKm.toLocaleString()}</div>
                <div className="stat-lbl">total km</div>
              </div>
              <div className="stat-box">
                <div className="stat-val" style={{ fontSize: 18 }}>{formatZAR(reportStats.totalReimb)}</div>
                <div className="stat-lbl">reimbursement</div>
              </div>
            </div>

            {/* Rate breakdown */}
            {Object.keys(reportStats.byMonth).length > 0 && (
              <div className="card">
                <div style={{ fontSize: 11, color: "#555", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>Rate Breakdown</div>
                {Object.entries(reportStats.byMonth).map(([m, v]) => (
                  <div key={m} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "8px 0", borderBottom: "1px solid #1a1a1a" }}>
                    <span style={{ color: "#888" }}>{monthLabel(m)}</span>
                    <span>{v.rate ? `${formatKm(v.km)} × R${v.rate}` : <span style={{ color: "#f0930a" }}>No rate</span>}</span>
                    <span style={{ color: "#C8F04A" }}>{v.rate ? formatZAR(v.km * v.rate) : "—"}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Trip table */}
            {filteredTrips.length > 0 && (
              <div className="card" style={{ overflowX: "auto" }}>
                <table className="report-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Open</th>
                      <th>Close</th>
                      <th>KM</th>
                      <th>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTrips.map(t => (
                      <tr key={t.id}>
                        <td style={{ color: "#666", whiteSpace: "nowrap" }}>{t.date}</td>
                        <td style={{ color: "#888" }}>{t.openKm.toLocaleString()}</td>
                        <td style={{ color: "#888" }}>{t.closeKm.toLocaleString()}</td>
                        <td><span className="tag">{t.km}</span></td>
                        <td style={{ color: "#ccc", fontSize: 11 }}>{t.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {filteredTrips.length === 0 && (
              <div style={{ textAlign: "center", padding: "40px 0", color: "#333", fontSize: 13 }}>No trips in selected period</div>
            )}

            <button className="btn btn-primary" onClick={sendReport} disabled={emailSending} style={{ opacity: emailSending ? 0.7 : 1 }}>
              {emailSending ? "Opening email..." : `📧 Email Report (${data.recipients.length} recipient${data.recipients.length !== 1 ? "s" : ""})`}
            </button>
            {data.recipients.length === 0 && (
              <div style={{ textAlign: "center", fontSize: 11, color: "#555", marginTop: 8 }}>Add recipients in Settings first</div>
            )}
          </>
        )}

        {/* SETTINGS TAB */}
        {tab === "settings" && (
          <>
            {/* Vehicle */}
            <div className="section-title" style={{ fontSize: 14, marginBottom: 12 }}>Vehicle</div>
            <div className="card">
              <label className="label">Vehicle Name / Reg</label>
              <div className="flex-gap">
                <input className="input" style={{ flex: 1 }} placeholder={data.vehicle} value={vehicleInput} onChange={e => setVehicleInput(e.target.value)} />
                <button className="btn btn-ghost" onClick={saveVehicle}>Save</button>
              </div>
              <div style={{ marginTop: 8, fontSize: 12, color: "#555" }}>Current: {data.vehicle}</div>
            </div>

            <hr className="divider" />
            <div className="section-title" style={{ fontSize: 14, marginBottom: 12 }}>Monthly Reimbursement Rates</div>
            <div className="card">
              <label className="label">Month</label>
              <input className="input" type="month" value={rateForm.month} onChange={e => setRateForm(f => ({ ...f, month: e.target.value }))} style={{ marginBottom: 12 }} />
              <label className="label">Rate (R per km)</label>
              <div className="flex-gap">
                <input className="input" style={{ flex: 1 }} type="number" step="0.01" inputMode="decimal" placeholder="e.g. 4.64" value={rateForm.rate} onChange={e => setRateForm(f => ({ ...f, rate: e.target.value }))} />
                <button className="btn btn-ghost" onClick={saveRate}>Save</button>
              </div>
            </div>
            {data.rates.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                {data.rates.slice(0, 6).map(r => (
                  <div className="rate-chip" key={r.month}>
                    <span style={{ color: "#888" }}>{monthLabel(r.month)}</span>
                    <span style={{ color: "#C8F04A" }}>R{r.rate}/km</span>
                  </div>
                ))}
              </div>
            )}

            <hr className="divider" />
            <div className="section-title" style={{ fontSize: 14, marginBottom: 12 }}>Report Recipients</div>
            <div className="card">
              <label className="label">Email Address</label>
              <div className="flex-gap">
                <input className="input" style={{ flex: 1 }} type="email" inputMode="email" placeholder="email@example.com" value={recipientInput} onChange={e => setRecipientInput(e.target.value)} onKeyDown={e => e.key === "Enter" && addRecipient()} />
                <button className="btn btn-ghost" onClick={addRecipient}>Add</button>
              </div>
            </div>
            {data.recipients.map(r => (
              <div className="email-chip" key={r}>
                <span style={{ fontSize: 13, color: "#aaa" }}>{r}</span>
                <button className="btn-danger" onClick={() => removeRecipient(r)}>✕</button>
              </div>
            ))}
            {data.recipients.length === 0 && (
              <div style={{ fontSize: 12, color: "#444", textAlign: "center", padding: "12px 0" }}>No recipients added yet</div>
            )}

            <hr className="divider" />
            <div style={{ fontSize: 11, color: "#333", textAlign: "center", lineHeight: 1.8 }}>
              Data stored locally on this device<br />
              {data.trips.length} trips · {data.rates.length} rates · {data.recipients.length} recipients
            </div>
          </>
        )}
      </div>

      {/* BOTTOM NAV */}
      <nav className="nav">
        {tabs.map(t => (
          <button key={t.id} className={`nav-btn ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
            <span className="nav-icon">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>

      {/* TOAST */}
      {toast && <div className={`toast ${toast.type === "error" ? "error" : ""}`}>{toast.msg}</div>}
    </div>
  );
}
