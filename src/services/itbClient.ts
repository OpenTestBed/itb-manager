// ITB (Interoperability Test Bed) REST API client
import JSZip from 'jszip';
import type { GeneratedFile } from '../parser/xmlGenerator';

export interface ITBConfig {
  baseUrl: string;         // e.g. http://localhost:9000
  deployPath: string;      // e.g. /api/rest/testsuite/deploy
  masterApiKey?: string;       // master API key for creating communities/domains
  organisationApiKey?: string; // organisation API key for test execution
  communityApiKey?: string;    // community API key for deployment (needs "manage test suites")
  specificationId?: string;    // target specification ID for deployment
  apiKey?: string;             // legacy — falls back for deploy if communityApiKey not set
  systemApiKey?: string;       // system API key for test execution
  // Numeric IDs for ITB UI URLs (not available via REST API)
  communityId?: string;
  organisationId?: string;
  systemId?: string;
  actorId?: string;
  testSuiteId?: string;
}

export interface ITBDeployResult {
  success: boolean;
  message: string;
  details?: any;
  url?: string;            // the URL that was called
}

const STORAGE_KEY = 'itb-config';

/**
 * Defaults come from .env (VITE_ITB_*) with sensible fallbacks.
 */
function envDefaults(): ITBConfig {
  return {
    baseUrl: import.meta.env.VITE_ITB_BASE_URL || 'http://localhost:9000',
    deployPath: import.meta.env.VITE_ITB_DEPLOY_PATH || '/api/rest/testsuite/deploy',
    masterApiKey: import.meta.env.VITE_ITB_MASTER_API_KEY || undefined,
    organisationApiKey: import.meta.env.VITE_ITB_ORGANISATION_API_KEY || undefined,
    systemApiKey: import.meta.env.VITE_ITB_SYSTEM_API_KEY || undefined,
    communityApiKey: import.meta.env.VITE_ITB_COMMUNITY_API_KEY || undefined,
    specificationId: import.meta.env.VITE_ITB_SPECIFICATION_ID || undefined,
  };
}

export function loadITBConfig(): ITBConfig {
  const defaults = envDefaults();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...defaults, ...parsed };
    }
  } catch { /* ignore */ }
  return defaults;
}

export function saveITBConfig(config: ITBConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

/**
 * Rewrite an ITB URL to go through the Vite dev proxy when the
 * target origin differs from the current page (avoids CORS).
 * The target base URL is encoded into the proxy path so the
 * middleware knows where to forward the request.
 */
function proxyUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  try {
    const target = new URL(base);
    const current = window.location;
    const sameOrigin =
      target.hostname === current.hostname && target.port === current.port;
    if (sameOrigin) return `${base}${path}`;
  } catch { /* invalid URL — fall through to proxy */ }
  // Encode target base as first path segment: /itb-proxy/<encoded-base>/rest/of/path
  return `/itb-proxy/${encodeURIComponent(base)}${path}`;
}

/**
 * Build a ZIP archive from the generated XML files.
 */
async function buildZip(files: GeneratedFile[]): Promise<Blob> {
  const zip = new JSZip();
  for (const file of files) {
    zip.file(file.filename, file.xml);
  }
  return zip.generateAsync({ type: 'blob' });
}

/**
 * Deploy a test suite ZIP to the ITB instance.
 */
export async function deployToITB(
  files: GeneratedFile[],
  config: ITBConfig
): Promise<ITBDeployResult> {
  if (!config.baseUrl) {
    return { success: false, message: 'ITB base URL is not configured.' };
  }

  const zipBlob = await buildZip(files);

  const form = new FormData();
  form.append('testSuite', zipBlob, 'testsuite.zip');
  form.append('updateSpecification', 'true');
  if (config.specificationId) {
    form.append('specification', config.specificationId);
  }

  const deployPath = config.deployPath || '/api/rest/testsuite/deploy';
  const url = proxyUrl(config.baseUrl, deployPath);
  const targetUrl = `${config.baseUrl.replace(/\/+$/, '')}${deployPath}`;

  const headers: Record<string, string> = {};
  // Deploy uses the community API key (needs "manage test suites" permission)
  const deployKey = config.communityApiKey;
  if (deployKey) {
    headers['ITB_API_KEY'] = deployKey;
  }

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: form,
    });

    const contentType = resp.headers.get('content-type') || '';
    let body: any;
    if (contentType.includes('json')) {
      body = await resp.json();
    } else {
      body = await resp.text();
    }

    if (resp.ok) {
      return {
        success: true,
        message: `Deployed successfully (${resp.status}).`,
        details: body,
        url: targetUrl,
      };
    } else {
      const errMsg = typeof body === 'string'
        ? body.substring(0, 200)
        : body?.message || body?.error || JSON.stringify(body).substring(0, 200);
      return {
        success: false,
        message: `${resp.status} from POST ${deployPath}: ${errMsg}`,
        details: body,
        url: targetUrl,
      };
    }
  } catch (err: any) {
    return {
      success: false,
      message: `Connection error: ${err?.message || err}`,
      url: targetUrl,
    };
  }
}

