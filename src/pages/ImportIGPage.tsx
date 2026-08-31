import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  PackagePlus, Link as LinkIcon, Upload, Check, AlertCircle, Loader2, Code, FileCheck,
  Globe, Settings, Copy, ExternalLink, RotateCw, ChevronRight,
} from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import {
  resolveITBIds, getITBAppUrl, ensureConformance, ensureSystem,
  getSpecificationActors,
} from '../services/itbClient';
import { Markdown } from '../components/Markdown';

// ── Types from /api/ig/discover ──────────────────────────────────────────────
/** A `TestPlan.scope` entry, classified by what its canonical points at. */
interface ScopeEntry {
  reference: string;
  description?: string;
  /**
   * Groups scope entries into table columns. 'actor' for a CapabilityStatement or
   * ActorDefinition; otherwise derived from the resource type in the canonical, so
   * a kind we've never seen ('transaction', …) still gets its own column.
   */
  kind?: string;
  /** Column header for this kind, e.g. 'Actor', 'Transaction'. */
  kindLabel?: string;
  /** Display name — the resource's title when it's in the package, else the last URL segment. */
  name?: string;
  inPackage?: boolean;
}

interface TestPlan {
  id: string;
  name: string;
  description: string;
  type?: 'gherkin' | 'itb-zip' | 'unknown';
  scope: ScopeEntry[];
  /** The scope entry naming the actor under test — drives the ITB actor binding. */
  actor_scope?: ScopeEntry | null;
  /** `TestPlan.runner` (1..1 in the Testing IG profile) — which runner these tests are for. */
  runner?: string;
  /** `TestPlan.mode` — declared modes that gate suites, inputs and parameters. */
  modes?: { code: string; description?: string }[];
  /** Why this plan can't be imported cleanly, reported against the element we looked at. */
  problems?: { severity: 'error' | 'warning' | 'info'; message: string }[];
  /** False when `problems` contains an error — the row is shown but not selectable. */
  importable?: boolean;
  parameters: { name: string; value: string; mode?: string }[];
  suites: {
    name: string;
    description?: string;
    type?: string;
    gherkin_file?: string;
    gherkin_content?: string;
    itb_zip_file?: string;
    itb_zip_base64?: string;
    tests?: { name: string; description?: string }[];
  }[];
  raw_json: any;
  /** TestPlan.identifier value for system="http://smart-architecture/placeholder/actorids", if present. */
  stableId?: string;
}

/** Result of comparing a TestPlan against previously-imported IG state. */
type DetectionStatus =
  | { kind: 'new' }
  | { kind: 'update'; specKey: string; specName?: string; igName: string; lastDeployedAt?: string; viaStableId: boolean }
  | { kind: 'conflict'; specKey: string; specName?: string; igName: string };
interface Discovery {
  ig_name: string;
  ig_version: string;
  ig_url?: string;
  fhir_version: string;
  dependencies: string[];
  test_plans: TestPlan[];
  profiles: any[];
}

interface DomainOption { apiKey: string; shortName: string; fullName?: string; description?: string; }
interface SpecOption  { apiKey: string; shortName: string; fullName?: string; description?: string; }

interface CompileError { message: string; issues: { severity: string; message: string; line?: number }[]; gherkin?: string; }

/**
 * Which of the actors ITB just created is this plan's system under test?
 *
 * `TestPlan.scope` names it by canonical (…/CapabilityStatement/MedicationOverviewConsumer);
 * the deployed actor identifiers come from the Gherkin actor declarations, which use the
 * same names. Match on the canonical's last segment, exactly first then case-insensitively.
 * Returns '' when scope names no actor — the caller falls back to ITB's default.
 */
function resolveSutActorId(tp: TestPlan | undefined, deployedActorIds: string[]): string {
  const ref = tp?.actor_scope?.reference || '';
  if (!ref) return '';
  const wanted = ref.split('/').pop() || '';
  if (!wanted) return '';
  return deployedActorIds.find(a => a === wanted)
    || deployedActorIds.find(a => a.toLowerCase() === wanted.toLowerCase())
    || '';
}

const SidePanel: React.FC<{ icon: any; title: string; status?: React.ReactNode; children: React.ReactNode }>
  = ({ icon: Icon, title, status, children }) => (
  <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 mb-4 overflow-hidden">
    <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-700 flex items-center gap-2 bg-gray-50/60 dark:bg-slate-800/40">
      <Icon size={15} className="text-blue-600 dark:text-blue-400 flex-shrink-0" />
      <span className="font-semibold text-sm text-gray-900 dark:text-white">{title}</span>
      <div className="flex-1" />
      {status}
    </div>
    <div className="p-4">{children}</div>
  </div>
);

