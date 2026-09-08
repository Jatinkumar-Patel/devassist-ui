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
  sqlServer: string;
  sqlDatabase: string;
  sqlPort: number;
  sqlAuthMode: 'sql-login' | 'windows';
  sqlUser: string;
  sqlEncrypt: boolean;
  sqlTrustServerCertificate: boolean;
  hasAdoPat: boolean;
  hasGithubPat: boolean;
  setAdoPat: (pat: string) => void;
  setGithubPat: (pat: string) => void;
  setOpenaiKey: (key: string) => void;
  setBridgeUrl: (url: string) => void;
  setSqlServer: (value: string) => void;
  setSqlDatabase: (value: string) => void;
  setSqlPort: (value: number) => void;
  setSqlAuthMode: (value: 'sql-login' | 'windows') => void;
  setSqlUser: (value: string) => void;
  setSqlEncrypt: (value: boolean) => void;
  setSqlTrustServerCertificate: (value: boolean) => void;
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
      sqlServer: '',
      sqlDatabase: '',
      sqlPort: 1433,
      sqlAuthMode: 'sql-login',
      sqlUser: '',
      sqlEncrypt: true,
      sqlTrustServerCertificate: true,
      hasAdoPat: false,
      hasGithubPat: false,
      setAdoPat:     (adoPat) => set({ adoPat }),
      setGithubPat:  (githubPat) => set({ githubPat }),
      setOpenaiKey:  (openaiKey) => set({ openaiKey }),
      setBridgeUrl:  (bridgeUrl) => set({ bridgeUrl }),
      setSqlServer:  (sqlServer) => set({ sqlServer }),
      setSqlDatabase:(sqlDatabase) => set({ sqlDatabase }),
      setSqlPort:    (sqlPort) => set({ sqlPort }),
      setSqlAuthMode:(sqlAuthMode) => set({ sqlAuthMode }),
      setSqlUser:    (sqlUser) => set({ sqlUser }),
      setSqlEncrypt: (sqlEncrypt) => set({ sqlEncrypt }),
      setSqlTrustServerCertificate: (sqlTrustServerCertificate) => set({ sqlTrustServerCertificate }),
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
      version: 5,
      migrate: (persistedState: any) => ({
        adoPat: '',
        githubPat: '',
        openaiKey: '',
        hasAdoPat: Boolean(persistedState?.hasAdoPat),
        hasGithubPat: Boolean(persistedState?.hasGithubPat),
        bridgeUrl: persistedState?.bridgeUrl ?? ORG_DEFAULTS.bridgeUrl,
        sqlServer: persistedState?.sqlServer ?? '',
        sqlDatabase: persistedState?.sqlDatabase ?? '',
        sqlPort: Number(persistedState?.sqlPort ?? 1433),
        sqlAuthMode: persistedState?.sqlAuthMode === 'windows' ? 'windows' : 'sql-login',
        sqlUser: persistedState?.sqlUser ?? '',
        sqlEncrypt: persistedState?.sqlEncrypt ?? true,
        sqlTrustServerCertificate: persistedState?.sqlTrustServerCertificate ?? true,
      }),
      partialize: (s) => ({
        adoPat: '',
        githubPat: '',
        openaiKey: '',
        hasAdoPat: s.hasAdoPat,
        hasGithubPat: s.hasGithubPat,
        bridgeUrl: s.bridgeUrl,
        sqlServer: s.sqlServer,
        sqlDatabase: s.sqlDatabase,
        sqlPort: s.sqlPort,
        sqlAuthMode: s.sqlAuthMode,
        sqlUser: s.sqlUser,
        sqlEncrypt: s.sqlEncrypt,
        sqlTrustServerCertificate: s.sqlTrustServerCertificate,
      }),
    }
  )
);