/**
 * Quick health check — try to reach the ITB base and check if the REST API is enabled.
 * A 5xx means the server is up but unhealthy.
 */
export async function checkITBHealth(baseUrl: string): Promise<{ ok: boolean; message: string }> {
  // First check if the server responds at all
  const rootUrl = proxyUrl(baseUrl, '/');
  try {
    const resp = await fetch(rootUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    if (resp.status >= 500) {
      return { ok: false, message: `ITB responded with server error (${resp.status})` };
    }
  } catch (err: any) {
    return { ok: false, message: `Cannot reach ITB: ${err?.message || err}` };
  }
  // Check if the REST API is enabled by fetching the OpenAPI spec
  const apiUrl = proxyUrl(baseUrl, '/api/rest');
  try {
    const resp = await fetch(apiUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    if (resp.status === 200) {
      const body = await resp.text().catch(() => '');
      if (body.includes('openapi')) {
        return { ok: true, message: 'ITB reachable, REST API enabled' };
      }
    }
    return { ok: false, message: 'ITB reachable but REST API not enabled (set AUTOMATION_API_ENABLED=true)' };
  } catch {
    return { ok: false, message: 'ITB reachable but REST API not available' };
  }
}

/**
 * Validate a master API key by attempting GET /api/rest/domains.
 * With a valid master key this returns 200; invalid returns 403.
 */
export async function checkMasterKey(baseUrl: string, masterKey: string): Promise<{ ok: boolean; message: string }> {
  const url = proxyUrl(baseUrl, '/api/rest/domains');
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: { 'ITB_API_KEY': masterKey },
      signal: AbortSignal.timeout(5000),
    });
    if (resp.status === 200) {
      return { ok: true, message: 'Master key valid' };
    }
    const body = await resp.json().catch(() => null);
    if (resp.status === 403 || resp.status === 401) {
      return { ok: false, message: body?.error_description || 'Master key rejected' };
    }
    return { ok: false, message: `Unexpected response (${resp.status})` };
  } catch (err: any) {
    return { ok: false, message: `Connection error: ${err?.message || err}` };
  }
}

/**
 * Validate an organisation API key via POST /api/rest/tests/status.
 * A valid key returns 200, an invalid one returns 403.
 */
export async function checkOrganisationKey(baseUrl: string, apiKey: string): Promise<{ ok: boolean; message: string }> {
  const url = proxyUrl(baseUrl, '/api/rest/tests/status');
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'ITB_API_KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ session: [] }),
      signal: AbortSignal.timeout(5000),
    });
    if (resp.status === 200) {
      return { ok: true, message: 'API key valid' };
    }
    const body = await resp.json().catch(() => null);
    if (body?.error_description?.includes('API key') || body?.error_code === '204') {
      return { ok: false, message: 'API key not recognized' };
    }
    if (resp.status === 403 || resp.status === 401) {
      return { ok: false, message: 'API key rejected' };
    }
    return { ok: false, message: `Unexpected response (${resp.status}): ${body?.error_description || ''}` };
  } catch (err: any) {
    return { ok: false, message: `Connection error: ${err?.message || err}` };
  }
}

/**
 * Validate a system API key via GET /api/rest/conformance/{system}/{dummyActor}.
 * Uses the organisation key for auth. A valid system key returns a specific error
 * about the actor; an invalid system key returns a different error.
 */
