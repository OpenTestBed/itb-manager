/**
 * Mock ITB backend.
 *
 * When ITB_MOCK=1 is set, the dev server bypasses the real ITB instance and
 * the MySQL `docker exec` calls. Instead it loads a fixture YAML into an
 * in-memory SQLite DB (sql.js) and serves both `dbQuery` and `itbFetch` from
 * that. Mutations (org/system/conformance creation) write back into the same
 * DB AND persist a snapshot to `~/.itb-test-manager/mock-runtime.json` so the
 * data survives dev-server restarts. Delete that file to reset to the seed.
 *
 * To switch:
 *   - real ITB:       unset ITB_MOCK (default)
 *   - mock fixture:   ITB_MOCK=1
 *   - alternate seed: ITB_MOCK=1 ITB_MOCK_FIXTURE=path/to/your.yml
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import yaml from 'js-yaml';
import initSqlJs, { Database } from 'sql.js';

export interface MockResponse {
  ok: boolean;
  status: number;
  json: () => Promise<any>;
  text: () => Promise<string>;
}

interface RuntimeState {
  // We persist the entire DB as exported bytes (sql.js gives us a Uint8Array
  // we can re-import on next startup). Stored as a base64 string for JSON.
  dbBase64?: string;
}

const RUNTIME_FILE = path.join(os.homedir(), '.itb-test-manager', 'mock-runtime.json');

let db: Database | null = null;

// SQLite mirror of just the ITB tables itb-test-manager reads/writes.
// Column names match ITB's MySQL schema where dbQuery() expects them.
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS Communities (
  id INTEGER PRIMARY KEY,
  sname TEXT, fname TEXT, api_key TEXT UNIQUE, description TEXT, domain INTEGER
);
CREATE TABLE IF NOT EXISTS Domains (
  id INTEGER PRIMARY KEY,
  sname TEXT, fname TEXT, api_key TEXT UNIQUE, description TEXT
);
CREATE TABLE IF NOT EXISTS Specifications (
  id INTEGER PRIMARY KEY,
  sname TEXT, fname TEXT, api_key TEXT UNIQUE, description TEXT,
  domain INTEGER, is_hidden INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS Actors (
  id INTEGER PRIMARY KEY,
  actorId TEXT, name TEXT, description TEXT, api_key TEXT UNIQUE,
  is_default INTEGER DEFAULT 0, is_hidden INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS SpecificationHasActors (
  spec_id INTEGER, actor_id INTEGER,
  PRIMARY KEY(spec_id, actor_id)
);
CREATE TABLE IF NOT EXISTS TestSuites (
  id INTEGER PRIMARY KEY,
  sname TEXT, fname TEXT, identifier TEXT, api_key TEXT
);
CREATE TABLE IF NOT EXISTS SpecificationHasTestSuites (
  spec INTEGER, testsuite INTEGER,
  PRIMARY KEY(spec, testsuite)
);
CREATE TABLE IF NOT EXISTS TestCases (
  id INTEGER PRIMARY KEY,
  sname TEXT, fname TEXT, identifier TEXT
);
CREATE TABLE IF NOT EXISTS TestSuiteHasTestCases (
  testsuite INTEGER, testcase INTEGER,
  PRIMARY KEY(testsuite, testcase)
);
CREATE TABLE IF NOT EXISTS TestCaseHasActors (
  testcase INTEGER, specification INTEGER, actor INTEGER, sut INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(testcase, specification, actor)
);
CREATE TABLE IF NOT EXISTS Organizations (
  id INTEGER PRIMARY KEY,
  sname TEXT, fname TEXT, api_key TEXT UNIQUE,
  community INTEGER, admin_organization INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS Systems (
  id INTEGER PRIMARY KEY,
  sname TEXT, fname TEXT, description TEXT, api_key TEXT UNIQUE,
  version TEXT, owner INTEGER
);
CREATE TABLE IF NOT EXISTS SystemImplementsActors (
  sut_id INTEGER, actor_id INTEGER,
  PRIMARY KEY(sut_id, actor_id)
);
CREATE TABLE IF NOT EXISTS testresults (
  test_session_id TEXT PRIMARY KEY,
  sut_id INTEGER, sut TEXT,
  organization_id INTEGER, organization TEXT,
  community_id INTEGER, community TEXT,
  domain_id INTEGER, domain TEXT,
  specification_id INTEGER, specification TEXT,
  actor_id INTEGER, actor TEXT,
  testsuite_id INTEGER, testsuite TEXT,
  testcase_id INTEGER, testcase TEXT,
  result TEXT NOT NULL, start_time TEXT, end_time TEXT,
  output_message TEXT
);
`;

function ensureDir(p: string) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function persistRuntime() {
  if (!db) return;
  try {
    const bytes = db.export(); // Uint8Array
    const b64 = Buffer.from(bytes).toString('base64');
    ensureDir(RUNTIME_FILE);
    fs.writeFileSync(RUNTIME_FILE, JSON.stringify({ dbBase64: b64 } as RuntimeState));
  } catch (e: any) {
    console.warn('[mock] persistRuntime failed:', e.message);
  }
}

function loadRuntime(): Uint8Array | null {
  try {
    const raw = fs.readFileSync(RUNTIME_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as RuntimeState;
    if (parsed.dbBase64) return Buffer.from(parsed.dbBase64, 'base64');
  } catch { /* not yet persisted — fall through to seed from fixture */ }
  return null;
}

