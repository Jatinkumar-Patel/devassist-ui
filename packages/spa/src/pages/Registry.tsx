import { useEffect, useState } from "react";
import { Package, GitBranch, TestTube2, Plus, Trash2, Save, ChevronDown, Folder, FileText, Users, CheckSquare, Square, RefreshCw } from "lucide-react";
import { loadRegistry, saveRegistry, invalidateRegistry } from "../lib/product-registry";
import type { ProductRegistry, Product, RepoRef, MtmPlan, ProductGroup, ProductSkillRef, PastedSkillMdRef } from "../types";
import { bridgeApi } from "../lib/bridge-url";
import { fetchSnowLookups } from "../lib/snow-client";

const EMPTY_PRODUCT: Product = {
  id: "", displayName: "", areaPathPrefix: "", snowProduct: "",
  snowProducts: [], snowAssignmentGroups: [],
  snowTaskTable: "incident_task", repos: [], mtmPlans: [], databaseRepoPaths: [],
  skillPaths: [], localSkills: [], githubSkillPaths: [], githubSkills: [], pastedSkillMd: [], docUrl: "", localFolder: "", notes: "",
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex gap-1 flex-wrap">
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
  const initialGithubSkills: ProductSkillRef[] =
    product.githubSkills?.length
      ? product.githubSkills
      : (product.githubSkillPaths ?? []).map((path, index) => ({
          path,
          role: index === 0 ? 'primary' : 'secondary',
          enabled: true,
        }));

  const initialLocalSkills: ProductSkillRef[] =
    product.localSkills?.length
      ? product.localSkills
      : (product.skillPaths ?? []).map((path, index) => ({
          path,
          role: index === 0 ? 'primary' : 'secondary',
          enabled: true,
        }));

  const initialPastedMd: PastedSkillMdRef[] =
    product.pastedSkillMd?.length
      ? product.pastedSkillMd
      : [];

  const [p, setP] = useState<Product>({
    ...product,
    databaseRepoPaths: product.databaseRepoPaths ?? [],
    snowProducts: Array.from(new Set((product.snowProducts ?? [product.snowProduct]).map((x) => String(x ?? '').trim()).filter(Boolean))),
    snowAssignmentGroups: Array.from(new Set((product.snowAssignmentGroups ?? []).map((x) => String(x ?? '').trim()).filter(Boolean))),
    skillPaths: product.skillPaths ?? (product.skillPath ? [product.skillPath] : []),
    localSkills: initialLocalSkills,
    githubSkillPaths: product.githubSkillPaths ?? [],
    githubSkills: initialGithubSkills,
    pastedSkillMd: initialPastedMd,
  });
  const [snowLookupLoading, setSnowLookupLoading] = useState(false);
  const [snowLookupError, setSnowLookupError] = useState("");
  const [snowProductsCatalog, setSnowProductsCatalog] = useState<string[]>([]);
  const [snowGroupCatalog, setSnowGroupCatalog] = useState<string[]>([]);
  const [snowLookupStamp, setSnowLookupStamp] = useState("");
  const set = <K extends keyof Product>(k: K, v: Product[K]) => setP(prev => ({ ...prev, [k]: v }));

  const loadSnowLookupCatalog = async () => {
    setSnowLookupLoading(true);
    setSnowLookupError("");
    try {
      const data = await fetchSnowLookups();
      setSnowProductsCatalog(Array.isArray(data.products) ? data.products : []);
      setSnowGroupCatalog(Array.isArray(data.assignmentGroups) ? data.assignmentGroups : []);
      setSnowLookupStamp(data.sampledAt ? new Date(data.sampledAt).toLocaleString() : '');
    } catch (e: any) {
      setSnowLookupError(e?.message ?? 'Unable to load SNOW lookups');
    } finally {
      setSnowLookupLoading(false);
    }
  };

  useEffect(() => {
    void loadSnowLookupCatalog();
  }, []);

  const saveProduct = () => {
    const enabledLocalSkills = (p.localSkills ?? []).filter((x) => x.enabled !== false && x.path.trim());
    const enabledGithubSkills = (p.githubSkills ?? []).filter((x) => x.enabled !== false && x.path.trim());
    const enabledPastedMd = (p.pastedSkillMd ?? []).filter((x) => x.enabled !== false && (x.title.trim() || x.content.trim()));
    const databaseRepoPaths = Array.from(new Set((p.databaseRepoPaths ?? []).map((x) => x.trim()).filter(Boolean)));
    const snowProducts = Array.from(new Set((p.snowProducts ?? []).map((x) => x.trim()).filter(Boolean)));
    const snowAssignmentGroups = Array.from(new Set((p.snowAssignmentGroups ?? []).map((x) => x.trim()).filter(Boolean)));
    const primarySnowProduct = p.snowProduct?.trim() || snowProducts[0] || '';
    const normalizedSnowProducts = primarySnowProduct
      ? Array.from(new Set([primarySnowProduct, ...snowProducts]))
      : snowProducts;

    onSave({
      ...p,
      snowProduct: primarySnowProduct,
      snowProducts: normalizedSnowProducts,
      snowAssignmentGroups,
      databaseRepoPaths,
      skillPaths: enabledLocalSkills.map((x) => x.path),
      skillPath: enabledLocalSkills[0]?.path ?? p.skillPath ?? '',
      localSkills: enabledLocalSkills,
      githubSkillPaths: enabledGithubSkills.map((x) => x.path),
      githubSkills: enabledGithubSkills,
      pastedSkillMd: enabledPastedMd,
    });
  };

  return (
    <div className="space-y-4">
      <Section title="Core fields">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="ID (slug)" value={p.id} onChange={v => set("id", v)} mono placeholder="e.g. shm"/>
          <Field label="Display name" value={p.displayName} onChange={v => set("displayName", v)} placeholder="Secure Health Messaging"/>
          <Field
            label="Primary SNOW product"
            value={p.snowProduct}
            onChange={v => {
              set("snowProduct", v);
              const trimmed = v.trim();
              if (!trimmed) return;
              const merged = Array.from(new Set([trimmed, ...(p.snowProducts ?? [])]));
              set("snowProducts", merged);
            }}
            placeholder="Sunrise Ambulatory Care"
          />
          <div><label className="block text-xs text-gray-500 mb-1">SNOW task table</label>
            <select value={p.snowTaskTable} onChange={e => set("snowTaskTable", e.target.value as Product["snowTaskTable"])} className={inp + " cursor-pointer"}>
              <option value="incident_task">incident_task</option><option value="sc_task">sc_task</option>
            </select>
          </div>
        </div>
      </Section>

      <Section title="SNOW mapping filters (multi-select)">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => { void loadSnowLookupCatalog(); }}
              className="text-xs px-2.5 py-1.5 rounded border border-cyan-700 text-cyan-200 hover:bg-cyan-950/30"
            >
              Refresh from SNOW
            </button>
            {snowLookupLoading && <span className="text-xs text-gray-500 animate-pulse">Loading SNOW options...</span>}
            {!snowLookupLoading && snowLookupStamp && <span className="text-[11px] text-gray-500">Last sync: {snowLookupStamp}</span>}
          </div>
          {snowLookupError && (
            <div className="rounded border border-amber-800/60 bg-amber-950/20 p-2.5 space-y-1.5">
              <p className="text-xs text-amber-200">{snowLookupError}</p>
              <p className="text-[11px] text-amber-100/90">
                End-user quick fix: restart DevAssist Bridge, then click Refresh from SNOW again.
              </p>
              <div className="flex flex-wrap gap-2 pt-0.5">
                <a
                  href="#/settings"
                  className="text-[11px] px-2.5 py-1 rounded border border-amber-700 text-amber-100 hover:bg-amber-900/40"
                >
                  Open Settings
                </a>
                <a
                  href="http://localhost:7447/api/status"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] px-2.5 py-1 rounded border border-gray-700 text-gray-200 hover:bg-gray-800"
                >
                  Check bridge status
                </a>
              </div>
            </div>
          )}

          <SnowLookupMultiSelect
            label="Mapped SNOW Product values"
            options={snowProductsCatalog}
            selected={p.snowProducts ?? []}
            onChange={(values) => {
              set("snowProducts", values);
              if (!p.snowProduct && values.length) set("snowProduct", values[0]);
            }}
            placeholder="Type to filter product values..."
          />

          <SnowLookupMultiSelect
            label="Mapped SNOW Assignment Group values"
            options={snowGroupCatalog}
            selected={p.snowAssignmentGroups ?? []}
            onChange={(values) => set("snowAssignmentGroups", values)}
            placeholder="Type to filter assignment groups..."
          />
          <p className="text-[11px] text-gray-500">
            These values are used as signal terms during SNOW KB evidence search so product scope matches support ownership patterns.
          </p>
        </div>
      </Section>
      <Section title="Area paths">
        <Field
          label="Primary area path prefix"
          value={p.areaPathPrefix}
          onChange={v => set("areaPathPrefix", v)}
          mono
          placeholder="SR\SCM\Ambulatory\SHM"
          fullWidth
        />
        <AreaPathSyncPicker
          primaryPath={p.areaPathPrefix}
          values={p.areaPathPrefixes ?? []}
          onChange={(v) => set("areaPathPrefixes", v)}
        />
        <p className="text-xs text-gray-500 mt-1">Additional area paths (manual edit, multiple allowed)</p>
        <StringListEditor values={p.areaPathPrefixes ?? []} onChange={v => set("areaPathPrefixes", v)} placeholder="SR\SCM\Ambulatory" mono/>
      </Section>
      <Section title={<><GitBranch size={11}/> Repositories</>}>
        <RepoListEditor repos={p.repos} onChange={v => set("repos", v)}/>
      </Section>
      <Section title={<><Folder size={11}/> Database repo paths</>}>
        <p className="text-xs text-gray-500">GitHub tree URLs used only for database evidence search for this product.</p>
        <StringListEditor
          values={p.databaseRepoPaths ?? []}
          onChange={v => set("databaseRepoPaths", v)}
          placeholder="https://github.com/org/repo/tree/main/path/to/database"
          mono
        />
      </Section>
      <Section title={<><TestTube2 size={11}/> MTM test plans</>}>
        <MtmListEditor plans={p.mtmPlans} onChange={v => set("mtmPlans", v)}/>
      </Section>
      <Section title={<><GitBranch size={11}/> GitHub devassist skill paths</>}>
        <SkillPathEditor
          values={p.githubSkills ?? []}
          onChange={(v) => {
            set("githubSkills", v);
            set("githubSkillPaths", v.filter((x) => x.enabled !== false).map((x) => x.path));
          }}
          placeholder="https://github.com/org/repo/tree/main/skills/devassist-triage/areas/shm"
        />
      </Section>
      <Section title={<><Folder size={11}/> Local skill / knowledge MD file paths</>}>
        <SkillPathEditor
          values={p.localSkills ?? []}
          onChange={(v) => {
            set("localSkills", v);
            set("skillPaths", v.filter((x) => x.enabled !== false).map((x) => x.path));
            set("skillPath", v.find((x) => x.enabled !== false)?.path ?? "");
          }}
          placeholder="C:\skills\shm-playbook.md"
        />
      </Section>
      <Section title={<><FileText size={11}/> Pasted markdown skill content</>}>
        <MarkdownSkillEditor
          values={p.pastedSkillMd ?? []}
          onChange={(v) => set("pastedSkillMd", v)}
        />
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
      <button onClick={saveProduct} disabled={saving}
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
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-center">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
        <div key={i} className="grid grid-cols-1 sm:grid-cols-[80px_1fr_100px_1fr_auto] gap-2 items-center">
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

