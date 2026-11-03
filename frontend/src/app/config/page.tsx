"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";
import {
  getDuties, updateDuty, createDuty, getSectors, saveSector, getSections, saveSection,
  getConfigLists, updateListItem, addListItem, formatApiError,
  DutyItem, Sector, SectionItem, ListItem,
} from "@/lib/api";

type Tab = "duties" | "sectors" | "sections" | "lists";
const DESIGNATIONS = ["INSPECTOR", "SI", "WSI", "ASI", "AWSI", "HC", "WHC", "PC", "WPC", "ARPC", "ARWPC", "HGS", "WHGS", "SPO"];
const LIST_TITLES: Record<string, string> = {
  staff_status: "Staff statuses", leave_status: "Leave states", task_status: "Task states",
  leave_type: "Leave types", designation: "Designations", staff_category: "Staff categories",
};

export default function ConfigPage() {
  const { token } = useAuth();
  const [tab, setTab] = useState<Tab>("duties");
  const [duties, setDuties] = useState<DutyItem[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [sections, setSections] = useState<SectionItem[]>([]);
  const [lists, setLists] = useState<Record<string, ListItem[]>>({});
  const [msg, setMsg] = useState<{ text: string; warn?: boolean } | null>(null);
  const [newDuty, setNewDuty] = useState({ category: "", section: "", shift_code: "", required_strength: "" });
  const [newName, setNewName] = useState("");
  const [newCode, setNewCode] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    const [d, s, sec, l] = await Promise.all([
      getDuties(token, { active_only: false }), getSectors(token), getSections(token), getConfigLists(token),
    ]);
    setDuties(d); setSectors(s); setSections(sec); setLists(l);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const run = async (fn: () => Promise<any>, ok: string) => {
    try {
      await fn();
      setMsg({ text: ok });
      load();
    } catch (e) {
      setMsg({ text: formatApiError(e, "Save failed"), warn: true });
    }
  };

  const tabs: [Tab, string][] = [["duties", "Duty requirements"], ["sectors", "Sectors"], ["sections", "Sections"], ["lists", "Status & state lists"]];

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">Station Configuration</h1>
          <div className="page-subtitle">
            Every value here is stored in the database and editable by the SHO / Admin SI; every change is audited.
            Shift timings and rotation rules are on <Link href="/policy">Policy &amp; Shifts</Link>.
          </div>
        </div>
      </div>
      {msg && <div role={msg.warn ? "alert" : "status"} className={`alert-banner alert-banner--${msg.warn ? "warning" : "info"}`} style={{ marginBottom: 16 }}>{msg.text}</div>}

      <div role="tablist" style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`btn btn-sm ${tab === k ? "btn-primary" : "btn-secondary"}`} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      {tab === "duties" && (
        <div className="card">
          <div className="card__header"><span className="card__title">Duty master — required strength per shift</span></div>
          <div className="card__body" style={{ padding: 0 }}>
            <div className="table-container">
              <table className="table" style={{ fontSize: 13 }}>
                <thead><tr><th>Duty</th><th>Section</th><th>Shift</th><th>Required</th><th>Eligible ranks</th><th>Active</th></tr></thead>
                <tbody>
                  {duties.map((d) => (
                    <tr key={d.id} style={!d.is_active ? { opacity: 0.55 } : undefined}>
                      <td>
                        <input className="form-control" defaultValue={d.category} aria-label="Duty category"
                          onBlur={(e) => e.target.value !== d.category && run(() => updateDuty(token!, d.id, { category: e.target.value }), "Duty renamed")} />
                      </td>
                      <td>
                        <select className="form-control" value={d.section || ""} aria-label="Section"
                          onChange={(e) => run(() => updateDuty(token!, d.id, { section: e.target.value || null }), "Section updated")}>
                          <option value="">—</option>
                          {sections.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
                        </select>
                      </td>
                      <td>
                        <select className="form-control" value={d.shift_code || ""} aria-label="Shift"
                          onChange={(e) => run(() => updateDuty(token!, d.id, e.target.value ? { shift_code: e.target.value } : { clear_shift: true }), "Shift updated")}>
                          <option value="">All shifts</option>
                          {["A", "B", "C"].map((s) => <option key={s} value={s}>Shift {s}</option>)}
                        </select>
                      </td>
                      <td style={{ width: 110 }}>
                        <input type="number" min={0} className="form-control" defaultValue={d.required_strength ?? ""} aria-label="Required strength"
                          placeholder="not set"
                          onBlur={(e) => {
                            const v = e.target.value === "" ? null : Number(e.target.value);
                            if (v !== (d.required_strength ?? null)) run(() => updateDuty(token!, d.id, { required_strength: v ?? 0 }), `Required strength for ${d.category} updated`);
                          }} />
                        {!d.is_configured && <div style={{ fontSize: 10, color: "#d97706" }}>not configured</div>}
                      </td>
                      <td style={{ minWidth: 220 }}>
                        <details>
                          <summary style={{ cursor: "pointer", fontSize: 12 }}>{(d.eligible_designations || []).join(", ") || "All ranks"}</summary>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                            {DESIGNATIONS.map((r) => {
                              const on = (d.eligible_designations || []).includes(r);
                              return (
                                <label key={r} style={{ fontSize: 11, display: "flex", gap: 3, alignItems: "center" }}>
                                  <input type="checkbox" checked={on} onChange={() => {
                                    const next = on ? (d.eligible_designations || []).filter((x) => x !== r) : [...(d.eligible_designations || []), r];
                                    run(() => updateDuty(token!, d.id, { eligible_designations: next }), "Eligible ranks updated");
                                  }} />{r}
                                </label>
                              );
                            })}
                          </div>
                        </details>
                      </td>
                      <td>
                        <input type="checkbox" checked={d.is_active} aria-label="Active"
                          onChange={(e) => run(() => updateDuty(token!, d.id, { is_active: e.target.checked }), "Duty updated")} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card__footer" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <strong style={{ fontSize: 13 }}>Add duty</strong>
            <input className="form-control" placeholder="Category" value={newDuty.category} onChange={(e) => setNewDuty({ ...newDuty, category: e.target.value })} style={{ width: 180 }} />
            <select className="form-control" value={newDuty.section} onChange={(e) => setNewDuty({ ...newDuty, section: e.target.value })} style={{ width: 150 }}>
              <option value="">Section</option>
              {sections.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
            <select className="form-control" value={newDuty.shift_code} onChange={(e) => setNewDuty({ ...newDuty, shift_code: e.target.value })} style={{ width: 130 }}>
              <option value="">All shifts</option>
              {["A", "B", "C"].map((s) => <option key={s} value={s}>Shift {s}</option>)}
            </select>
            <input type="number" min={0} className="form-control" placeholder="Required" value={newDuty.required_strength} onChange={(e) => setNewDuty({ ...newDuty, required_strength: e.target.value })} style={{ width: 110 }} />
            <button className="btn btn-primary btn-sm" disabled={!newDuty.category.trim()} onClick={() => run(async () => {
              await createDuty(token!, {
                category: newDuty.category, section: newDuty.section || null, shift_code: newDuty.shift_code || null,
                required_strength: newDuty.required_strength ? Number(newDuty.required_strength) : null,
              });
              setNewDuty({ category: "", section: "", shift_code: "", required_strength: "" });
            }, "Duty added")}>Add</button>
          </div>
        </div>
      )}

      {tab === "sectors" && (
        <div className="card">
          <div className="card__header"><span className="card__title">Sectors</span></div>
          <div className="card__body" style={{ padding: 0 }}>
            <table className="table">
              <thead><tr><th>Name</th><th>Code</th><th>Description</th><th>Staff</th><th>Active</th></tr></thead>
              <tbody>
                {sectors.map((s) => (
                  <tr key={s.id}>
                    <td><input className="form-control" defaultValue={s.name} aria-label="Sector name" onBlur={(e) => e.target.value !== s.name && run(() => saveSector(token!, { name: e.target.value }, s.id), "Sector updated")} /></td>
                    <td><input className="form-control" defaultValue={s.code} aria-label="Sector code" onBlur={(e) => e.target.value !== s.code && run(() => saveSector(token!, { code: e.target.value }, s.id), "Sector updated")} /></td>
                    <td><input className="form-control" defaultValue={s.description || ""} aria-label="Description" onBlur={(e) => e.target.value !== (s.description || "") && run(() => saveSector(token!, { description: e.target.value }, s.id), "Sector updated")} /></td>
                    <td>{s.staff_count ?? 0}</td>
                    <td><input type="checkbox" checked={s.is_active} aria-label="Active" onChange={(e) => run(() => saveSector(token!, { is_active: e.target.checked }, s.id), "Sector updated")} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card__footer" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input className="form-control" placeholder="New sector name" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ width: 200 }} />
            <input className="form-control" placeholder="Code" value={newCode} onChange={(e) => setNewCode(e.target.value)} style={{ width: 110 }} />
            <button className="btn btn-primary btn-sm" disabled={!newName || !newCode} onClick={() => run(async () => { await saveSector(token!, { name: newName, code: newCode }); setNewName(""); setNewCode(""); }, "Sector added")}>Add sector</button>
          </div>
        </div>
      )}

      {tab === "sections" && (
        <div className="card">
          <div className="card__header"><span className="card__title">Sections</span></div>
          <div className="card__body" style={{ padding: 0 }}>
            <table className="table">
              <thead><tr><th>Name</th><th>Description</th><th>Active</th></tr></thead>
              <tbody>
                {sections.map((s) => (
                  <tr key={s.id}>
                    <td><input className="form-control" defaultValue={s.name} aria-label="Section name" onBlur={(e) => e.target.value !== s.name && run(() => saveSection(token!, { name: e.target.value }, s.id), "Section updated")} /></td>
                    <td><input className="form-control" defaultValue={s.description || ""} aria-label="Description" onBlur={(e) => e.target.value !== (s.description || "") && run(() => saveSection(token!, { description: e.target.value }, s.id), "Section updated")} /></td>
                    <td><input type="checkbox" checked={s.is_active} aria-label="Active" onChange={(e) => run(() => saveSection(token!, { is_active: e.target.checked }, s.id), "Section updated")} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card__footer" style={{ display: "flex", gap: 8 }}>
            <input className="form-control" placeholder="New section" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ width: 220 }} />
            <button className="btn btn-primary btn-sm" disabled={!newName} onClick={() => run(async () => { await saveSection(token!, { name: newName }); setNewName(""); }, "Section added")}>Add section</button>
          </div>
        </div>
      )}

      {tab === "lists" && (
        <>
          <div className="alert-banner alert-banner--info" style={{ marginBottom: 16 }}>
            Status codes drive the availability engine and cannot be renamed, but their labels, descriptions, order and visibility can be edited. New leave types can be added.
          </div>
          {Object.entries(lists).map(([name, items]) => (
            <div className="card" key={name} style={{ marginBottom: 16 }}>
              <div className="card__header"><span className="card__title">{LIST_TITLES[name] || name}</span></div>
              <div className="card__body" style={{ padding: 0 }}>
                <table className="table" style={{ fontSize: 13 }}>
                  <thead><tr><th>Code</th><th>Label</th><th>Description</th><th>Order</th><th>Shown</th></tr></thead>
                  <tbody>
                    {items.map((i) => (
                      <tr key={i.id}>
                        <td><code>{i.code}</code></td>
                        <td><input className="form-control" defaultValue={i.label} aria-label="Label" onBlur={(e) => e.target.value !== i.label && run(() => updateListItem(token!, i.id, { label: e.target.value }), "Label updated")} /></td>
                        <td><input className="form-control" defaultValue={i.description || ""} aria-label="Description" onBlur={(e) => e.target.value !== (i.description || "") && run(() => updateListItem(token!, i.id, { description: e.target.value }), "Description updated")} /></td>
                        <td style={{ width: 90 }}><input type="number" className="form-control" defaultValue={i.sort_order} aria-label="Order" onBlur={(e) => Number(e.target.value) !== i.sort_order && run(() => updateListItem(token!, i.id, { sort_order: Number(e.target.value) }), "Order updated")} /></td>
                        <td><input type="checkbox" checked={i.is_active} aria-label="Shown" onChange={(e) => run(() => updateListItem(token!, i.id, { is_active: e.target.checked }), "Visibility updated")} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {name === "leave_type" && (
                <div className="card__footer" style={{ display: "flex", gap: 8 }}>
                  <input className="form-control" placeholder="Code (e.g. HPL)" value={newCode} onChange={(e) => setNewCode(e.target.value.toUpperCase())} style={{ width: 140 }} />
                  <input className="form-control" placeholder="Label" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ width: 220 }} />
                  <button className="btn btn-primary btn-sm" disabled={!newCode || !newName}
                    onClick={() => run(async () => { await addListItem(token!, "leave_type", { code: newCode, label: newName, sort_order: items.length }); setNewCode(""); setNewName(""); }, "Leave type added")}>Add leave type</button>
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </AppShell>
  );
}
