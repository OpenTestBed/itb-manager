import { defineConfig, Plugin, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { createGunzip } from 'zlib'
import { Readable } from 'stream'
import yaml from 'js-yaml'

/** Docker MySQL settings for ITB ID resolution — read from .env at server start */
function getDbConfig(env: Record<string, string>) {
  return {
    container: env.ITB_MYSQL_CONTAINER || 'itb-mysql',
    user: env.ITB_MYSQL_USER || 'root',
    password: env.ITB_MYSQL_PASSWORD || 'root',
    database: env.ITB_MYSQL_DATABASE || 'gitb',
  };
}

/**
 * Vite dev plugin: resolve ITB numeric database IDs via docker exec → MySQL.
 * GET /api/itb-ids?suite=<identifier>&actors=<apiKey1,apiKey2>&org=<orgApiKey>
 */
/**
 * Vite dev plugin: dynamic reverse proxy for ITB API calls.
 * The target base URL is encoded in the path:
 *   /itb-proxy/<encoded-base-url>/rest/of/path
 * e.g. /itb-proxy/http%3A%2F%2Flocalhost%3A9000/api/rest/testsuite/deploy
 *   → forwards to http://localhost:9000/api/rest/testsuite/deploy
 */
function itbProxy(): Plugin {
  return {
    name: 'itb-proxy',
    configureServer(server) {
      server.middlewares.use('/itb-proxy', async (req, res) => {
        // Extract encoded base URL from path: /itb-proxy/<encoded-base>/rest...
        const rawPath = (req.url || '/');
        const afterPrefix = rawPath.replace(/^\//, ''); // remove leading /
        const slashIdx = afterPrefix.indexOf('/');
        if (slashIdx < 0) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'Missing target base in path' }));
          return;
        }
        const targetBase = decodeURIComponent(afterPrefix.substring(0, slashIdx));
        const path = afterPrefix.substring(slashIdx);
        const targetUrl = `${targetBase.replace(/\/+$/, '')}${path}`;

        try {
          // Collect request body
          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
          }
          const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 30000);

          // Forward headers (except host and the custom header)
          const fwdHeaders: Record<string, string> = {};
          for (const [k, v] of Object.entries(req.headers)) {
            if (k === 'host' || k === 'x-itb-target' || k === 'connection') continue;
            if (typeof v === 'string') fwdHeaders[k] = v;
          }

          const resp = await fetch(targetUrl, {
            method: req.method || 'GET',
            headers: fwdHeaders,
            body: body && body.length > 0 ? body : undefined,
            signal: controller.signal,
            // @ts-ignore -- duplex required for node fetch with body
            duplex: body ? 'half' : undefined,
          });
          clearTimeout(timeout);

          res.statusCode = resp.status;
          // Forward response headers
          for (const [k, v] of resp.headers.entries()) {
            if (k === 'transfer-encoding') continue;
            res.setHeader(k, v);
          }
          const respBody = await resp.arrayBuffer();
          res.end(Buffer.from(respBody));
        } catch (err: any) {
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err?.message || 'proxy error' }));
        }
      });
    },
  };
}

/**
 * Vite dev plugin: proxy health checks to avoid CORS issues.
 * GET /api/health-proxy?url=<encoded-url>&method=<GET|POST>
 */
function healthProxy(): Plugin {
  return {
    name: 'health-proxy',
    configureServer(server) {
      server.middlewares.use('/api/health-proxy', async (req, res) => {
        const url = new URL(req.url || '/', `http://${req.headers.host}`);
        const target = url.searchParams.get('url');
        const method = url.searchParams.get('method') || 'GET';

        if (!target) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'Missing url parameter' }));
          return;
        }

        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 5000);
          const resp = await fetch(target, { method, signal: controller.signal });
          clearTimeout(timeout);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ status: resp.status }));
        } catch (err: any) {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ status: 0, error: err?.message || 'unreachable' }));
        }
      });
    },
  };
}

