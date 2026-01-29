import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * TraceCamargue — MVP
 * - Lots de production (produit fini) avec composants + photo
 * - Stock/réception (lots entrants)
 * - Relevés températures matin/soir (journal)
 * - Plan de nettoyage (checklist)
 * - Alertes DLC/DDM (approche)
 * - Exports CSV/JSON
 *
 * Notes:
 * - Données stockées en localStorage (MVP). Pour multi-téléphones, il faudra un backend/sync.
 * - Les notifications « automatiques » dépendent du navigateur/OS. Ici: rappel in-app + bouton test notif.
 */

// ---------- utils ----------
const uid = () => Math.random().toString(16).slice(2) + Date.now().toString(16);
const todayISO = () => new Date().toISOString().slice(0, 10);
const nowHM = () => {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
};

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function save(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function downloadText(filename, text, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function toCSV(rows) {
  const esc = (v) => {
    const s = String(v ?? "");
    if (/[\n\r,\"]/g.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.map(esc).join(",")];
  for (const r of rows) lines.push(headers.map((h) => esc(r[h])).join(","));
  return lines.join("\n");
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ---------- storage keys ----------
const K = {
  settings: "tc_settings_v1",
  products: "tc_products_v1", // catalogue
  inbound: "tc_inbound_v1", // lots entrants
  lots: "tc_lots_v1", // lots produits finis
  temps: "tc_temps_v1", // relevés T°
  fridges: "tc_fridges_v1",
  cleaningAreas: "tc_cleaning_areas_v1",
  cleaningLogs: "tc_cleaning_logs_v1",
};

// ---------- UI helpers ----------
function Section({ title, subtitle, right, children }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          {subtitle ? <p className="text-sm text-slate-600 mt-1">{subtitle}</p> : null}
        </div>
        {right ? <div className="shrink-0">{right}</div> : null}
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function Pill({ children }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs border border-slate-200 bg-slate-50 text-slate-700">
      {children}
    </span>
  );
}

function Button({ children, onClick, variant = "primary", disabled, type = "button" }) {
  const base = "px-3 py-2 rounded-xl text-sm font-medium transition shadow-sm";
  const variants = {
    primary: "bg-slate-900 text-white hover:bg-slate-800",
    ghost: "bg-transparent border border-slate-200 text-slate-800 hover:bg-slate-50",
    danger: "bg-rose-600 text-white hover:bg-rose-500",
  };
  return (
    <button type={type} disabled={disabled} onClick={onClick} className={`${base} ${variants[variant]} ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}>
      {children}
    </button>
  );
}

function Input({ label, value, onChange, placeholder, type = "text", required }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-700">{label}{required ? " *" : ""}</span>
      <input
        type={type}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
      />
    </label>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-700">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function CardRow({ title, meta, right, onClick }) {
  return (
    <div
      className={`flex items-center justify-between gap-3 p-3 rounded-2xl border border-slate-200 ${onClick ? "cursor-pointer hover:bg-slate-50" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
    >
      <div className="min-w-0">
        <div className="font-medium text-slate-900 truncate">{title}</div>
        {meta ? <div className="text-xs text-slate-600 mt-1">{meta}</div> : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

function daysUntil(dateISO) {
  if (!dateISO) return null;
  const d0 = new Date();
  const d1 = new Date(dateISO + "T00:00:00");
  const ms = d1.getTime() - new Date(d0.toISOString().slice(0, 10) + "T00:00:00").getTime();
  return Math.round(ms / 86400000);
}

// ---------- main ----------
export default function App() {
  const [tab, setTab] = useState("dashboard");

  const [settings, setSettings] = useState(() =>
    load(K.settings, {
      company: "L’Olivette Camarguaise",
      operator: "",
      tempMorning: "08:00",
      tempEvening: "18:00",
      dlcWarnDays: 7,
    })
  );
  const [products, setProducts] = useState(() => load(K.products, []));
  const [inbound, setInbound] = useState(() => load(K.inbound, []));
  const [lots, setLots] = useState(() => load(K.lots, []));
  const [temps, setTemps] = useState(() => load(K.temps, []));
  const [fridges, setFridges] = useState(() =>
    load(K.fridges, [
      { id: uid(), name: "Chambre froide +", min: 0, max: 4 },
      { id: uid(), name: "Chambre froide -", min: -22, max: -18 },
      { id: uid(), name: "Séchoir", min: 12, max: 16 },
    ])
  );
  const [areas, setAreas] = useState(() =>
    load(K.cleaningAreas, [
      { id: uid(), name: "Table inox", freq: "DAILY" },
      { id: uid(), name: "Trancheuse", freq: "DAILY" },
      { id: uid(), name: "Sol laboratoire", freq: "DAILY" },
      { id: uid(), name: "Siphons", freq: "WEEKLY" },
    ])
  );
  const [cleaningLogs, setCleaningLogs] = useState(() => load(K.cleaningLogs, []));

  // persist
  useEffect(() => save(K.settings, settings), [settings]);
  useEffect(() => save(K.products, products), [products]);
  useEffect(() => save(K.inbound, inbound), [inbound]);
  useEffect(() => save(K.lots, lots), [lots]);
  useEffect(() => save(K.temps, temps), [temps]);
  useEffect(() => save(K.fridges, fridges), [fridges]);
  useEffect(() => save(K.cleaningAreas, areas), [areas]);
  useEffect(() => save(K.cleaningLogs, cleaningLogs), [cleaningLogs]);

  // notifications / reminders (best-effort)
  const [reminder, setReminder] = useState(null);
  useEffect(() => {
    const t = setInterval(() => {
      const now = nowHM();
      const d = todayISO();
      const didMorning = temps.some((x) => x.date === d && x.slot === "MORNING");
      const didEvening = temps.some((x) => x.date === d && x.slot === "EVENING");
      if (now >= settings.tempMorning && !didMorning) {
        setReminder({ type: "TEMP", slot: "MORNING" });
      } else if (now >= settings.tempEvening && !didEvening) {
        setReminder({ type: "TEMP", slot: "EVENING" });
      } else {
        setReminder(null);
      }
    }, 30_000);
    return () => clearInterval(t);
  }, [settings.tempMorning, settings.tempEvening, temps]);

  // DLC alerts
  const dlcAlerts = useMemo(() => {
    const warn = Number(settings.dlcWarnDays ?? 7);
    const items = inbound
      .filter((x) => x.status === "IN_STOCK")
      .map((x) => ({ ...x, dleft: daysUntil(x.expiry) }))
      .filter((x) => x.dleft != null && x.dleft <= warn)
      .sort((a, b) => (a.dleft ?? 999) - (b.dleft ?? 999));
    return items;
  }, [inbound, settings.dlcWarnDays]);

  // cleaning due
  const cleaningDue = useMemo(() => {
    const d = todayISO();
    const lastDoneByArea = new Map();
    for (const log of cleaningLogs) {
      const prev = lastDoneByArea.get(log.areaId);
      if (!prev || log.date > prev) lastDoneByArea.set(log.areaId, log.date);
    }
    const isDue = (area) => {
      const last = lastDoneByArea.get(area.id);
      if (!last) return true;
      if (area.freq === "DAILY") return last !== d;
      if (area.freq === "WEEKLY") {
        const ld = new Date(last + "T00:00:00");
        const td = new Date(d + "T00:00:00");
        return (td.getTime() - ld.getTime()) / 86400000 >= 7;
      }
      if (area.freq === "MONTHLY") {
        return last.slice(0, 7) !== d.slice(0, 7);
      }
      return false;
    };
    return areas.filter(isDue);
  }, [areas, cleaningLogs]);

  // ---------- actions ----------
  const requestNotif = async () => {
    if (!("Notification" in window)) return alert("Notifications non supportées ici.");
    const p = await Notification.requestPermission();
    if (p !== "granted") alert("Permission refusée.");
    else new Notification("TraceCamargue", { body: "Notifications activées (si supportées par ton téléphone)." });
  };

  const exportAllJSON = () => {
    const payload = { settings, products, inbound, lots, temps, fridges, areas, cleaningLogs };
    downloadText(`tracecamargue_export_${todayISO()}.json`, JSON.stringify(payload, null, 2), "application/json");
  };

  const exportLotsCSV = () => {
    const rows = [];
    for (const lot of lots) {
      for (const comp of lot.components) {
        rows.push({
          lotProduitFini: lot.lotCode,
          produitFini: lot.finishedName,
          date: lot.date,
          operateur: lot.operator,
          composantType: comp.type,
          composantNom: comp.name,
          marque: comp.brand,
          lotComposant: comp.lotNumber,
          dlcDdm: comp.expiry,
        });
      }
      if (!lot.components.length) {
        rows.push({
          lotProduitFini: lot.lotCode,
          produitFini: lot.finishedName,
          date: lot.date,
          operateur: lot.operator,
          composantType: "",
          composantNom: "",
          marque: "",
          lotComposant: "",
          dlcDdm: "",
        });
      }
    }
    downloadText(`lots_production_${todayISO()}.csv`, toCSV(rows), "text/csv");
  };

  const exportTempsCSV = () => {
    const rows = temps.flatMap((t) =>
      t.readings.map((r) => ({
        date: t.date,
        slot: t.slot,
        chambre: r.fridgeName,
        valeur: r.value,
        min: r.min,
        max: r.max,
        conforme: r.ok ? "OUI" : "NON",
        actionCorrective: r.correctiveAction || "",
        commentaire: t.note || "",
      }))
    );
    downloadText(`releves_temperature_${todayISO()}.csv`, toCSV(rows), "text/csv");
  };

  // ---------- views ----------
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm text-slate-600">{settings.company || "TraceCamargue"}</div>
            <div className="font-semibold text-slate-900 truncate">Traçabilité & HACCP — MVP</div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={requestNotif}>Activer notifications</Button>
            <Button variant="ghost" onClick={exportAllJSON}>Export JSON</Button>
          </div>
        </div>
      </header>

      {reminder ? (
        <div className="max-w-6xl mx-auto px-4 mt-4">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 flex items-center justify-between gap-3">
            <div>
              <div className="font-medium text-slate-900">Rappel : Relevé températures {reminder.slot === "MORNING" ? "du matin" : "du soir"}</div>
              <div className="text-xs text-slate-700">Ouvre l’onglet Températures pour saisir rapidement.</div>
            </div>
            <Button onClick={() => setTab("temps")}>Saisir</Button>
          </div>
        </div>
      ) : null}

      <main className="max-w-6xl mx-auto px-4 py-6">
        <nav className="flex flex-wrap gap-2 mb-6">
          {[
            ["dashboard", "Tableau de bord"],
            ["production", "Production"],
            ["stock", "Stock / Réception"],
            ["temps", "Températures"],
            ["cleaning", "Nettoyage"],
            ["exports", "Exports"],
            ["settings", "Paramètres"],
          ].map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`px-3 py-2 rounded-xl text-sm border ${tab === k ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200 text-slate-800 hover:bg-slate-50"}`}
            >
              {label}
            </button>
          ))}
        </nav>

        {tab === "dashboard" ? (
          <Dashboard dlcAlerts={dlcAlerts} cleaningDue={cleaningDue} setTab={setTab} lots={lots} />
        ) : null}

        {tab === "production" ? (
          <Production
            settings={settings}
            inbound={inbound}
            lots={lots}
            setLots={setLots}
          />
        ) : null}

        {tab === "stock" ? (
          <Stock inbound={inbound} setInbound={setInbound} products={products} setProducts={setProducts} />
        ) : null}

        {tab === "temps" ? (
          <Temperatures fridges={fridges} setFridges={setFridges} temps={temps} setTemps={setTemps} />
        ) : null}

        {tab === "cleaning" ? (
          <Cleaning areas={areas} setAreas={setAreas} cleaningLogs={cleaningLogs} setCleaningLogs={setCleaningLogs} />
        ) : null}

        {tab === "exports" ? (
          <Section
            title="Exports"
            subtitle="CSV pour Excel + JSON complet (en haut)."
          >
            <div className="flex flex-wrap gap-2">
              <Button onClick={exportLotsCSV}>Exporter lots production (CSV)</Button>
              <Button onClick={exportTempsCSV} variant="ghost">Exporter relevés T° (CSV)</Button>
            </div>
          </Section>
        ) : null}

        {tab === "settings" ? (
          <Settings settings={settings} setSettings={setSettings} />
        ) : null}
      </main>

      <footer className="max-w-6xl mx-auto px-4 pb-10 text-xs text-slate-500">
        Données locales (MVP). Pour un usage multi-utilisateurs / contrôles avancés, on branchera une synchro + audit trail.
      </footer>
    </div>
  );
}

function Dashboard({ dlcAlerts, cleaningDue, setTab, lots }) {
  const lotsToday = useMemo(() => lots.filter((l) => l.date === todayISO()).length, [lots]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Section
        title="À faire aujourd’hui"
        subtitle="Alertes automatiques"
        right={<Pill>{todayISO()}</Pill>}
      >
        <div className="space-y-2">
          <CardRow
            title={`DLC/DDM proches (${dlcAlerts.length})`}
            meta={dlcAlerts.length ? dlcAlerts.slice(0, 2).map((x) => `${x.name} (J${x.dleft})`).join(" • ") : "Aucune alerte"}
            right={<Button variant="ghost" onClick={() => setTab("stock")}>Voir</Button>}
          />
          <CardRow
            title={`Nettoyage à faire (${cleaningDue.length})`}
            meta={cleaningDue.length ? cleaningDue.slice(0, 3).map((a) => a.name).join(" • ") : "Rien en retard"}
            right={<Button variant="ghost" onClick={() => setTab("cleaning")}>Ouvrir</Button>}
          />
          <CardRow
            title={`Lots produits aujourd’hui (${lotsToday})`}
            meta={lotsToday ? "Tu peux exporter en CSV dans l’onglet Exports." : "Aucun lot enregistré aujourd’hui"}
            right={<Button variant="ghost" onClick={() => setTab("production")}>Nouveau lot</Button>}
          />
        </div>
      </Section>

      <Section title="Raccourcis">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setTab("production")}>Démarrer un lot</Button>
          <Button variant="ghost" onClick={() => setTab("temps")}>Saisir T°</Button>
          <Button variant="ghost" onClick={() => setTab("cleaning")}>Checklist nettoyage</Button>
          <Button variant="ghost" onClick={() => setTab("stock")}>Réception / Stock</Button>
        </div>
      </Section>
    </div>
  );
}

function Production({ settings, inbound, lots, setLots }) {
  const [finishedName, setFinishedName] = useState("");
  const [qty, setQty] = useState("");
  const [expiry, setExpiry] = useState("");
  const [operator, setOperator] = useState(settings.operator || "");

  const [currentLot, setCurrentLot] = useState(null);
  const [selectedInboundId, setSelectedInboundId] = useState("");
  const [compForm, setCompForm] = useState({ type: "INGREDIENT", name: "", brand: "", lotNumber: "", expiry: "", photo: "" });

  const inboundOptions = useMemo(() => {
    const opts = [{ value: "", label: "— sélectionner un lot du stock (optionnel) —" }];
    for (const x of inbound.filter((i) => i.status === "IN_STOCK")) {
      const dleft = daysUntil(x.expiry);
      opts.push({ value: x.id, label: `${x.name} — lot ${x.lotNumber || "?"} — ${x.expiry || ""}${dleft != null ? ` (J${dleft})` : ""}` });
    }
    return opts;
  }, [inbound]);

  const createLot = () => {
    if (!finishedName.trim()) return alert("Renseigne le produit fini.");
    const code = `PF-${todayISO().replaceAll("-", "")}-${String((lots.filter((l) => l.date === todayISO()).length + 1)).padStart(3, "0")}`;
    const lot = {
      id: uid(),
      date: todayISO(),
      time: nowHM(),
      finishedName: finishedName.trim(),
      qty: qty.trim(),
      expiry: expiry || "",
      operator: operator || "",
      lotCode: code,
      components: [],
      notes: "",
    };
    setCurrentLot(lot);
  };

  const addComponent = async () => {
    if (!currentLot) return;

    // If an inbound lot is selected, pull fields
    let comp = { ...compForm };
    const inboundItem = inbound.find((x) => x.id === selectedInboundId);
    if (inboundItem) {
      comp = {
        ...comp,
        name: inboundItem.name,
        brand: inboundItem.brand,
        lotNumber: inboundItem.lotNumber,
        expiry: inboundItem.expiry,
        photo: inboundItem.photo || comp.photo,
      };
    }

    if (!comp.name.trim()) return alert("Renseigne le nom du composant (ou choisis un lot du stock).");

    const next = {
      ...currentLot,
      components: [
        ...currentLot.components,
        {
          id: uid(),
          type: comp.type,
          name: comp.name.trim(),
          brand: comp.brand.trim(),
          lotNumber: comp.lotNumber.trim(),
          expiry: comp.expiry,
          photo: comp.photo,
        },
      ],
    };
    setCurrentLot(next);
    setSelectedInboundId("");
    setCompForm({ type: comp.type, name: "", brand: "", lotNumber: "", expiry: "", photo: "" });
  };

  const onPickPhoto = async (file) => {
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    setCompForm((s) => ({ ...s, photo: dataUrl }));
  };

  const finalize = () => {
    if (!currentLot) return;
    setLots([currentLot, ...lots]);
    setCurrentLot(null);
    setFinishedName("");
    setQty("");
    setExpiry("");
  };

  const removeComp = (id) => {
    setCurrentLot((l) => ({ ...l, components: l.components.filter((c) => c.id !== id) }));
  };

  return (
    <div className="space-y-4">
      {!currentLot ? (
        <Section title="Démarrer un lot (produit fini)" subtitle="Crée le lot, puis ajoute les composants par photo/scan ou depuis le stock.">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input label="Produit fini" value={finishedName} onChange={setFinishedName} placeholder="Ex: Gardianne de taureau 750g" required />
            <Input label="Quantité" value={qty} onChange={setQty} placeholder="Ex: 140 bocaux" />
            <Input label="DLC/DDM (produit fini)" type="date" value={expiry} onChange={setExpiry} />
          </div>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label="Opérateur" value={operator} onChange={setOperator} placeholder="Ex: Nico" />
            <div className="flex items-end">
              <Button onClick={createLot}>Créer le lot</Button>
            </div>
          </div>
        </Section>
      ) : (
        <Section
          title={`Lot en cours : ${currentLot.lotCode}`}
          subtitle={`${currentLot.finishedName} • ${currentLot.date} ${currentLot.time}${currentLot.expiry ? ` • DLC/DDM: ${currentLot.expiry}` : ""}`}
          right={<Button variant="danger" onClick={() => setCurrentLot(null)}>Annuler</Button>}
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Select
                  label="Ajouter depuis le stock"
                  value={selectedInboundId}
                  onChange={setSelectedInboundId}
                  options={inboundOptions}
                />
                <Select
                  label="Type"
                  value={compForm.type}
                  onChange={(v) => setCompForm((s) => ({ ...s, type: v }))}
                  options={[
                    { value: "INGREDIENT", label: "Ingrédient" },
                    { value: "PACKAGING", label: "Emballage" },
                  ]}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Input label="Nom (si pas stock)" value={compForm.name} onChange={(v) => setCompForm((s) => ({ ...s, name: v }))} placeholder="Ex: Poivre" />
                <Input label="Marque / fournisseur" value={compForm.brand} onChange={(v) => setCompForm((s) => ({ ...s, brand: v }))} placeholder="Ex: Ducros" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Input label="N° lot" value={compForm.lotNumber} onChange={(v) => setCompForm((s) => ({ ...s, lotNumber: v }))} placeholder="Lot ingrédient" />
                <Input label="DLC/DDM" type="date" value={compForm.expiry} onChange={(v) => setCompForm((s) => ({ ...s, expiry: v }))} />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white cursor-pointer">
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => onPickPhoto(e.target.files?.[0] || null)}
                  />
                  <span className="text-sm">📸 Photo étiquette</span>
                </label>
                <Button onClick={addComponent}>Ajouter composant</Button>
              </div>

              {compForm.photo ? (
                <div className="rounded-2xl border border-slate-200 overflow-hidden">
                  <img src={compForm.photo} alt="Étiquette" className="w-full max-h-64 object-cover" />
                </div>
              ) : null}
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold text-slate-900">Composants ({currentLot.components.length})</div>
                <Button onClick={finalize} variant="primary">Valider & enregistrer</Button>
              </div>
              <div className="space-y-2">
                {currentLot.components.length ? (
                  currentLot.components.map((c) => (
                    <div key={c.id} className="p-3 rounded-2xl border border-slate-200 bg-white">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-medium text-slate-900 truncate">{c.name}</div>
                          <div className="text-xs text-slate-600 mt-1">
                            <span className="mr-2">{c.type === "INGREDIENT" ? "Ingrédient" : "Emballage"}</span>
                            {c.brand ? <span className="mr-2">• {c.brand}</span> : null}
                            {c.lotNumber ? <span className="mr-2">• lot {c.lotNumber}</span> : null}
                            {c.expiry ? <span>• DLC/DDM {c.expiry}</span> : null}
                          </div>
                        </div>
                        <Button variant="ghost" onClick={() => removeComp(c.id)}>Supprimer</Button>
                      </div>
                      {c.photo ? <img src={c.photo} alt="" className="mt-2 w-full max-h-40 object-cover rounded-xl" /> : null}
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-slate-600">Ajoute les ingrédients + emballages utilisés pour constituer la traçabilité.</div>
                )}
              </div>
            </div>
          </div>
        </Section>
      )}

      <Section title="Historique (derniers lots)" subtitle="Clique pour voir les composants.">
        <div className="space-y-2">
          {lots.slice(0, 8).map((l) => (
            <details key={l.id} className="rounded-2xl border border-slate-200 bg-white p-3">
              <summary className="cursor-pointer flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-slate-900 truncate">{l.lotCode} — {l.finishedName}</div>
                  <div className="text-xs text-slate-600 mt-1">{l.date} {l.time} • {l.operator || ""} • {l.components.length} composants</div>
                </div>
                <Pill>{l.expiry ? `DLC/DDM ${l.expiry}` : ""}</Pill>
              </summary>
              <div className="mt-3 space-y-2">
                {l.components.map((c) => (
                  <div key={c.id} className="text-sm text-slate-800 flex flex-wrap gap-2 items-center">
                    <Pill>{c.type === "INGREDIENT" ? "Ingrédient" : "Emballage"}</Pill>
                    <span className="font-medium">{c.name}</span>
                    {c.brand ? <span className="text-slate-600">({c.brand})</span> : null}
                    {c.lotNumber ? <span className="text-slate-600">lot {c.lotNumber}</span> : null}
                    {c.expiry ? <span className="text-slate-600">DLC/DDM {c.expiry}</span> : null}
                  </div>
                ))}
              </div>
            </details>
          ))}
          {!lots.length ? <div className="text-sm text-slate-600">Aucun lot enregistré pour le moment.</div> : null}
        </div>
      </Section>
    </div>
  );
}

function Stock({ inbound, setInbound, products, setProducts }) {
  const [form, setForm] = useState({ name: "", brand: "", lotNumber: "", expiry: "", supplier: "", photo: "" });
  const [search, setSearch] = useState("");

  const onPickPhoto = async (file) => {
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    setForm((s) => ({ ...s, photo: dataUrl }));
  };

  const addInbound = () => {
    if (!form.name.trim()) return alert("Nom produit obligatoire.");
    const item = {
      id: uid(),
      createdAt: new Date().toISOString(),
      name: form.name.trim(),
      brand: form.brand.trim(),
      supplier: form.supplier.trim(),
      lotNumber: form.lotNumber.trim(),
      expiry: form.expiry,
      status: "IN_STOCK",
      photo: form.photo,
    };
    setInbound([item, ...inbound]);
    // update catalogue
    if (!products.some((p) => p.name === item.name && p.brand === item.brand)) {
      setProducts([{ id: uid(), name: item.name, brand: item.brand, supplier: item.supplier }, ...products]);
    }
    setForm({ name: "", brand: "", lotNumber: "", expiry: "", supplier: "", photo: "" });
  };

  const markStatus = (id, status) => {
    setInbound(inbound.map((x) => (x.id === id ? { ...x, status } : x)));
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return inbound;
    return inbound.filter((x) =>
      [x.name, x.brand, x.supplier, x.lotNumber].some((v) => String(v || "").toLowerCase().includes(q))
    );
  }, [inbound, search]);

  return (
    <div className="space-y-4">
      <Section title="Réception / entrée stock" subtitle="Prends en photo l’étiquette et renseigne le lot + DLC/DDM.">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Input label="Nom produit" value={form.name} onChange={(v) => setForm((s) => ({ ...s, name: v }))} placeholder="Ex: Sel fin" required />
          <Input label="Marque" value={form.brand} onChange={(v) => setForm((s) => ({ ...s, brand: v }))} placeholder="Ex: La Baleine" />
          <Input label="Fournisseur" value={form.supplier} onChange={(v) => setForm((s) => ({ ...s, supplier: v }))} placeholder="Ex: METRO" />
        </div>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
          <Input label="N° lot" value={form.lotNumber} onChange={(v) => setForm((s) => ({ ...s, lotNumber: v }))} placeholder="Lot" />
          <Input label="DLC/DDM" type="date" value={form.expiry} onChange={(v) => setForm((s) => ({ ...s, expiry: v }))} />
          <div className="flex items-end gap-2">
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white cursor-pointer">
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onPickPhoto(e.target.files?.[0] || null)} />
              <span className="text-sm">📸 Photo</span>
            </label>
            <Button onClick={addInbound}>Ajouter</Button>
          </div>
        </div>
        {form.photo ? <img src={form.photo} alt="" className="mt-3 w-full max-h-56 object-cover rounded-2xl border border-slate-200" /> : null}
      </Section>

      <Section
        title="Stock"
        subtitle="Recherche, statut, et alertes DLC/DDM via le tableau de bord."
        right={<div className="w-64"><Input label="Recherche" value={search} onChange={setSearch} placeholder="nom, marque, lot…" /></div>}
      >
        <div className="space-y-2">
          {filtered.slice(0, 40).map((x) => {
            const dleft = daysUntil(x.expiry);
            const warn = dleft != null && dleft <= 7;
            return (
              <div key={x.id} className="p-3 rounded-2xl border border-slate-200 bg-white">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900 truncate">{x.name}</div>
                    <div className="text-xs text-slate-600 mt-1">
                      {x.brand ? <span className="mr-2">{x.brand}</span> : null}
                      {x.lotNumber ? <span className="mr-2">• lot {x.lotNumber}</span> : null}
                      {x.expiry ? <span className={warn ? "text-rose-700 font-medium" : ""}>• DLC/DDM {x.expiry}{dleft != null ? ` (J${dleft})` : ""}</span> : null}
                      <span className="ml-2">• {x.status === "IN_STOCK" ? "En stock" : x.status === "USED" ? "Utilisé" : "Sorti"}</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {x.status !== "USED" ? <Button variant="ghost" onClick={() => markStatus(x.id, "USED")}>Marquer utilisé</Button> : null}
                    {x.status !== "OUT" ? <Button variant="ghost" onClick={() => markStatus(x.id, "OUT")}>Sorti</Button> : null}
                  </div>
                </div>
                {x.photo ? <img src={x.photo} alt="" className="mt-2 w-full max-h-40 object-cover rounded-xl" /> : null}
              </div>
            );
          })}
          {!filtered.length ? <div className="text-sm text-slate-600">Aucun résultat.</div> : null}
        </div>
      </Section>
    </div>
  );
}

function Temperatures({ fridges, setFridges, temps, setTemps }) {
  const [slot, setSlot] = useState("MORNING");
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [values, setValues] = useState(() => Object.fromEntries(fridges.map((f) => [f.id, ""])));

  useEffect(() => {
    setValues(Object.fromEntries(fridges.map((f) => [f.id, ""])));
  }, [fridges]);

  const saveReading = () => {
    const readings = fridges.map((f) => {
      const v = Number(values[f.id]);
      const ok = Number.isFinite(v) && v >= Number(f.min) && v <= Number(f.max);
      return {
        fridgeId: f.id,
        fridgeName: f.name,
        min: f.min,
        max: f.max,
        value: values[f.id],
        ok,
        correctiveAction: ok ? "" : "",
      };
    });
    // If any out of range, ask corrective actions
    const anyBad = readings.some((r) => r.value !== "" && !r.ok);
    let finalReadings = readings;
    if (anyBad) {
      finalReadings = readings.map((r) => {
        if (r.value === "" || r.ok) return r;
        const action = prompt(`Action corrective pour ${r.fridgeName} (valeur ${r.value} hors ${r.min}–${r.max})`, "") || "";
        return { ...r, correctiveAction: action };
      });
    }

    // Upsert by date+slot
    const existing = temps.find((t) => t.date === date && t.slot === slot);
    const entry = { id: existing?.id || uid(), date, slot, createdAt: new Date().toISOString(), note, readings: finalReadings };
    const next = existing ? temps.map((t) => (t.id === existing.id ? entry : t)) : [entry, ...temps];
    setTemps(next);
    setNote("");
    alert("Relevé enregistré.");
  };

  const addFridge = () => {
    const name = prompt("Nom chambre froide", "Nouvelle chambre");
    if (!name) return;
    const min = prompt("Temp min", "0");
    const max = prompt("Temp max", "4");
    setFridges([{ id: uid(), name, min: Number(min), max: Number(max) }, ...fridges]);
  };

  return (
    <div className="space-y-4">
      <Section
        title="Saisie relevé températures"
        subtitle="Matin/soir + tolérances. Si hors plage, action corrective demandée."
        right={<Button variant="ghost" onClick={addFridge}>+ Ajouter chambre</Button>}
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Input label="Date" type="date" value={date} onChange={setDate} />
          <Select
            label="Créneau"
            value={slot}
            onChange={setSlot}
            options={[
              { value: "MORNING", label: "Matin" },
              { value: "EVENING", label: "Soir" },
            ]}
          />
          <Input label="Commentaire" value={note} onChange={setNote} placeholder="Optionnel" />
        </div>

        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          {fridges.map((f) => (
            <div key={f.id} className="p-3 rounded-2xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between">
                <div className="font-medium text-slate-900">{f.name}</div>
                <Pill>{f.min} → {f.max}°C</Pill>
              </div>
              <input
                type="number"
                step="0.1"
                value={values[f.id] ?? ""}
                onChange={(e) => setValues((s) => ({ ...s, [f.id]: e.target.value }))}
                placeholder="Température"
                className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
          ))}
        </div>

        <div className="mt-3">
          <Button onClick={saveReading}>Enregistrer</Button>
        </div>
      </Section>

      <Section title="Historique" subtitle="Les derniers relevés.">
        <div className="space-y-2">
          {temps.slice(0, 12).map((t) => (
            <details key={t.id} className="rounded-2xl border border-slate-200 bg-white p-3">
              <summary className="cursor-pointer flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-slate-900 truncate">{t.date} — {t.slot === "MORNING" ? "Matin" : "Soir"}</div>
                  <div className="text-xs text-slate-600 mt-1">{t.note || ""}</div>
                </div>
                <Pill>{t.readings.filter((r) => r.value !== "").length} valeurs</Pill>
              </summary>
              <div className="mt-3 space-y-2">
                {t.readings.map((r, idx) => (
                  <div key={idx} className="text-sm flex items-center justify-between">
                    <span>{r.fridgeName}</span>
                    <span className={r.value !== "" && !r.ok ? "text-rose-700 font-medium" : "text-slate-800"}>
                      {r.value !== "" ? `${r.value}°C` : "—"}
                      {r.value !== "" ? ` (cible ${r.min}–${r.max})` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          ))}
          {!temps.length ? <div className="text-sm text-slate-600">Aucun relevé.</div> : null}
        </div>
      </Section>
    </div>
  );
}

function Cleaning({ areas, setAreas, cleaningLogs, setCleaningLogs }) {
  const [date, setDate] = useState(todayISO());

  const dueAreas = useMemo(() => {
    const lastDoneByArea = new Map();
    for (const log of cleaningLogs) {
      const prev = lastDoneByArea.get(log.areaId);
      if (!prev || log.date > prev) lastDoneByArea.set(log.areaId, log.date);
    }
    const isDue = (area) => {
      const last = lastDoneByArea.get(area.id);
      if (!last) return true;
      if (area.freq === "DAILY") return last !== date;
      if (area.freq === "WEEKLY") {
        const ld = new Date(last + "T00:00:00");
        const td = new Date(date + "T00:00:00");
        return (td.getTime() - ld.getTime()) / 86400000 >= 7;
      }
      if (area.freq === "MONTHLY") return last.slice(0, 7) !== date.slice(0, 7);
      return false;
    };
    return areas.filter(isDue);
  }, [areas, cleaningLogs, date]);

  const toggleDone = async (areaId) => {
    const already = cleaningLogs.some((l) => l.areaId === areaId && l.date === date);
    if (already) {
      setCleaningLogs(cleaningLogs.filter((l) => !(l.areaId === areaId && l.date === date)));
      return;
    }
    setCleaningLogs([{ id: uid(), areaId, date, createdAt: new Date().toISOString() }, ...cleaningLogs]);
  };

  const addArea = () => {
    const name = prompt("Zone / surface", "");
    if (!name) return;
    const freq = prompt("Fréquence: DAILY / WEEKLY / MONTHLY", "DAILY") || "DAILY";
    setAreas([{ id: uid(), name, freq: ["DAILY", "WEEKLY", "MONTHLY"].includes(freq) ? freq : "DAILY" }, ...areas]);
  };

  return (
    <div className="space-y-4">
      <Section title="Checklist nettoyage" subtitle="Coche ce qui est fait. (MVP)" right={<Button variant="ghost" onClick={addArea}>+ Ajouter zone</Button>}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Input label="Date" type="date" value={date} onChange={setDate} />
        </div>

        <div className="mt-3 space-y-2">
          {areas.map((a) => {
            const done = cleaningLogs.some((l) => l.areaId === a.id && l.date === date);
            const due = dueAreas.some((d) => d.id === a.id);
            return (
              <div key={a.id} className={`p-3 rounded-2xl border ${due && !done ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900 truncate">{a.name}</div>
                    <div className="text-xs text-slate-600 mt-1">Fréquence: {a.freq}</div>
                  </div>
                  <Button variant={done ? "primary" : "ghost"} onClick={() => toggleDone(a.id)}>
                    {done ? "Fait" : "À faire"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="Historique" subtitle="Dernières actions enregistrées.">
        <div className="space-y-2">
          {cleaningLogs.slice(0, 12).map((l) => {
            const a = areas.find((x) => x.id === l.areaId);
            return <CardRow key={l.id} title={a?.name || "Zone"} meta={`Fait le ${l.date}`} />;
          })}
          {!cleaningLogs.length ? <div className="text-sm text-slate-600">Aucun log.</div> : null}
        </div>
      </Section>
    </div>
  );
}

function Settings({ settings, setSettings }) {
  return (
    <div className="space-y-4">
      <Section title="Paramètres" subtitle="Rappels & réglages.">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Input label="Nom entreprise" value={settings.company} onChange={(v) => setSettings((s) => ({ ...s, company: v }))} />
          <Input label="Opérateur par défaut" value={settings.operator} onChange={(v) => setSettings((s) => ({ ...s, operator: v }))} />
          <Input label="Alerte DLC/DDM (jours)" type="number" value={String(settings.dlcWarnDays)} onChange={(v) => setSettings((s) => ({ ...s, dlcWarnDays: Number(v) }))} />
        </div>

        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          <Input label="Heure rappel T° matin" type="time" value={settings.tempMorning} onChange={(v) => setSettings((s) => ({ ...s, tempMorning: v }))} />
          <Input label="Heure rappel T° soir" type="time" value={settings.tempEvening} onChange={(v) => setSettings((s) => ({ ...s, tempEvening: v }))} />
        </div>

        <div className="mt-3 text-sm text-slate-600">
          Astuce : sur téléphone, installe l’app (menu navigateur → « Ajouter à l’écran d’accueil ») pour un usage terrain.
        </div>
      </Section>

      <Section title="Sécurité & conformité (à prévoir en V2)" subtitle="Pour être béton en contrôle.">
        <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1">
          <li>Comptes utilisateurs + rôles (opérateur/admin) + signatures nominatives</li>
          <li>Historique des modifications (audit trail)</li>
          <li>Sauvegardes + export PDF normalisé</li>
          <li>Synchronisation multi-téléphones (cloud ou serveur local)</li>
          <li>Scan code-barres/GS1 + OCR étiquette (lecture lot/DLC automatique)</li>
        </ul>
      </Section>
    </div>
  );
}
