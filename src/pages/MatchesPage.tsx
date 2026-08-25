import React, { useEffect, useMemo, useState } from 'react';
import { Menu, Transition } from '@headlessui/react';
import {
  Loader2, AlertCircle, Globe, Users, FileCheck, Building2, Server,
  CheckCircle2, Plus, Trash2, X, Link2, Search, Copy, ExternalLink, Mail,
  ChevronDown, Send, Play, Circle, Clock, XCircle,
} from 'lucide-react';

interface SystemReg {
  systemApiKey: string;
  systemName: string;
  orgApiKey: string;
  orgName: string;
}
interface ActorWithSystems {
  apiKey: string;
  identifier: string;
  name: string;
  systems: SystemReg[];
}
interface ParticipantStatus {
  status: 'not-started' | 'in-progress' | 'done';
  result: 'passed' | 'failed' | null;
  total: number;
  completed: number;
  failed: number;
  lastSessionAt: string | null;
}
interface VendorLink {
  actorApiKey: string;
  actorName: string;
  systemApiKey: string;
  systemName: string;
  orgName: string;
  url: string | null; // null when ITB IDs couldn't be resolved
  participantStatus: ParticipantStatus | null;
}
interface MatchStatus {
  overall: 'not-started' | 'in-progress' | 'partial' | 'done-passed' | 'done-failed';
  doneCount: number;
  total: number;
  failedCount: number;
}
interface Match {
  id: string;
  name?: string;
  bindings: Record<string, string>; // actorApiKey → systemApiKey
  links: VendorLink[];
  status: MatchStatus;
  createdAt: string;
}
interface SpecCard {
  apiKey: string;
  shortName: string;
  fullName: string;
  domain: { apiKey: string; shortName: string; fullName: string };
  actors: ActorWithSystems[];
  matches: Match[];
}

type Coverage = 'no-actors' | 'incomplete' | 'ready';
function coverageOf(spec: SpecCard): Coverage {
  if (spec.actors.length === 0) return 'no-actors';
  return spec.actors.every(a => a.systems.length > 0) ? 'ready' : 'incomplete';
}

