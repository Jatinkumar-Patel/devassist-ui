import { useEffect, useState } from "react";
import { Package, GitBranch, TestTube2, Plus, Trash2, Save, ChevronDown, Folder, FileText, Users, CheckSquare, Square, RefreshCw } from "lucide-react";
import { loadRegistry, saveRegistry, invalidateRegistry } from "../lib/product-registry";
import type { ProductRegistry, Product, RepoRef, MtmPlan, ProductGroup } from "../types";

const EMPTY_PRODUCT: Product = {
  id: "", displayName: "", areaPathPrefix: "", snowProduct: "",
  snowTaskTable: "incident_task", repos: [], mtmPlans: [],
  skillPaths: [], docUrl: "", localFolder: "", notes: "",
};

export default function RegistryPage() {
  const [registry, setRegistry] = useState<ProductRegistry | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState<"products" | "groups">("products");

  const reload = () => {
    invalidateRegistry();
    loadRegistry().then(setRegistry).catch((e) => setError(e.message));
  };

  useEffect(() => { reload(); }, []);

  const save = async (updated: ProductRegistry) => {
    setSaving(true);
    try {
      await saveRegistry(updated);
      setRegistry(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  };

  const updateProduct = (p: Product) => {
    if (!registry) return;
    save({ ...registry, products: registry.products.map(x => x.id === p.id ? p : x) });
  };

  const addProduct = () => {
    if (!registry) return;
    const id = `product-${Date.now()}`;
    const updated = { ...registry, products: [...registry.products, { ...EMPTY_PRODUCT, id }] };
    setRegistry(updated);
    setSelected(id);
  };

  const deleteProduct = (id: string) => {
    if (!registry || !confirm(`Delete product "${id}"?`)) return;
    save({ ...registry, products: registry.products.filter(p => p.id !== id) });
    if (selected === id) setSelected(null);
  };

  if (error) return <div className="text-red-400 text-sm p-4 border border-red-800 rounded-lg bg-red-950/20">{error}</div>;
  if (!registry) return <div className="text-gray-500 text-sm animate-pulse">Loading registry...</div>;

  const active = registry.products.find(p => p.id === selected);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          <TabBtn active={activeTab === "products"} onClick={() => setActiveTab("products")}><Package size={12}/> Products ({registry.products.length})</TabBtn>
          <TabBtn active={activeTab === "groups"} onClick={() => setActiveTab("groups")}><Users size={12}/> Groups ({registry.groups?.length ?? 0})</TabBtn>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={reload} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 border border-gray-700 px-2 py-1 rounded"><RefreshCw size={11}/> Reload</button>
          {saved && <span className="text-xs text-emerald-400">Saved</span>}
          {saving && <span className="text-xs text-gray-500 animate-pulse">Saving...</span>}
        </div>
      </div>

      {activeTab === "products" && (
        <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4">
          <aside className="space-y-1">
            {registry.products.map(p => (
              <div key={p.id} className="flex items-center gap-1 group">
                <button onClick={() => setSelected(p.id)}
                  className={`flex-1 text-left px-3 py-2 rounded text-sm flex items-center gap-2 ${p.id === selected ? "bg-gray-800 text-gray-100" : "text-gray-400 hover:bg-gray-900 hover:text-gray-200"}`}>
                  <Package size={12} className="shrink-0"/><span className="truncate">{p.displayName || <em className="text-gray-600">unnamed</em>}</span>
                </button>
                <button onClick={() => deleteProduct(p.id)} className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 p-1 rounded"><Trash2 size={12}/></button>
              </div>
            ))}
            <button onClick={addProduct} className="w-full flex items-center gap-1.5 text-xs text-gray-600 hover:text-altera-teal border border-dashed border-gray-800 hover:border-altera-teal/50 px-3 py-2 rounded mt-1">
              <Plus size={12}/> Add product
            </button>
          </aside>
          <section>
            {active ? <ProductEditor key={active.id} product={active} onSave={updateProduct} saving={saving}/>
              : <div className="text-gray-600 text-sm flex items-center justify-center h-48">Select a product to edit.</div>}
          </section>
        </div>
      )}

      {activeTab === "groups" && (
        <GroupsEditor groups={registry.groups ?? []} products={registry.products}
          onSave={gs => save({ ...registry, groups: gs })} saving={saving}/>
      )}
    </div>
  );
}

function ProductEditor({ product, onSave, saving }: { product: Product; onSave: (p: Product) => void; saving: boolean }) {
  const [p, setP] = useState<Product>({ ...product, skillPaths: product.skillPaths ?? (product.skillPath ? [product.skillPath] : []) });
  const set = <K extends keyof Product>(k: K, v: Product[K]) => setP(prev => ({ ...prev, [k]: v }));
  return (
    <div className="space-y-4">
      <Section title="Core fields">
        <div className="grid grid-cols-2 gap-3">
          <Field label="ID (slug)" value={p.id} onChange={v => set("id", v)} mono placeholder="e.g. shm"/>
          <Field label="Display name" value={p.displayName} onChange={v => set("displayName", v)} placeholder="Secure Health Messaging"/>
          <Field label="Area path prefix" value={p.areaPathPrefix} onChange={v => set("areaPathPrefix", v)} mono placeholder="SR\SCM\Ambulatory\SHM" fullWidth/>
          <Field label="SNOW product" value={p.snowProduct} onChange={v => set("snowProduct", v)} placeholder="Sunrise Ambulatory Care"/>
          <div><label className="block text-xs text-gray-500 mb-1">SNOW task table</label>
            <select value={p.snowTaskTable} onChange={e => set("snowTaskTable", e.target.value as Product["snowTaskTable"])} className={inp + " cursor-pointer"}>
              <option value="incident_task">incident_task</option><option value="sc_task">sc_task</option>
            </select>
          </div>
        </div>
      </Section>
      <Section title="Additional area path prefixes">
        <StringListEditor values={p.areaPathPrefixes ?? []} onChange={v => set("areaPathPrefixes", v)} placeholder="SR\SCM\Ambulatory" mono/>
      </Section>
      <Section title={<><GitBranch size={11}/> Repositories</>}>
        <RepoListEditor repos={p.repos} onChange={v => set("repos", v)}/>
      </Section>
      <Section title={<><TestTube2 size={11}/> MTM test plans</>}>
        <MtmListEditor plans={p.mtmPlans} onChange={v => set("mtmPlans", v)}/>
      </Section>
      <Section title={<><FileText size={11}/> Local skill / knowledge MD file paths</>}>
        <StringListEditor values={p.skillPaths ?? []} onChange={v => set("skillPaths", v)} placeholder="C:\skills\shm-playbook.md" mono/>
      </Section>
      <Section title={<><Folder size={11}/> Local paths</>}>
        <div className="grid grid-cols-1 gap-3">
          <Field label="Local DA folder (# = DA number)" value={p.localFolder ?? ""} onChange={v => set("localFolder", v)} mono placeholder="C:\temp\DA#"/>
          <Field label="Documentation URL or path" value={p.docUrl ?? ""} onChange={v => set("docUrl", v)} placeholder="https://wiki/... or C:\docs\..."/>
        </div>
      </Section>
      <Section title="Notes">
        <textarea value={p.notes ?? ""} onChange={e => set("notes", e.target.value)} rows={3} placeholder="Team contacts, quirks, useful links..."
          className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 resize-y focus:outline-none focus:border-altera-teal/60"/>
      </Section>
      <button onClick={() => onSave(p)} disabled={saving}
        className="flex items-center gap-1.5 bg-altera-blue hover:bg-altera-blue/80 disabled:opacity-50 text-white px-4 py-2 rounded text-sm font-medium">
        <Save size={13}/> {saving ? "Saving..." : "Save product"}
      </button>
    </div>
  );
}

function GroupsEditor({ groups, products, onSave }: { groups: ProductGroup[]; products: Product[]; onSave: (g: ProductGroup[]) => void; saving?: boolean }) {
  const [gs, setGs] = useState<ProductGroup[]>(groups);
  const [sel, setSel] = useState<string | null>(gs[0]?.id ?? null);
  const add = () => { const id = `group-${Date.now()}`; const ng: ProductGroup = { id, name: "New Group", productIds: [] }; const u = [...gs, ng]; setGs(u); setSel(id); };
  const del = (id: string) => { if (!confirm("Delete group?")) return; const u = gs.filter(g => g.id !== id); setGs(u); onSave(u); if (sel === id) setSel(null); };
  const upd = (g: ProductGroup) => { const u = gs.map(x => x.id === g.id ? g : x); setGs(u); onSave(u); };
  const active = gs.find(g => g.id === sel);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-4">
      <aside className="space-y-1">
        {gs.map(g => (
          <div key={g.id} className="flex items-center gap-1 group">
            <button onClick={() => setSel(g.id)} className={`flex-1 text-left px-3 py-2 rounded text-sm ${g.id === sel ? "bg-gray-800 text-gray-100" : "text-gray-400 hover:bg-gray-900"}`}>
              <Users size={12} className="inline mr-1.5"/>{g.name} <span className="text-gray-600 text-xs">({g.productIds.length})</span>
            </button>
            <button onClick={() => del(g.id)} className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 p-1"><Trash2 size={12}/></button>
          </div>
        ))}
        <button onClick={add} className="w-full flex items-center gap-1.5 text-xs text-gray-600 hover:text-altera-teal border border-dashed border-gray-800 px-3 py-2 rounded mt-1"><Plus size={12}/> Add group</button>
      </aside>
      <section>
        {active ? (
          <div className="space-y-4">
            <Field label="Group name" value={active.name} onChange={v => upd({ ...active, name: v })} placeholder="e.g. AMB Group"/>
            <div className="space-y-1">
              <p className="text-xs text-gray-500 font-medium">Products in this group (check to include)</p>
              {products.map(p => (
                <button key={p.id} onClick={() => {
                  const ids = active.productIds.includes(p.id) ? active.productIds.filter(x => x !== p.id) : [...active.productIds, p.id];
                  upd({ ...active, productIds: ids });
                }} className="w-full flex items-center gap-2.5 px-3 py-2 rounded hover:bg-gray-800 text-sm text-left">
                  {active.productIds.includes(p.id) ? <CheckSquare size={14} className="text-altera-teal shrink-0"/> : <Square size={14} className="text-gray-600 shrink-0"/>}
                  <span className={active.productIds.includes(p.id) ? "text-gray-200" : "text-gray-500"}>{p.displayName}</span>
                  <span className="text-gray-600 text-xs font-mono ml-auto">{p.id}</span>
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-600">Changes auto-save when you click checkboxes.</p>
          </div>
        ) : <div className="text-gray-600 text-sm flex items-center justify-center h-48">Select or create a group.</div>}
      </section>
    </div>
  );
}

function RepoListEditor({ repos, onChange }: { repos: RepoRef[]; onChange: (v: RepoRef[]) => void }) {
  const add = () => onChange([...repos, { key: `repo-${Date.now()}`, owner: "allscriptshealthcare", repo: "", required: false, localPaths: [] }]);
  const del = (i: number) => onChange(repos.filter((_, j) => j !== i));
  const upd = <K extends keyof RepoRef>(i: number, k: K, v: RepoRef[K]) => onChange(repos.map((r, j) => j === i ? { ...r, [k]: v } : r));
  return (
    <div className="space-y-4">
      {repos.map((r, i) => (
        <div key={i} className="rounded border border-gray-800 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-400">{r.owner}/{r.repo || <em className="text-gray-600">repo</em>}</span>
            <button onClick={() => del(i)} className="text-gray-600 hover:text-red-400"><Trash2 size={13}/></button>
          </div>
          {/* Row 1: owner / repo / primary */}
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
            <div><label className="block text-xs text-gray-600 mb-0.5">Owner</label>
              <input value={r.owner} onChange={e => upd(i, "owner", e.target.value)} className={inp + " font-mono"}/>
            </div>
            <div><label className="block text-xs text-gray-600 mb-0.5">Repo</label>
              <input value={r.repo} onChange={e => upd(i, "repo", e.target.value)} className={inp + " font-mono"}/>
            </div>
            <label className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer mt-4 whitespace-nowrap">
              <input type="checkbox" checked={!!r.required} onChange={e => upd(i, "required", e.target.checked)} className="accent-altera-teal"/> Primary
            </label>
          </div>
          {/* Row 2: GitHub URL / version file */}
          <div className="grid grid-cols-2 gap-2">
            <div><label className="block text-xs text-gray-600 mb-0.5">GitHub URL (override, optional)</label>
              <input value={r.githubUrl ?? ""} onChange={e => upd(i, "githubUrl", e.target.value)}
                placeholder={`https://github.com/${r.owner}/${r.repo}`}
                className={inp + " font-mono text-[11px]"}/>
            </div>
            <div><label className="block text-xs text-gray-600 mb-0.5">Version file (optional)</label>
              <input value={r.versionFile ?? ""} onChange={e => upd(i, "versionFile", e.target.value)}
                placeholder="e.g. package.json" className={inp}/>
            </div>
          </div>
          {/* Local clone paths — multiple */}
          <div>
            <label className="block text-xs text-gray-600 mb-1">Local clone paths</label>
            <div className="space-y-1.5">
              {(r.localPaths ?? []).map((lp, li) => (
                <div key={li} className="flex gap-2 items-center">
                  <input value={lp}
                    onChange={e => upd(i, "localPaths", (r.localPaths ?? []).map((x, xi) => xi === li ? e.target.value : x))}
                    placeholder="e.g. C:\git\plhlt-aimanager-npm"
                    className={inp + " font-mono text-[11px]"}/>
                  <button onClick={() => upd(i, "localPaths", (r.localPaths ?? []).filter((_, xi) => xi !== li))}
                    className="text-gray-600 hover:text-red-400 shrink-0"><Trash2 size={12}/></button>
                </div>
              ))}
              <button onClick={() => upd(i, "localPaths", [...(r.localPaths ?? []), ""])}
                className="flex items-center gap-1 text-xs text-gray-600 hover:text-altera-teal">
                <Plus size={11}/> Add local path
              </button>
            </div>
          </div>
        </div>
      ))}
      <button onClick={add} className="flex items-center gap-1 text-xs text-gray-600 hover:text-altera-teal border border-dashed border-gray-800 hover:border-altera-teal/50 px-3 py-2 rounded w-full justify-center">
        <Plus size={12}/> Add repository
      </button>
    </div>
  );
}

function MtmListEditor({ plans, onChange }: { plans: MtmPlan[]; onChange: (v: MtmPlan[]) => void }) {
  const add = () => onChange([...plans, { id: 0, name: "", adoProject: "SR", url: "" }]);
  const del = (i: number) => onChange(plans.filter((_, j) => j !== i));
  const upd = <K extends keyof MtmPlan>(i: number, k: K, v: MtmPlan[K]) => onChange(plans.map((m, j) => j === i ? { ...m, [k]: v } : m));
  return (
    <div className="space-y-2">
      {plans.map((m, i) => (
        <div key={i} className="grid grid-cols-[80px_1fr_100px_1fr_auto] gap-2 items-center">
          <input type="number" value={m.id} onChange={e => upd(i, "id", parseInt(e.target.value)||0)} placeholder="Plan ID" className={inp}/>
          <input value={m.name} onChange={e => upd(i, "name", e.target.value)} placeholder="Plan name" className={inp}/>
          <input value={m.adoProject} onChange={e => upd(i, "adoProject", e.target.value)} placeholder="Project" className={inp}/>
          <input value={m.url ?? ""} onChange={e => upd(i, "url", e.target.value)} placeholder="URL (opt)" className={inp}/>
          <button onClick={() => del(i)} className="text-gray-600 hover:text-red-400"><Trash2 size={13}/></button>
        </div>
      ))}
      <button onClick={add} className="flex items-center gap-1 text-xs text-gray-600 hover:text-altera-teal"><Plus size={12}/> Add MTM plan</button>
    </div>
  );
}

function StringListEditor({ values, onChange, placeholder, mono }: { values: string[]; onChange: (v: string[]) => void; placeholder?: string; mono?: boolean }) {
  const add = () => onChange([...values, ""]);
  const del = (i: number) => onChange(values.filter((_, j) => j !== i));
  const upd = (i: number, v: string) => onChange(values.map((x, j) => j === i ? v : x));
  return (
    <div className="space-y-1.5">
      {values.map((v, i) => (
        <div key={i} className="flex gap-2 items-center">
          <input value={v} onChange={e => upd(i, e.target.value)} placeholder={placeholder} className={`flex-1 ${inp} ${mono ? "font-mono" : ""}`}/>
          <button onClick={() => del(i)} className="text-gray-600 hover:text-red-400"><Trash2 size={13}/></button>
        </div>
      ))}
      <button onClick={add} className="flex items-center gap-1 text-xs text-gray-600 hover:text-altera-teal"><Plus size={12}/> Add</button>
    </div>
  );
}

const inp = "bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-altera-teal/60 w-full";

function Field({ label, value, onChange, placeholder, mono, fullWidth }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean; fullWidth?: boolean }) {
  return (
    <div className={fullWidth ? "col-span-2" : ""}>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={`${inp} ${mono ? "font-mono" : ""}`}/>
    </div>
  );
}

function Section({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-lg border border-gray-800 overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-3 py-2 bg-gray-900/50 text-xs font-medium text-gray-400 hover:text-gray-200">
        <span className="flex items-center gap-1.5">{title}</span>
        <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`}/>
      </button>
      {open && <div className="p-3 space-y-2">{children}</div>}
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium ${active ? "bg-gray-800 text-gray-100" : "text-gray-500 hover:text-gray-300"}`}>
      {children}
    </button>
  );
}