// ── Fixture loading ────────────────────────────────────────────────────
function readFixture(fixturePath: string): any {
  const raw = fs.readFileSync(fixturePath, 'utf-8');
  return yaml.load(raw) || {};
}

function seedFromFixture(d: Database, fixturePath: string) {
  const fixture = readFixture(fixturePath);

  // (spec_id, actorId) → numeric actor.id. Scoped by spec because the same
  // GITB actorId (e.g. "Client") may exist on multiple specs as distinct rows.
  const actorIdBySpecAndName: Record<string, number> = {};

  // Communities
  for (const c of fixture.communities || []) {
    d.run(
      `INSERT INTO Communities (id, sname, fname, api_key, description, domain) VALUES (?, ?, ?, ?, ?, ?)`,
      [c.id, c.sname || '', c.fname || c.sname || '', c.api_key || '', c.description || '', c.domain ?? null]
    );
  }
  for (const dom of fixture.domains || []) {
    d.run(
      `INSERT INTO Domains (id, sname, fname, api_key, description) VALUES (?, ?, ?, ?, ?)`,
      [dom.id, dom.sname || '', dom.fname || dom.sname || '', dom.api_key || '', dom.description || '']
    );
  }
  for (const s of fixture.specifications || []) {
    d.run(
      `INSERT INTO Specifications (id, sname, fname, api_key, description, domain, is_hidden) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [s.id, s.sname || '', s.fname || s.sname || '', s.api_key || '', s.description || '', s.domain ?? null, s.is_hidden ? 1 : 0]
    );
  }
  for (const a of fixture.actors || []) {
    d.run(
      `INSERT INTO Actors (id, actorId, name, description, api_key, is_default, is_hidden) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [a.id, a.actorId || '', a.name || a.actorId || '', a.description || '', a.api_key || '', a.is_default ? 1 : 0, a.is_hidden ? 1 : 0]
    );
    if (a.spec) {
      d.run(`INSERT OR IGNORE INTO SpecificationHasActors (spec_id, actor_id) VALUES (?, ?)`, [a.spec, a.id]);
      actorIdBySpecAndName[`${a.spec}|${a.actorId}`] = a.id;
    }
  }
  for (const ts of fixture.testsuites || []) {
    d.run(`INSERT INTO TestSuites (id, sname, fname, identifier) VALUES (?, ?, ?, ?)`,
      [ts.id, ts.sname || '', ts.fname || ts.sname || '', ts.sname || '']);
    if (ts.spec) {
      d.run(`INSERT OR IGNORE INTO SpecificationHasTestSuites (spec, testsuite) VALUES (?, ?)`, [ts.spec, ts.id]);
    }
  }
  for (const tc of fixture.testcases || []) {
    d.run(`INSERT INTO TestCases (id, sname, fname, identifier) VALUES (?, ?, ?, ?)`,
      [tc.id, tc.sname || '', tc.fname || tc.sname || '', tc.sname || '']);
    if (tc.suite) {
      d.run(`INSERT OR IGNORE INTO TestSuiteHasTestCases (testsuite, testcase) VALUES (?, ?)`, [tc.suite, tc.id]);
    }
    // SUT / simulated actor mapping (ITB's TestCaseHasActors).
    // Scope the actor-name lookup by spec — same GITB id can exist twice.
    for (const actorName of (tc.actors_sut || [])) {
      const aid = tc.spec ? actorIdBySpecAndName[`${tc.spec}|${actorName}`] : undefined;
      if (aid && tc.spec) {
        d.run(`INSERT OR IGNORE INTO TestCaseHasActors (testcase, specification, actor, sut) VALUES (?, ?, ?, 1)`,
          [tc.id, tc.spec, aid]);
      }
    }
    for (const actorName of (tc.actors_simulated || [])) {
      const aid = tc.spec ? actorIdBySpecAndName[`${tc.spec}|${actorName}`] : undefined;
      if (aid && tc.spec) {
        d.run(`INSERT OR IGNORE INTO TestCaseHasActors (testcase, specification, actor, sut) VALUES (?, ?, ?, 0)`,
          [tc.id, tc.spec, aid]);
      }
    }
  }
  for (const o of fixture.organisations || []) {
    d.run(`INSERT INTO Organizations (id, sname, fname, api_key, community, admin_organization) VALUES (?, ?, ?, ?, ?, ?)`,
      [o.id, o.sname || '', o.fname || o.sname || '', o.api_key || '', o.community ?? null, o.admin_organization ? 1 : 0]);
  }
  for (const s of fixture.systems || []) {
    d.run(`INSERT INTO Systems (id, sname, fname, description, api_key, version, owner) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [s.id, s.sname || '', s.fname || s.sname || '', s.description || '', s.api_key || '', s.version || '1.0', s.owner ?? null]);
  }
  // Conformance: resolve api_key strings to numeric ids
  for (const c of fixture.conformance || []) {
    const sysRow = d.exec(`SELECT id FROM Systems WHERE api_key = ?`, [c.system]);
    const actorRow = d.exec(`SELECT id FROM Actors WHERE api_key = ?`, [c.actor]);
    const sid = sysRow[0]?.values?.[0]?.[0];
    const aid = actorRow[0]?.values?.[0]?.[0];
    if (sid != null && aid != null) {
      d.run(`INSERT OR IGNORE INTO SystemImplementsActors (sut_id, actor_id) VALUES (?, ?)`, [sid, aid]);
    }
  }
  for (const r of fixture.test_results || []) {
    const sysRow = d.exec(`SELECT id FROM Systems WHERE api_key = ?`, [r.sut]);
    const actorRow = d.exec(`SELECT id FROM Actors WHERE api_key = ?`, [r.actor]);
    const sid = sysRow[0]?.values?.[0]?.[0];
    const aid = actorRow[0]?.values?.[0]?.[0];
    d.run(
      `INSERT OR REPLACE INTO testresults ` +
      `(test_session_id, sut_id, actor_id, specification_id, testsuite_id, testcase_id, result, start_time, end_time) ` +
      `VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [r.test_session_id, sid ?? null, aid ?? null, r.spec ?? null, r.suite ?? null, r.testcase ?? null,
       r.result || 'RUNNING', r.start_time || '2026-05-01 00:00:00', r.end_time || null]
    );
  }
}

