import React, { useEffect, useState, useMemo } from 'react';
import {
  Building2, Laptop, FileCheck, Globe, ExternalLink, Loader2, AlertCircle, Check,
  Copy, ArrowRight, Server, TestTube2, Users, Search, Star,
} from 'lucide-react';
import { Markdown } from '../components/Markdown';

interface ActorItem {
  apiKey: string;
  identifier: string;
  name: string;
  description?: string;
  isDefault: boolean;
}
interface SpecItem {
  apiKey: string;
  shortName: string;
  fullName: string;
  description?: string;
  domain: { apiKey: string; shortName: string; fullName: string };
  suiteCount: number;
  actors: ActorItem[];
}

type Step = 'org' | 'system' | 'specs' | 'done';

const Section: React.FC<{
  step: Step;
  current: Step;
  index: number;
  title: string;
  icon: any;
  children: React.ReactNode;
}> = ({ step, current, index, title, icon: Icon, children }) => {
  const stepOrder: Step[] = ['org', 'system', 'specs', 'done'];
  const isPast = stepOrder.indexOf(current) > stepOrder.indexOf(step);
  const isCurrent = current === step;
  const isFuture = !isPast && !isCurrent;
  return (
    <div className={`bg-white dark:bg-slate-900 rounded-lg border mb-4 transition-opacity ${
      isFuture ? 'border-gray-200 dark:border-slate-800 opacity-50' : 'border-gray-200 dark:border-slate-700'
    }`}>
      <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-700 flex items-center gap-2">
        <span className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold ${
          isPast ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' :
          isCurrent ? 'bg-blue-600 text-white' :
          'bg-gray-100 dark:bg-slate-800 text-gray-400 dark:text-slate-500'
        }`}>
          {isPast ? <Check size={12} /> : index}
        </span>
        <Icon size={15} className={isCurrent ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-slate-500'} />
        <span className="font-semibold text-sm text-gray-900 dark:text-white">{title}</span>
      </div>
      {(isCurrent || isPast) && <div className="p-4">{children}</div>}
    </div>
  );
};

export function RegisterVendorPage() {
  const [step, setStep] = useState<Step>('org');

  // Step 1 — Organisation
  const [orgName, setOrgName] = useState('');
  const [orgDescription, setOrgDescription] = useState('');
  const [orgNameStatus, setOrgNameStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const [orgCreated, setOrgCreated] = useState<{ apiKey: string; shortName: string; fullName: string } | null>(null);
  const [orgBusy, setOrgBusy] = useState(false);
  const [orgError, setOrgError] = useState('');

  // Step 2 — System
  const [systemName, setSystemName] = useState('');
  const [systemDescription, setSystemDescription] = useState('');
  const [systemEndpoint, setSystemEndpoint] = useState('');
  const [systemCreated, setSystemCreated] = useState<{ apiKey: string; shortName: string } | null>(null);
  const [systemBusy, setSystemBusy] = useState(false);
  const [systemError, setSystemError] = useState('');

  // Step 3 — Specs
  const [specs, setSpecs] = useState<SpecItem[]>([]);
  const [specsLoading, setSpecsLoading] = useState(false);
  const [specsLoadError, setSpecsLoadError] = useState('');
  const [selectedActors, setSelectedActors] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [conformanceBusy, setConformanceBusy] = useState(false);
  const [conformanceResult, setConformanceResult] = useState<{ actorApiKey: string; ok: boolean; error?: string }[] | null>(null);

  // Step 4 — Done
  const [itbOrgUrl, setITBOrgUrl] = useState<string | null>(null);

  // Fetch specs as soon as we land on Step 3 (and once on first mount, so the
  // user doesn't see a blank panel even before they finish steps 1 and 2).
  useEffect(() => {
    setSpecsLoading(true);
    setSpecsLoadError('');
    fetch('/api/registration/specs')
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(d => setSpecs(d?.specs || []))
      .catch(e => setSpecsLoadError(e.message))
      .finally(() => setSpecsLoading(false));
  }, []);

  // Live availability check on the org name (debounced).
  useEffect(() => {
    if (!orgName.trim()) { setOrgNameStatus('idle'); return; }
    const t = setTimeout(async () => {
      setOrgNameStatus('checking');
      try {
        const r = await fetch(`/api/registration/org-name-available?name=${encodeURIComponent(orgName.trim())}`);
        if (!r.ok) { setOrgNameStatus('idle'); return; }
        const d = await r.json();
        setOrgNameStatus(d.available ? 'available' : 'taken');
      } catch {
        setOrgNameStatus('idle');
      }
    }, 350);
    return () => clearTimeout(t);
  }, [orgName]);

  // Fetch the ITB organisation URL once we have a created org.
  useEffect(() => {
    if (!orgCreated?.apiKey) return;
    fetch(`/api/registration/itb-org-url?org=${encodeURIComponent(orgCreated.apiKey)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setITBOrgUrl(d?.url || null))
      .catch(() => setITBOrgUrl(null));
  }, [orgCreated?.apiKey]);

  // Apply search filter across spec name + actor fields + domain name. The
  // API only returns actors that are SUT in at least one testcase of the
  // spec, so there's no per-role filtering to do here. If the spec name
  // matches the search, show all its actors; else show only matching actors.
  const filteredSpecs: SpecItem[] = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return specs;
    const out: SpecItem[] = [];
    for (const s of specs) {
      const specHay = `${s.shortName} ${s.fullName} ${s.description || ''} ${s.domain.shortName} ${s.domain.fullName}`.toLowerCase();
      const specMatch = specHay.includes(q);
      if (specMatch) { out.push(s); continue; }
      const matchedActors = s.actors.filter(a =>
        `${a.name} ${a.identifier} ${a.description || ''}`.toLowerCase().includes(q)
      );
      if (matchedActors.length > 0) out.push({ ...s, actors: matchedActors });
    }
    return out;
  }, [specs, search]);

  // Group filtered specs by domain.
  const specsByDomain = useMemo(() => {
    const m = new Map<string, { domain: SpecItem['domain']; specs: SpecItem[] }>();
    for (const s of filteredSpecs) {
      const k = s.domain.apiKey;
      if (!m.has(k)) m.set(k, { domain: s.domain, specs: [] });
      m.get(k)!.specs.push(s);
    }
    return Array.from(m.values());
  }, [filteredSpecs]);

  const allVisibleActorKeys = useMemo(
    () => filteredSpecs.flatMap(s => s.actors.map(a => a.apiKey)),
    [filteredSpecs]
  );

  const toggleActor = (key: string) => {
    const next = new Set(selectedActors);
    next.has(key) ? next.delete(key) : next.add(key);
    setSelectedActors(next);
  };
  const toggleSpecAllActors = (specKey: string) => {
    const spec = specs.find(s => s.apiKey === specKey);
    if (!spec) return;
    const next = new Set(selectedActors);
    const allSelected = spec.actors.length > 0 && spec.actors.every(a => next.has(a.apiKey));
    for (const a of spec.actors) {
      if (allSelected) next.delete(a.apiKey); else next.add(a.apiKey);
    }
    setSelectedActors(next);
  };

  const createOrg = async () => {
    if (!orgName.trim() || orgNameStatus === 'taken') return;
    setOrgBusy(true); setOrgError('');
    try {
      const r = await fetch('/api/registration/org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: orgName.trim(), description: orgDescription.trim() }),
      });
      const d = await r.json();
      if (r.status === 409 || d?.error === 'name_taken') {
        setOrgError('This name is already taken. Please choose another.');
        setOrgNameStatus('taken');
        return;
      }
      if (!r.ok || !d?.apiKey) {
        setOrgError(d?.error || `HTTP ${r.status}`);
        return;
      }
      setOrgCreated({ apiKey: d.apiKey, shortName: orgName.trim(), fullName: orgName.trim() });
      setStep('system');
    } catch (e: any) {
      setOrgError(e.message);
    } finally {
      setOrgBusy(false);
    }
  };

  const createSystem = async () => {
    if (!systemName.trim() || !orgCreated) return;
    setSystemBusy(true); setSystemError('');
    try {
      const r = await fetch('/api/registration/system', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: systemName.trim(),
          description: systemDescription.trim(),
          organisation: orgCreated.apiKey,
          // Endpoint URL isn't a property the ITB system create endpoint accepts
          // directly today; admins set it later via endpoint config. Capture for
          // display + future when we wire endpoint creation.
        }),
      });
      const d = await r.json();
      if (!r.ok || !d?.apiKey) {
        setSystemError(d?.error_description || d?.error || `HTTP ${r.status}`);
        return;
      }
      setSystemCreated({ apiKey: d.apiKey, shortName: systemName.trim() });
      setStep('specs');
    } catch (e: any) {
      setSystemError(e.message);
    } finally {
      setSystemBusy(false);
    }
  };

  const submitConformance = async () => {
    if (!systemCreated || selectedActors.size === 0) return;
    setConformanceBusy(true);
    try {
      const r = await fetch('/api/registration/conformance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgApiKey: orgCreated?.apiKey,
          systemApiKey: systemCreated.apiKey,
          actorApiKeys: [...selectedActors],
        }),
      });
      const d = await r.json();
      setConformanceResult(d?.created || []);
      setStep('done');
    } catch (e: any) {
      setConformanceResult([{ actorApiKey: '', ok: false, error: e.message }]);
      setStep('done');
    } finally {
      setConformanceBusy(false);
    }
  };

  const copy = (text: string) => { navigator.clipboard?.writeText(text).catch(() => {}); };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-2">
          <Server size={22} className="text-blue-600 dark:text-blue-400" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Register your system</h1>
        </div>
        <p className="text-sm text-gray-500 dark:text-slate-400 mb-6">
          Create your organisation, register a system, and pick the specifications it implements.
          You'll get the keys to log into ITB and run tests at the end.
        </p>

        {/* Step 1 — Organisation */}
        <Section step="org" current={step} index={1} title="Your organisation" icon={Building2}>
          {orgCreated ? (
            <div className="text-sm">
              <span className="text-gray-500 dark:text-slate-400">Created:</span>{' '}
              <strong className="text-gray-900 dark:text-white">{orgCreated.shortName}</strong>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Organisation name</label>
                <input value={orgName} onChange={e => setOrgName(e.target.value)}
                  placeholder="e.g. ACME Health Systems"
                  autoFocus
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <div className="mt-1 text-xs h-4">
                  {orgNameStatus === 'checking' && <span className="text-gray-400 flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> Checking…</span>}
                  {orgNameStatus === 'available' && <span className="text-green-700 dark:text-green-400 flex items-center gap-1"><Check size={10} /> Available</span>}
                  {orgNameStatus === 'taken' && <span className="text-red-700 dark:text-red-400 flex items-center gap-1"><AlertCircle size={10} /> This name is already taken. Please choose another.</span>}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Description (optional)</label>
                <input value={orgDescription} onChange={e => setOrgDescription(e.target.value)}
                  placeholder="Short description"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              {orgError && <div className="text-sm text-red-700 dark:text-red-400 flex items-start gap-1.5"><AlertCircle size={14} className="mt-0.5" /> {orgError}</div>}
              <div className="flex justify-end">
                <button onClick={createOrg}
                  disabled={orgBusy || !orgName.trim() || orgNameStatus === 'taken' || orgNameStatus === 'checking'}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                  {orgBusy ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
                  Continue
                </button>
              </div>
            </div>
          )}
        </Section>

        {/* Step 2 — System */}
        <Section step="system" current={step} index={2} title="Your system" icon={Laptop}>
          {systemCreated ? (
            <div className="text-sm">
              <span className="text-gray-500 dark:text-slate-400">Created:</span>{' '}
              <strong className="text-gray-900 dark:text-white">{systemCreated.shortName}</strong>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">System name</label>
                <input value={systemName} onChange={e => setSystemName(e.target.value)}
                  placeholder="e.g. ACME EHR Server v3.2"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Description (optional)</label>
                <input value={systemDescription} onChange={e => setSystemDescription(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Endpoint URL (optional, for your records)</label>
                <input value={systemEndpoint} onChange={e => setSystemEndpoint(e.target.value)}
                  placeholder="https://api.example.com/fhir"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <p className="text-[10px] text-gray-400 mt-1">ITB endpoint configuration is set up later by an admin. We just record this here.</p>
              </div>
              {systemError && <div className="text-sm text-red-700 dark:text-red-400 flex items-start gap-1.5"><AlertCircle size={14} className="mt-0.5" /> {systemError}</div>}
              <div className="flex justify-end">
                <button onClick={createSystem}
                  disabled={systemBusy || !systemName.trim() || !orgCreated}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                  {systemBusy ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
                  Continue
                </button>
              </div>
            </div>
          )}
        </Section>

        {/* Step 3 — Specs */}
        <Section step="specs" current={step} index={3} title="Specifications you implement" icon={FileCheck}>
          {specsLoading ? (
            <div className="flex items-center text-sm text-gray-500"><Loader2 size={14} className="animate-spin mr-2" /> Loading specifications…</div>
          ) : specsLoadError ? (
            <div className="text-sm text-red-700 dark:text-red-400 flex items-start gap-1.5"><AlertCircle size={14} className="mt-0.5" /> {specsLoadError}</div>
          ) : specs.length === 0 ? (
            <div className="text-sm text-gray-500 dark:text-slate-400">No specifications are currently published in this community.</div>
          ) : (
            <div>
              {/* Search box */}
              <div className="flex items-center gap-2 mb-3">
                <div className="flex-1 flex items-center gap-2 px-2 py-1.5 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 focus-within:ring-2 focus-within:ring-blue-500">
                  <Search size={13} className="text-gray-400 flex-shrink-0" />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search by specification, actor, or description…"
                    className="flex-1 bg-transparent text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none"
                    disabled={step !== 'specs'}
                  />
                  {search && (
                    <button onClick={() => setSearch('')} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-slate-300">
                      clear
                    </button>
                  )}
                </div>
                {selectedActors.size > 0 && (
                  <span className="text-xs text-gray-500 dark:text-slate-400 whitespace-nowrap">
                    {selectedActors.size} actor{selectedActors.size === 1 ? '' : 's'} selected
                  </span>
                )}
              </div>


              <div className="overflow-x-auto -mx-4 border-y border-gray-200 dark:border-slate-700">
                <table className="w-full text-sm">
                  <thead className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-slate-400 bg-gray-50/60 dark:bg-slate-800/40">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold w-8"></th>
                      <th className="text-left px-3 py-2 font-semibold">Actor</th>
                      <th className="text-left px-3 py-2 font-semibold">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {specsByDomain.length === 0 && search.trim() !== '' && (
                      <tr><td colSpan={3} className="px-3 py-6 text-center text-sm text-gray-500 dark:text-slate-400">
                        No specifications or actors match "<strong>{search}</strong>".
                      </td></tr>
                    )}
                    {specsByDomain.flatMap(g => {
                      const rows: React.ReactNode[] = [];
                      // Domain header row
                      rows.push(
                        <tr key={`dom-${g.domain.apiKey}`} className="bg-blue-50/40 dark:bg-slate-800/40">
                          <td colSpan={3} className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-blue-700 dark:text-blue-400 font-semibold">
                            <span className="inline-flex items-center gap-1"><Globe size={10} /> {g.domain.fullName || g.domain.shortName}</span>
                          </td>
                        </tr>
                      );
                      for (const s of g.specs) {
                        const allSelected = s.actors.length > 0 && s.actors.every(a => selectedActors.has(a.apiKey));
                        const someSelected = s.actors.some(a => selectedActors.has(a.apiKey));
                        // Spec header row (with tri-state checkbox to claim/unclaim all its actors)
                        rows.push(
                          <tr key={`spec-${s.apiKey}`} className="bg-gray-50/60 dark:bg-slate-800/20 border-t border-gray-200 dark:border-slate-700">
                            <td className="px-3 py-2 align-top">
                              <input
                                type="checkbox"
                                checked={allSelected}
                                ref={el => { if (el) el.indeterminate = !allSelected && someSelected; }}
                                onChange={() => toggleSpecAllActors(s.apiKey)}
                                disabled={step !== 'specs' || s.actors.length === 0}
                                title={s.actors.length === 0 ? 'No claimable actors' : 'Claim all actors of this spec'}
                              />
                            </td>
                            <td colSpan={2} className="px-3 py-2 align-top">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold text-sm text-gray-900 dark:text-white">{s.fullName || s.shortName}</span>
                                {s.shortName && s.fullName && s.shortName !== s.fullName && (
                                  <code className="text-[10px] text-gray-400 dark:text-slate-500 font-mono">{s.shortName}</code>
                                )}
                                <span className="inline-flex items-center gap-1 text-[10px] text-purple-700 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 px-1.5 py-0.5 rounded-full">
                                  <TestTube2 size={10} /> {s.suiteCount} test {s.suiteCount === 1 ? 'suite' : 'suites'}
                                </span>
                                <span className="inline-flex items-center gap-1 text-[10px] text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-1.5 py-0.5 rounded-full">
                                  <Users size={10} /> {s.actors.length} {s.actors.length === 1 ? 'actor' : 'actors'}
                                </span>
                              </div>
                              {s.description && (
                                <div className="mt-1 text-xs text-gray-600 dark:text-slate-300 max-w-3xl">
                                  <Markdown className="text-xs" inline={false}>{s.description}</Markdown>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                        // Actor rows
                        if (s.actors.length === 0) {
                          rows.push(
                            <tr key={`spec-${s.apiKey}-noact`} className="border-t border-gray-100 dark:border-slate-800">
                              <td></td>
                              <td colSpan={2} className="px-3 py-2 text-xs text-gray-400 dark:text-slate-500 italic">No actors are exposed for this specification.</td>
                            </tr>
                          );
                        } else {
                          for (const a of s.actors) {
                            const checked = selectedActors.has(a.apiKey);
                            const toggle = () => toggleActor(a.apiKey);
                            rows.push(
                              <tr
                                key={`act-${a.apiKey}`}
                                onClick={() => step === 'specs' && toggle()}
                                className={`border-t border-gray-100 dark:border-slate-800 hover:bg-blue-50/30 dark:hover:bg-blue-900/10 ${step === 'specs' ? 'cursor-pointer' : ''} ${checked ? 'bg-blue-50/40 dark:bg-blue-900/15' : ''}`}
                              >
                                <td className="px-3 py-2 align-top pl-8" onClick={e => e.stopPropagation()}>
                                  <input type="checkbox" checked={checked} disabled={step !== 'specs'} onChange={toggle} />
                                </td>
                                <td className="px-3 py-2 align-top">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-medium text-gray-900 dark:text-white">{a.name}</span>
                                    {a.isDefault && (
                                      <Star size={10} className="text-amber-500" fill="currentColor" aria-label="Default actor" />
                                    )}
                                    {a.identifier && a.identifier !== a.name && (
                                      <code className="text-[10px] text-gray-400 dark:text-slate-500 font-mono">{a.identifier}</code>
                                    )}
                                  </div>
                                </td>
                                <td className="px-3 py-2 align-top text-xs text-gray-600 dark:text-slate-300 max-w-2xl">
                                  {a.description ? (
                                    <Markdown className="text-xs" inline={false}>{a.description}</Markdown>
                                  ) : (
                                    <span className="text-gray-400 italic">—</span>
                                  )}
                                </td>
                              </tr>
                            );
                          }
                        }
                      }
                      return rows;
                    })}
                  </tbody>
                </table>
              </div>

              <p className="text-[11px] text-gray-500 dark:text-slate-500 mt-2">
                Conformance is claimed per actor. A specification can have multiple actor roles (e.g. <em>Prescription Placer</em> vs <em>Prescription Dispenser</em>) — pick the ones your system actually plays. The default actor is marked with <Star size={9} className="inline text-amber-500" fill="currentColor" />.
              </p>

              <div className="flex items-center justify-between pt-3 border-t border-gray-200 dark:border-slate-700 mt-3">
                <span className="text-xs text-gray-500 dark:text-slate-400">{selectedActors.size} actor{selectedActors.size === 1 ? '' : 's'} selected{search ? ` · ${allVisibleActorKeys.length} visible` : ''}</span>
                <button onClick={submitConformance}
                  disabled={conformanceBusy || selectedActors.size === 0 || step !== 'specs'}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                  {conformanceBusy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  Register
                </button>
              </div>
            </div>
          )}
        </Section>

        {/* Step 4 — Done */}
        {step === 'done' && (
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-5">
            <div className="flex items-center gap-3 mb-3">
              <Check size={24} className="text-green-600 dark:text-green-400" />
              <div className="font-bold text-green-800 dark:text-green-300">Registration complete</div>
            </div>

            <div className="text-sm text-gray-700 dark:text-slate-300 space-y-2">
              <div className="bg-white dark:bg-slate-900 rounded border border-green-200 dark:border-green-800 p-3 space-y-2">
                {orgCreated && (
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-500">Organisation API key</div>
                      <code className="text-xs text-gray-900 dark:text-white font-mono">{orgCreated.apiKey}</code>
                    </div>
                    <button onClick={() => copy(orgCreated.apiKey)}
                      className="flex items-center gap-1 px-2 py-1 text-xs border border-gray-300 dark:border-slate-600 rounded hover:bg-gray-50 dark:hover:bg-slate-800">
                      <Copy size={11} /> Copy
                    </button>
                  </div>
                )}
                {systemCreated && (
                  <div className="flex items-center justify-between gap-3 border-t border-gray-100 dark:border-slate-800 pt-2">
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-500">System API key</div>
                      <code className="text-xs text-gray-900 dark:text-white font-mono">{systemCreated.apiKey}</code>
                    </div>
                    <button onClick={() => copy(systemCreated.apiKey)}
                      className="flex items-center gap-1 px-2 py-1 text-xs border border-gray-300 dark:border-slate-600 rounded hover:bg-gray-50 dark:hover:bg-slate-800">
                      <Copy size={11} /> Copy
                    </button>
                  </div>
                )}
              </div>

              {conformanceResult && (
                <div className="text-xs text-gray-600 dark:text-slate-400">
                  Conformance statements: {conformanceResult.filter(c => c.ok).length}/{conformanceResult.length} created.
                  {conformanceResult.some(c => !c.ok) && (
                    <ul className="mt-1 ml-4 list-disc text-red-700 dark:text-red-400">
                      {conformanceResult.filter(c => !c.ok).map((c, k) => (
                        <li key={k}>{c.actorApiKey}: {c.error || 'failed'}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <div className="pt-2">
                {itbOrgUrl ? (
                  <a href={itbOrgUrl} target="_blank" rel="noopener"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
                    <ExternalLink size={14} /> View my conformance statements in ITB
                  </a>
                ) : (
                  <span className="text-xs text-gray-500 dark:text-slate-400">Resolving ITB link…</span>
                )}
              </div>
            </div>

            <p className="text-[11px] text-gray-500 dark:text-slate-500 mt-4">
              Save the API keys above — you'll need them later to run tests against your system.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