function itbIdResolver(db: { container: string; user: string; password: string; database: string }): Plugin {
  const dockerCmd = (sql: string) =>
    `docker exec -e MYSQL_PWD=${db.password} ${db.container} mysql -u ${db.user} ${db.database} -N -e "${sql}"`;

  return {
    name: 'itb-id-resolver',
    configureServer(server) {
      server.middlewares.use('/api/itb-ids', (req, res) => {
        const url = new URL(req.url || '/', `http://${req.headers.host}`);
        const suiteId = url.searchParams.get('suite') || '';
        const testcaseId = url.searchParams.get('testcase') || '';
        const actorKeys = (url.searchParams.get('actors') || '').split(',').filter(Boolean);
        const orgKey = url.searchParams.get('org') || '';
        const sysKey = url.searchParams.get('system') || '';
        const communityKey = url.searchParams.get('community') || '';
        const sutActor = url.searchParams.get('sutActor') || '';

        try {
          const sql = `
            SELECT 'community' AS kind, id, api_key AS k FROM Communities WHERE api_key IS NOT NULL
            UNION ALL
            SELECT 'organisation', id, api_key FROM Organizations WHERE api_key IS NOT NULL
            UNION ALL
            SELECT 'system', id, api_key FROM Systems WHERE api_key IS NOT NULL
            UNION ALL
            SELECT 'actor', id, api_key FROM Actors WHERE api_key IS NOT NULL
            UNION ALL
            SELECT 'actor_by_id', id, actorId FROM Actors WHERE actorId IS NOT NULL
            UNION ALL
            SELECT 'testsuite', id, identifier FROM TestSuites WHERE identifier IS NOT NULL
            UNION ALL
            SELECT 'testcase', id, identifier FROM TestCases WHERE identifier IS NOT NULL;
          `.replace(/\n/g, ' ');

          const raw = execSync(
            dockerCmd(sql),
            { encoding: 'utf-8', timeout: 5000 }
          );

          // Parse tab-separated rows
          const rows = raw.trim().split('\n').map(line => {
            const [kind, id, key] = line.split('\t');
            return { kind, id: Number(id), key };
          });

          const find = (kind: string, key: string) =>
            rows.find(r => r.kind === kind && r.key === key)?.id ?? null;

          const result: Record<string, number | null> = {
            communityId: communityKey ? find('community', communityKey) : null,
            testSuiteId: rows.find(r => r.kind === 'testsuite' && r.key === suiteId)?.id ?? null,
            testCaseId: testcaseId ? (rows.find(r => r.kind === 'testcase' && r.key === testcaseId)?.id ?? null) : null,
          };

          const dbQuery = (sql: string) => {
            try {
              return execSync(
                dockerCmd(sql),
                { encoding: 'utf-8', timeout: 3000 }
              ).trim();
            } catch { return ''; }
          };

          // Direct lookups from provided keys
          if (orgKey) result.organisationId = find('organisation', orgKey);
          if (sysKey) result.systemId = find('system', sysKey);
          // Prioritize the SUT actor for the execution URL
          if (sutActor) {
            const aid = find('actor', sutActor) ?? find('actor_by_id', sutActor);
            if (aid) result.actorId = aid;
          }
          // Fallback: try other actors from the deploy response
          if (!result.actorId) {
            for (const ak of actorKeys) {
              const aid = find('actor', ak) ?? find('actor_by_id', ak);
              if (aid) { result.actorId = aid; break; }
            }
          }

          // Resolve org from system owner
          if (!result.organisationId && result.systemId) {
            const v = dbQuery(`SELECT owner FROM Systems WHERE id = ${result.systemId}`);
            if (v) result.organisationId = Number(v) || null;
          }

          // Resolve org from community (first org with API key)
          if (!result.organisationId && result.communityId) {
            const v = dbQuery(`SELECT id FROM Organizations WHERE community = ${result.communityId} AND api_key IS NOT NULL ORDER BY id LIMIT 1`);
            if (v) result.organisationId = Number(v) || null;
          }

          // Resolve community from org
          if (!result.communityId && result.organisationId) {
            const v = dbQuery(`SELECT community FROM Organizations WHERE id = ${result.organisationId}`);
            if (v) result.communityId = Number(v) || null;
          }

          // Resolve system from org (first system owned by this org)
          if (!result.systemId && result.organisationId) {
            const v = dbQuery(`SELECT id FROM Systems WHERE owner = ${result.organisationId} ORDER BY id DESC LIMIT 1`);
            if (v) result.systemId = Number(v) || null;
          }

          // Resolve system from conformance with the found actor (if system still missing)
          if (!result.systemId && result.actorId) {
            const v = dbQuery(`SELECT sut_id FROM SystemImplementsActors WHERE actor_id = ${result.actorId} ORDER BY sut_id DESC LIMIT 1`);
            if (v) result.systemId = Number(v) || null;
          }

          // Resolve actor from test suite specification (if actor still missing)
          if (!result.actorId && result.testSuiteId) {
            const v = dbQuery(`SELECT a.id FROM SpecificationHasTestSuites shts JOIN SpecificationHasActors sha ON sha.spec_id = shts.spec JOIN Actors a ON a.id = sha.actor_id WHERE shts.testsuite = ${result.testSuiteId} LIMIT 1`);
            if (v) result.actorId = Number(v) || null;
          }

          // Look up API keys for resolved actor and system (for auto-conformance)
          const apiKeys: Record<string, string | null> = { actorApiKey: null, systemApiKey: null, specId: null };
          if (result.actorId) {
            apiKeys.actorApiKey = dbQuery(`SELECT api_key FROM Actors WHERE id = ${result.actorId}`) || null;
          }
          if (result.systemId) {
            apiKeys.systemApiKey = dbQuery(`SELECT api_key FROM Systems WHERE id = ${result.systemId}`) || null;
          }
          // Find the specification that owns the test suite
          if (result.testSuiteId) {
            apiKeys.specId = dbQuery(`SELECT spec FROM SpecificationHasTestSuites WHERE testsuite = ${result.testSuiteId} LIMIT 1`) || null;
          }
          // Auto-create conformance via REST API (DB inserts don't trigger snapshot generation)
          if (apiKeys.systemApiKey && apiKeys.actorApiKey) {
            try {
              // Find an org API key to authenticate
              const orgApiKey = result.organisationId
                ? dbQuery(`SELECT api_key FROM Organizations WHERE id = ${result.organisationId}`)
                : '';
              if (orgApiKey) {
                execSync(`curl -s -X PUT "http://localhost:10003/api/rest/conformance/${apiKeys.systemApiKey}/${apiKeys.actorApiKey}" -H "ITB_API_KEY: ${orgApiKey}"`, { timeout: 5000 });
              }
            } catch { /* conformance may already exist — ignore */ }
          }

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ...result, ...apiKeys }));
        } catch (err: any) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err?.message || 'Failed to query ITB database' }));
        }
      });
    },
  };
}

/**
 * Vite dev plugin: REST API for Gherkin-to-TDL compilation.
 *
 * POST /api/compile
 *   Body: raw Gherkin text (Content-Type: text/plain)
 *   Returns: ZIP file (application/zip)
 *
 * POST /api/compile/testplan
 *   Body: FHIR TestPlan JSON (Content-Type: application/json)
 *   Extracts the Gherkin from the referenced feature file,
 *   compiles to TDL, and returns a ZIP.
 */