export async function checkSystemKey(baseUrl: string, orgApiKey: string, systemApiKey: string): Promise<{ ok: boolean; message: string }> {
  const url = proxyUrl(baseUrl, `/api/rest/conformance/${systemApiKey}/DUMMY_ACTOR_KEY`);
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: { 'ITB_API_KEY': orgApiKey },
      signal: AbortSignal.timeout(5000),
    });
    const body = await resp.json().catch(() => null);
    if (resp.status === 200) {
      // Shouldn't happen with dummy actor, but means both keys are valid
      return { ok: true, message: 'System key valid' };
    }
    // If the error mentions the actor (not the system), the system key is valid
    if (body?.error_description?.includes('actor') || body?.error_description?.includes('DUMMY_ACTOR_KEY')) {
      return { ok: true, message: 'System key valid' };
    }
    // If it mentions the system key, it's invalid
    if (body?.error_description?.includes('system')) {
      return { ok: false, message: 'System key not found' };
    }
    if (body?.error_description?.includes('API key')) {
      return { ok: false, message: 'Organisation key invalid (required to verify system key)' };
    }
    return { ok: false, message: `Unexpected response (${resp.status}): ${body?.error_description || ''}` };
  } catch (err: any) {
    return { ok: false, message: `Connection error: ${err?.message || err}` };
  }
}

/**
 * Validate a community API key via POST /api/rest/testsuite/deploy with no payload.
 * A valid key returns 400 "Failed to parse provided payload" (key accepted, body missing).
 * An invalid key returns 403 or an error about the API key.
 */
export async function checkCommunityKey(baseUrl: string, communityApiKey: string): Promise<{ ok: boolean; message: string }> {
  const url = proxyUrl(baseUrl, '/api/rest/testsuite/deploy');
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'ITB_API_KEY': communityApiKey,
        'Content-Type': 'application/json',
      },
      body: '{}',
      signal: AbortSignal.timeout(5000),
    });
    const body = await resp.json().catch(() => null);
    // 103 with "not valid" = key is valid, just bad payload (empty JSON)
    // 400 with "Failed to parse" = also key valid, bad payload
    if (body?.error_code === '103' && body?.error_description?.includes('not valid')) {
      return { ok: true, message: 'Community API key valid' };
    }
    if (resp.status === 400 && body?.error_description?.includes('parse')) {
      return { ok: true, message: 'Community API key valid' };
    }
    // "not allowed to manage" = key valid but wrong permissions
    if (body?.error_description?.includes('not allowed')) {
      return { ok: false, message: 'Key valid but lacks "manage test suites" permission' };
    }
    if (body?.error_description?.includes('API key') || body?.error_code === '204') {
      return { ok: false, message: 'Community API key not recognized' };
    }
    if (resp.status === 403 || resp.status === 401) {
      return { ok: false, message: 'Community API key rejected' };
    }
    return { ok: false, message: `Unexpected response (${resp.status}): ${body?.error_description || ''}` };
  } catch (err: any) {
    return { ok: false, message: `Connection error: ${err?.message || err}` };
  }
}

/**
 * Validate the specification ID by fetching it from the ITB REST API.
 */
export async function checkSpecification(baseUrl: string, apiKey: string, specificationId: string): Promise<{ ok: boolean; message: string }> {
  if (!specificationId.trim()) {
    return { ok: false, message: 'Specification ID is empty' };
  }
  const url = proxyUrl(baseUrl, `/api/rest/specification/${specificationId}`);
  try {
    const resp = await fetch(url, {
      headers: { 'ITB_API_KEY': apiKey },
      signal: AbortSignal.timeout(5000),
    });
    if (resp.ok) {
      const data = await resp.json();
      return { ok: true, message: `Specification: ${data.fullName || data.shortName}` };
    }
    if (resp.status === 404) {
      return { ok: false, message: 'Specification not found' };
    }
    return { ok: false, message: `ITB returned ${resp.status}` };
  } catch (err: any) {
    return { ok: false, message: `Connection error: ${err?.message || err}` };
  }
}

/**
 * Probe common REST API paths to help discover the right deploy endpoint.
 */
export async function discoverEndpoints(baseUrl: string): Promise<{ path: string; status: number }[]> {
  const candidates = [
    '/api/rest/testsuite/deploy',
    '/rest/api/testsuite/deploy',
    '/api/v1/testsuite/deploy',
    '/gitb/api/rest/testsuite/deploy',
    '/api/rest/testsuite',
    '/api/rest',
    '/api',
  ];

  const results: { path: string; status: number }[] = [];

  for (const path of candidates) {
    try {
      const url = proxyUrl(baseUrl, path);
      const resp = await fetch(url, {
        method: 'OPTIONS',
        signal: AbortSignal.timeout(3000),
      });
      results.push({ path, status: resp.status });
    } catch {
      // skip unreachable paths
    }
  }

  return results;
}

// ── Test Execution ──────────────────────────────────────────────────

export interface ITBTestResult {
  sessionId?: string;
  result?: string;   // SUCCESS, FAILURE, UNDEFINED
  message: string;
  details?: any;
}

