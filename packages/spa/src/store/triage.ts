import { create } from 'zustand';
import type { TriageSession } from '../types';

interface TriageState {
  sessions: TriageSession[];
  active: string | null;     // session id
  setActive: (id: string) => void;
  upsert: (session: TriageSession) => void;
  remove: (id: string) => void;
}

export const useTriageStore = create<TriageState>()((set) => ({
  sessions: [],
  active: null,
  setActive: (id) => set({ active: id }),
  upsert: (session) =>
    set((s) => {
      const idx = s.sessions.findIndex((x) => x.id === session.id);
      const sessions = idx >= 0
        ? s.sessions.map((x) => x.id === session.id ? session : x)
        : [session, ...s.sessions];
      return { sessions, active: session.id };
    }),
  remove: (id) =>
    set((s) => ({
      sessions: s.sessions.filter((x) => x.id !== id),
      active: s.active === id ? s.sessions[0]?.id ?? null : s.active,
    })),
}));