function compileApi(): Plugin {
  // Lazy-load parser modules (they use ESM, loaded at first request)
  let parserReady: Promise<{
    parse: (gherkin: string) => any;
    compile: (parsed: any) => { files: { filename: string; xml: string; type: string }[] };
  }> | null = null;

  function getParser() {
    if (!parserReady) {
      parserReady = (async () => {
        // We can't import the browser modules directly, so we'll use a simpler approach:
        // shell out to a Node script that does the compilation
        return {
          parse: (_gherkin: string) => null,
          compile: (_parsed: any) => ({ files: [] }),
        };
      })();
    }
    return parserReady;
  }

  return {
    name: 'compile-api',
    configureServer(server) {
      // POST /api/compile — Gherkin text → TDL ZIP
      server.middlewares.use('/api/compile', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'POST only' }));
          return;
        }

        // Read body
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        }
        const body = Buffer.concat(chunks).toString('utf-8');

        const url = new URL(req.url || '/', `http://${req.headers.host}`);
        const isTestPlan = url.pathname.endsWith('/testplan');

        let gherkinContent: string;

        if (isTestPlan) {
          // Parse TestPlan JSON, find the feature file reference
          try {
            const testPlan = JSON.parse(body);
            const suite = testPlan.suite?.[0];
            const featureFile = suite?.input?.find((i: any) => i.name === 'gherkin-script')?.file;
            if (!featureFile) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'TestPlan has no gherkin-script input' }));
              return;
            }
            // Try to load the feature file from public/
            const featurePath = path.join(process.cwd(), 'public', featureFile);
            if (!fs.existsSync(featurePath)) {
              res.statusCode = 404;
              res.end(JSON.stringify({ error: `Feature file not found: ${featureFile}` }));
              return;
            }
            gherkinContent = fs.readFileSync(featurePath as string, 'utf-8');
          } catch (e: any) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: `Invalid TestPlan JSON: ${e.message}` }));
            return;
          }
        } else {
          gherkinContent = body;
        }

        if (!gherkinContent.trim()) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'Empty Gherkin content' }));
          return;
        }

        try {
          // Use the Vite module runner to load the parser modules
          const mod = await server.ssrLoadModule('/src/api/compile.ts');
          const result = await mod.compileGherkin(gherkinContent);

          if (result.error) {
            res.statusCode = 422;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: result.error, issues: result.issues }));
            return;
          }

          // Build ZIP
          const JSZip = (await import('jszip')).default;
          const zip = new JSZip();
          for (const file of result.files) {
            zip.file(file.filename, file.xml);
          }
          const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/zip');
          res.setHeader('Content-Disposition', `attachment; filename="${result.testcaseName || 'testsuite'}.zip"`);
          res.end(zipBuffer);
        } catch (e: any) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: `Compilation failed: ${e.message}` }));
        }
      });
    },
  };
}

// ── IG Package helpers (native JS, no Python) ─────────────────

async function fetchIGPackage(url: string): Promise<Buffer> {
  // Handle package references like "hl7.fhir.be.vaccination#1.0.2"
  if (url.includes('#') && !url.startsWith('http')) {
    const [name, version] = url.split('#', 2);
    url = `https://packages.fhir.org/${name}/${version}`;
  }
  if (!url.endsWith('.tgz')) url = url.replace(/\/+$/, '') + '/package.tgz';
  const resp = await fetch(url, { redirect: 'follow' });
  if (!resp.ok) throw new Error(`Failed to fetch: ${resp.status} ${resp.statusText}`);
  return Buffer.from(await resp.arrayBuffer());
}

async function parseIGPackage(tgzBuffer: Buffer): Promise<any> {
  const tar = await import('tar-stream');
  const extract = tar.extract();
  const files: Record<string, Buffer> = {};

  const promise = new Promise<void>((resolve, reject) => {
    extract.on('entry', (header: any, stream: any, next: () => void) => {
      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => { files[header.name] = Buffer.concat(chunks); next(); });
      stream.on('error', reject);
    });
    extract.on('finish', resolve);
    extract.on('error', reject);
  });

  // Pipe tgz through gunzip into tar extractor
  const gunzip = createGunzip();
  const readable = Readable.from(tgzBuffer);
  readable.pipe(gunzip).pipe(extract);
  await promise;

  // Parse package.json
  const pkgJsonBuf = files['package/package.json'];
  if (!pkgJsonBuf) throw new Error('No package/package.json found in archive');
  const pkgMeta = JSON.parse(pkgJsonBuf.toString('utf-8'));

  const igName = pkgMeta.name || 'unknown';
  const igVersion = pkgMeta.version || '';
  const igUrl = pkgMeta.canonical || '';
  let fhirVersion = pkgMeta.fhirVersion || '';
  if (Array.isArray(fhirVersion)) fhirVersion = fhirVersion[0] || '';

  const deps: string[] = [];
  for (const [n, v] of Object.entries(pkgMeta.dependencies || {})) {
    if (!n.startsWith('hl7.fhir.r')) deps.push(`${n}#${v}`);
  }

  // Collect all Binary resources (may contain Gherkin)
  const binaries: Record<string, any> = {};
  for (const [name, buf] of Object.entries(files)) {
    if (name.includes('Binary-') && name.endsWith('.json')) {
      try {
        const data = JSON.parse(buf.toString('utf-8'));
        if (data.resourceType === 'Binary') binaries[data.id || ''] = data;
      } catch {}
    }
  }

  // Find TestPlan resources
  const testPlans: any[] = [];
  for (const [name, buf] of Object.entries(files)) {
    if (name.includes('TestPlan-') && name.endsWith('.json')) {
      try {
        const data = JSON.parse(buf.toString('utf-8'));
        if (data.resourceType === 'TestPlan') {
          // Deduplicate by id (same TestPlan can appear in example/ and tests/)
          const tp = parseTestPlan(data, binaries, files);
          if (!testPlans.some(existing => existing.id === tp.id)) {
            testPlans.push(tp);
          }
        }
      } catch {}
    }
  }

  // Find profiles/actors
  const profiles: any[] = [];
  for (const [name, buf] of Object.entries(files)) {
    if (!name.startsWith('package/') || name.startsWith('package/tests/')) continue;
    if (!name.endsWith('.json')) continue;
    try {
      const data = JSON.parse(buf.toString('utf-8'));
      const rt = data.resourceType || '';
      if (['StructureDefinition', 'ActorDefinition', 'CapabilityStatement'].includes(rt)) {
        profiles.push({ id: data.id || '', name: data.name || data.title || '', url: data.url || '', type: rt });
      }
    } catch {}
  }

  return { ig_name: igName, ig_version: igVersion, ig_url: igUrl, fhir_version: fhirVersion, dependencies: deps, test_plans: testPlans, profiles };
}