/**
 * Get actors for the specification (to find actor API keys for test execution).
 */
export async function getSpecificationActors(config: ITBConfig): Promise<any[]> {
  if (!config.specificationId) return [];
  const url = proxyUrl(config.baseUrl, `/api/rest/specification/${config.specificationId}/actors`);
  // Try community key first (has broader access), fall back to org key
  const apiKey = config.communityApiKey || config.organisationApiKey || config.apiKey || '';
  const headers: Record<string, string> = {};
  if (apiKey) headers['ITB_API_KEY'] = apiKey;
  try {
    const resp = await fetch(url, { headers });
    if (resp.ok) return await resp.json();
  } catch { /* ignore */ }
  return [];
}

/**
 * Get or create a system for test execution.
 */
export async function ensureSystem(config: ITBConfig): Promise<string | null> {
  if (config.systemApiKey) return config.systemApiKey;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.organisationApiKey) headers['ITB_API_KEY'] = config.organisationApiKey;

  // Create a system
  const url = proxyUrl(config.baseUrl, '/api/rest/system');
  try {
    const resp = await fetch(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        shortName: 'TestSUT',
        fullName: 'Test System Under Test',
        description: 'Auto-created by Gherkin FHIR Compiler',
        version: '1.0',
      }),
    });
    if (resp.ok) {
      const data = await resp.json();
      return data.apiKey || null;
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Ensure a conformance statement exists between system and actor.
 */
export async function ensureConformance(config: ITBConfig, systemApiKey: string, actorApiKey: string): Promise<boolean> {
  const url = proxyUrl(config.baseUrl, `/api/rest/conformance/${systemApiKey}/${actorApiKey}`);
  const headers: Record<string, string> = {};
  if (config.organisationApiKey) headers['ITB_API_KEY'] = config.organisationApiKey;
  try {
    const resp = await fetch(url, { method: 'PUT', headers });
    return resp.ok;
  } catch { return false; }
}

/**
 * Start a test execution via ITB REST API.
 */
export async function startTest(
  config: ITBConfig,
  testCaseIds: string[],
  systemApiKey: string,
  actorApiKey: string,
): Promise<ITBTestResult[]> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.organisationApiKey) headers['ITB_API_KEY'] = config.organisationApiKey;
  const url = proxyUrl(config.baseUrl, '/api/rest/tests/start');

  const results: ITBTestResult[] = [];

  for (const testId of testCaseIds) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          testCase: testId,
          system: systemApiKey,
          actor: actorApiKey,
          forceSequentialExecution: true,
        }),
      });
      const data = await resp.json();
      if (resp.ok) {
        // Wait for result
        const sessionId = data.sessionId || data.session;
        if (sessionId) {
          const statusResult = await pollTestStatus(config, sessionId);
          results.push(statusResult);
        } else {
          results.push({ message: 'Test started but no session ID returned', details: data });
        }
      } else {
        results.push({ message: `Failed to start test: ${data?.message || resp.status}`, details: data });
      }
    } catch (err: any) {
      results.push({ message: `Error: ${err?.message || err}` });
    }
  }
  return results;
}

/**
 * Poll test status until completion.
 */
async function pollTestStatus(config: ITBConfig, sessionId: string): Promise<ITBTestResult> {
  const headers: Record<string, string> = {};
  if (config.organisationApiKey) headers['ITB_API_KEY'] = config.organisationApiKey;
  const url = proxyUrl(config.baseUrl, `/api/rest/tests/status`);

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: sessionId }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.result && data.result !== 'UNDEFINED') {
          return {
            sessionId,
            result: data.result,
            message: `Test ${data.result}`,
            details: data,
          };
        }
      }
    } catch { /* retry */ }
  }
  return { sessionId, result: 'UNDEFINED', message: 'Test timed out waiting for result' };
}

/**
 * Resolve ITB numeric database IDs from API keys / identifiers.
 * Calls the Vite dev middleware at /api/itb-ids which queries MySQL via docker exec.
 */