export function MatchesPage() {
  const [specs, setSpecs] = useState<SpecCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'ready' | 'incomplete'>('all');
  // Per-spec, in-progress composer state: actorApiKey → systemApiKey
  const [composer, setComposer] = useState<Record<string, Record<string, string>>>({});
  const [composerName, setComposerName] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const reload = () => {
    setLoading(true);
    setError('');
    fetch('/api/management/matches')
      .then(async r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => setSpecs(d?.specs || []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(reload, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return specs.filter(s => {
      if (filter === 'ready' && coverageOf(s) !== 'ready') return false;
      if (filter === 'incomplete' && coverageOf(s) === 'ready') return false;
      if (!q) return true;
      const hay = `${s.shortName} ${s.fullName} ${s.domain.shortName} ${s.domain.fullName} `
        + s.actors.map(a => `${a.identifier} ${a.name}`).join(' ').toLowerCase()
        + ' '
        + s.actors.flatMap(a => a.systems.map(x => `${x.systemName} ${x.orgName}`)).join(' ').toLowerCase();
      return hay.toLowerCase().includes(q);
    });
  }, [specs, search, filter]);

  const totals = useMemo(() => {
    const ready = specs.filter(s => coverageOf(s) === 'ready').length;
    const incomplete = specs.filter(s => coverageOf(s) === 'incomplete').length;
    const noActors = specs.filter(s => coverageOf(s) === 'no-actors').length;
    const matchCount = specs.reduce((n, s) => n + s.matches.length, 0);
    return { ready, incomplete, noActors, matchCount };
  }, [specs]);

  const setBinding = (specKey: string, actorKey: string, systemKey: string) => {
    setComposer(c => ({
      ...c,
      [specKey]: { ...(c[specKey] || {}), [actorKey]: systemKey },
    }));
  };
  const clearBinding = (specKey: string, actorKey: string) => {
    setComposer(c => {
      const cur = { ...(c[specKey] || {}) };
      delete cur[actorKey];
      return { ...c, [specKey]: cur };
    });
  };

  const composerComplete = (spec: SpecCard) => {
    const cur = composer[spec.apiKey] || {};
    return spec.actors.length > 0 && spec.actors.every(a => cur[a.apiKey]);
  };

  const createMatch = async (spec: SpecCard) => {
    if (!composerComplete(spec)) return;
    setBusy(b => ({ ...b, [spec.apiKey]: true }));
    try {
      const r = await fetch('/api/management/matches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          specApiKey: spec.apiKey,
          name: composerName[spec.apiKey] || '',
          bindings: composer[spec.apiKey] || {},
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      // Reset composer for this spec, reload list
      setComposer(c => ({ ...c, [spec.apiKey]: {} }));
      setComposerName(n => ({ ...n, [spec.apiKey]: '' }));
      reload();
    } catch (e: any) {
      alert(`Could not create match: ${e.message}`);
    } finally {
      setBusy(b => ({ ...b, [spec.apiKey]: false }));
    }
  };

  const deleteMatch = async (specKey: string, matchId: string) => {
    if (!confirm('Delete this match?')) return;
    try {
      const r = await fetch(`/api/management/matches/${specKey}/${matchId}`, { method: 'DELETE' });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      reload();
    } catch (e: any) {
      alert(`Could not delete match: ${e.message}`);
    }
  };

  const sysName = (s: SpecCard, systemApiKey: string): string => {
    for (const a of s.actors) {
      const found = a.systems.find(x => x.systemApiKey === systemApiKey);
      if (found) return `${found.systemName} (${found.orgName})`;
    }
    return systemApiKey;
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <Link2 size={22} className="text-blue-600 dark:text-blue-400" />
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Matches</h1>
      </div>
      <p className="text-sm text-gray-500 dark:text-slate-400 mb-5">
        Pair vendor systems for peer-to-peer test runs. A specification is{' '}
        <strong>match-ready</strong> when at least one vendor has registered
        conformance for every SUT-eligible actor.
      </p>

      {/* Summary chips */}
      <div className="flex flex-wrap gap-2 mb-4 text-xs">
        <button onClick={() => setFilter('all')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border transition-colors ${
            filter === 'all' ? 'bg-blue-600 text-white border-blue-600' :
            'bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-300 border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700'
          }`}>
          <FileCheck size={12} /> All <span className="opacity-75">({specs.length})</span>
        </button>
        <button onClick={() => setFilter('ready')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border transition-colors ${
            filter === 'ready' ? 'bg-green-600 text-white border-green-600' :
            'bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-300 border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700'
          }`}>
          <CheckCircle2 size={12} /> Match-ready <span className="opacity-75">({totals.ready})</span>
        </button>
        <button onClick={() => setFilter('incomplete')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border transition-colors ${
            filter === 'incomplete' ? 'bg-amber-600 text-white border-amber-600' :
            'bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-300 border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700'
          }`}>
          <AlertCircle size={12} /> Incomplete <span className="opacity-75">({totals.incomplete})</span>
        </button>
        <span className="flex items-center gap-1.5 px-3 py-1.5 text-gray-500 dark:text-slate-400">
          <Link2 size={12} /> {totals.matchCount} match{totals.matchCount === 1 ? '' : 'es'} saved
        </span>
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 px-2 py-1.5 mb-4 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 focus-within:ring-2 focus-within:ring-blue-500">
        <Search size={13} className="text-gray-400 flex-shrink-0" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search specs, actors, vendors, or systems…"
          className="flex-1 bg-transparent text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none" />
        {search && (
          <button onClick={() => setSearch('')} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-slate-300">
            clear
          </button>
        )}
      </div>

      {loading && <div className="flex items-center text-sm text-gray-500"><Loader2 size={14} className="animate-spin mr-2" /> Loading…</div>}
      {error && <div className="text-sm text-red-700 dark:text-red-400 flex items-start gap-1.5"><AlertCircle size={14} className="mt-0.5" /> {error}</div>}

      {!loading && !error && filtered.length === 0 && (
        <div className="text-sm text-gray-500 dark:text-slate-400 italic px-3 py-6 border border-dashed border-gray-200 dark:border-slate-700 rounded-lg text-center">
          {specs.length === 0
            ? 'No specifications are currently published.'
            : 'No specifications match the current filter.'}
        </div>
      )}

      {/* Spec cards */}
      <div className="space-y-4">
        {filtered.map(spec => {
          const cov = coverageOf(spec);
          const cur = composer[spec.apiKey] || {};
          const isBusy = !!busy[spec.apiKey];
          return (
            <div key={spec.apiKey}
              className={`bg-white dark:bg-slate-900 rounded-lg border shadow-sm ${
                cov === 'ready' ? 'border-green-200 dark:border-green-800' :
                cov === 'incomplete' ? 'border-amber-200 dark:border-amber-800' :
                'border-gray-200 dark:border-slate-700'
              }`}>
              {/* Header */}
              <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-700 flex items-start gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-base text-gray-900 dark:text-white">{spec.fullName || spec.shortName}</span>
                    {spec.shortName && spec.fullName && spec.shortName !== spec.fullName && (
                      <code className="text-[11px] text-gray-400 dark:text-slate-500 font-mono">{spec.shortName}</code>
                    )}
                    <span className="inline-flex items-center gap-1 text-[11px] text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-1.5 py-0.5 rounded-full">
                      <Globe size={10} /> {spec.domain.fullName || spec.domain.shortName}
                    </span>
                  </div>
                </div>
                <div>
                  {cov === 'ready' && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-2 py-1 rounded-full">
                      <CheckCircle2 size={12} /> Match-ready
                    </span>
                  )}
                  {cov === 'incomplete' && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-1 rounded-full">
                      <AlertCircle size={12} /> Incomplete coverage
                    </span>
                  )}
                  {cov === 'no-actors' && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 dark:text-slate-400 bg-gray-100 dark:bg-slate-800 px-2 py-1 rounded-full">
                      No SUT actors
                    </span>
                  )}
                </div>
              </div>

              {/* Actor × system grid */}
              {spec.actors.length === 0 ? (
                <div className="px-4 py-3 text-sm text-gray-500 dark:text-slate-400 italic">
                  This specification has no SUT-eligible actors yet — deploy a test suite that marks at least one actor as SUT.
                </div>
              ) : (
                <div className="px-4 py-3">
                  <div className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-slate-400 font-semibold mb-2">Pick one system per actor</div>
                  <div className="space-y-2">
                    {spec.actors.map(actor => {
                      const picked = cur[actor.apiKey];
                      return (
                        <div key={actor.apiKey} className="flex items-center gap-2 flex-wrap">
                          <div className="w-44 flex-shrink-0 flex items-center gap-1.5 text-sm font-medium text-gray-900 dark:text-white">
                            <Users size={13} className="text-gray-500 dark:text-slate-400 flex-shrink-0" />
                            <span className="truncate" title={actor.identifier}>{actor.name || actor.identifier}</span>
                          </div>
                          {actor.systems.length === 0 ? (
                            <span className="text-xs text-amber-700 dark:text-amber-400 italic">
                              No vendors registered for this actor
                            </span>
                          ) : (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {actor.systems.map(sys => {
                                const isPicked = picked === sys.systemApiKey;
                                return (
                                  <button key={sys.systemApiKey}
                                    onClick={() => isPicked
                                      ? clearBinding(spec.apiKey, actor.apiKey)
                                      : setBinding(spec.apiKey, actor.apiKey, sys.systemApiKey)}
                                    title={`${sys.systemName} — ${sys.orgName}`}
                                    className={`flex items-center gap-1 px-2 py-1 rounded text-xs border transition-colors ${
                                      isPicked
                                        ? 'bg-blue-600 text-white border-blue-600'
                                        : 'bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-300 border-gray-200 dark:border-slate-600 hover:bg-blue-50 dark:hover:bg-slate-700'
                                    }`}>
                                    <Server size={10} />
                                    <span className="font-medium">{sys.systemName}</span>
                                    <span className="opacity-75 inline-flex items-center gap-0.5"><Building2 size={9} /> {sys.orgName}</span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Composer footer */}
                  {spec.actors.some(a => a.systems.length > 0) && (
                    <div className="flex items-center gap-2 pt-3 mt-3 border-t border-gray-100 dark:border-slate-800">
                      <input value={composerName[spec.apiKey] || ''}
                        onChange={e => setComposerName(n => ({ ...n, [spec.apiKey]: e.target.value }))}
                        placeholder="Match name (optional)"
                        className="flex-1 px-2 py-1 text-sm border border-gray-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500" />
                      <button onClick={() => createMatch(spec)}
                        disabled={isBusy || !composerComplete(spec)}
                        className="flex items-center gap-1 px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
                        {isBusy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                        Save match
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Existing matches */}
              {spec.matches.length > 0 && (
                <div className="px-4 py-3 border-t border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/30">
                  <div className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-slate-400 font-semibold mb-2">
                    Saved matches ({spec.matches.length})
                  </div>
                  <ul className="space-y-1.5">
                    {spec.matches.map(m => (
                      <li key={m.id}
                        className="flex items-center gap-3 px-3 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded text-xs"
                        title={`Created ${new Date(m.createdAt).toLocaleString()}`}>
                        <Link2 size={12} className="text-blue-500 flex-shrink-0" />
                        {m.name && (
                          <span className="font-medium text-gray-900 dark:text-white whitespace-nowrap flex-shrink-0">{m.name}</span>
                        )}

                        {/* All bindings inline; each is a labeled split-button */}
                        <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
                          {m.links.map(link => (
                            <BindingActionButton key={link.actorApiKey} link={link} />
                          ))}
                        </div>

                        {/* Match-level status pill */}
                        <MatchStatusPill status={m.status} />

                        {/* Bulk copy + delete */}
                        {m.links.some(l => l.url) && (
                          <button
                            onClick={() => {
                              const text = m.links
                                .filter(l => l.url)
                                .map(l => `${l.actorName} — ${l.systemName} (${l.orgName})\n  ${l.url}`)
                                .join('\n\n');
                                navigator.clipboard?.writeText(text);
                            }}
                            className="p-1 text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 flex-shrink-0"
                            title="Copy all links as a plain-text block">
                            <Mail size={12} />
                          </button>
                        )}
                        <button onClick={() => deleteMatch(spec.apiKey, m.id)}
                          className="p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400 flex-shrink-0"
                          title="Delete match">
                          <Trash2 size={12} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Helper components ──────────────────────────────────────────────────

// Split-button: primary action (Copy) + dropdown chevron with [Copy / Send / Run].
function BindingActionButton({ link }: { link: VendorLink }) {
  const disabled = !link.url;
  const url = link.url || '';
  const ps = link.participantStatus;

  const copy = () => navigator.clipboard?.writeText(url);
  const send = () => {
    // mailto draft pre-filled with a vendor-friendly body. The user's mail
    // client opens — they can adjust recipient/subject before sending.
    const subject = `Test execution link for ${link.actorName}`;
    const body =
      `Hello,\n\nPlease use the following link to access your test execution view in ITB:\n\n` +
      `Actor: ${link.actorName}\nSystem: ${link.systemName}${link.orgName ? ` (${link.orgName})` : ''}\n\n${url}\n\nThanks.`;
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };
  const run = () => { if (url) window.open(url, '_blank', 'noopener'); };

  return (
    <div className="inline-flex items-center gap-1">
      <span className="inline-flex items-center gap-1 text-gray-500 dark:text-slate-400 whitespace-nowrap">
        <ParticipantStatusDot ps={ps} />
        <span>{link.actorName}:</span>
        <span className="font-medium text-gray-900 dark:text-white" title={link.orgName ? `${link.systemName} (${link.orgName})` : link.systemName}>
          {link.systemName}
        </span>
      </span>
      {disabled ? (
        <span className="text-amber-600 dark:text-amber-400 italic">(no link)</span>
      ) : (
        <Menu as="div" className="relative inline-flex">
          <div className="inline-flex rounded border border-blue-300 dark:border-blue-800 overflow-hidden">
            <button onClick={copy}
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40 text-[11px] font-medium"
              title="Copy this vendor's link to clipboard">
              <Copy size={11} /> Copy
            </button>
            <Menu.Button className="px-1 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40 border-l border-blue-300 dark:border-blue-800"
              title="More actions">
              <ChevronDown size={11} />
            </Menu.Button>
          </div>
          <Transition
            enter="transition ease-out duration-100"
            enterFrom="opacity-0 scale-95"
            enterTo="opacity-100 scale-100"
            leave="transition ease-in duration-75"
            leaveFrom="opacity-100 scale-100"
            leaveTo="opacity-0 scale-95"
          >
            <Menu.Items className="absolute right-0 top-full mt-1 z-20 w-44 origin-top-right rounded-md bg-white dark:bg-slate-800 shadow-lg ring-1 ring-black/10 dark:ring-white/10 focus:outline-none">
              <Menu.Item>
                {({ active }) => (
                  <button onClick={copy}
                    className={`flex items-center gap-2 w-full px-3 py-2 text-xs text-left ${active ? 'bg-blue-50 dark:bg-slate-700 text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-slate-200'}`}>
                    <Copy size={12} /> Copy link
                  </button>
                )}
              </Menu.Item>
              <Menu.Item>
                {({ active }) => (
                  <button onClick={send}
                    className={`flex items-center gap-2 w-full px-3 py-2 text-xs text-left ${active ? 'bg-blue-50 dark:bg-slate-700 text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-slate-200'}`}>
                    <Send size={12} /> Send via email…
                  </button>
                )}
              </Menu.Item>
              <Menu.Item>
                {({ active }) => (
                  <button onClick={run}
                    className={`flex items-center gap-2 w-full px-3 py-2 text-xs text-left ${active ? 'bg-blue-50 dark:bg-slate-700 text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-slate-200'}`}>
                    <Play size={12} /> Run in ITB
                  </button>
                )}
              </Menu.Item>
            </Menu.Items>
          </Transition>
        </Menu>
      )}
    </div>
  );
}

// Inline dot showing per-participant execution state.
function ParticipantStatusDot({ ps }: { ps: ParticipantStatus | null }) {
  if (!ps || ps.status === 'not-started') {
    return <Circle size={8} className="text-gray-300 dark:text-slate-600" aria-label="not run" />;
  }
  if (ps.status === 'in-progress') {
    return <Clock size={8} className="text-amber-500" aria-label="in progress" />;
  }
  if (ps.result === 'failed') {
    return <XCircle size={8} className="text-red-500" aria-label="failed" />;
  }
  return <CheckCircle2 size={8} className="text-green-500" aria-label="passed" />;
}

// End-of-row pill summarizing the match's overall execution.
function MatchStatusPill({ status }: { status: MatchStatus }) {
  let label: string;
  let cls: string;
  let Icon: any;
  switch (status.overall) {
    case 'not-started':
      label = 'Not run';
      Icon = Circle;
      cls = 'text-gray-500 dark:text-slate-400 bg-gray-100 dark:bg-slate-800';
      break;
    case 'in-progress':
      label = 'In progress';
      Icon = Clock;
      cls = 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20';
      break;
    case 'partial':
      label = `Partial ${status.doneCount}/${status.total}`;
      Icon = Clock;
      cls = 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20';
      break;
    case 'done-passed':
      label = 'Done · passed';
      Icon = CheckCircle2;
      cls = 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20';
      break;
    case 'done-failed':
      label = `Done · ${status.failedCount} failed`;
      Icon = XCircle;
      cls = 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20';
      break;
  }
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0 ${cls}`}>
      <Icon size={11} /> {label}
    </span>
  );
}