function parseTestPlan(data: any, binaries: Record<string, any>, rawFiles: Record<string, Buffer>): any {
  const scope = (data.scope || []).filter((s: any) => s.reference).map((s: any) => ({ reference: s.reference, description: s.description || '' }));
  const parameters = (data.parameter || []).map((p: any) => ({ name: p.name || '', value: p.valueString || '', mode: p.mode || '' }));

  const suites = (data.suite || []).map((s: any) => {
    let gherkinFile = '';
    let gherkinContent = '';
    let itbZipFile = '';
    let itbZipBase64 = '';  // pre-built ZIP, base64-encoded
    let suiteType: 'gherkin' | 'itb-zip' | 'unknown' = 'unknown';

    for (const inp of (s.input || [])) {
      if (inp.name === 'gherkin-script') {
        suiteType = 'gherkin';
        gherkinFile = inp.file || '';
        // Try binary reference
        const bRef = inp.sourceReference?.reference || '';
        if (bRef.startsWith('Binary/')) {
          const bid = bRef.split('/')[1];
          if (binaries[bid]?.data) gherkinContent = Buffer.from(binaries[bid].data, 'base64').toString('utf-8');
        }
      } else if (inp.name === 'itb-test-suite') {
        suiteType = 'itb-zip';
        itbZipFile = inp.file || '';
      }
    }

    // Resolve gherkin content:
    // 1. From Binary resources by file stem
    // 2. From raw files in package/tests/ or package/
    if (suiteType === 'gherkin' && !gherkinContent && gherkinFile) {
      const stem = path.parse(gherkinFile).name;
      console.log(`[parseTestPlan] Looking for gherkin file="${gherkinFile}" stem="${stem}"`);
      console.log(`[parseTestPlan] Available binaries: [${Object.keys(binaries).join(', ')}]`);
      console.log(`[parseTestPlan] Available raw files: [${Object.keys(rawFiles).filter(f => f.includes('.feature') || f.includes('tests/')).join(', ')}]`);
      // Try binaries
      for (const [bid, bdata] of Object.entries(binaries)) {
        if ((stem.includes(bid) || bid.includes(stem)) && (bdata as any).data) {
          gherkinContent = Buffer.from((bdata as any).data, 'base64').toString('utf-8');
          console.log(`[parseTestPlan] Found in binary: ${bid}`);
          break;
        }
      }
      // Fallback: raw .feature file in the package
      if (!gherkinContent) {
        for (const [fname, buf] of Object.entries(rawFiles)) {
          if (fname.endsWith(gherkinFile) || fname.endsWith(`/${gherkinFile}`) || fname.endsWith(`/${stem}.feature`)) {
            gherkinContent = buf.toString('utf-8');
            console.log(`[parseTestPlan] Found in raw file: ${fname}`);
            break;
          }
        }
        if (!gherkinContent) console.log(`[parseTestPlan] NOT FOUND in any raw file`);
      }
    }

    // Resolve pre-built ZIP from:
    // 1. Binary resources (base64 .data field)
    // 2. Raw files in package/tests/ matching the filename
    if (suiteType === 'itb-zip' && itbZipFile) {
      // Try Binary resources first
      const zipStem = path.parse(itbZipFile).name;
      for (const [bid, bdata] of Object.entries(binaries)) {
        if ((zipStem.includes(bid) || bid.includes(zipStem)) && (bdata as any).data) {
          itbZipBase64 = (bdata as any).data;
          break;
        }
      }
      // Fallback: look for the raw file in the package
      if (!itbZipBase64) {
        for (const [fname, buf] of Object.entries(rawFiles)) {
          if (fname.endsWith(itbZipFile) || fname.endsWith(`/${itbZipFile}`)) {
            itbZipBase64 = buf.toString('base64');
            break;
          }
        }
      }
    }

    const tests = (s.test || []).map((t: any) => ({ name: t.name || '', description: t.description || '' }));
    return {
      name: s.name || '', description: s.description || '',
      type: suiteType,
      gherkin_file: gherkinFile, gherkin_content: gherkinContent,
      itb_zip_file: itbZipFile, itb_zip_base64: itbZipBase64,
      tests,
    };
  });

  // Determine overall test plan type
  const types = suites.map((s: any) => s.type).filter((t: string) => t !== 'unknown');
  const testPlanType = types.includes('itb-zip') ? 'itb-zip' : types.includes('gherkin') ? 'gherkin' : 'unknown';

  return {
    id: data.id || '', name: data.title || data.name || data.id || '', description: data.description || '',
    url: data.url || '', scope, parameters, suites, raw_json: data,
    type: testPlanType,
  };
}

function extractFileFromMultipart(body: Buffer, contentType: string): Buffer {
  // Simple multipart parser — extract the first file part
  const boundaryMatch = contentType.match(/boundary=(.+)/);
  if (!boundaryMatch) return body; // Assume raw file if no boundary
  const boundary = boundaryMatch[1].replace(/^"/, '').replace(/"$/, '');
  const parts = body.toString('binary').split('--' + boundary);
  for (const part of parts) {
    if (part.includes('filename=')) {
      const headerEnd = part.indexOf('\r\n\r\n');
      if (headerEnd >= 0) {
        const fileData = part.substring(headerEnd + 4).replace(/\r\n$/, '');
        return Buffer.from(fileData, 'binary');
      }
    }
  }
  return body;
}

/**
 * Vite dev plugin: ITB management API — state, domains, specs, orgs, IG import.
 * All JS — no Python backend needed.
 */
