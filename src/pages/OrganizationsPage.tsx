import React, { useEffect, useState } from 'react';
import { Building2, Plus } from 'lucide-react';

export function OrganizationsPage() {
  const [orgs, setOrgs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const load = () => {
    setLoading(true);
    fetch('/api/organizations').then(r => r.ok ? r.json() : []).then(d => { setOrgs(d); setLoading(false); }).catch(() => setLoading(false));
  };
  useEffect(load, []);

  const create = async () => {
    if (!name.trim()) return;
    setCreating(true);
    await fetch('/api/organizations', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ short_name: name, full_name: name }),
    });
    setName(''); setShowForm(false); setCreating(false);
    load();
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Organizations</h1>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
          <Plus size={14} /> New Organization
        </button>
      </div>

      {showForm && (
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 p-4 mb-4 flex gap-2">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Organization name"
            className="flex-1 px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-800 text-gray-900 dark:text-white" />
          <button onClick={create} disabled={creating || !name.trim()} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50">Create</button>
          <button onClick={() => setShowForm(false)} className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-sm text-gray-600 dark:text-gray-400">Cancel</button>
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading...</div>
        ) : !orgs.length ? (
          <div className="p-8 text-center text-gray-500 dark:text-slate-400">No organizations registered.</div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-slate-800">
            {orgs.map((o: any) => (
              <div key={o.apiKey || o.shortName} className="px-4 py-3 flex items-center gap-3">
                <Building2 size={16} className="text-gray-400" />
                <div>
                  <div className="font-medium text-sm text-gray-900 dark:text-white">{o.fullName || o.shortName}</div>
                  {o.apiKey && <div className="text-xs text-gray-400"><code>{o.apiKey}</code></div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
