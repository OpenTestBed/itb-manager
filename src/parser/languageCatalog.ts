import yaml from 'js-yaml';

export type CatalogAction =
  | { call: { path: string; output?: string; inputs?: Record<string,string> } }
  | { verify: { handler: string; desc?: string; inputs: Record<string,string> } }
  | { process: { handler: string; operation: string; output?: string; inputs: Record<string,string>; hidden?: boolean } }
  | { assign: { to: string; value: string; append?: boolean } }
  | { listAppend: { list: string; item: Record<string,string> } }
  | { foreach: { from: string; do: CatalogAction[] } }
  | { send: { id?: string; desc?: string; handler: string; from?: string; to?: string; inputs: Record<string,string> } }
  | { declareActor: { id: string; name?: string; role?: string; endpoint?: string; canonical?: string } }
  | { declareVariable: { name: string; varType?: string; value?: string } }
  | { interact: { id?: string; desc?: string; inputTitle?: string; requests: { desc: string; name?: string; inputType?: string; required?: boolean; variable: string }[] } }
  | { receive: { id?: string; desc?: string; handler: string; from?: string; to?: string; inputs?: Record<string,string> } }
  | { log: string };

export interface CatalogRequirement {
  service: string;
  version?: string;
}

export interface CatalogStep {
  match: string;
  table?: { required: string[] };
  actions: CatalogAction[];
  requires?: CatalogRequirement | CatalogRequirement[];
  /** Which component provided this step (undefined = core language) */
  _source?: { componentId: string; componentName: string; enabled: boolean };
}

export interface Catalog {
  version: number;
  locale: string;
  steps: CatalogStep[];
}

/** Extension catalog loaded from a component's steps.yml */
export interface ExtensionCatalog {
  id: string;
  name: string;
  description?: string;
  steps: CatalogStep[];
}

/** Component manifest loaded from component.yml */
export interface ComponentManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  docker?: {
    image: string;
    ports?: string[];
    environment?: string[];
    volumes?: string[];
  };
  healthCheck?: {
    method: string;
    path: string;
    expect?: { status: number };
  };
  actors?: { id: string; description?: string }[];
  services?: { handler: string; path: string }[];
  language?: string; // relative path to steps.yml
  scriptlets?: string[]; // list of scriptlet XML files shipped with this component
}

/** A scriptlet XML file shipped with a component */
export interface ComponentScriptlet {
  /** Path relative to the test suite root, e.g. "scriptlets/buildJsonBody.xml" */
  path: string;
  /** Raw XML content */
  xml: string;
}

export interface ComponentInfo {
  manifest: ComponentManifest;
  extension?: ExtensionCatalog;
  scriptlets?: ComponentScriptlet[];
  enabled: boolean;
  status: 'unknown' | 'healthy' | 'unhealthy' | 'checking';
}

const base = () => import.meta.env.BASE_URL || '/';

/** Load the core language catalog */
export async function loadCatalog(locale = 'en'): Promise<Catalog> {
  const url = `${base()}lang/${locale}.yml`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load catalog: ${url} (${res.status})`);
  }
  const text = await res.text();
  return yaml.load(text) as Catalog;
}

/** Discover available components from the index */
export async function discoverComponents(): Promise<string[]> {
  try {
    const url = `${base()}components/index.json`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return data.components || [];
  } catch {
    return [];
  }
}

/** Load a single component manifest */
export async function loadComponentManifest(componentId: string): Promise<ComponentManifest | null> {
  try {
    const url = `${base()}components/${componentId}/component.yml`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const text = await res.text();
    return yaml.load(text) as ComponentManifest;
  } catch {
    return null;
  }
}

/** Load a component's language extension */
export async function loadComponentExtension(componentId: string, languageFile: string): Promise<ExtensionCatalog | null> {
  try {
    const url = `${base()}components/${componentId}/${languageFile}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const text = await res.text();
    return yaml.load(text) as ExtensionCatalog;
  } catch {
    return null;
  }
}

/** Load all components and their extensions */
export async function loadAllComponents(): Promise<ComponentInfo[]> {
  const ids = await discoverComponents();
  const results: ComponentInfo[] = [];

  for (const id of ids) {
    const manifest = await loadComponentManifest(id);
    if (!manifest) continue;

    let extension: ExtensionCatalog | null = null;
    if (manifest.language) {
      extension = await loadComponentExtension(id, manifest.language);
    }

    // Load scriptlet XML files shipped with this component
    const scriptlets: ComponentScriptlet[] = [];
    if (manifest.scriptlets) {
      for (const file of manifest.scriptlets) {
        try {
          const url = `${base()}components/${id}/scriptlets/${file}`;
          const res = await fetch(url);
          if (res.ok) {
            const xml = await res.text();
            scriptlets.push({ path: `scriptlets/${file}`, xml });
          }
        } catch { /* skip unavailable scriptlets */ }
      }
    }

    // Check localStorage for enabled state (default: enabled)
    const stored = localStorage.getItem(`component:${id}:enabled`);
    const enabled = stored !== null ? stored === 'true' : true;

    results.push({ manifest, extension: extension ?? undefined, scriptlets: scriptlets.length > 0 ? scriptlets : undefined, enabled, status: 'unknown' });
  }

  return results;
}

/**
 * Merge component extensions into the core catalog.
 * Extension steps are appended after core steps so that
 * core patterns take precedence (first match wins).
 */
export function mergeCatalog(core: Catalog, components: ComponentInfo[]): Catalog {
  const merged: CatalogStep[] = [...core.steps];

  for (const comp of components) {
    if (comp.extension?.steps) {
      // Tag each extension step with its source component and enabled status
      const tagged = comp.extension.steps.map(s => ({
        ...s,
        _source: {
          componentId: comp.manifest.id,
          componentName: comp.manifest.name,
          enabled: comp.enabled,
        },
      }));
      merged.push(...tagged);
    }
  }

  return { ...core, steps: merged };
}

/** Check health of a component.
 *  In dev mode, routes through /api/health-proxy to avoid CORS. */
export async function checkComponentHealth(
  manifest: ComponentManifest,
  endpointOverride?: string
): Promise<'healthy' | 'unhealthy'> {
  if (!manifest.healthCheck) return 'unknown' as any;

  const baseUrl = endpointOverride || `http://localhost:${manifest.docker?.ports?.[0]?.split(':')[0] || '8080'}`;
  const targetUrl = `${baseUrl}${manifest.healthCheck.path}`;
  const method = manifest.healthCheck.method || 'GET';
  const expected = manifest.healthCheck.expect?.status || 200;

  try {
    // Use server-side proxy to bypass CORS in dev mode
    const proxyUrl = `/api/health-proxy?url=${encodeURIComponent(targetUrl)}&method=${method}`;
    const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const data = await res.json();
      return data.status === expected ? 'healthy' : 'unhealthy';
    }
    // Proxy not available (production) — try direct fetch
    const direct = await fetch(targetUrl, { method, signal: AbortSignal.timeout(5000) });
    return direct.status === expected ? 'healthy' : 'unhealthy';
  } catch {
    return 'unhealthy';
  }
}