export function ImportIGPage() {
  const { appState, itbConfig, selectedSpecKey, selectSpec, navigate, refreshState, setITBSettingsOpen } = useAppContext();

  // ── Source state ──
  const [tab, setTab] = useState<'url' | 'file'>('url');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState('');
  const [discovery, setDiscovery] = useState<Discovery | null>(null);

  // ── Target state ──
  const [domains, setDomains] = useState<DomainOption[]>([]);
  const [domainKey, setDomainKey] = useState<string>(appState.domainKey || '');
  const [domainTouched, setDomainTouched] = useState(false);  // user explicitly set a domain
  const [targetMode, setTargetMode] = useState<'new' | 'existing'>('new');
  const [targetTouched, setTargetTouched] = useState(false);  // user picked target manually
  const [newSpecName, setNewSpecName] = useState('');
  const [existingSpecKey, setExistingSpecKey] = useState<string>(selectedSpecKey || '');
  const [domainSpecs, setDomainSpecs] = useState<SpecOption[]>([]);

  // ── Detection (computed) — classify each TestPlan as New / Update of existing.
  // Cross-IG matching is allowed via TestPlan.stableId (the namespaced identifier),
  // since that asserts the *same logical thing* even across IG package boundaries.
  // Fallback to (igName, id) when no stableId is present (less stable; ITB-local match).
  const detectionMap = useMemo(() => {
    const out = new Map<string, DetectionStatus>();
    if (!discovery) return out;
    for (const tp of discovery.test_plans) {
      const stableId = tp.stableId || '';
      let match: { igName: string; specKey: string; name?: string; lastDeployedAt?: string; viaStableId: boolean } | null = null;
      for (const [igName, igEntry] of Object.entries(appState.importedIGs || {})) {
        const tps = igEntry.testPlans || {};
        if (stableId && tps[stableId]) {
          match = { igName, ...tps[stableId], viaStableId: true };
          break;
        }
        if (igName === discovery.ig_name && tp.id && tps[tp.id]) {
          match = { igName, ...tps[tp.id], viaStableId: false };
          break;
        }
      }
      if (match) {
        out.set(tp.id, {
          kind: 'update',
          specKey: match.specKey,
          specName: match.name,
          igName: match.igName,
          lastDeployedAt: match.lastDeployedAt,
          viaStableId: match.viaStableId,
        });
      } else {
        out.set(tp.id, { kind: 'new' });
      }
    }
    return out;
  }, [discovery, appState.importedIGs]);

  // ── Scope columns ──
  // One table column per scope *kind* present in the package. Today that's Actor;
  // when plans start scoping to a transaction, that column appears on its own with
  // no change here — the kind and its label come from the discovery payload.
  const SCOPE_KIND_ORDER = ['transaction', 'actor'];
  const scopeColumns = useMemo(() => {
    const byKind = new Map<string, string>();
    for (const tp of discovery?.test_plans || []) {
      for (const s of tp.scope || []) {
        const kind = s.kind || 'unknown';
        if (!byKind.has(kind)) byKind.set(kind, s.kindLabel || 'Scope');
      }
    }
    // Always show Actor, even if a package has none — its absence is meaningful.
    if (!byKind.has('actor')) byKind.set('actor', 'Actor');
    return [...byKind.entries()]
      .map(([kind, label]) => ({ kind, label }))
      .sort((a, b) => {
        const ai = SCOPE_KIND_ORDER.indexOf(a.kind);
        const bi = SCOPE_KIND_ORDER.indexOf(b.kind);
        if (ai !== bi) return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
        return a.label.localeCompare(b.label);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discovery]);

  // ── Selection / compile / deploy ──
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [compiling, setCompiling] = useState<Set<string>>(new Set());
  const [compiled, setCompiled] = useState<Record<string, { zip_base64: string; zip_size: number }>>({});
  const [compileErrors, setCompileErrors] = useState<Record<string, CompileError>>({});
  const [deploying, setDeploying] = useState(false);
  const [deployErrors, setDeployErrors] = useState<Record<string, string>>({});
  /** Non-fatal TDL validation warnings ITB reported per plan, shown after deploy. */
  const [deployWarnings, setDeployWarnings] = useState<Record<string, string[]>>({});
  /** Actors ITB created for the deployed plans — these are what matching binds systems to. */
  const [deployedActors, setDeployedActors] = useState<{ actorId: string; actorApiKey: string }[]>([]);
  const [deployedSpec, setDeployedSpec] = useState<{ key: string; name: string } | null>(null);

  // ── Reimport handoff (from Spec detail page) ──
  useEffect(() => {
    const raw = sessionStorage.getItem('itm:reimport');
    if (!raw) return;
    sessionStorage.removeItem('itm:reimport');
    try {
      const h = JSON.parse(raw);
      if (h.url) { setUrl(h.url); setTab('url'); }
      if (h.specKey) {
        setTargetMode('existing');
        setExistingSpecKey(h.specKey);
        setDomainTouched(true);  // honour the spec the user came from
      }
    } catch { /* ignore */ }
  }, []);

  // ── Load domains for the picker ──
  useEffect(() => {
    fetch('/api/domains').then(r => r.ok ? r.json() : []).then((d: DomainOption[]) => {
      setDomains(d || []);
      // Auto-pick if exactly one domain and user hasn't chosen one yet.
      if (!domainKey && !domainTouched && (d || []).length === 1) {
        setDomainKey(d[0].apiKey);
      }
    }).catch(() => setDomains([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Domain hint from IG name (best-effort heuristic, only if user hasn't chosen) ──
  useEffect(() => {
    if (!discovery || domainTouched) return;
    if (domains.length === 0) return;
    if (domainKey) return;  // already set (e.g. from appState)

    const igLower = (discovery.ig_name || '').toLowerCase();
    const hit = domains.find(d => {
      const sn = (d.shortName || '').toLowerCase();
      if (!sn) return false;
      return igLower.includes('.' + sn + '.')
        || igLower.endsWith('.' + sn)
        || igLower.startsWith(sn + '.');
    });
    if (hit) setDomainKey(hit.apiKey);
    else if (appState.domainKey) setDomainKey(appState.domainKey);
  }, [discovery, domains, domainKey, domainTouched, appState.domainKey]);

  // ── Load specs in chosen domain (for "replace existing" picker) ──
  useEffect(() => {
    if (!domainKey) { setDomainSpecs([]); return; }
    fetch(`/api/domains/${domainKey}/specifications`)
      .then(r => r.ok ? r.json() : [])
      .then((s: SpecOption[]) => setDomainSpecs(s || []))
      .catch(() => setDomainSpecs([]));
  }, [domainKey]);

  // ── Auto-flip Target based on detection. Runs whenever detection or selection
  // changes, but only if the user hasn't manually touched the Target panel.
  // If every selected TestPlan maps to the *same* existing Specification → switch
  // to "Update existing" with that spec preselected. Otherwise leave alone.
  useEffect(() => {
    if (!discovery || targetTouched) return;
    if (selected.size === 0) return;
    const distinctSpecs = new Set<string>();
    for (const id of selected) {
      const det = detectionMap.get(id);
      if (det?.kind !== 'update') return;  // any "new" → can't auto-update
      distinctSpecs.add(det.specKey);
    }
    if (distinctSpecs.size === 1) {
      const onlySpec = [...distinctSpecs][0];
      setTargetMode('existing');
      setExistingSpecKey(onlySpec);
    }
  }, [detectionMap, selected, discovery, targetTouched]);

  // ── Discover the IG ──
  const discover = async () => {
    setDiscovering(true);
    setDiscoverError('');
    setDiscovery(null);
    setSelected(new Set());
    setCompiled({});
    setCompileErrors({});
    setDeployErrors({});
    try {
      let r: Response;
      if (tab === 'file' && file) {
        const form = new FormData();
        form.append('file', file);
        r = await fetch('/api/ig/upload/discover', { method: 'POST', body: form });
      } else {
        r = await fetch('/api/ig/discover', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
      }
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.detail || `HTTP ${r.status}`);
      }
      const d: Discovery = await r.json();
      setDiscovery(d);
      // Plans with a blocking problem (no suite, unresolvable script) are listed
      // with the reason but never preselected — they can't compile.
      setSelected(new Set(d.test_plans.filter(tp => tp.importable !== false).map(tp => tp.id)));
      // Suggest a spec name from the IG if we don't have one yet.
      if (!newSpecName) setNewSpecName(d.ig_name || '');
    } catch (e: any) {
      setDiscoverError(e.message);
    }
    setDiscovering(false);
  };

  // ── Compile selected plans ──
  const compileOne = async (tp: TestPlan): Promise<{ zip_base64: string; zip_size: number } | { error: CompileError }> => {
    const itbZipSuite = tp.suites?.find(s => s.type === 'itb-zip' && s.itb_zip_base64);
    if (itbZipSuite?.itb_zip_base64) {
      const zipBytes = atob(itbZipSuite.itb_zip_base64);
      return { zip_base64: itbZipSuite.itb_zip_base64, zip_size: zipBytes.length };
    }

    const gherkinSuite = tp.suites?.find(s => s.type === 'gherkin' && s.gherkin_content);
    const gherkinContent = gherkinSuite?.gherkin_content;
    if (!gherkinContent && (!tp.raw_json || Object.keys(tp.raw_json).length === 0)) {
      return { error: { message: 'No Gherkin content or TestPlan JSON', issues: [] } };
    }
    try {
      const r = gherkinContent
        ? await fetch('/api/compile', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: gherkinContent })
        : await fetch('/api/compile/testplan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(tp.raw_json) });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        return { error: {
          message: e.error || `HTTP ${r.status}`,
          issues: Array.isArray(e.issues) ? e.issues : [],
          gherkin: gherkinContent,
        } };
      }
      const blob = await r.blob();
      const buf = await blob.arrayBuffer();
      const arr = new Uint8Array(buf);
      let binStr = '';
      for (let i = 0; i < arr.length; i++) binStr += String.fromCharCode(arr[i]);
      return { zip_base64: btoa(binStr), zip_size: buf.byteLength };
    } catch (e: any) {
      return { error: { message: e.message, issues: [], gherkin: gherkinContent } };
    }
  };

  const compileSelected = async () => {
    if (!discovery) return;
    const ids = [...selected].filter(id => !compiled[id]);
    if (ids.length === 0) return;
    setCompiling(new Set(ids));
    const newCompiled = { ...compiled };
    const newErrors = { ...compileErrors };
    for (const id of ids) {
      const tp = discovery.test_plans.find(t => t.id === id);
      if (!tp) continue;
      const result = await compileOne(tp);
      if ('error' in result) {
        newErrors[id] = result.error;
        delete newCompiled[id];
      } else {
        newCompiled[id] = result;
        delete newErrors[id];
      }
    }
    setCompiled(newCompiled);
    setCompileErrors(newErrors);
    setCompiling(new Set());
  };

  const recompileOne = async (id: string) => {
    const tp = discovery?.test_plans.find(t => t.id === id);
    if (!tp) return;
    setCompiling(prev => new Set(prev).add(id));
    const result = await compileOne(tp);
    setCompiled(prev => {
      const next = { ...prev };
      if ('error' in result) delete next[id]; else next[id] = result;
      return next;
    });
    setCompileErrors(prev => {
      const next = { ...prev };
      if ('error' in result) next[id] = result.error; else delete next[id];
      return next;
    });
    setCompiling(prev => { const n = new Set(prev); n.delete(id); return n; });
  };

  // ── Pre-flight ──
  // The community key can arrive from either side: the browser's own config
  // (localStorage over VITE_ env defaults) or the server's state.json, which is
  // what the dev-server middleware uses and what the settings dialog displays.
  // Checking only itbConfig reported it missing while the dialog showed it.
  const communityKey = appState.communityApiKey || itbConfig.communityApiKey || itbConfig.apiKey || '';
  const noCommunity = !communityKey;
  const noBaseUrl = !itbConfig.baseUrl;
  const haveCompiled = Object.keys(compiled).length;
  const targetReady = !noCommunity && !noBaseUrl && !!domainKey && (
    targetMode === 'new' ? !!newSpecName.trim() : !!existingSpecKey
  );

  const targetDomain = useMemo(() => domains.find(d => d.apiKey === domainKey), [domains, domainKey]);
  const targetSpec = useMemo(() => domainSpecs.find(s => s.apiKey === existingSpecKey), [domainSpecs, existingSpecKey]);
  const sameAsAppDomain = appState.domainKey && appState.domainKey === domainKey;

  // ── Deploy ──
  const deploy = async () => {
    if (!discovery) return;
    setDeploying(true);
    const newDeployErrors: Record<string, string> = {};
    const newDeployWarnings: Record<string, string[]> = {};
    const deployedSpecKeys: string[] = [];
    let landingSpecKey = '';
    let landingSpecName = '';

    // Same fallback as the pre-flight check — otherwise a key that only reached
    // server state would pass the banner and then deploy with an empty header.
    const deployKey = communityKey;
    const baseUrl = itbConfig.baseUrl.replace(/\/+$/, '');

    try {
      let specId = '';
      let specName = '';

      if (targetMode === 'existing') {
        specId = existingSpecKey;
        specName = targetSpec?.fullName || targetSpec?.shortName || '';
        if (!specId) throw new Error('Pick a specification to update');
        // The target may come from recorded provenance (the "★ Update of …" badge),
        // which keeps pointing at a specification key even after someone deletes that
        // specification in ITB. Deploying into a dead key fails obscurely, so check.
        const probe = await fetch(
          `/itb-proxy/${encodeURIComponent(baseUrl)}/api/rest/specification/${encodeURIComponent(specId)}`,
          { headers: { 'ITB_API_KEY': deployKey } },
        ).catch(() => null);
        if (!probe || !probe.ok) {
          throw new Error(
            `The target specification no longer exists in ITB (key ${specId}). `
            + `It was remembered from a previous import — pick "Create new" or choose another specification.`,
          );
        }
      } else {
        specName = newSpecName.trim() || discovery.ig_name || 'Specification';
        const createResp = await fetch(
          `/itb-proxy/${encodeURIComponent(baseUrl)}/api/rest/specification`,
          {
            method: 'PUT',
            headers: { 'ITB_API_KEY': deployKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              shortName: specName,
              fullName: specName,
              description: `Created from IG import: ${discovery.ig_name || ''}`.trim(),
              domain: domainKey,
              hidden: false,
              displayOrder: 0,
            }),
          },
        );
        if (!createResp.ok) {
          throw new Error(`Failed to create specification (${createResp.status}): ${await createResp.text()}`);
        }
        specId = (await createResp.json()).apiKey || '';
        if (!specId) throw new Error('ITB did not return a specification API key');
      }
      landingSpecKey = specId;
      landingSpecName = specName;

      // Push each compiled test suite into that spec.
      let lastDeployResult: any = null;
      // actor identifiers ITB reports back per deployed plan, so we can bind each
      // plan's conformance statement to the actor its TestPlan.scope names.
      // CAREFUL: `identifier` means different things on the two ITB endpoints.
      // In the deploy response, actors[].name is the actor id (MedicationOverviewConsumer)
      // and actors[].identifier is its API key. On /specification/{key}/actors it is the
      // other way round — `identifier` is the actor id and `apiKey` is the key.
      const deployedActorsByPlan: Record<string, { name: string; apiKey: string }[]> = {};
      for (const id of Object.keys(compiled)) {
        const b64 = compiled[id].zip_base64;
        const binStr = atob(b64);
        const bytes = new Uint8Array(binStr.length);
        for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
        const zipFile = new File([bytes], `${id}.zip`, { type: 'application/zip' });

        const formData = new FormData();
        formData.append('updateSpecification', 'true');
        formData.append('specification', specId);
        // ITB rejects any archive that produces validation warnings unless told not
        // to, and generated suites routinely warn (e.g. a handler input it doesn't
        // recognise). We accept them and surface them below rather than losing the
        // deploy — warnings are reported, not swallowed.
        formData.append('ignoreWarnings', 'true');
        formData.append('testSuite', zipFile);

        try {
          const resp = await fetch(
            `/itb-proxy/${encodeURIComponent(baseUrl)}${itbConfig.deployPath}`,
            { method: 'POST', headers: { 'ITB_API_KEY': deployKey }, body: formData },
          );
          if (!resp.ok) throw new Error(`Deploy failed (${resp.status}): ${await resp.text()}`);
          const result = await resp.json();
          // ITB answers 200 even when it *rejects* the archive — the verdict is
          // `completed`, not the status code. Checking resp.ok alone reported a
          // rejected suite as deployed and it silently never appeared in ITB.
          if (result?.completed === false) {
            const reasons = (result.errors || []).map((e: any) => e.description).filter(Boolean);
            throw new Error(
              `ITB rejected the test suite: ${reasons.length ? reasons.join(' | ') : 'no reason given'}`,
            );
          }
          const warnings = (result?.warnings || []).map((w: any) => w.description).filter(Boolean);
          if (warnings.length) newDeployWarnings[id] = warnings;
          lastDeployResult = result;
          deployedActorsByPlan[id] = ((lastDeployResult.identifiers?.specifications || []) as any[])
            .flatMap(s => (s.actors || []))
            .map((a: any) => ({ name: a.name || '', apiKey: a.identifier || '' }))
            .filter((a: any) => a.name);
        } catch (e: any) {
          newDeployErrors[id] = e.message;
        }
      }
      deployedSpecKeys.push(specId);

      // Best-effort post-deploy ITB plumbing (system + conformance), then ID resolution.
      //
      // Which actor is the SUT comes from each plan's `TestPlan.scope`, not from the
      // actor's name: a real IG names its actors after CapabilityStatements
      // (MedicationOverviewConsumer, …), so the old name === 'User' | 'SUT' guess
      // missed and fell through to actors[0] — which could be the validator.
      if (lastDeployResult) {
        try {
          // Ask for the actors of the spec we just deployed into, not the one
          // configured in settings.
          const actors = await getSpecificationActors(itbConfig, specId);
          // On this endpoint `identifier` IS the actor id (see note above).
          const actorIdOf = (a: any) => a?.identifier || a?.actorId || '';

          // actor id → API key, for every plan whose scope named an actor.
          const bound = new Map<string, string>();
          for (const id of Object.keys(compiled)) {
            if (newDeployErrors[id]) continue;
            const tp = discovery.test_plans.find(t => t.id === id);
            const deployed = deployedActorsByPlan[id] || [];
            const sutActorId = resolveSutActorId(tp, deployed.map(a => a.name));
            if (!sutActorId) continue;
            const apiKey = deployed.find(a => a.name === sutActorId)?.apiKey
              || actors.find(a => actorIdOf(a) === sutActorId)?.apiKey
              || '';
            if (apiKey) bound.set(sutActorId, apiKey);
          }

          // /api/itb-ids resolves the numeric id from the actor *id*, not its key.
          const firstActorId = [...bound.keys()][0] || '';
          await resolveITBIds(itbConfig, lastDeployResult, firstActorId);

          const systemKey = await ensureSystem(itbConfig);
          const matchable: { actorId: string; actorApiKey: string }[] = [];
          for (const [actorId, actorApiKey] of bound) {
            matchable.push({ actorId, actorApiKey });
            if (systemKey) await ensureConformance(itbConfig, systemKey, actorApiKey);
          }
          // Fall back to ITB's own default only when scope told us nothing at all.
          if (matchable.length === 0) {
            const fallback = actors.find(a => a.default) || actors[0];
            if (fallback?.apiKey) {
              matchable.push({ actorId: actorIdOf(fallback), actorApiKey: fallback.apiKey });
              if (systemKey) await ensureConformance(itbConfig, systemKey, fallback.apiKey);
            }
          }
          setDeployedActors(matchable);
        } catch { /* non-fatal */ }
      }

      // Persist provenance for the Spec detail page + per-TestPlan re-import detection.
      // Build a testPlans map keyed by stable identifier (preferred — durable across IG
      // versions) or `id` (fallback). Each successfully-deployed TestPlan maps to the
      // landingSpecKey it landed in.
      const testPlansPayload: Record<string, { specKey: string; name: string; lastDeployedAt: string }> = {};
      const nowIso = new Date().toISOString();
      for (const id of Object.keys(compiled)) {
        if (newDeployErrors[id]) continue;  // skip plans whose deploy failed
        const tp = discovery.test_plans.find(t => t.id === id);
        if (!tp) continue;
        const key = tp.stableId || tp.id;
        if (!key) continue;
        testPlansPayload[key] = {
          specKey: landingSpecKey,
          name: tp.name || '',
          lastDeployedAt: nowIso,
        };
      }

      if (deployedSpecKeys.length) {
        try {
          await fetch('/api/igs/record', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              key: discovery.ig_name || landingSpecKey,
              version: discovery.ig_version || '',
              url: discovery.ig_url || (tab === 'url' ? url : ''),
              spec_keys: deployedSpecKeys,
              testPlans: testPlansPayload,
            }),
          });
          await refreshState();
        } catch { /* non-fatal */ }
      }
    } catch (e: any) {
      newDeployErrors['__top__'] = e.message;
    }

    setDeployErrors(newDeployErrors);
    setDeployWarnings(newDeployWarnings);
    setDeploying(false);

    const fatal = newDeployErrors['__top__'];
    const allFailed = !fatal && Object.keys(compiled).every(id => newDeployErrors[id]);
    if (!fatal && !allFailed && landingSpecKey) {
      sessionStorage.setItem('itm:just-created', landingSpecKey);
      selectSpec(landingSpecKey, landingSpecName);
      // Stay on the page and show what landed — the deployed actors are the ones
      // peer-to-peer matching binds systems to, so that handoff belongs here rather
      // than behind a jump to the spec page.
      setDeployedSpec({ key: landingSpecKey, name: landingSpecName });
    }
  };

  // ── Render helpers ──
  const shortRef = (ref: string) => ref.split('/').pop() || ref;

  const GherkinErrorView: React.FC<{ err: CompileError }> = ({ err }) => {
    const lines = (err.gherkin || '').split('\n');
    const errorLines = new Set(err.issues.filter(i => i.severity === 'error' && i.line).map(i => i.line!));
    const copy = () => {
      navigator.clipboard?.writeText(err.gherkin || '').catch(() => {});
    };
    return (
      <div className="mt-2 border border-red-300 dark:border-red-800 rounded-lg overflow-hidden bg-red-50/50 dark:bg-red-900/10">
        <div className="px-3 py-2 border-b border-red-200 dark:border-red-800 flex items-start gap-2 bg-red-50 dark:bg-red-900/20">
          <AlertCircle size={14} className="text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-red-800 dark:text-red-300">{err.message}</div>
            {err.issues.length > 0 && (
              <ul className="mt-1 text-xs text-red-700 dark:text-red-400 space-y-0.5">
                {err.issues.filter(i => i.severity === 'error').map((i, k) => (
                  <li key={k}>Line {i.line ?? '?'}: {i.message}</li>
                ))}
              </ul>
            )}
          </div>
          {err.gherkin && (
            <button onClick={copy} className="flex items-center gap-1 px-2 py-1 text-xs bg-white dark:bg-slate-800 border border-red-200 dark:border-red-700 rounded hover:bg-red-50 dark:hover:bg-red-900/30 text-red-700 dark:text-red-300">
              <Copy size={11} /> Copy Gherkin
            </button>
          )}
        </div>
        {err.gherkin && (
          <pre className="text-[11px] leading-5 font-mono overflow-auto max-h-72 bg-white dark:bg-slate-950">
            {lines.map((line, i) => {
              const lineNo = i + 1;
              const isErr = errorLines.has(lineNo);
              return (
                <div key={lineNo} className={`flex ${isErr ? 'bg-red-100 dark:bg-red-900/30 border-l-2 border-red-500' : ''}`}>
                  <span className="select-none px-2 py-0 text-gray-400 dark:text-slate-500 text-right w-10 flex-shrink-0">{lineNo}</span>
                  <span className={`flex-1 whitespace-pre px-2 ${isErr ? 'text-red-900 dark:text-red-300' : 'text-gray-800 dark:text-gray-200'}`}>{line || ' '}</span>
                </div>
              );
            })}
          </pre>
        )}
      </div>
    );
  };

  // ── Final render ──
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-2 mb-2">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Add Specification</h1>
      </div>
      <p className="text-sm text-gray-500 dark:text-slate-400 mb-5">
        Import a FHIR Implementation Guide and deploy its test plans to ITB as a Specification.
      </p>

      {/* Pre-flight banner */}
      {(noCommunity || noBaseUrl) && (
        <div className="mb-4 flex items-start gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
          <AlertCircle size={18} className="text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1 text-sm">
            <div className="font-semibold text-amber-800 dark:text-amber-300">ITB connection not configured</div>
            <div className="text-amber-700 dark:text-amber-400 mt-0.5">
              {noBaseUrl && 'Missing ITB base URL. '}
              {noCommunity && 'No community API key. Get it from ITB → Communities → your community → API key. (The domain has its own key that looks identical and will not work here.)'}
            </div>
          </div>
          <button onClick={() => setITBSettingsOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white rounded text-sm hover:bg-amber-700">
            <Settings size={13} /> Open ITB Settings
          </button>
        </div>
      )}

      {/* ── 1. Target ── */}
      <SidePanel icon={FileCheck} title="Target"
        status={targetReady && (
          <span className="text-xs text-green-700 dark:text-green-400 flex items-center gap-1">
            <Check size={11} /> Ready
          </span>
        )}>
        <div className="space-y-3">
          {/* Domain */}
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Domain</label>
            <div className="flex items-center gap-2">
              <Globe size={14} className="text-blue-500 flex-shrink-0" />
              <select value={domainKey}
                onChange={e => { setDomainKey(e.target.value); setDomainTouched(true); }}
                className="flex-1 px-2 py-1.5 border border-gray-300 dark:border-slate-600 rounded text-sm bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">— Pick a domain —</option>
                {domains.map(d => (
                  <option key={d.apiKey} value={d.apiKey}>{d.fullName || d.shortName}</option>
                ))}
              </select>
              {!domainTouched && domainKey && (
                <span className="text-[10px] text-blue-600 dark:text-blue-400 flex-shrink-0" title={sameAsAppDomain ? 'Active domain in app' : 'Picked from IG hint'}>
                  {sameAsAppDomain ? 'active' : 'auto'}
                </span>
              )}
            </div>
            {!domainKey && domains.length === 0 && (
              <div className="text-xs text-amber-600 dark:text-amber-400 mt-1">No domains in this community. Create one first.</div>
            )}
          </div>

          {/* Mode */}
          <div className="grid grid-cols-2 gap-2">
            <label className={`flex items-start gap-2 p-2.5 rounded border cursor-pointer transition-colors ${targetMode === 'new' ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800/50'}`}>
              <input type="radio" name="targetMode" checked={targetMode === 'new'} onChange={() => { setTargetMode('new'); setTargetTouched(true); }} className="mt-1" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 dark:text-white">Create new specification</div>
                {targetMode === 'new' && (
                  <input value={newSpecName} onChange={e => setNewSpecName(e.target.value)}
                    placeholder="e.g. Belgian Vaccination"
                    className="mt-1.5 w-full px-2 py-1 border border-gray-300 dark:border-slate-600 rounded text-sm bg-white dark:bg-slate-800 text-gray-900 dark:text-white" />
                )}
              </div>
            </label>
            <label className={`flex items-start gap-2 p-2.5 rounded border cursor-pointer transition-colors ${targetMode === 'existing' ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800/50'}`}>
              <input type="radio" name="targetMode" checked={targetMode === 'existing'} onChange={() => { setTargetMode('existing'); setTargetTouched(true); }} className="mt-1" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 dark:text-white">Update existing specification</div>
                {targetMode === 'existing' && (
                  <select value={existingSpecKey} onChange={e => { setExistingSpecKey(e.target.value); setTargetTouched(true); }}
                    disabled={!domainKey}
                    className="mt-1.5 w-full px-2 py-1 border border-gray-300 dark:border-slate-600 rounded text-sm bg-white dark:bg-slate-800 text-gray-900 dark:text-white disabled:opacity-50">
                    <option value="">{domainKey ? '— Pick a spec —' : 'Pick a domain first'}</option>
                    {domainSpecs.map(s => (
                      <option key={s.apiKey} value={s.apiKey}>{s.fullName || s.shortName}</option>
                    ))}
                  </select>
                )}
              </div>
            </label>
          </div>
        </div>
      </SidePanel>

      {/* ── 2. Source ── */}
      <SidePanel icon={PackagePlus} title="Source"
        status={discovery && (
          <span className="text-xs text-green-700 dark:text-green-400 flex items-center gap-1">
            <Check size={11} /> {discovery.ig_name} v{discovery.ig_version}
          </span>
        )}>
        <div className="flex gap-2 mb-3">
          <button onClick={() => setTab('url')} className={`flex items-center gap-1 px-3 py-1.5 rounded text-sm ${tab === 'url' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800'}`}>
            <LinkIcon size={14} /> From URL
          </button>
          <button onClick={() => setTab('file')} className={`flex items-center gap-1 px-3 py-1.5 rounded text-sm ${tab === 'file' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800'}`}>
            <Upload size={14} /> Upload .tgz
          </button>
        </div>
        {tab === 'url' ? (
          <div className="flex gap-2">
            <input value={url} onChange={e => setUrl(e.target.value)}
              placeholder="https://example.org/ig/  or  package.id#version"
              className="flex-1 px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <button onClick={discover} disabled={!url || discovering}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
              {discovering ? <Loader2 size={14} className="animate-spin" /> : <PackagePlus size={14} />}
              Fetch IG
            </button>
          </div>
        ) : (
          <div className="flex gap-2 items-center">
            <input ref={fileRef} type="file" accept=".tgz,.tar.gz" onChange={e => setFile(e.target.files?.[0] || null)}
              className="flex-1 text-sm text-gray-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-blue-50 file:text-blue-700 dark:file:bg-blue-900/30 dark:file:text-blue-400 file:text-sm file:font-medium" />
            <button onClick={discover} disabled={!file || discovering}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
              {discovering ? <Loader2 size={14} className="animate-spin" /> : <PackagePlus size={14} />}
              Analyze
            </button>
          </div>
        )}
        {discoverError && (
          <div className="mt-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400 flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
            <span>{discoverError}</span>
          </div>
        )}
        {discovery && (
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div><span className="text-gray-500 dark:text-slate-400">Package: </span><code className="text-gray-800 dark:text-slate-200">{discovery.ig_name}</code></div>
            <div><span className="text-gray-500 dark:text-slate-400">Version: </span><code className="text-gray-800 dark:text-slate-200">{discovery.ig_version || '—'}</code></div>
            <div><span className="text-gray-500 dark:text-slate-400">FHIR: </span><code className="text-gray-800 dark:text-slate-200">{discovery.fhir_version || '—'}</code></div>
            <div><span className="text-gray-500 dark:text-slate-400">Test plans: </span><code className="text-gray-800 dark:text-slate-200">{discovery.test_plans.length}</code></div>
            {discovery.dependencies?.length > 0 && (
              <div className="col-span-2 mt-1">
                <span className="text-gray-500 dark:text-slate-400">Dependencies: </span>
                {discovery.dependencies.map(d => <code key={d} className="ml-1 text-[10px] bg-gray-100 dark:bg-slate-800 px-1 rounded">{d}</code>)}
              </div>
            )}
          </div>
        )}
      </SidePanel>

      {/* ── 3. Test Plans ── */}
      {discovery && (
        <SidePanel icon={Code} title={`Test plans (${selected.size}/${discovery.test_plans.length} selected)`}
          status={
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                <input type="checkbox" checked={selected.size === discovery.test_plans.length}
                  onChange={e => setSelected(e.target.checked ? new Set(discovery.test_plans.map(t => t.id)) : new Set())}
                  className="rounded" /> Select all
              </label>
              <button onClick={compileSelected}
                disabled={compiling.size > 0 || selected.size === 0 || [...selected].every(id => compiled[id])}
                className="flex items-center gap-1.5 px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 disabled:opacity-50">
                {compiling.size > 0 ? <Loader2 size={11} className="animate-spin" /> : <Code size={11} />}
                Compile
              </button>
            </div>
          }>
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
                  <th className="w-8 px-4 py-2"></th>
                  <th className="px-2 py-2 font-semibold">Test plan</th>
                  {scopeColumns.map(c => (
                    <th key={c.kind} className="px-2 py-2 font-semibold whitespace-nowrap">{c.label}</th>
                  ))}
                  <th className="px-2 py-2 font-semibold text-right whitespace-nowrap">Tests</th>
                  <th className="px-2 py-2 font-semibold whitespace-nowrap">Status</th>
                  <th className="w-8 px-2 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                {discovery.test_plans.map(tp => {
                  const isSel = selected.has(tp.id);
                  const isCompiling = compiling.has(tp.id);
                  const isCompiled = !!compiled[tp.id];
                  const error = compileErrors[tp.id];
                  const detection = detectionMap.get(tp.id);
                  const blocked = tp.importable === false;
                  const isOpen = expanded.has(tp.id);
                  const testCount = tp.suites.reduce((n, s) => n + (s.tests?.length || 0), 0);
                  const hasDetail = !!tp.description || (tp.problems || []).length > 0 || !!error
                    || tp.suites.length > 0 || (tp.modes || []).length > 0 || !!tp.runner;
                  return (
                    <React.Fragment key={tp.id}>
                      <tr className={blocked ? 'opacity-60' : ''}>
                        <td className="px-4 py-2.5 align-top">
                          <input type="checkbox" checked={isSel} disabled={blocked} onChange={e => {
                            const s = new Set(selected);
                            e.target.checked ? s.add(tp.id) : s.delete(tp.id);
                            setSelected(s);
                          }} className="mt-0.5 rounded disabled:cursor-not-allowed" />
                        </td>

                        <td className="px-2 py-2.5 align-top">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-medium text-gray-900 dark:text-white">{tp.name}</span>
                            {tp.type === 'itb-zip' && <span className="text-[10px] bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 px-1.5 py-0.5 rounded-full">Pre-built ZIP</span>}
                            {tp.type === 'gherkin' && <span className="text-[10px] bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded-full">Gherkin</span>}
                            {detection?.kind === 'new' && (
                              <span className="text-[10px] bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-1.5 py-0.5 rounded-full" title="No matching TestPlan in any previously-imported IG">
                                ✦ New
                              </span>
                            )}
                            {detection?.kind === 'update' && (
                              <span
                                className="text-[10px] bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300 px-1.5 py-0.5 rounded-full"
                                title={`Previously imported under IG "${detection.igName}"${detection.lastDeployedAt ? ` on ${new Date(detection.lastDeployedAt).toLocaleString()}` : ''} — ${detection.viaStableId ? 'matched by stable identifier' : 'matched by id within same IG'}`}>
                                ★ Update of {detection.specName ? `"${detection.specName}"` : 'existing spec'}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* One cell per scope kind — Actor today, Transaction when plans carry one. */}
                        {scopeColumns.map(c => {
                          const hits = tp.scope.filter(s => (s.kind || 'unknown') === c.kind);
                          return (
                            <td key={c.kind} className="px-2 py-2.5 align-top">
                              {hits.length === 0
                                ? <span className="text-gray-300 dark:text-slate-600">—</span>
                                : (
                                  <div className="flex flex-col gap-1 items-start">
                                    {hits.map((s, k) => (
                                      <span key={k}
                                        className="text-xs bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.5 rounded whitespace-nowrap"
                                        title={s.description ? `${s.reference}\n\n${s.description}` : s.reference}>
                                        {s.name || shortRef(s.reference)}
                                      </span>
                                    ))}
                                  </div>
                                )}
                            </td>
                          );
                        })}

                        <td className="px-2 py-2.5 align-top text-right tabular-nums text-gray-600 dark:text-slate-400">
                          {testCount || <span className="text-gray-300 dark:text-slate-600">—</span>}
                        </td>

                        <td className="px-2 py-2.5 align-top whitespace-nowrap">
                          {isCompiling && <span className="text-xs text-gray-500 dark:text-slate-400 flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> Compiling…</span>}
                          {!isCompiling && isCompiled && (
                            <span className="text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-1.5 py-0.5 rounded-full inline-flex items-center gap-1">
                              <Check size={10} /> Ready ({compiled[tp.id].zip_size.toLocaleString()} B)
                            </span>
                          )}
                          {!isCompiling && error && (
                            <span className="text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 px-1.5 py-0.5 rounded-full inline-flex items-center gap-1">
                              <AlertCircle size={10} /> Error
                            </span>
                          )}
                          {!isCompiling && !isCompiled && !error && blocked && (
                            <span className="text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 px-1.5 py-0.5 rounded-full inline-flex items-center gap-1">
                              <AlertCircle size={10} /> Cannot import
                            </span>
                          )}
                          {!isCompiling && !isCompiled && !error && !blocked && (
                            <span className="text-xs text-gray-400 dark:text-slate-500">Not compiled</span>
                          )}
                          {(error || isCompiled) && (
                            <button onClick={() => recompileOne(tp.id)} disabled={isCompiling}
                              title="Recompile"
                              className="ml-1.5 text-xs text-gray-400 hover:text-blue-600 disabled:opacity-50 align-middle">
                              <RotateCw size={11} className={isCompiling ? 'animate-spin' : ''} />
                            </button>
                          )}
                        </td>

                        <td className="px-2 py-2.5 align-top">
                          {hasDetail && (
                            <button
                              onClick={() => setExpanded(prev => {
                                const n = new Set(prev);
                                n.has(tp.id) ? n.delete(tp.id) : n.add(tp.id);
                                return n;
                              })}
                              title={isOpen ? 'Hide details' : 'Show details'}
                              className="text-gray-400 hover:text-blue-600">
                              <ChevronRight size={14} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                            </button>
                          )}
                        </td>
                      </tr>

                      {isOpen && (
                        <tr>
                          <td />
                          <td colSpan={scopeColumns.length + 4} className="px-2 pb-3 pt-0 align-top">
                            {tp.description && <Markdown className="text-xs text-gray-500 dark:text-slate-400 mb-2">{tp.description}</Markdown>}
                            <div className="flex flex-wrap gap-1">
                              {tp.suites.map((s, k) => (
                                <span key={k} className="text-xs bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-400 px-1.5 py-0.5 rounded"
                                  title={s.gherkin_file ? `from ${s.gherkin_file}` : ''}>
                                  {s.name} ({s.tests?.length || 0} tests){s.mode ? ` · mode: ${s.mode}` : ''}
                                </span>
                              ))}
                              {(tp.modes || []).map((m, k) => (
                                <span key={k} className="text-xs bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400 px-1.5 py-0.5 rounded" title={m.description || ''}>
                                  mode: {m.code}
                                </span>
                              ))}
                              {tp.runner && (
                                <span className="text-xs text-gray-400 dark:text-slate-500 px-1.5 py-0.5" title={`TestPlan.runner: ${tp.runner}`}>
                                  runner: {shortRef(tp.runner)}
                                </span>
                              )}
                            </div>
                            {(tp.problems || []).length > 0 && (
                              <ul className="mt-2 space-y-0.5">
                                {(tp.problems || []).map((p, k) => (
                                  <li key={k} className={`text-xs flex items-start gap-1.5 ${
                                    p.severity === 'error' ? 'text-red-700 dark:text-red-400'
                                    : p.severity === 'warning' ? 'text-amber-700 dark:text-amber-400'
                                    : 'text-gray-500 dark:text-slate-400'}`}>
                                    <AlertCircle size={11} className="mt-0.5 flex-shrink-0" />
                                    <span>{p.message}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                            {error && <GherkinErrorView err={error} />}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SidePanel>
      )}

      {/* ── 4. Preview & Deploy ── */}
      {haveCompiled > 0 && (
        <SidePanel icon={ChevronRight} title="Preview & Deploy">
          <div className="space-y-3">
            {!targetReady && (
              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-sm text-amber-800 dark:text-amber-300">
                Set a target above before deploying.
              </div>
            )}
            <div className="bg-gray-50 dark:bg-slate-800/50 rounded-lg border border-gray-200 dark:border-slate-700 p-3 text-sm">
              <div className="font-semibold text-gray-900 dark:text-white mb-2">When you click Deploy, ITB will:</div>
              <ul className="space-y-1.5 text-gray-700 dark:text-slate-300">
                {targetMode === 'new' ? (
                  <li className="flex items-start gap-2">
                    <span className="text-blue-500 mt-0.5">•</span>
                    Create specification <strong>{newSpecName.trim() || '(unnamed)'}</strong> in domain <strong>{targetDomain?.fullName || targetDomain?.shortName || '(none)'}</strong>
                  </li>
                ) : (
                  <li className="flex items-start gap-2">
                    <span className="text-blue-500 mt-0.5">•</span>
                    Update specification <strong>{targetSpec?.fullName || targetSpec?.shortName || '(none)'}</strong> in domain <strong>{targetDomain?.fullName || targetDomain?.shortName || '(none)'}</strong>
                  </li>
                )}
                <li className="flex items-start gap-2">
                  <span className="text-blue-500 mt-0.5">•</span>
                  Push <strong>{haveCompiled} test suite{haveCompiled === 1 ? '' : 's'}</strong> ({Object.values(compiled).reduce((s, c) => s + c.zip_size, 0).toLocaleString()} B) into that specification
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-500 mt-0.5">•</span>
                  Register your community as a tester (system + conformance statement) so you can run the suites
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-500 mt-0.5">•</span>
                  Record provenance ({discovery?.ig_name} v{discovery?.ig_version || '—'}) so you can re-import later
                </li>
              </ul>
            </div>

            {Object.keys(deployErrors).length > 0 && (
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-800 dark:text-red-300">
                <div className="font-semibold mb-1">Some operations failed:</div>
                <ul className="space-y-0.5">
                  {Object.entries(deployErrors).map(([k, v]) => (
                    <li key={k}><code className="text-xs">{k === '__top__' ? 'overall' : k}</code>: {v}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex justify-end">
              <button onClick={deploy} disabled={deploying || !targetReady}
                className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                {deploying ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
                Deploy to ITB
              </button>
            </div>
          </div>
        </SidePanel>
      )}

      {/* ── 5. Deployed — hand off to peer-to-peer matching ── */}
      {deployedSpec && (
        <SidePanel icon={Check} title="Deployed"
          status={<span className="text-xs text-green-700 dark:text-green-400">{deployedSpec.name}</span>}>
          <div className="space-y-3 text-sm">
            <div className="text-gray-700 dark:text-slate-300">
              These actors are now matchable in <strong>{deployedSpec.name}</strong>. Bind a system to
              each side to run one participant against another.
            </div>
            <ul className="border border-gray-200 dark:border-slate-700 rounded-lg divide-y divide-gray-200 dark:divide-slate-700">
              {deployedActors.length === 0 && (
                <li className="px-3 py-2 text-xs text-gray-500 dark:text-slate-400 italic">
                  No SUT actor resolved — open the specification in ITB to check what was created.
                </li>
              )}
              {deployedActors.map(a => (
                <li key={a.actorApiKey} className="px-3 py-2 flex items-center gap-2">
                  <Globe size={13} className="text-indigo-500 flex-shrink-0" />
                  <span className="font-medium text-gray-900 dark:text-white">{a.actorId || a.actorApiKey}</span>
                </li>
              ))}
            </ul>
            {Object.keys(deployWarnings).length > 0 && (
              <details className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2">
                <summary className="text-xs text-amber-800 dark:text-amber-300 cursor-pointer">
                  Deployed with {Object.values(deployWarnings).reduce((n, w) => n + w.length, 0)} TDL validation warning(s)
                </summary>
                {Object.entries(deployWarnings).map(([id, ws]) => (
                  <div key={id} className="mt-1.5">
                    <div className="text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-400">{id}</div>
                    <ul className="mt-0.5 space-y-0.5">
                      {ws.map((w, k) => (
                        <li key={k} className="text-[11px] text-amber-800 dark:text-amber-300 leading-snug">{w}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </details>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => navigate(`spec/${deployedSpec.key}`)}
                className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-slate-800 flex items-center gap-2">
                <FileCheck size={14} /> Open specification
              </button>
              <button onClick={() => navigate('matches')}
                className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-2">
                <ChevronRight size={14} /> Set up peer to peer testing
              </button>
            </div>
          </div>
        </SidePanel>
      )}
    </div>
  );
}
