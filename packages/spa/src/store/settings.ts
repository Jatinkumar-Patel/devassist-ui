import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Org-level defaults — pre-configured, users never need to change these
export const ORG_DEFAULTS = {
  bridgeUrl: 'http://localhost:7447',
  adoBaseUrl: 'https://alm-prod-app1.rd.allscripts.com/tfs/boc_projects',
  snowViewerUrl: 'https://servicenowviewer.allscripts.com',
  registryUrl: '/config/product-registry.json',
} as const;

interface SettingsState {
  // Personal — each user fills these in once via the wizard
  adoPat: string;
  githubPat: string;
  // Org-level — pre-set, overridable only from Settings page
  bridgeUrl: string;
  setAdoPat: (pat: string) => void;
  setGithubPat: (pat: string) => void;
  setBridgeUrl: (url: string) => void;
  clearPats: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      adoPat: '',
      githubPat: '',
      bridgeUrl: ORG_DEFAULTS.bridgeUrl,
      setAdoPat: (adoPat) => set({ adoPat }),
      setGithubPat: (githubPat) => set({ githubPat }),
      setBridgeUrl: (bridgeUrl) => set({ bridgeUrl }),
      clearPats: () => set({ adoPat: '', githubPat: '' }),
    }),
    {
      name: 'devassist-settings',
      // Never log PAT values
      partialize: (s) => ({ adoPat: s.adoPat, githubPat: s.githubPat, bridgeUrl: s.bridgeUrl }),
    }
  )
);