// ── Public init ────────────────────────────────────────────────────────
let initialized = false;
let mockItbBase = 'http://mock-itb.local:10003';

export async function initMock(fixturePath: string): Promise<void> {
  if (initialized) return;
  const SQL = await initSqlJs({});
  const persisted = loadRuntime();
  if (persisted) {
    db = new SQL.Database(persisted);
    console.log('[mock] loaded runtime DB from', RUNTIME_FILE);
  } else {
    db = new SQL.Database();
    db.run('PRAGMA foreign_keys = OFF;');
    db.exec(SCHEMA_SQL);
    seedFromFixture(db, fixturePath);
    persistRuntime();
    console.log('[mock] seeded fresh DB from', fixturePath);
  }

  // Pull mock itb_url out of the fixture for the URL builder.
  try {
    const fx = readFixture(fixturePath);
    if (fx.itb_url) mockItbBase = String(fx.itb_url);
  } catch { /* ignore */ }

  initialized = true;
}

// ── Mock dbQuery ───────────────────────────────────────────────────────
// Returns the same tab-separated, newline-joined format as the real
// `dbQuery` (which shells out to `mysql -N`). Empty string on error.
//
// SQLite is stricter than MySQL on a few functions. Rewrite the common ones
// in the SQL string before exec; expand the list as new dialect mismatches
// surface during dev:
//   - UNIX_TIMESTAMP(x) → CAST(strftime('%s', x) AS INTEGER)
//   - NOW()             → datetime('now')
//   - CURDATE()         → date('now')
//   - IFNULL/COALESCE work in both, no rewrite needed.
function translateMysqlToSqlite(sql: string): string {
  return sql
    .replace(/UNIX_TIMESTAMP\s*\(([^)]+)\)/gi, "CAST(strftime('%s', $1) AS INTEGER)")
    .replace(/\bNOW\s*\(\s*\)/gi, "datetime('now')")
    .replace(/\bCURDATE\s*\(\s*\)/gi, "date('now')");
}