export async function resolveITBIds(
  config: ITBConfig,
  deployDetails: any,
  sutActorId?: string,
): Promise<{ communityId?: number; organisationId?: number; systemId?: number; actorId?: number; testSuiteId?: number; testCaseId?: number }> {
  const suiteId = deployDetails?.identifiers?.testSuite || '';
  const testCases = deployDetails?.identifiers?.testCases || [];
  const firstTestCase = testCases[0] || '';
  const actorKeys = (deployDetails?.identifiers?.specifications?.[0]?.actors || [])
    .map((a: any) => a.identifier)
    .filter(Boolean);
  const orgKey = config.organisationApiKey || '';
  const sysKey = config.systemApiKey || '';
  const communityKey = config.communityApiKey || '';

  const params = new URLSearchParams({
    suite: suiteId,
    testcase: firstTestCase,
    actors: actorKeys.join(','),
    org: orgKey,
    system: sysKey,
    community: communityKey,
    sutActor: sutActorId || '',
  });

  try {
    const resp = await fetch(`/api/itb-ids?${params}`);
    if (resp.ok) {
      const data = await resp.json();
      console.log('[ITB] /api/itb-ids response:', data);
      return data;
    }
    console.warn('[ITB] /api/itb-ids returned', resp.status, await resp.text().catch(() => ''));
  } catch (err) {
    console.warn('[ITB] /api/itb-ids fetch failed:', err);
  }
  return {};
}

/**
 * Build the ITB UI URL — full execution URL if numeric IDs are available,
 * otherwise just the app home page.
 *
 * Format: {base}/app#/admin/users/community/{c}/organisation/{o}/test/{s}/{a}/execute?tc={tc}
 */
export function getITBAppUrl(config: ITBConfig, ids?: { communityId?: number; organisationId?: number; systemId?: number; actorId?: number; testSuiteId?: number; testCaseId?: number }): string {
  const base = config.baseUrl.replace(/\/+$/, '');
  const c = ids?.communityId || config.communityId;
  const o = ids?.organisationId || config.organisationId;
  const s = ids?.systemId || config.systemId;
  const a = ids?.actorId || config.actorId;
  // tc= is the test CASE id, not test suite id
  const tc = ids?.testCaseId || ids?.testSuiteId || config.testSuiteId;
  if (c && o && s && a) {
    let url = `${base}/app#/admin/users/community/${c}/organisation/${o}/test/${s}/${a}/execute`;
    if (tc) url += `?tc=${tc}`;
    return url;
  }
  return `${base}/app`;
}

/**
 * Resolve a session-scoped or context-scoped ITB UI URL from API keys at click time.
 * Hits /api/itb-ids to look up numeric IDs from the keys, then builds the deep link.
 *
 * Returns the deepest URL we can produce; falls back to {base}/app if any required
 * numeric ID is missing. Callers should treat the result as best-effort.
 *
 * Reused by:
 *  - "Run in ITB" buttons on Spec/System detail and matrix conformance rows
 *  - Per-cell click on the conformance matrix
 *  - Recent runs row "Open session" links
 */
export async function buildITBSessionUrl(
  config: ITBConfig,
  ctx: { systemKey?: string; actorKey?: string; specKey?: string; sessionId?: string | null },
): Promise<string> {
  const base = config.baseUrl.replace(/\/+$/, '');

  // Path A — sessionId provided: read IDs straight off the testresults row in ITB's DB.
  // This is the reliable path: ITB recorded community_id/organization_id/sut_id/actor_id
  // when the session ran, so we don't depend on itbConfig having every key populated.
  if (ctx.sessionId) {
    try {
      const resp = await fetch(`/api/itb-session-url?session=${encodeURIComponent(ctx.sessionId)}`);
      if (resp.ok) {
        const data = await resp.json();
        if (data?.url) return data.url;
      }
    } catch { /* fall through */ }
  }

  // Path B — no sessionId (or session lookup failed): resolve numeric IDs from API keys.
  const params = new URLSearchParams({
    org: config.organisationApiKey || '',
    system: ctx.systemKey || config.systemApiKey || '',
    community: config.communityApiKey || '',
    actors: ctx.actorKey || '',
    sutActor: ctx.actorKey || '',
  });
  let ids: any = {};
  try {
    const resp = await fetch(`/api/itb-ids?${params}`);
    if (resp.ok) ids = await resp.json();
  } catch { /* keep ids = {} */ }

  const c = ids.communityId || config.communityId;
  const o = ids.organisationId || config.organisationId;
  const s = ids.systemId || config.systemId;
  const a = ids.actorId || config.actorId;

  if (c && o && s && a) {
    let url = `${base}/app#/admin/users/community/${c}/organisation/${o}/test/${s}/${a}/execute`;
    if (ids.testCaseId) url += `?tc=${ids.testCaseId}`;
    else if (ids.testSuiteId) url += `?ts=${ids.testSuiteId}`;
    return url;
  }
  return `${base}/app`;
}
