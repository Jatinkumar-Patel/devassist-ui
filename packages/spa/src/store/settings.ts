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
  adoPat: string;
  githubPat: string;
  openaiKey: string;      // personal OpenAI API key — optional, enables inline AI analysis
  bridgeUrl: string;
  setAdoPat: (pat: string) => void;
  setGithubPat: (pat: string) => void;
  setOpenaiKey: (key: string) => void;
  setBridgeUrl: (url: string) => void;
  clearPats: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      adoPat: '',
      githubPat: '',
      openaiKey: '',
      bridgeUrl: ORG_DEFAULTS.bridgeUrl,
      setAdoPat:     (adoPat) => set({ adoPat }),
      setGithubPat:  (githubPat) => set({ githubPat }),
      setOpenaiKey:  (openaiKey) => set({ openaiKey }),
      setBridgeUrl:  (bridgeUrl) => set({ bridgeUrl }),
      clearPats: () => {
        localStorage.removeItem('devassist-setup-done');
        set({ adoPat: '', githubPat: '', openaiKey: '' });
      },
    }),
    {
      name: 'devassist-settings',
      partialize: (s) => ({ adoPat: s.adoPat, githubPat: s.githubPat, openaiKey: s.openaiKey, bridgeUrl: s.bridgeUrl }),
    }
  )
);