export function mockDbQuery(sql: string): string {
  if (!db) return '';
  try {
    sql = translateMysqlToSqlite(sql);
    const rs = db.exec(sql);
    if (rs.length === 0) return '';
    const lines: string[] = [];
    for (const row of rs[0].values) {
      lines.push(row.map(v => v === null || v === undefined ? '' : String(v)).join('\t'));
    }
    return lines.join('\n');
  } catch (e: any) {
    console.warn('[mock] dbQuery failed:', e.message, '\n  SQL:', sql.slice(0, 200));
    return '';
  }
}

// ── Mock itbFetch ──────────────────────────────────────────────────────
// Routes the small set of ITB REST endpoints itb-test-manager calls.
// Returns a Response-shaped object compatible with the existing callsites.
function jsonResp(status: number, body: any): MockResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => typeof body === 'string' ? body : JSON.stringify(body),
  };
}

function nextId(table: string): number {
  if (!db) return 1;
  const r = db.exec(`SELECT COALESCE(MAX(id), 0) + 1 FROM ${table}`);
  return Number(r[0]?.values?.[0]?.[0] || 1);
}

function genApiKey(prefix: string): string {
  // Mock api_keys look obviously fake; real ITB uses 32-char hex with X separators.
  return `MOCK_${prefix}_${Date.now().toString(36).toUpperCase()}_${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export async function mockItbFetch(urlPath: string, opts: any = {}): Promise<MockResponse> {
  if (!db) return jsonResp(503, { error: 'mock not initialized' });
  const method = (opts.method || 'GET').toUpperCase();
  const body = opts.body ? safeParseJson(opts.body) : null;

  // Strip any leading /api/rest if it's there (existing wrapper adds it,
  // but defensively support both).
  const cleanPath = urlPath.replace(/^\/api\/rest/, '');

  // GET /domains
  if (method === 'GET' && cleanPath === '/domains') {
    const rs = db.exec(`SELECT id, sname, fname, api_key, description FROM Domains ORDER BY sname`);
    const rows = (rs[0]?.values || []).map(([id, sname, fname, api_key, description]) => ({
      id, shortName: sname, fullName: fname, apiKey: api_key, description,
    }));
    return jsonResp(200, rows);
  }

  // GET /domain/:key/specifications
  let m = cleanPath.match(/^\/domain\/([^/]+)\/specifications$/);
  if (method === 'GET' && m) {
    const key = m[1];
    const rs = db.exec(
      `SELECT s.id, s.sname, s.fname, s.api_key, s.description ` +
      `FROM Specifications s JOIN Domains d ON d.id = s.domain ` +
      `WHERE d.api_key = ? AND s.is_hidden = 0 ORDER BY s.sname`,
      [key]
    );
    const rows = (rs[0]?.values || []).map(([id, sname, fname, api_key, description]) => ({
      id, shortName: sname, fullName: fname, apiKey: api_key, description,
    }));
    return jsonResp(200, rows);
  }

  // GET /specification/:key
  m = cleanPath.match(/^\/specification\/([^/]+)$/);
  if (method === 'GET' && m) {
    const key = m[1];
    const rs = db.exec(`SELECT id, sname, fname, api_key, description FROM Specifications WHERE api_key = ?`, [key]);
    const r = rs[0]?.values?.[0];
    if (!r) return jsonResp(404, { error: 'not found' });
    return jsonResp(200, { id: r[0], shortName: r[1], fullName: r[2], apiKey: r[3], description: r[4] });
  }

  // GET /specification/:key/actors
  m = cleanPath.match(/^\/specification\/([^/]+)\/actors$/);
  if (method === 'GET' && m) {
    const key = m[1];
    const rs = db.exec(
      `SELECT a.id, a.actorId, a.name, a.description, a.api_key, a.is_default ` +
      `FROM Actors a ` +
      `JOIN SpecificationHasActors sha ON sha.actor_id = a.id ` +
      `JOIN Specifications s ON s.id = sha.spec_id ` +
      `WHERE s.api_key = ? AND a.is_hidden = 0 ORDER BY a.is_default DESC, a.actorId`,
      [key]
    );
    const rows = (rs[0]?.values || []).map(([id, actorId, name, description, api_key, isDef]) => ({
      id, actorId, name, description, apiKey: api_key, default: !!isDef,
    }));
    return jsonResp(200, rows);
  }

  // GET /organisation — list orgs
  if (method === 'GET' && cleanPath === '/organisation') {
    const rs = db.exec(`SELECT id, sname, fname, api_key, community FROM Organizations ORDER BY sname`);
    const rows = (rs[0]?.values || []).map(([id, sname, fname, api_key, community]) => ({
      id, shortName: sname, fullName: fname, apiKey: api_key, community,
    }));
    return jsonResp(200, rows);
  }

  // PUT /organisation — create
  if (method === 'PUT' && cleanPath === '/organisation') {
    const id = nextId('Organizations');
    const apiKey = genApiKey('ORG');
    const sname = String(body?.shortName || `org-${id}`);
    const fname = String(body?.fullName || sname);
    const community = Number(body?.community || 1); // default to first non-admin community
    db.run(
      `INSERT INTO Organizations (id, sname, fname, api_key, community, admin_organization) VALUES (?, ?, ?, ?, ?, 0)`,
      [id, sname, fname, apiKey, community]
    );
    persistRuntime();
    return jsonResp(200, { id, shortName: sname, fullName: fname, apiKey, community });
  }

  // PUT /system — create
  if (method === 'PUT' && cleanPath === '/system') {
    const id = nextId('Systems');
    const apiKey = genApiKey('SYS');
    const sname = String(body?.shortName || `system-${id}`);
    const fname = String(body?.fullName || sname);
    const description = String(body?.description || '');
    const version = String(body?.version || '1.0');
    // body.organisation is the org's apiKey — resolve to numeric id
    const orgKey = String(body?.organisation || '');
    let ownerId: number | null = null;
    const orgRow = db.exec(`SELECT id FROM Organizations WHERE api_key = ?`, [orgKey]);
    if (orgRow[0]?.values?.[0]?.[0]) ownerId = Number(orgRow[0].values[0][0]);
    if (ownerId === null) return jsonResp(400, { error: 'unknown organisation' });
    db.run(
      `INSERT INTO Systems (id, sname, fname, description, api_key, version, owner) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, sname, fname, description, apiKey, version, ownerId]
    );
    persistRuntime();
    return jsonResp(200, { id, shortName: sname, fullName: fname, apiKey, owner: ownerId });
  }

  // PUT /actor — create (rare in registration; admins use it on import)
  if (method === 'PUT' && cleanPath === '/actor') {
    const id = nextId('Actors');
    const apiKey = genApiKey('ACTOR');
    const actorId = String(body?.identifier || `actor-${id}`);
    const name = String(body?.name || actorId);
    const description = String(body?.description || '');
    const isDefault = body?.default ? 1 : 0;
    db.run(
      `INSERT INTO Actors (id, actorId, name, description, api_key, is_default, is_hidden) VALUES (?, ?, ?, ?, ?, ?, 0)`,
      [id, actorId, name, description, apiKey, isDefault]
    );
    if (body?.specification) {
      const specRow = db.exec(`SELECT id FROM Specifications WHERE api_key = ?`, [String(body.specification)]);
      const sid = specRow[0]?.values?.[0]?.[0];
      if (sid != null) {
        db.run(`INSERT OR IGNORE INTO SpecificationHasActors (spec_id, actor_id) VALUES (?, ?)`, [sid, id]);
      }
    }
    persistRuntime();
    return jsonResp(200, { id, actorId, apiKey });
  }

  // PUT /conformance/{system}/{actor} — create conformance statement
  m = cleanPath.match(/^\/conformance\/([^/]+)\/([^/]+)$/);
  if (method === 'PUT' && m) {
    const sysKey = m[1];
    const actorKey = m[2];
    const sysRow = db.exec(`SELECT id FROM Systems WHERE api_key = ?`, [sysKey]);
    const actorRow = db.exec(`SELECT id FROM Actors WHERE api_key = ?`, [actorKey]);
    const sid = sysRow[0]?.values?.[0]?.[0];
    const aid = actorRow[0]?.values?.[0]?.[0];
    if (sid == null || aid == null) return jsonResp(404, { error: 'not found' });
    db.run(`INSERT OR IGNORE INTO SystemImplementsActors (sut_id, actor_id) VALUES (?, ?)`, [sid, aid]);
    persistRuntime();
    return jsonResp(200, { ok: true });
  }

  // PUT /community / /domain / /specification — admin-only create. Stub
  // these with simple "OK + new key" responses so the admin UI path doesn't
  // explode in mock mode (full schema/admin UX testing is out of scope).
  if (method === 'PUT' && (cleanPath === '/community' || cleanPath === '/domain' || cleanPath === '/specification')) {
    const apiKey = genApiKey(cleanPath.slice(1).toUpperCase());
    return jsonResp(200, { apiKey, shortName: body?.shortName, fullName: body?.fullName });
  }

  return jsonResp(404, { error: `mock: no handler for ${method} ${cleanPath}` });
}

function safeParseJson(s: any): any {
  if (typeof s !== 'string') return s;
  try { return JSON.parse(s); } catch { return s; }
}

export function mockItbBaseUrl(): string {
  return mockItbBase;
}
