import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Org-level defaults — pre-configured, users never need to change these
export const ORG_DEFAULTS = {
  bridgeUrl: ((import.meta as any).env?.VITE_BRIDGE_URL as string | undefined)?.trim() || 'http://localhost:7447',
  adoBaseUrl: 'https://alm-prod-app1.rd.allscripts.com/tfs/boc_projects',
  snowViewerUrl: 'https://servicenowviewer.allscripts.com',
  registryUrl: '/config/product-registry.json',
  databaseRepoPaths: [
    'https://github.com/allscriptshealthcare/sunrise-sxa/tree/main/Products/Database',
  ],
} as const;

function normalizePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of paths) {
    const p = raw.trim();
    if (!p) continue;
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

interface SettingsState {
  adoPat: string;
  githubPat: string;
  openaiKey: string;      // personal OpenAI API key — optional, enables inline AI analysis
  bridgeUrl: string;
  databaseRepoPaths: string[];
  setAdoPat: (pat: string) => void;
  setGithubPat: (pat: string) => void;
  setOpenaiKey: (key: string) => void;
  setBridgeUrl: (url: string) => void;
  setDatabaseRepoPaths: (paths: string[]) => void;
  addDatabaseRepoPath: (path: string) => void;
  removeDatabaseRepoPath: (index: number) => void;
  resetDatabaseRepoPaths: () => void;
  clearPats: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      adoPat: '',
      githubPat: '',
      openaiKey: '',
      bridgeUrl: ORG_DEFAULTS.bridgeUrl,
      databaseRepoPaths: [...ORG_DEFAULTS.databaseRepoPaths],
      setAdoPat:     (adoPat) => set({ adoPat }),
      setGithubPat:  (githubPat) => set({ githubPat }),
      setOpenaiKey:  (openaiKey) => set({ openaiKey }),
      setBridgeUrl:  (bridgeUrl) => set({ bridgeUrl }),
      setDatabaseRepoPaths: (databaseRepoPaths) => set({ databaseRepoPaths: normalizePaths(databaseRepoPaths) }),
      addDatabaseRepoPath: (path) => set((state) => ({
        databaseRepoPaths: normalizePaths([...state.databaseRepoPaths, path]),
      })),
      removeDatabaseRepoPath: (index) => set((state) => ({
        databaseRepoPaths: state.databaseRepoPaths.filter((_, i) => i !== index),
      })),
      resetDatabaseRepoPaths: () => set({ databaseRepoPaths: [...ORG_DEFAULTS.databaseRepoPaths] }),
      clearPats: () => {
        localStorage.removeItem('devassist-setup-done');
        set({ adoPat: '', githubPat: '', openaiKey: '' });
      },
    }),
    {
      name: 'devassist-settings',
      version: 3,
      migrate: (persistedState: any) => ({
        adoPat: '',
        githubPat: '',
        openaiKey: '',
        bridgeUrl: persistedState?.bridgeUrl ?? ORG_DEFAULTS.bridgeUrl,
        databaseRepoPaths: normalizePaths(
          Array.isArray(persistedState?.databaseRepoPaths)
            ? persistedState.databaseRepoPaths
            : [...ORG_DEFAULTS.databaseRepoPaths]
        ),
      }),
      partialize: (s) => ({
        adoPat: '',
        githubPat: '',
        openaiKey: '',
        bridgeUrl: s.bridgeUrl,
        databaseRepoPaths: s.databaseRepoPaths,
      }),
    }
  )
);