function managementApi(db: { container: string; user: string; password: string; database: string }, env: Record<string, string>): Plugin {
  const stateFile = path.join(os.homedir(), '.itb-test-manager', 'state.json');

  function loadState(): any {
    try { return JSON.parse(fs.readFileSync(stateFile, 'utf-8')); }
    catch { return { itb_url: 'http://localhost:10003', itb_api_key: '', master_api_key: '', community_key: '', community_api_key: '', organisation_api_key: '', domain_key: '', domain_name: '', selected_community: null, selected_organisation: null, imported_igs: {} }; }
  }
  function saveState(s: any) {
    const dir = path.dirname(stateFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(s, null, 2));
  }

  async function itbFetch(urlPath: string, opts: any = {}, apiKey?: string, authLevel?: 'master' | 'community' | 'organisation'): Promise<any> {
    const state = loadState();
    let key = apiKey || '';
    if (!key) {
      if (authLevel === 'master') {
        key = state.master_api_key || env.VITE_ITB_MASTER_API_KEY || '';
      } else if (authLevel === 'organisation') {
        key = state.organisation_api_key || env.VITE_ITB_ORGANISATION_API_KEY || '';
      } else {
        // Default: community key, fallback chain
        key = state.community_api_key || state.itb_api_key || env.VITE_ITB_COMMUNITY_API_KEY || env.VITE_ITB_ORGANISATION_API_KEY || '';
      }
    }
    const base = state.itb_url || env.VITE_ITB_BASE_URL || 'http://localhost:10003';
    const headers: Record<string, string> = { 'ITB_API_KEY': key, 'Content-Type': 'application/json', ...(opts.headers || {}) };
    console.log(`[itbFetch] ${opts.method || 'GET'} ${urlPath} auth=${authLevel || 'default'} key=${key ? key.slice(0, 8) + '...' : '(empty)'}`);
    const resp = await fetch(`${base}/api/rest${urlPath}`, { ...opts, headers });
    return resp;
  }

  function dbQuery(sql: string): string {
    try {
      return execSync(
        `docker exec -e MYSQL_PWD=${db.password} ${db.container} mysql -u ${db.user} ${db.database} -N -e "${sql.replace(/\n/g, ' ')}"`,
        { encoding: 'utf-8', timeout: 5000 }
      ).trim();
    } catch { return ''; }
  }

  async function readBody(req: any): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    return Buffer.concat(chunks).toString('utf-8');
  }

  return {
    name: 'management-api',
    configureServer(server) {

      // GET /api/state
      server.middlewares.use('/api/state', (req, res) => {
        if (req.method !== 'GET') { res.statusCode = 405; res.end(''); return; }
        const state = loadState();
        // Use master key first (works on fresh ITB), then community key
        const masterKey = state.master_api_key || env.VITE_ITB_MASTER_API_KEY || '';
        const communityKey = state.community_api_key || state.itb_api_key || env.VITE_ITB_COMMUNITY_API_KEY || '';
        const apiKey = masterKey || communityKey;
        const baseUrl = state.itb_url || env.VITE_ITB_BASE_URL || 'http://localhost:10003';
        // Check connection — try /api/rest OpenAPI endpoint (no auth needed)
        fetch(`${baseUrl}/api/rest`, { signal: AbortSignal.timeout(5000) })
          .then(r => {
            state.connected = r.status === 200;
            state.has_master_key = !!masterKey;
            state.community_api_key = state.community_api_key || '';
            state.organisation_api_key = state.organisation_api_key || '';
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(state));
          })
          .catch(() => {
            state.connected = false;
            state.has_master_key = !!masterKey;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(state));
          });
      });

      // POST /api/connect
      server.middlewares.use('/api/connect', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(''); return; }
        const body = JSON.parse(await readBody(req));
        const state = loadState();
        state.itb_url = body.url || state.itb_url;
        state.itb_api_key = body.api_key || state.itb_api_key;
        if (body.master_api_key !== undefined) state.master_api_key = body.master_api_key;
        if (body.community_api_key !== undefined) state.community_api_key = body.community_api_key;
        if (body.organisation_api_key !== undefined) state.organisation_api_key = body.organisation_api_key;
        saveState(state);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ status: 'ok' }));
      });

      // POST /api/reset — clear all server-side state
      server.middlewares.use('/api/reset', (_req, res) => {
        const freshState = {
          itb_url: env.VITE_ITB_BASE_URL || 'http://localhost:10003',
          itb_api_key: '', master_api_key: '', community_key: '',
          community_api_key: '', organisation_api_key: '',
          domain_key: '', domain_name: '',
          selected_community: null, selected_organisation: null,
          imported_igs: {},
        };
        saveState(freshState);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ status: 'ok' }));
      });

      // POST /api/set-domain?domain_key=X&domain_name=Y
      server.middlewares.use('/api/set-domain', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(''); return; }
        const url = new URL(req.url || '/', `http://${req.headers.host}`);
        const state = loadState();
        state.domain_key = url.searchParams.get('domain_key') || '';
        state.domain_name = url.searchParams.get('domain_name') || '';
        saveState(state);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ domain_key: state.domain_key, domain_name: state.domain_name }));
      });

      // /api/communities — GET list, PUT create
      server.middlewares.use('/api/communities', async (req, res) => {
        if (req.method === 'GET') {
          // List communities — try DB first (more reliable), fallback to empty
          try {
            const raw = dbQuery(`SELECT id, sname, fname, api_key FROM Communities WHERE id > 0`);
            const communities: any[] = [];
            if (raw) {
              for (const line of raw.split('\n')) {
                const [id, shortName, fullName, apiKey] = line.split('\t');
                if (id) communities.push({ id: Number(id), shortName, fullName, apiKey });
              }
            }
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(communities));
          } catch { res.setHeader('Content-Type', 'application/json'); res.end('[]'); }
        } else if (req.method === 'PUT') {
          // Create community — requires master key
          try {
            const body = await readBody(req);
            const r = await itbFetch('/community', { method: 'PUT', body }, undefined, 'master');
            const data = await r.json();
            if (r.ok && data.apiKey) {
              // Auto-store community API key
              const state = loadState();
              state.community_api_key = data.apiKey;
              const parsed = JSON.parse(body);
              state.selected_community = { apiKey: data.apiKey, shortName: parsed.shortName, fullName: parsed.fullName };
              saveState(state);
            }
            res.statusCode = r.status;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
          } catch (e: any) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: e.message }));
          }
        } else { res.statusCode = 405; res.end(''); }
      });

      // POST /api/select-community — select a community and store its API key
      server.middlewares.use('/api/select-community', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(''); return; }
        const body = JSON.parse(await readBody(req));
        const state = loadState();
        state.community_api_key = body.apiKey || '';
        state.selected_community = body.apiKey ? { apiKey: body.apiKey, shortName: body.shortName || '', fullName: body.fullName || '' } : null;
        saveState(state);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ status: 'ok' }));
      });

      // POST /api/select-organisation — select an org and store its API key
      server.middlewares.use('/api/select-organisation', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(''); return; }
        const body = JSON.parse(await readBody(req));
        const state = loadState();
        state.organisation_api_key = body.apiKey || '';
        state.selected_organisation = body.apiKey ? { apiKey: body.apiKey, shortName: body.shortName || '', fullName: body.fullName || '' } : null;
        saveState(state);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ status: 'ok' }));
      });

      // /api/domains — GET list, PUT create, /api/domains/{key}/specifications
      server.middlewares.use('/api/domains', async (req, res, next) => {
        const url = new URL(req.url || '/', `http://${req.headers.host}`);
        const pathParts = url.pathname.replace(/^\//, '').split('/');

        // PUT /api/domains — create domain (requires master key per ITB API)
        if (req.method === 'PUT' && (pathParts.length === 0 || (pathParts.length === 1 && !pathParts[0]))) {
          try {
            const body = await readBody(req);
            const r = await itbFetch('/domain', { method: 'PUT', body }, undefined, 'master');
            const data = await r.json();
            res.statusCode = r.status;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
          } catch (e: any) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: e.message }));
          }
          return;
        }

        // GET /api/domains — list
        if (pathParts.length === 0 || (pathParts.length === 1 && !pathParts[0])) {
          try {
            const r = await itbFetch('/domains');
            const data = r.ok ? await r.json() : [];
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
          } catch { res.setHeader('Content-Type', 'application/json'); res.end('[]'); }
          return;
        }
        if (pathParts.length >= 2 && pathParts[1] === 'specifications') {
          const domainKey = pathParts[0];
          try {
            const r = await itbFetch(`/domain/${domainKey}/specifications`);
            const data = r.ok ? await r.json() : [];
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
          } catch { res.setHeader('Content-Type', 'application/json'); res.end('[]'); }
          return;
        }
        next();
      });

      // GET /api/specifications/{key}/detail
      server.middlewares.use('/api/specifications', async (req, res, next) => {
        const url = new URL(req.url || '/', `http://${req.headers.host}`);
        const pathParts = url.pathname.replace(/^\//, '').split('/');
        if (pathParts.length >= 2 && pathParts[1] === 'detail') {
          const specKey = pathParts[0];
          // Spec info
          let spec: any = { apiKey: specKey };
          try { const r = await itbFetch(`/specification/${specKey}`); if (r.ok) spec = await r.json(); } catch {}
          // Actors
          let actors: any[] = [];
          try { const r = await itbFetch(`/specification/${specKey}/actors`); if (r.ok) actors = await r.json(); } catch {}
          // Test suites from DB
          const testSuites: any[] = [];
          const raw = dbQuery(`SELECT ts.id, ts.identifier, ts.sname, ts.description FROM TestSuites ts JOIN SpecificationHasTestSuites shts ON shts.testsuite = ts.id WHERE shts.spec = (SELECT id FROM Specifications WHERE api_key = '${specKey}')`);
          if (raw) {
            for (const line of raw.split('\n')) {
              const [id, identifier, name, description] = line.split('\t');
              testSuites.push({ id: Number(id), identifier, name, description: description || '' });
            }
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ...spec, actors, testSuites }));
          return;
        }
        next();
      });

      // /api/organizations — GET list, PUT create
      server.middlewares.use('/api/organizations', async (req, res) => {
        if (req.method === 'GET') {
          try {
            const r = await itbFetch('/organisation', {}, undefined, 'community');
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(r.ok ? await r.json() : []));
          } catch { res.setHeader('Content-Type', 'application/json'); res.end('[]'); }
        } else if (req.method === 'PUT') {
          try {
            const body = await readBody(req);
            const r = await itbFetch('/organisation', { method: 'PUT', body }, undefined, 'community');
            const data = await r.json();
            if (r.ok && data.apiKey) {
              // Auto-store organisation API key
              const state = loadState();
              state.organisation_api_key = data.apiKey;
              const parsed = JSON.parse(body);
              state.selected_organisation = { apiKey: data.apiKey, shortName: parsed.shortName, fullName: parsed.fullName };
              saveState(state);
            }
            res.statusCode = r.status;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
          } catch (e: any) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: e.message }));
          }
        } else { res.statusCode = 405; res.end(''); }
      });

      // /api/systems — PUT create system
      server.middlewares.use('/api/systems', async (req, res) => {
        if (req.method === 'PUT') {
          try {
            const body = await readBody(req);
            const r = await itbFetch('/system', { method: 'PUT', body }, undefined, 'community');
            const data = await r.json();
            res.statusCode = r.status;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
          } catch (e: any) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: e.message }));
          }
        } else { res.statusCode = 405; res.end(''); }
      });

      // ── Local specification model ──────────────────────────────
      const specStoreFile = path.join(path.dirname(stateFile), 'specs.json');
      function loadSpecStore(): any {
        try { return JSON.parse(fs.readFileSync(specStoreFile, 'utf-8')); }
        catch { return { specs: [], version: 1 }; }
      }
      function saveSpecStore(store: any) {
        const dir = path.dirname(specStoreFile);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(specStoreFile, JSON.stringify(store, null, 2));
      }

      // GET /api/specs — list local specs
      // PUT /api/specs — create/update a local spec
      // DELETE /api/specs/:id — delete a local spec
      server.middlewares.use('/api/specs', async (req, res) => {
        const url = new URL(req.url || '/', `http://${req.headers.host}`);
        const pathId = url.pathname.replace(/^\//, '');

        if (req.method === 'GET' && !pathId) {
          // List all specs with test summaries from ITB
          const store = loadSpecStore();
          const summaries: any[] = [];
          for (const spec of store.specs) {
            const summary: any = { ...spec, testSuites: [], totalSuites: 0, totalCases: 0 };
            if (spec.itbSpecKey) {
              // Fetch test suites + case counts from DB
              const raw = dbQuery(
                `SELECT ts.id, ts.identifier, ts.sname, COUNT(tc.id) as cases ` +
                `FROM TestSuites ts ` +
                `JOIN SpecificationHasTestSuites shts ON shts.testsuite = ts.id ` +
                `LEFT JOIN TestSuiteHasTestCases tstc ON tstc.testsuite = ts.id ` +
                `LEFT JOIN TestCases tc ON tc.id = tstc.testcase ` +
                `WHERE shts.spec = (SELECT id FROM Specifications WHERE api_key = '${spec.itbSpecKey}') ` +
                `GROUP BY ts.id, ts.identifier, ts.sname`
              );
              if (raw) {
                for (const line of raw.split('\n')) {
                  const [id, identifier, name, cases] = line.split('\t');
                  if (id) {
                    summary.testSuites.push({ id: Number(id), identifier, name, caseCount: Number(cases) || 0 });
                    summary.totalSuites++;
                    summary.totalCases += Number(cases) || 0;
                  }
                }
              }
            }
            summaries.push(summary);
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(summaries));
          return;
        }

        if (req.method === 'PUT') {
          const body = JSON.parse(await readBody(req));
          const store = loadSpecStore();
          const existing = store.specs.findIndex((s: any) => s.id === body.id);
          if (existing >= 0) {
            store.specs[existing] = { ...store.specs[existing], ...body };
          } else {
            store.specs.push({ ...body, createdAt: new Date().toISOString() });
          }
          saveSpecStore(store);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
          return;
        }

        if (req.method === 'DELETE' && pathId) {
          const store = loadSpecStore();
          // Remove spec and all children
          const removeIds = new Set([pathId]);
          let changed = true;
          while (changed) {
            changed = false;
            for (const s of store.specs) {
              if (s.parentId && removeIds.has(s.parentId) && !removeIds.has(s.id)) {
                removeIds.add(s.id);
                changed = true;
              }
            }
          }
          store.specs = store.specs.filter((s: any) => !removeIds.has(s.id));
          saveSpecStore(store);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ deleted: [...removeIds] }));
          return;
        }

        res.statusCode = 405;
        res.end('');
      });

      // GET /api/itb-tree — full ITB hierarchy: communities → domains → specs → actors/test suites, orgs → systems
      server.middlewares.use('/api/itb-tree', async (_req, res) => {
        try {
          // Fetch communities from DB
          const commRaw = dbQuery(`SELECT id, sname, fname, api_key FROM Communities WHERE id > 0`);
          const communities: any[] = [];
          if (commRaw) {
            for (const line of commRaw.split('\n')) {
              const [id, shortName, fullName, apiKey] = line.split('\t');
              if (id) communities.push({ id: Number(id), shortName, fullName, apiKey });
            }
          }

          // Fetch domains
          const domainsResp = await itbFetch('/domains');
          const domains: any[] = domainsResp.ok ? await domainsResp.json() : [];

          const tree: any[] = [];
          for (const domain of domains) {
            // Fetch specs for each domain
            let specs: any[] = [];
            try {
              const specsResp = await itbFetch(`/domain/${domain.apiKey}/specifications`);
              if (specsResp.ok) specs = await specsResp.json();
            } catch {}

            const specNodes: any[] = [];
            for (const spec of specs) {
              // Fetch actors via REST API
              let actors: any[] = [];
              try {
                const actorsResp = await itbFetch(`/specification/${spec.apiKey}/actors`);
                if (actorsResp.ok) actors = await actorsResp.json();
              } catch {}

              // Fetch test suites via DB
              const testSuites: any[] = [];
              const raw = dbQuery(
                `SELECT ts.id, ts.identifier, ts.sname FROM TestSuites ts ` +
                `JOIN SpecificationHasTestSuites shts ON shts.testsuite = ts.id ` +
                `WHERE shts.spec = (SELECT id FROM Specifications WHERE api_key = '${spec.apiKey}')`
              );
              if (raw) {
                for (const line of raw.split('\n')) {
                  const parts = line.split('\t');
                  if (parts.length >= 3) testSuites.push({ id: Number(parts[0]), identifier: parts[1], name: parts[2] });
                }
              }

              specNodes.push({ ...spec, actors, testSuites });
            }

            tree.push({ ...domain, specifications: specNodes });
          }

          // Also fetch orgs
          let orgs: any[] = [];
          try {
            const orgsResp = await itbFetch('/organisation', {}, undefined, 'community');
            if (orgsResp.ok) orgs = await orgsResp.json();
          } catch {}

          // Fetch systems for each org from DB
          for (const org of orgs) {
            const sysRaw = dbQuery(`SELECT s.id, s.sname, s.fname, s.api_key FROM Systems s JOIN Organizations o ON s.owner = o.id WHERE o.api_key = '${org.apiKey}'`);
            org.systems = [];
            if (sysRaw) {
              for (const line of sysRaw.split('\n')) {
                const [id, shortName, fullName, apiKey] = line.split('\t');
                if (id) org.systems.push({ id: Number(id), shortName, fullName, apiKey });
              }
            }
          }

          const state = loadState();
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            communities,
            domains: tree,
            organisations: orgs,
            selectedCommunity: state.selected_community,
            selectedOrganisation: state.selected_organisation,
          }));
        } catch (e: any) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: e.message }));
        }
      });

      // ── Plugin catalog + service detection ──

      // Load plugin catalog from YAML
      function loadPluginCatalog(): any[] {
        try {
          const raw = fs.readFileSync(path.join(process.cwd(), 'plugins.yaml'), 'utf-8');
          return yaml.load(raw)?.plugins || [];
        } catch { return []; }
      }

      // GET /api/services — full plugin catalog with live status
      server.middlewares.use('/api/services', async (req, res) => {
        const url = new URL(req.url || '/', `http://${req.headers.host}`);
        const probe = url.searchParams.get('probe') !== 'false'; // default: probe health

        const plugins = loadPluginCatalog();

        // Get running Docker containers
        let running: Record<string, string> = {};
        try {
          const raw = execSync('docker ps --format "{{.Names}}\t{{.Status}}\t{{.Image}}"', { encoding: 'utf-8', timeout: 5000 });
          for (const line of raw.trim().split('\n')) {
            const parts = line.split('\t');
            if (parts[0]) running[parts[0]] = parts[1] || '';
          }
        } catch {}

        // Probe health endpoints in parallel
        const results = await Promise.all(plugins.map(async (plugin: any) => {
          // Docker status
          const containerMatch = Object.keys(running).find(k => k.includes(plugin.container || ''));
          const dockerStatus = containerMatch ? 'running' : 'stopped';
          const dockerDetail = containerMatch ? running[containerMatch] : '';

          // Health probe
          let healthStatus = 'unknown';
          let healthDetail = '';
          if (probe && plugin.healthCheck?.url && dockerStatus === 'running') {
            try {
              const hc = plugin.healthCheck;
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 3000);
              const resp = await fetch(hc.url, {
                method: hc.method || 'GET',
                headers: hc.headers || {},
                body: hc.body || undefined,
                signal: controller.signal,
              });
              clearTimeout(timeout);
              healthStatus = resp.status === (hc.expect || 200) ? 'healthy' : 'unhealthy';
              healthDetail = `HTTP ${resp.status}`;
            } catch (e: any) {
              healthStatus = 'unreachable';
              healthDetail = e.message || 'connection failed';
            }
          } else if (dockerStatus === 'stopped') {
            healthStatus = 'stopped';
          }

          return {
            ...plugin,
            dockerStatus,
            dockerDetail,
            healthStatus,
            healthDetail,
          };
        }));

        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(results));
      });

      // POST /api/ig/discover — fetch IG package.tgz from URL and parse
      server.middlewares.use('/api/ig/discover', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(''); return; }
        const body = JSON.parse(await readBody(req));
        try {
          const tgz = await fetchIGPackage(body.url);
          const discovery = await parseIGPackage(tgz);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(discovery));
        } catch (e: any) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ detail: e.message }));
        }
      });

      // POST /api/ig/upload/discover — upload package.tgz and parse
      server.middlewares.use('/api/ig/upload', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(''); return; }
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
          const rawBody = Buffer.concat(chunks);
          // Extract file from multipart form data
          const tgzBuffer = extractFileFromMultipart(rawBody, req.headers['content-type'] || '');
          const discovery = await parseIGPackage(tgzBuffer);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(discovery));
        } catch (e: any) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ detail: e.message }));
        }
      });

      // POST /api/ig/deploy/testsuite — deploy compiled ZIP to ITB
      server.middlewares.use('/api/ig/deploy/testsuite', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(''); return; }
        try {
          const body = JSON.parse(await readBody(req));
          const state = loadState();
          const communityKey = body.community_key || state.community_key || state.itb_api_key || '';
          const domainKey = body.domain_key || state.domain_key || '';
          const zipBytes = Buffer.from(body.zip_base64, 'base64');
          const results: any[] = [];
          const specKeys: string[] = [];

          // Create specs from scope (deduplicated)
          const seenScopes = new Set<string>();
          for (const scopeRef of (body.scope || [])) {
            const ref = scopeRef.reference || '';
            if (!ref || seenScopes.has(ref)) continue;
            seenScopes.add(ref);
            const specName = ref.split('/').pop() || ref;
            try {
              const sr = await itbFetch('/specification', {
                method: 'PUT', body: JSON.stringify({
                  shortName: specName, fullName: scopeRef.description || specName,
                  description: 'From TestPlan scope: ' + ref, domain: domainKey, hidden: false, displayOrder: 0,
                }),
              }, communityKey);
              if (sr.ok) {
                const specData = await sr.json();
                const specKey = specData.apiKey || '';
                specKeys.push(specKey);
                // Create SUT actor
                await itbFetch('/actor', {
                  method: 'PUT', body: JSON.stringify({
                    identifier: 'sut', name: 'System Under Test', description: 'The system being tested',
                    reportMetadata: 'SUT', default: false, hidden: false, displayOrder: 0, specification: specKey,
                  }),
                }, communityKey);
              }
            } catch (e: any) { results.push({ scope: ref, error: e.message }); }
          }

          // Deploy ZIP to each spec
          for (const specKey of specKeys) {
            try {
              const boundary = '----FormBoundary' + Date.now();
              const parts = [
                `--${boundary}\r\nContent-Disposition: form-data; name="updateSpecification"\r\n\r\ntrue`,
                `--${boundary}\r\nContent-Disposition: form-data; name="specification"\r\n\r\n${specKey}`,
                `--${boundary}\r\nContent-Disposition: form-data; name="testSuite"; filename="${body.testplan_id}.zip"\r\nContent-Type: application/zip\r\n\r\n`,
              ];
              const pre = Buffer.from(parts.join('\r\n') + '\r\n');
              const post = Buffer.from(`\r\n--${boundary}--\r\n`);
              const fullBody = Buffer.concat([pre, zipBytes, post]);

              const base = state.itb_url || 'http://localhost:10003';
              const dr = await fetch(`${base}/api/rest/testsuite/deploy`, {
                method: 'POST',
                headers: { 'ITB_API_KEY': communityKey, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
                body: fullBody,
              });
              const deployData = dr.ok ? await dr.json() : { error: await dr.text() };
              results.push({ test_plan: body.testplan_id, specification_key: specKey, status: dr.ok ? 'deployed' : 'error', detail: deployData });
            } catch (e: any) { results.push({ test_plan: body.testplan_id, specification_key: specKey, error: e.message }); }
          }

          // Resolve execution URL
          let execution_url: string | null = null;
          const deployedDetail = results.find(r => r.status === 'deployed')?.detail || {};
          const identifiers = deployedDetail.identifiers || {};
          const suiteIdentifier = identifiers.testSuite || body.testplan_id;
          const actorKeysFromDeploy = (identifiers.specifications || []).flatMap((s: any) => (s.actors || []).map((a: any) => a.identifier));
          try {
            const idsUrl = `/api/itb-ids?suite=${encodeURIComponent(suiteIdentifier)}&community=${encodeURIComponent(communityKey)}&actors=${actorKeysFromDeploy.join(',')}`;
            const idsResp = await fetch(`http://localhost:3001${idsUrl}`);
            if (idsResp.ok) {
              const ids = await idsResp.json();
              if (ids.communityId && ids.organisationId && ids.systemId && ids.actorId) {
                const base = state.itb_url || 'http://localhost:10003';
                execution_url = `${base}/app#/admin/users/community/${ids.communityId}/organisation/${ids.organisationId}/test/${ids.systemId}/${ids.actorId}/execute`;
                if (ids.testSuiteId) execution_url += `?ts=${ids.testSuiteId}`;
              }
            }
          } catch { /* ID resolution failed */ }

          // Save imported IG state
          state.imported_igs = state.imported_igs || {};
          state.imported_igs[body.testplan_id] = { version: '', url: 'deploy', spec_keys: specKeys };
          saveState(state);

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ results, spec_keys: specKeys, execution_url }));
        } catch (e: any) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ detail: e.message }));
        }
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const db = getDbConfig(env);
  return {
  plugins: [react(), healthProxy(), itbProxy(), compileApi(), itbIdResolver(db), managementApi(db, env)],
  base: '/',
  build: {
    rollupOptions: {
      output: {
        assetFileNames: 'assets/[name]-[hash][extname]',
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js'
      }
    },
  },
  css: {
    postcss: './postcss.config.js'
  },
  server: {
    port: 3001,
    open: true,
  },
  define: {
    global: 'globalThis',
  },
};
})