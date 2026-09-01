import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Org-level defaults — pre-configured, users never need to change these
export const ORG_DEFAULTS = {
  bridgeUrl: ((import.meta as any).env?.VITE_BRIDGE_URL as string | undefined)?.trim() || 'http://localhost:7447',
  adoBaseUrl: 'https://alm-prod-app1.rd.allscripts.com/tfs/boc_projects',
  snowViewerUrl: 'https://servicenowviewer.allscripts.com',
  registryUrl: '/config/product-registry.json',
} as const;

interface SettingsState {
  adoPat: string;
  githubPat: string;
  openaiKey: string;      // personal OpenAI API key — optional, enables inline AI analysis
  bridgeUrl: string;
  hasAdoPat: boolean;
  hasGithubPat: boolean;
  setAdoPat: (pat: string) => void;
  setGithubPat: (pat: string) => void;
  setOpenaiKey: (key: string) => void;
  setBridgeUrl: (url: string) => void;
  setSecretStatus: (status: { hasAdoPat?: boolean; hasGithubPat?: boolean }) => void;
  clearPats: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      adoPat: '',
      githubPat: '',
      openaiKey: '',
      bridgeUrl: ORG_DEFAULTS.bridgeUrl,
      hasAdoPat: false,
      hasGithubPat: false,
      setAdoPat:     (adoPat) => set({ adoPat }),
      setGithubPat:  (githubPat) => set({ githubPat }),
      setOpenaiKey:  (openaiKey) => set({ openaiKey }),
      setBridgeUrl:  (bridgeUrl) => set({ bridgeUrl }),
      setSecretStatus: (status) => set((current) => ({
        hasAdoPat: status.hasAdoPat ?? current.hasAdoPat,
        hasGithubPat: status.hasGithubPat ?? current.hasGithubPat,
      })),
      clearPats: () => {
        localStorage.removeItem('devassist-setup-done');
        set({ adoPat: '', githubPat: '', openaiKey: '', hasAdoPat: false, hasGithubPat: false });
      },
    }),
    {
      name: 'devassist-settings',
      version: 4,
      migrate: (persistedState: any) => ({
        adoPat: '',
        githubPat: '',
        openaiKey: '',
        hasAdoPat: Boolean(persistedState?.hasAdoPat),
        hasGithubPat: Boolean(persistedState?.hasGithubPat),
        bridgeUrl: persistedState?.bridgeUrl ?? ORG_DEFAULTS.bridgeUrl,
      }),
      partialize: (s) => ({
        adoPat: '',
        githubPat: '',
        openaiKey: '',
        hasAdoPat: s.hasAdoPat,
        hasGithubPat: s.hasGithubPat,
        bridgeUrl: s.bridgeUrl,
      }),
    }
  )
);