function SnowLookupMultiSelect({
  label,
  options,
  selected,
  onChange,
  placeholder,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
}) {
  const [query, setQuery] = useState('');
  const normalizedSelected = Array.from(new Set(selected.map((x) => x.trim()).filter(Boolean)));
  const q = query.trim().toLowerCase();

  const filteredOptions = options
    .filter((option) => !q || option.toLowerCase().includes(q))
    .slice(0, 120);

  const toggle = (value: string) => {
    if (normalizedSelected.includes(value)) {
      onChange(normalizedSelected.filter((v) => v !== value));
      return;
    }
    onChange([...normalizedSelected, value]);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <label className="text-xs text-gray-400">{label}</label>
        <span className="text-[11px] text-gray-500">{normalizedSelected.length} selected</span>
      </div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        className={inp + ' text-[11px]'}
      />
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => onChange(filteredOptions.length ? Array.from(new Set([...normalizedSelected, ...filteredOptions])) : normalizedSelected)}
          className="text-[11px] px-2 py-1 rounded border border-gray-700 text-gray-300 hover:bg-gray-800"
        >
          Add visible
        </button>
        <button
          type="button"
          onClick={() => onChange(q ? normalizedSelected.filter((v) => !v.toLowerCase().includes(q)) : [])}
          className="text-[11px] px-2 py-1 rounded border border-gray-700 text-gray-300 hover:bg-gray-800"
        >
          {q ? 'Remove visible' : 'Clear all'}
        </button>
      </div>
      <div className="max-h-44 overflow-auto border border-gray-800 rounded p-2 space-y-1 bg-gray-950/40">
        {filteredOptions.length === 0 ? (
          <p className="text-xs text-gray-500">No matching options.</p>
        ) : (
          filteredOptions.map((value) => {
            const checked = normalizedSelected.includes(value);
            return (
              <label key={value} className="flex items-start gap-2 text-xs text-gray-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(value)}
                  className="accent-altera-teal mt-0.5"
                />
                <span>{value}</span>
              </label>
            );
          })
        )}
      </div>
      {!!normalizedSelected.length && (
        <div className="flex flex-wrap gap-1.5">
          {normalizedSelected.map((value) => (
            <span key={value} className="inline-flex items-center gap-1 rounded border border-cyan-800/60 bg-cyan-950/30 px-2 py-0.5 text-[11px] text-cyan-200">
              {value}
              <button
                type="button"
                onClick={() => onChange(normalizedSelected.filter((v) => v !== value))}
                className="text-cyan-300/80 hover:text-cyan-100"
                aria-label={`Remove ${value}`}
              >
                x
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const inp = "bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-altera-teal/60 w-full";

function Field({ label, value, onChange, placeholder, mono, fullWidth }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean; fullWidth?: boolean }) {
  return (
    <div className={fullWidth ? "sm:col-span-2" : ""}>
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

function SkillPathEditor({ values, onChange, placeholder }: { values: ProductSkillRef[]; onChange: (v: ProductSkillRef[]) => void; placeholder?: string }) {
  const add = () => onChange([...values, { path: "", role: "secondary", enabled: true }]);
  const del = (i: number) => onChange(values.filter((_, j) => j !== i));
  const updPath = (i: number, path: string) => onChange(values.map((x, j) => j === i ? { ...x, path } : x));
  const updRole = (i: number, role: ProductSkillRef['role']) => onChange(values.map((x, j) => j === i ? { ...x, role } : x));
  const updEnabled = (i: number, enabled: boolean) => onChange(values.map((x, j) => j === i ? { ...x, enabled } : x));

  return (
    <div className="space-y-1.5">
      {values.map((v, i) => (
        <div key={i} className="grid grid-cols-1 sm:grid-cols-[92px_120px_1fr_auto] gap-2 items-center">
          <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer whitespace-nowrap">
            <input
              type="checkbox"
              checked={v.enabled !== false}
              onChange={(e) => updEnabled(i, e.target.checked)}
              className="accent-altera-teal"
            />
            Use
          </label>
          <select
            value={v.role}
            onChange={(e) => updRole(i, e.target.value as ProductSkillRef['role'])}
            className={inp + " cursor-pointer"}
          >
            <option value="primary">Primary</option>
            <option value="secondary">Secondary</option>
          </select>
          <input
            value={v.path}
            onChange={e => updPath(i, e.target.value)}
            placeholder={placeholder}
            className={`flex-1 ${inp} font-mono`}
          />
          <button onClick={() => del(i)} className="text-gray-600 hover:text-red-400"><Trash2 size={13}/></button>
        </div>
      ))}
      <button onClick={add} className="flex items-center gap-1 text-xs text-gray-600 hover:text-altera-teal"><Plus size={12}/> Add skill path</button>
    </div>
  );
}

function MarkdownSkillEditor({ values, onChange }: { values: PastedSkillMdRef[]; onChange: (v: PastedSkillMdRef[]) => void }) {
  const add = () => onChange([...values, { title: "", content: "", role: "secondary", enabled: true }]);
  const del = (i: number) => onChange(values.filter((_, j) => j !== i));
  const upd = <K extends keyof PastedSkillMdRef>(i: number, key: K, value: PastedSkillMdRef[K]) => {
    onChange(values.map((x, j) => j === i ? { ...x, [key]: value } : x));
  };

  return (
    <div className="space-y-3">
      {values.map((v, i) => (
        <div key={i} className="rounded border border-gray-800 p-3 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-[92px_120px_1fr_auto] gap-2 items-center">
            <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer whitespace-nowrap">
              <input
                type="checkbox"
                checked={v.enabled !== false}
                onChange={(e) => upd(i, "enabled", e.target.checked)}
                className="accent-altera-teal"
              />
              Use
            </label>
            <select
              value={v.role}
              onChange={(e) => upd(i, "role", e.target.value as PastedSkillMdRef['role'])}
              className={inp + " cursor-pointer"}
            >
              <option value="primary">Primary</option>
              <option value="secondary">Secondary</option>
            </select>
            <input
              value={v.title}
              onChange={e => upd(i, "title", e.target.value)}
              placeholder="Skill title"
              className={inp}
            />
            <button onClick={() => del(i)} className="text-gray-600 hover:text-red-400"><Trash2 size={13}/></button>
          </div>
          <textarea
            value={v.content}
            onChange={e => upd(i, "content", e.target.value)}
            placeholder="Paste the full markdown skill file here"
            rows={8}
            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 resize-y focus:outline-none focus:border-altera-teal/60 font-mono"
          />
        </div>
      ))}
      <button onClick={add} className="flex items-center gap-1 text-xs text-gray-600 hover:text-altera-teal"><Plus size={12}/> Add pasted markdown skill</button>
    </div>
  );
}

type AdoAreaNode = {
  name?: string;
  path?: string;
  hasChildren?: boolean;
  children?: AdoAreaNode[];
};

function AreaPathSyncPicker({
  primaryPath,
  values,
  onChange,
}: {
  primaryPath: string;
  values: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [nodes, setNodes] = useState<AdoAreaNode[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const selected = Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));

  const fetchAreaPaths = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(bridgeApi('/api/ado/SR/_apis/wit/classificationnodes/areas?$depth=10&api-version=7.0'));
      if (!res.ok) throw new Error(`ADO area sync failed: ${res.status}`);
      const data = await res.json();
      const children = Array.isArray(data?.children) ? data.children : [];
      setNodes(children);

      const nextExpanded: Record<string, boolean> = {};
      for (const path of selected) nextExpanded[path] = true;
      if (primaryPath.trim()) nextExpanded[primaryPath.trim()] = true;
      setExpanded(nextExpanded);
      setOpen(true);
    } catch (e: any) {
      setError(e?.message ?? 'Unable to load area paths');
    } finally {
      setLoading(false);
    }
  };

  const toggleSelected = (path: string) => {
    const normalized = path.trim();
    if (!normalized) return;
    if (selected.includes(normalized)) {
      onChange(selected.filter((p) => p !== normalized));
    } else {
      onChange([...selected, normalized]);
    }
  };

  const toggleExpanded = (path: string) => {
    setExpanded((prev) => ({ ...prev, [path]: !prev[path] }));
  };

  const matches = (node: AdoAreaNode, q: string): boolean => {
    if (!q) return true;
    const name = String(node.name ?? '').toLowerCase();
    const path = String(node.path ?? '').toLowerCase();
    if (name.includes(q) || path.includes(q)) return true;
    return (node.children ?? []).some((child) => matches(child, q));
  };

  const renderNode = (node: AdoAreaNode, depth = 0): React.ReactNode => {
    const path = String(node.path ?? '').trim();
    const name = String(node.name ?? '').trim() || path;
    const children = Array.isArray(node.children) ? node.children : [];
    const hasChildren = children.length > 0 || !!node.hasChildren;
    const isOpen = expanded[path] ?? false;
    const isChecked = path ? selected.includes(path) : false;
    const q = query.trim().toLowerCase();

    if (!matches(node, q)) return null;

    return (
      <div key={path || `${name}-${depth}`}>
        <div className="flex items-center gap-2 py-1" style={{ paddingLeft: `${depth * 14}px` }}>
          {hasChildren ? (
            <button
              type="button"
              onClick={() => path && toggleExpanded(path)}
              className="text-gray-500 hover:text-gray-200"
              aria-label={isOpen ? 'Collapse area path node' : 'Expand area path node'}
            >
              <ChevronDown size={12} className={`transition-transform ${isOpen ? 'rotate-180' : '-rotate-90'}`} />
            </button>
          ) : (
            <span className="w-3" />
          )}
          <label className="flex items-center gap-2 text-xs text-gray-200 flex-1 cursor-pointer">
            <input
              type="checkbox"
              checked={isChecked}
              onChange={() => path && toggleSelected(path)}
              className="accent-altera-teal"
            />
            <span className="truncate">{name}</span>
            {path === primaryPath && <span className="text-[10px] text-cyan-300 border border-cyan-800/60 px-1 rounded">primary</span>}
          </label>
        </div>
        {hasChildren && isOpen && (
          <div>
            {children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            if (!nodes.length) {
              void fetchAreaPaths();
              return;
            }
            setOpen((v) => !v);
          }}
          className="text-xs px-2.5 py-1.5 rounded border border-cyan-700 text-cyan-200 hover:bg-cyan-950/30"
        >
          {nodes.length ? (open ? 'Hide ADO area paths' : 'Show ADO area paths') : 'Sync ADO area paths'}
        </button>
        <button
          type="button"
          onClick={() => void fetchAreaPaths()}
          className="text-xs px-2.5 py-1.5 rounded border border-gray-700 text-gray-300 hover:bg-gray-800"
        >
          Refresh
        </button>
        <span className="text-[11px] text-gray-500">{selected.length} selected</span>
      </div>

      {loading && <p className="text-xs text-gray-500 animate-pulse">Syncing area paths from ADO...</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}

      {open && (
        <div className="rounded border border-gray-800 bg-gray-950/40 p-2 space-y-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter area paths..."
            className={inp + " font-mono text-[11px]"}
          />
          <div className="max-h-72 overflow-auto border border-gray-800 rounded p-2 space-y-0.5">
            {nodes.length === 0 ? (
              <p className="text-xs text-gray-500">No area paths loaded yet. Click Sync ADO area paths.</p>
            ) : (
              nodes.map((node) => renderNode(node, 0))
            )}
          </div>
          <p className="text-[11px] text-gray-500">Checked nodes are stored as additional area path prefixes for this product.</p>
        </div>
      )}
    </div>
  );
}