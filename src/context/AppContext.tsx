import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { ITBConfig, loadITBConfig, saveITBConfig } from '../services/itbClient';

export interface AppState {
  connected: boolean;
  hasMasterKey: boolean;
  domainKey: string;
  domainName: string;
  communityKey: string;
  communityApiKey: string;
  organisationApiKey: string;
  selectedCommunity: { apiKey: string; shortName: string; fullName: string } | null;
  selectedOrganisation: { apiKey: string; shortName: string; fullName: string } | null;
  importedIGs: Record<string, { version: string; url: string; spec_keys: string[] }>;
}

interface AppContextType {
  isDark: boolean;
  setIsDark: (v: boolean) => void;
  itbConfig: ITBConfig;
  setITBConfig: (c: ITBConfig) => void;
  saveConfig: (c: ITBConfig) => void;
  itbSettingsOpen: boolean;
  setITBSettingsOpen: (v: boolean) => void;
  appState: AppState;
  refreshState: () => Promise<void>;
  // Navigation — hash-based: #/dashboard, #/domain/{key}, #/spec/{key}, etc.
  path: string;
  navigate: (path: string) => void;
  // Derived from path
  selectedSpecKey: string;
  selectedSpecName: string;
  selectSpec: (key: string, name: string) => void;
}

const AppContext = createContext<AppContextType>(null!);
export const useAppContext = () => useContext(AppContext);

function getHashPath(): string {
  const h = window.location.hash.replace(/^#\/?/, '');
  return h || 'dashboard';
}

export const AppContextProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem('theme');
    return saved ? saved === 'dark' : window.matchMedia?.('(prefers-color-scheme: dark)').matches || false;
  });
  const [itbConfig, setITBConfig] = useState<ITBConfig>(loadITBConfig);
  const [itbSettingsOpen, setITBSettingsOpen] = useState(false);
  const [path, setPath] = useState(getHashPath);
  const [appState, setAppState] = useState<AppState>({
    connected: false, hasMasterKey: false, domainKey: '', domainName: '', communityKey: '',
    communityApiKey: '', organisationApiKey: '',
    selectedCommunity: null, selectedOrganisation: null, importedIGs: {},
  });

  // Spec selection persisted in localStorage
  const [selectedSpecKey, setSelectedSpecKey] = useState(() => localStorage.getItem('selectedSpecKey') || itbConfig.specificationId || '');
  const [selectedSpecName, setSelectedSpecName] = useState(() => localStorage.getItem('selectedSpecName') || '');

  const selectSpec = useCallback((key: string, name: string) => {
    setSelectedSpecKey(key);
    setSelectedSpecName(name);
    localStorage.setItem('selectedSpecKey', key);
    localStorage.setItem('selectedSpecName', name);
  }, []);

  // Hash-based navigation
  const navigate = useCallback((p: string) => {
    window.location.hash = `/${p}`;
  }, []);

  useEffect(() => {
    const onHash = () => setPath(getHashPath());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Theme
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', isDark);
    document.body.style.backgroundColor = isDark ? '#0f172a' : '#f8fafc';
    document.body.style.color = isDark ? '#f9fafb' : '#111827';
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  const saveConfig = (c: ITBConfig) => { setITBConfig(c); saveITBConfig(c); };

  const refreshState = async () => {
    try {
      const r = await fetch('/api/state');
      if (r.ok) {
        const d = await r.json();
        setAppState({
          connected: d.connected,
          hasMasterKey: d.has_master_key || false,
          domainKey: d.domain_key || '',
          domainName: d.domain_name || '',
          communityKey: d.community_key || '',
          communityApiKey: d.community_api_key || '',
          organisationApiKey: d.organisation_api_key || '',
          selectedCommunity: d.selected_community || null,
          selectedOrganisation: d.selected_organisation || null,
          importedIGs: d.imported_igs || {},
        });
        // Auto-populate itbConfig keys from server state
        if (d.community_api_key || d.organisation_api_key) {
          setITBConfig(prev => ({
            ...prev,
            communityApiKey: d.community_api_key || prev.communityApiKey,
            organisationApiKey: d.organisation_api_key || prev.organisationApiKey,
          }));
        }
      }
    } catch {}
  };

  useEffect(() => { refreshState(); }, []);

  return (
    <AppContext.Provider value={{
      isDark, setIsDark,
      itbConfig, setITBConfig, saveConfig, itbSettingsOpen, setITBSettingsOpen,
      appState, refreshState, path, navigate,
      selectedSpecKey, selectedSpecName, selectSpec,
    }}>
      {children}
    </AppContext.Provider>
  );
};
