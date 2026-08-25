import { defineConfig, Plugin, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { createGunzip, gunzipSync, inflateSync, inflateRawSync } from 'zlib'
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

/**
 * Decode an IG `Binary.data` payload to Gherkin text.
 *
 * Some IG generators (notably newer test-workbench builds) gzip the Gherkin source
 * before base64-encoding it into `Binary.data`. Other generators ZIP it. Older
 * generators put the raw text in directly. Sniff the magic bytes and unwrap before
 * returning UTF-8 text.
 *
 * Magic bytes:
 *   1f 8b      → gzip
 *   50 4b 03 04 → zip (PK\x03\x04) — extract first .feature entry
 *   78 01 / 78 9c / 78 da → raw zlib (deflate stream)
 *   otherwise  → assume already plain text
 */
/**
 * Heuristic: does this string look like a real Gherkin file?
 * Used to decide whether a decoded Binary.data payload is the actual Gherkin
 * content or some stub/hash/placeholder we should ignore in favour of the raw
 * .feature file from the tarball.
 */
function looksLikeGherkin(text: string): boolean {
  if (!text || text.length < 20) return false;        // too short to be a feature file
  if (text.includes(' ')) return false;          // null bytes — clearly binary
  if (text.includes('�')) return false;          // UTF-8 replacement chars — invalid bytes
  return /\b(Feature|Scenario|Given|When|Then|@\w+)\b/.test(text);
}

function decodeBinaryToGherkin(base64Data: string): string {
  let buf: Buffer;
  try {
    buf = Buffer.from(base64Data, 'base64');
  } catch {
    return '';
  }
  if (buf.length === 0) return '';

  // Diagnostic: log the first 16 bytes as hex when the result doesn't look like text.
  // This prints to the dev-server console only and helps us identify unknown formats.
  const head = Array.from(buf.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' ');

  // gzip
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    try { return gunzipSync(buf).toString('utf-8'); }
    catch (e: any) { console.warn('[decodeBinaryToGherkin] gunzip failed:', e.message, 'head=', head); }
  }

  // zip — pick the first .feature entry
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    try {
      const featureContent = extractFeatureFromZipBuffer(buf);
      if (featureContent) return featureContent;
    } catch (e: any) { console.warn('[decodeBinaryToGherkin] zip extract failed:', e.message, 'head=', head); }
  }

  // raw zlib (deflate). Try both with and without a header — some encoders strip it.
  if (buf[0] === 0x78 && (buf[1] === 0x01 || buf[1] === 0x9c || buf[1] === 0xda)) {
    try { return inflateSync(buf).toString('utf-8'); }
    catch { try { return inflateRawSync(buf).toString('utf-8'); } catch { /* fall through */ } }
  }

  // Last-ditch: maybe the data is BASE64 *again* (some IG generators double-encode).
  // Detect by sampling: if the buffer is mostly printable base64-alphabet chars and
  // length is plausible base64, try a second decode.
  const text = buf.toString('utf-8');
  const looksLikeBase64 = /^[A-Za-z0-9+/=\s]+$/.test(text) && text.length % 4 === 0 && text.length > 32;
  if (looksLikeBase64) {
    try {
      const inner = Buffer.from(text, 'base64');
      // Check if THAT inner buffer is gzip/zip/text.
      if (inner[0] === 0x1f && inner[1] === 0x8b) {
        try { return gunzipSync(inner).toString('utf-8'); } catch { /* fall through */ }
      }
      if (inner[0] === 0x50 && inner[1] === 0x4b) {
        try { return extractFeatureFromZipBuffer(inner) || inner.toString('utf-8'); } catch { /* fall through */ }
      }
      const innerText = inner.toString('utf-8');
      if (innerText.includes('Feature:') || innerText.includes('Scenario:')) return innerText;
    } catch { /* fall through */ }
  }

  // Heuristic: if the decoded text doesn't look like Gherkin AND has invalid UTF-8
  // sequences, log the first bytes so we can identify the format.
  const hasReplacement = text.includes('�');
  const looksLikeGherkin = /\b(Feature|Scenario|Given|When|Then)\b/.test(text);
  if (hasReplacement && !looksLikeGherkin) {
    console.warn(
      `[decodeBinaryToGherkin] Decoded payload doesn't look like Gherkin and has invalid UTF-8 bytes. ` +
      `First 16 bytes (hex): ${head}. Length: ${buf.length}. ` +
      `If you can paste this hex string back to the developer, we can identify the encoding.`
    );
  }

  return text;
}

/**
 * Walk a ZIP file's central directory and extract the first `.feature` entry as
 * UTF-8 text. Inline DEFLATE-only minimal implementation — the data inside an IG
 * Binary should be a single .feature file or a tiny archive.
 */
function extractFeatureFromZipBuffer(zip: Buffer): string {
  // Find end-of-central-directory record (signature 0x06054b50, scan from end).
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip: no EOCD');
  const cdOffset = zip.readUInt32LE(eocd + 16);
  const cdEntries = zip.readUInt16LE(eocd + 10);

  let p = cdOffset;
  for (let i = 0; i < cdEntries; i++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('zip: bad CD signature');
    const compMethod = zip.readUInt16LE(p + 10);
    const compSize = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const localOffset = zip.readUInt32LE(p + 42);
    const name = zip.slice(p + 46, p + 46 + nameLen).toString('utf-8');
    p += 46 + nameLen + extraLen + commentLen;

    if (!name.endsWith('.feature')) continue;

    // Read local file header to find data offset.
    if (zip.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('zip: bad LFH signature');
    const lfhNameLen = zip.readUInt16LE(localOffset + 26);
    const lfhExtraLen = zip.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lfhNameLen + lfhExtraLen;
    const data = zip.slice(dataStart, dataStart + compSize);
    if (compMethod === 0) return data.toString('utf-8');                  // stored
    if (compMethod === 8) return inflateRawSync(data).toString('utf-8');  // deflate
    throw new Error(`zip: unsupported compression method ${compMethod}`);
  }
  return '';
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

/**
 * Canonical namespace for stable cross-import identifiers (TestPlans, Actors, etc.).
 * See memory file `project_canonical_id_namespace.md`. Placeholder URL — may move when
 * the SMART architecture work publishes a permanent namespace.
 */
const STABLE_ID_SYSTEM = 'http://smart-architecture/placeholder/actorids';

/** Pull the stable id value from a FHIR resource's identifier[] array, if present. */
function stableIdOf(resource: any): string {
  const ids = Array.isArray(resource?.identifier) ? resource.identifier : [];
  for (const i of ids) {
    if (i && i.system === STABLE_ID_SYSTEM && i.value) return String(i.value);
  }
  return '';
}

function parseTestPlan(data: any, binaries: Record<string, any>, rawFiles: Record<string, Buffer>): any {
  const scope = (data.scope || []).filter((s: any) => s.reference).map((s: any) => ({ reference: s.reference, description: s.description || '' }));
  const parameters = (data.parameter || []).map((p: any) => ({ name: p.name || '', value: p.valueString || '', mode: p.mode || '' }));
  const stableId = stableIdOf(data);

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
          if (binaries[bid]?.data) {
            const candidate = decodeBinaryToGherkin(binaries[bid].data);
            // Only accept Binary content that actually looks like a Gherkin file.
            // Otherwise leave gherkinContent empty and let the raw-file fallback below
            // pick up the .feature file from the tarball.
            if (looksLikeGherkin(candidate)) {
              gherkinContent = candidate;
            } else {
              console.log(
                `[parseTestPlan] Binary/${bid} (${binaries[bid].data?.length || 0} b64 chars) does not look like Gherkin — falling through to raw file lookup.`
              );
            }
          }
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
          const candidate = decodeBinaryToGherkin((bdata as any).data);
          if (looksLikeGherkin(candidate)) {
            gherkinContent = candidate;
            console.log(`[parseTestPlan] Found in binary: ${bid}`);
            break;
          }
          console.log(`[parseTestPlan] Binary/${bid} matched stem but content isn't Gherkin — skipping`);
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
    // Stable cross-import identifier (FHIR Identifier with system=STABLE_ID_SYSTEM).
    // When present, use this as the dedup key; when absent, fall back to `id` (less stable).
    stableId,
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
  // Mock mode: ITB_MOCK=1 routes both dbQuery and itbFetch through an in-memory
  // sql.js-backed fixture instead of the real ITB instance + MySQL container.
  // ITB_MOCK_FIXTURE overrides the default fixture path.
  const mockMode = env.ITB_MOCK === '1' || env.ITB_MOCK === 'true' || process.env.ITB_MOCK === '1';
  const mockFixturePath = env.ITB_MOCK_FIXTURE || process.env.ITB_MOCK_FIXTURE
    || path.join(process.cwd(), 'mock', 'itb-default.yml');

  function loadState(): any {
    try { return JSON.parse(fs.readFileSync(stateFile, 'utf-8')); }
    catch { return { itb_url: 'http://localhost:10003', itb_api_key: '', master_api_key: '', community_key: '', community_api_key: '', organisation_api_key: '', domain_key: '', domain_name: '', selected_community: null, selected_organisation: null, imported_igs: {} }; }
  }
  function saveState(s: any) {
    const dir = path.dirname(stateFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(s, null, 2));
  }

  // ── P2P matches sidecar ─────────────────────────────────────────────
  // A "match" is a chosen tuple (one system per actor) for a spec — the
  // input shape needed to launch a P2P test run. ITB doesn't have a native
  // P2P session-binding concept yet, so we own this. When ITB grows one,
  // migrate this sidecar's contents into ITB and drop the file.
  type P2PMatch = {
    id: string;
    name?: string;
    bindings: Record<string, string>; // actorApiKey → systemApiKey
    createdAt: string;
  };
  type P2PMatchesFile = { specs: Record<string, P2PMatch[]> };
  const matchesFile = path.join(path.dirname(stateFile), 'p2p_matches.json');

  function loadMatches(): P2PMatchesFile {
    try {
      const raw = JSON.parse(fs.readFileSync(matchesFile, 'utf-8'));
      return raw && typeof raw === 'object' && raw.specs ? raw : { specs: {} };
    } catch { return { specs: {} }; }
  }
  function saveMatches(d: P2PMatchesFile) {
    const dir = path.dirname(matchesFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(matchesFile, JSON.stringify(d, null, 2));
  }

  async function itbFetch(urlPath: string, opts: any = {}, apiKey?: string, authLevel?: 'master' | 'community' | 'organisation'): Promise<any> {
    if (mockMode) {
      const mock = (globalThis as any).__itbMock;
      console.log(`[itbFetch:mock] ${opts.method || 'GET'} ${urlPath}`);
      return mock ? mock.mockItbFetch(urlPath, opts) : { ok: false, status: 503, json: async () => ({ error: 'mock not ready' }), text: async () => 'mock not ready' };
    }
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
    if (mockMode) {
      const mock = (globalThis as any).__itbMock;
      return mock ? mock.mockDbQuery(sql) : '';
    }
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
    async configureServer(server) {

      // ── Mock mode: init the in-memory ITB before any request lands ─────
      if (mockMode) {
        try {
          const mod = await import('./src/mock/itbMock.js');
          await mod.initMock(mockFixturePath);
          // Stash the imported helpers so dbQuery/itbFetch can route to them.
          (globalThis as any).__itbMock = mod;
          console.log(`[mock] ITB_MOCK active — fixture: ${mockFixturePath}`);
        } catch (e: any) {
          console.error('[mock] init failed:', e.message);
          throw e;
        }
      }

      // GET /api/state
      server.middlewares.use('/api/state', (req, res) => {
        if (req.method !== 'GET') { res.statusCode = 405; res.end(''); return; }
        const state = loadState();
        // Use master key first (works on fresh ITB), then community key
        const masterKey = state.master_api_key || env.VITE_ITB_MASTER_API_KEY || '';
        const communityKey = state.community_api_key || state.itb_api_key || env.VITE_ITB_COMMUNITY_API_KEY || '';
        const apiKey = masterKey || communityKey;
        const baseUrl = state.itb_url || env.VITE_ITB_BASE_URL || 'http://localhost:10003';

        // Mock mode: short-circuit the connection probe — there's no real ITB
        // to reach, but we always report connected so the UI doesn't show a
        // misleading "Disconnected" state. Surface mock_mode for UI badging.
        if (mockMode) {
          state.connected = true;
          state.has_master_key = true;
          state.community_api_key = state.community_api_key || 'MOCK_COMMUNITY_KEY';
          state.organisation_api_key = state.organisation_api_key || '';
          state.mock_mode = true;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(state));
          return;
        }
        state.mock_mode = false;
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

      // /api/systems — PUT create system; GET /{key}/detail returns the system view
      server.middlewares.use('/api/systems', async (req, res) => {
        const url = new URL(req.url || '/', `http://${req.headers.host}`);
        const parts = url.pathname.replace(/^\//, '').split('/').filter(Boolean);

        // GET /api/systems/{key}/detail — system info + organisation/community + conformance rows
        if (req.method === 'GET' && parts.length === 2 && parts[1] === 'detail') {
          const sysKey = parts[0];
          // Defensive — only allow chars typical for an ITB API key. Prevents SQL injection
          // since dbQuery interpolates the value directly into a `mysql -e` arg.
          if (!/^[A-Za-z0-9_-]+$/.test(sysKey)) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'invalid system key' }));
            return;
          }
          try {
            // System + Organisation + Community in one row.
            const base = dbQuery(
              `SELECT sys.sname, sys.fname, sys.description, sys.api_key, ` +
              `o.api_key, o.sname, o.fname, ` +
              `COALESCE(c.api_key, ''), COALESCE(c.sname, ''), COALESCE(c.fname, '') ` +
              `FROM Systems sys ` +
              `JOIN Organizations o ON sys.owner = o.id ` +
              `LEFT JOIN Communities c ON o.community = c.id ` +
              `WHERE sys.api_key = '${sysKey}'`
            );
            if (!base) {
              res.statusCode = 404;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'system not found' }));
              return;
            }
            const cols = base.split('\t');
            const [sname, fname, description, apiKey, orgKey, orgSname, orgFname, commKey, commSname, commFname] = cols;
            const norm = (v: string | undefined) => (!v || v === 'NULL') ? '' : v;
            const detail: any = {
              apiKey: norm(apiKey),
              shortName: norm(sname),
              fullName: norm(fname),
              description: norm(description),
              organisationKey: norm(orgKey),
              organisationName: norm(orgFname) || norm(orgSname),
              communityKey: norm(commKey),
              communityName: norm(commFname) || norm(commSname),
              conformance: [] as any[],
            };

            // Conformance: SystemImplementsActors → Actors → SpecificationHasActors → Specifications → Domains
            const confRaw = dbQuery(
              `SELECT COALESCE(spec.api_key, ''), COALESCE(spec.sname, ''), COALESCE(spec.fname, ''), ` +
              `COALESCE(d.api_key, ''), COALESCE(d.sname, ''), COALESCE(d.fname, ''), ` +
              `a.api_key, COALESCE(a.actorId, ''), COALESCE(a.name, '') ` +
              `FROM SystemImplementsActors sia ` +
              `JOIN Systems sys ON sia.sut_id = sys.id ` +
              `JOIN Actors a ON sia.actor_id = a.id ` +
              `LEFT JOIN SpecificationHasActors sha ON sha.actor_id = a.id ` +
              `LEFT JOIN Specifications spec ON sha.spec_id = spec.id ` +
              `LEFT JOIN Domains d ON spec.domain = d.id ` +
              `WHERE sys.api_key = '${sysKey}'`
            );
            if (confRaw) {
              for (const line of confRaw.split('\n')) {
                const c = line.split('\t');
                if (c.length < 9) continue;
                const [specKey, specSname, specFname, domKey, domSname, domFname, actorKey, actorId, actorName] = c;
                if (!specKey) continue;  // actor not bound to any spec — skip orphans
                detail.conformance.push({
                  specKey: norm(specKey),
                  specShortName: norm(specSname),
                  specFullName: norm(specFname),
                  domainKey: norm(domKey),
                  domainShortName: norm(domSname),
                  domainFullName: norm(domFname),
                  actorKey: norm(actorKey),
                  actorIdentifier: norm(actorId),
                  actorName: norm(actorName),
                });
              }
            }

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(detail));
          } catch (e: any) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: e.message }));
          }
          return;
        }

        // PUT /api/systems — create system (delegates to ITB REST)
        if (req.method === 'PUT' && parts.length === 0) {
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
          return;
        }

        res.statusCode = 405; res.end('');
      });

      // GET /api/conformance/matrix
      // Returns the conformance matrix (systems × specs) with the latest run per cell.
      //
      // Episode model: v1 only knows the "current" episode (synthesised — for each
      // (system, actor, spec), use the most recent run). The response carries an
      // `episode` field so future named episodes (Connectathons, release verification
      // events) slot in without breaking the contract.
      //
      // Source model: v1 is *lazy* — derives everything from existing ITB tables
      // (SystemImplementsActors + testresults). The contract is shaped as if Test
      // Instances were owned objects so we can swap to an owned source without
      // changing the frontend.
      //
      // Filters: ?community=KEY  ?domain=KEY  ?organisation=KEY  ?staleDays=30
      server.middlewares.use('/api/conformance/matrix', async (req, res) => {
        if (req.method !== 'GET') { res.statusCode = 405; res.end(''); return; }
        try {
          const u = new URL(req.url || '/', `http://${req.headers.host}`);
          const communityKey = u.searchParams.get('community') || '';
          const domainKey = u.searchParams.get('domain') || '';
          const organisationKey = u.searchParams.get('organisation') || '';
          const staleDays = Number(u.searchParams.get('staleDays') || '30');
          // Defensive: keys are interpolated into mysql -e args; allow only API-key chars.
          for (const k of [communityKey, domainKey, organisationKey]) {
            if (k && !/^[A-Za-z0-9_-]+$/.test(k)) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'invalid filter key' }));
              return;
            }
          }
          const filters: string[] = [];
          if (communityKey) filters.push(`c.api_key = '${communityKey}'`);
          if (organisationKey) filters.push(`o.api_key = '${organisationKey}'`);
          if (domainKey) filters.push(`d.api_key = '${domainKey}'`);
          const whereExtra = filters.length ? ` AND ${filters.join(' AND ')}` : '';

          // One join: every conformance claim with its spec, domain, organisation,
          // community, actor, and the *latest* test result for the (sut,actor,spec) tuple.
          const sql =
            `SELECT ` +
            `  sys.api_key, COALESCE(sys.sname,''), COALESCE(sys.fname,''), ` +
            `  o.api_key, COALESCE(o.sname,''), COALESCE(o.fname,''), ` +
            `  COALESCE(c.api_key,''), COALESCE(c.sname,''), COALESCE(c.fname,''), ` +
            `  spec.api_key, COALESCE(spec.sname,''), COALESCE(spec.fname,''), ` +
            `  d.api_key, COALESCE(d.sname,''), COALESCE(d.fname,''), ` +
            `  a.api_key, COALESCE(a.actorId,''), COALESCE(a.name,''), ` +
            `  COALESCE(latest.result,''), ` +
            `  COALESCE(UNIX_TIMESTAMP(latest.end_time),0), ` +
            `  COALESCE(latest.test_session_id,'') ` +
            `FROM SystemImplementsActors sia ` +
            `JOIN Systems sys ON sia.sut_id = sys.id ` +
            `JOIN Organizations o ON sys.owner = o.id ` +
            `LEFT JOIN Communities c ON o.community = c.id ` +
            `JOIN Actors a ON sia.actor_id = a.id ` +
            `JOIN SpecificationHasActors sha ON sha.actor_id = a.id ` +
            `JOIN Specifications spec ON sha.spec_id = spec.id ` +
            `JOIN Domains d ON spec.domain = d.id ` +
            // Latest test result per (sut, actor, spec) — picks the row with the most
            // recent start_time among those that have ended.
            `LEFT JOIN ( ` +
            `  SELECT t.sut_id, t.actor_id, t.specification_id, t.result, t.end_time, t.test_session_id ` +
            `  FROM testresults t ` +
            `  INNER JOIN ( ` +
            `    SELECT sut_id, actor_id, specification_id, MAX(start_time) AS max_start ` +
            `    FROM testresults ` +
            `    WHERE end_time IS NOT NULL AND sut_id IS NOT NULL AND actor_id IS NOT NULL AND specification_id IS NOT NULL ` +
            `    GROUP BY sut_id, actor_id, specification_id ` +
            `  ) g ON t.sut_id = g.sut_id AND t.actor_id = g.actor_id AND t.specification_id = g.specification_id AND t.start_time = g.max_start ` +
            `) latest ON latest.sut_id = sia.sut_id AND latest.actor_id = sia.actor_id AND latest.specification_id = spec.id ` +
            `WHERE sys.api_key IS NOT NULL${whereExtra}`;

          const raw = dbQuery(sql);
          const systemsMap = new Map<string, any>();
          const specsMap = new Map<string, any>();
          const cells: any[] = [];
          const nowSec = Math.floor(Date.now() / 1000);
          const staleSec = Math.max(1, staleDays) * 24 * 3600;

          if (raw) {
            for (const line of raw.split('\n')) {
              const c = line.split('\t');
              if (c.length < 21) continue;
              const [
                sysKey, sysShort, sysFull,
                orgKey, orgShort, orgFull,
                commKey, commShort, commFull,
                specKey, specShort, specFull,
                domKey, domShort, domFull,
                actorKey, actorIdStr, actorName,
                result, endUnixStr, sessionId,
              ] = c;

              if (!systemsMap.has(sysKey)) {
                systemsMap.set(sysKey, {
                  apiKey: sysKey, shortName: sysShort, fullName: sysFull,
                  organisation: { apiKey: orgKey, shortName: orgShort, fullName: orgFull },
                  community: commKey ? { apiKey: commKey, shortName: commShort, fullName: commFull } : null,
                });
              }
              if (!specsMap.has(specKey)) {
                specsMap.set(specKey, {
                  apiKey: specKey, shortName: specShort, fullName: specFull,
                  domain: { apiKey: domKey, shortName: domShort, fullName: domFull },
                });
              }

              const endUnix = Number(endUnixStr) || 0;
              let status: string;
              let ageDays: number | null = null;
              let lastRunAt: string | null = null;
              if (endUnix > 0) {
                const ageSec = nowSec - endUnix;
                ageDays = Math.max(0, Math.floor(ageSec / 86400));
                lastRunAt = new Date(endUnix * 1000).toISOString();
                if (result === 'SUCCESS') status = ageSec > staleSec ? 'stale' : 'passed';
                else status = 'failed';
              } else {
                status = 'claimed';  // claim exists but no run yet
              }

              cells.push({
                systemKey: sysKey,
                specKey,
                actorKey,
                actorIdentifier: actorIdStr,
                actorName,
                status,
                ageDays,
                lastRunAt,
                lastSessionId: sessionId || null,
              });
            }
          }

          const response = {
            episode: { key: 'current', name: 'Current', isLive: true, source: 'lazy' },
            staleDays,
            filters: { community: communityKey || null, organisation: organisationKey || null, domain: domainKey || null },
            systems: Array.from(systemsMap.values()),
            specs: Array.from(specsMap.values()),
            cells,
          };

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(response));
        } catch (e: any) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: e.message }));
        }
      });

      // GET /api/itb-spec-url?spec={apiKey}
      // Returns the ITB admin URL for a specification — resolves the numeric
      // domain.id and spec.id from the spec api_key, then builds:
      //   {base}/app#/admin/domains/{domainId}/specifications/{specId}
      // (Pattern verified from ITB's Angular route config: see admin route
      //  `domains/:DOMAIN_ID/specifications/:SPECIFICATION_ID`.)
      // Returns { url: null } if either ID can't be resolved.
      server.middlewares.use('/api/itb-spec-url', (req, res) => {
        if (req.method !== 'GET') { res.statusCode = 405; res.end(''); return; }
        try {
          const u = new URL(req.url || '/', `http://${req.headers.host}`);
          const specKey = u.searchParams.get('spec') || '';
          if (!specKey || !/^[A-Za-z0-9_-]+$/.test(specKey)) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'invalid or missing spec' }));
            return;
          }
          const row = dbQuery(
            `SELECT spec.id, COALESCE(d.id, '') ` +
            `FROM Specifications spec ` +
            `LEFT JOIN Domains d ON spec.domain = d.id ` +
            `WHERE spec.api_key = '${specKey}' LIMIT 1`
          );
          if (!row) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'spec not found', url: null }));
            return;
          }
          const [specId, domainId] = row.split('\t');
          const state = loadState();
          const base = (state.itb_url || 'http://localhost:10003').replace(/\/+$/, '');
          let url: string | null = null;
          if (specId && domainId) {
            url = `${base}/app#/admin/domains/${domainId}/specifications/${specId}`;
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            url,
            domainId: Number(domainId) || null,
            specId: Number(specId) || null,
          }));
        } catch (e: any) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: e.message, url: null }));
        }
      });

      // GET /api/itb-session-url?session={sessionId}
      // Returns the ITB execute URL for a recorded session by reading the IDs ITB
      // already stored on `testresults`. This is the reliable path: it does NOT
      // depend on the user's itbConfig having every key populated, because every
      // testresults row carries community_id, organization_id, sut_id, actor_id.
      server.middlewares.use('/api/itb-session-url', (req, res) => {
        if (req.method !== 'GET') { res.statusCode = 405; res.end(''); return; }
        try {
          const u = new URL(req.url || '/', `http://${req.headers.host}`);
          const sid = u.searchParams.get('session') || '';
          if (!sid || !/^[A-Za-z0-9_-]+$/.test(sid)) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'invalid or missing session' }));
            return;
          }
          const row = dbQuery(
            `SELECT COALESCE(community_id, ''), COALESCE(organization_id, ''), ` +
            `COALESCE(sut_id, ''), COALESCE(actor_id, ''), ` +
            `COALESCE(testsuite_id, ''), COALESCE(testcase_id, '') ` +
            `FROM testresults WHERE test_session_id = '${sid}' LIMIT 1`
          );
          if (!row) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'session not found' }));
            return;
          }
          const [cid, oid, sysid, aid, tsid, tcid] = row.split('\t');
          const state = loadState();
          const base = (state.itb_url || 'http://localhost:10003').replace(/\/+$/, '');
          let url: string;
          // Need at least community/org/system/actor for a usable deep link.
          if (cid && oid && sysid && aid) {
            url = `${base}/app#/admin/users/community/${cid}/organisation/${oid}/test/${sysid}/${aid}/execute`;
            // Append the test case id (or test suite as fallback) — this is the
            // existing post-deploy URL pattern used elsewhere in this file.
            if (tcid) url += `?tc=${tcid}`;
            else if (tsid) url += `?ts=${tsid}`;
          } else {
            url = `${base}/app`;
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            url,
            communityId: Number(cid) || null,
            organisationId: Number(oid) || null,
            systemId: Number(sysid) || null,
            actorId: Number(aid) || null,
            testSuiteId: Number(tsid) || null,
            testCaseId: Number(tcid) || null,
          }));
        } catch (e: any) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: e.message }));
        }
      });

      // GET /api/runs — paginated list of Runs (rows of `testresults`) joined with
      // system / spec / actor / domain api_keys. Reused by Spec detail and System
      // detail "Recent runs" sections, and by future global Runs view.
      //
      // Query params (all optional, all AND'd):
      //   system, spec, community, actor — API-key filters
      //   from, to                       — ISO dates against start_time
      //   limit (default 50, max 200), offset (default 0)
      server.middlewares.use('/api/runs', async (req, res) => {
        if (req.method !== 'GET') { res.statusCode = 405; res.end(''); return; }
        try {
          const u = new URL(req.url || '/', `http://${req.headers.host}`);
          const systemKey = u.searchParams.get('system') || '';
          const specKey = u.searchParams.get('spec') || '';
          const communityKey = u.searchParams.get('community') || '';
          const actorKey = u.searchParams.get('actor') || '';
          const fromStr = u.searchParams.get('from') || '';
          const toStr = u.searchParams.get('to') || '';
          const limit = Math.min(200, Math.max(1, Number(u.searchParams.get('limit') || '50')));
          const offset = Math.max(0, Number(u.searchParams.get('offset') || '0'));

          for (const k of [systemKey, specKey, communityKey, actorKey]) {
            if (k && !/^[A-Za-z0-9_-]+$/.test(k)) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'invalid filter key' }));
              return;
            }
          }
          // ISO date validation (best-effort: yyyy-mm-dd or full ISO)
          const isoOk = (s: string) => !s || /^\d{4}-\d{2}-\d{2}(T[\d:.Z+-]+)?$/.test(s);
          if (!isoOk(fromStr) || !isoOk(toStr)) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'invalid date filter' }));
            return;
          }

          const where: string[] = ['tr.start_time IS NOT NULL'];
          if (systemKey) where.push(`sys.api_key = '${systemKey}'`);
          if (specKey) where.push(`spec.api_key = '${specKey}'`);
          if (communityKey) where.push(`c.api_key = '${communityKey}'`);
          if (actorKey) where.push(`a.api_key = '${actorKey}'`);
          if (fromStr) where.push(`tr.start_time >= '${fromStr}'`);
          if (toStr) where.push(`tr.start_time <= '${toStr}'`);
          const whereClause = `WHERE ${where.join(' AND ')}`;

          // Total count (separate query — page sizes can be small relative to total).
          const countSql =
            `SELECT COUNT(*) ` +
            `FROM testresults tr ` +
            `LEFT JOIN Systems sys ON tr.sut_id = sys.id ` +
            `LEFT JOIN Organizations o ON sys.owner = o.id ` +
            `LEFT JOIN Communities c ON o.community = c.id ` +
            `LEFT JOIN Specifications spec ON tr.specification_id = spec.id ` +
            `LEFT JOIN Actors a ON tr.actor_id = a.id ` +
            whereClause;
          const totalRaw = dbQuery(countSql);
          const total = Number(totalRaw) || 0;

          // Page query.
          const pageSql =
            `SELECT ` +
            `  tr.test_session_id, ` +
            `  COALESCE(sys.api_key, ''), COALESCE(sys.fname, ''), COALESCE(sys.sname, ''), ` +
            `  COALESCE(spec.api_key, ''), COALESCE(spec.fname, ''), COALESCE(spec.sname, ''), ` +
            `  COALESCE(a.api_key, ''), COALESCE(a.actorId, ''), COALESCE(a.name, ''), ` +
            `  tr.result, ` +
            `  COALESCE(UNIX_TIMESTAMP(tr.start_time), 0), ` +
            `  COALESCE(UNIX_TIMESTAMP(tr.end_time), 0) ` +
            `FROM testresults tr ` +
            `LEFT JOIN Systems sys ON tr.sut_id = sys.id ` +
            `LEFT JOIN Organizations o ON sys.owner = o.id ` +
            `LEFT JOIN Communities c ON o.community = c.id ` +
            `LEFT JOIN Specifications spec ON tr.specification_id = spec.id ` +
            `LEFT JOIN Actors a ON tr.actor_id = a.id ` +
            whereClause + ' ' +
            `ORDER BY tr.start_time DESC ` +
            `LIMIT ${limit} OFFSET ${offset}`;
          const raw = dbQuery(pageSql);

          const runs: any[] = [];
          if (raw) {
            for (const line of raw.split('\n')) {
              const c = line.split('\t');
              if (c.length < 13) continue;
              const [
                sessionId,
                sysKey, sysFull, sysShort,
                spKey, spFull, spShort,
                actKey, actId, actName,
                result,
                startedUnixStr, endedUnixStr,
              ] = c;
              const startedUnix = Number(startedUnixStr) || 0;
              const endedUnix = Number(endedUnixStr) || 0;
              runs.push({
                sessionId,
                systemKey: sysKey,
                systemName: sysFull || sysShort,
                specKey: spKey,
                specName: spFull || spShort,
                actorKey: actKey,
                actorIdentifier: actId,
                actorName: actName,
                result,
                startedAt: startedUnix > 0 ? new Date(startedUnix * 1000).toISOString() : null,
                endedAt: endedUnix > 0 ? new Date(endedUnix * 1000).toISOString() : null,
                durationSec: endedUnix > 0 && startedUnix > 0 ? endedUnix - startedUnix : null,
              });
            }
          }

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            total,
            limit,
            offset,
            filters: { system: systemKey || null, spec: specKey || null, community: communityKey || null, actor: actorKey || null, from: fromStr || null, to: toStr || null },
            runs,
          }));
        } catch (e: any) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: e.message }));
        }
      });

      // ── Vendor self-registration (open access; uses server's community key) ───
      // Routes mounted under /api/registration/* are intentionally minimal and
      // never expose other vendors' data:
      //  - GET  /api/registration/specs                — list of specs visible to a vendor
      //  - GET  /api/registration/org-name-available?name=X — { available: bool }
      //  - POST /api/registration/org                  — create org under server's community
      //  - POST /api/registration/system               — create system under {orgApiKey}
      //  - POST /api/registration/conformance          — create conformance statements
      //  - GET  /api/registration/itb-org-url?org=X    — deep-link to ITB org conformance dashboard
      //
      // Today: open URL — anyone who reaches /#/register can register. Later: an
      // env-var-gated invite-token mode + an env-var-gated allow-duplicate-with-suffix
      // mode for the org name.

      server.middlewares.use('/api/registration/specs', async (req, res) => {
        if (req.method !== 'GET') { res.statusCode = 405; res.end(''); return; }
        try {
          // Pull all specs in all domains. For each spec, only return actors
          // that are the SUT in at least one testcase — that's the universe a
          // vendor can claim conformance against. ITB's TestCaseHasActors.sut
          // (populated by its testsuite parser from GITB role="SUT") is the
          // source of truth. Infra actors (Validator, mocks, simulators) are
          // never offered to the vendor.
          //
          // Specs with no SUT actors (e.g. nothing deployed yet) still appear
          // as a row with NULL actor columns so the UI can show the spec
          // exists but is not claimable.
          const raw = dbQuery(
            `SELECT spec.api_key, COALESCE(spec.sname, ''), COALESCE(spec.fname, ''), COALESCE(spec.description, ''), ` +
            `d.api_key, COALESCE(d.sname, ''), COALESCE(d.fname, ''), ` +
            `(SELECT COUNT(*) FROM SpecificationHasTestSuites WHERE spec = spec.id) AS suite_count, ` +
            `COALESCE(a.api_key, ''), COALESCE(a.actorId, ''), COALESCE(a.name, ''), COALESCE(a.description, ''), ` +
            `COALESCE(a.is_default, 0) ` +
            `FROM Specifications spec ` +
            `JOIN Domains d ON spec.domain = d.id ` +
            `LEFT JOIN ( ` +
            `  SELECT DISTINCT tha.specification AS spec_id, tha.actor AS actor_id ` +
            `  FROM TestCaseHasActors tha WHERE tha.sut = 1 ` +
            `) sut_actors ON sut_actors.spec_id = spec.id ` +
            `LEFT JOIN Actors a ON a.id = sut_actors.actor_id AND a.is_hidden = 0 ` +
            `WHERE spec.api_key IS NOT NULL AND spec.is_hidden = 0 ` +
            `ORDER BY d.sname, spec.sname, a.is_default DESC, a.name`
          );

          // Roll up the (spec, actor) rows into specs[] each carrying actors[].
          const specMap = new Map<string, any>();
          if (raw) {
            for (const line of raw.split('\n')) {
              const c = line.split('\t');
              if (c.length < 13) continue;
              const specKey = c[0];
              if (!specMap.has(specKey)) {
                specMap.set(specKey, {
                  apiKey: specKey,
                  shortName: c[1],
                  fullName: c[2],
                  description: c[3] || '',
                  domain: { apiKey: c[4], shortName: c[5], fullName: c[6] || c[5] },
                  suiteCount: Number(c[7]) || 0,
                  actors: [],
                });
              }
              const actorKey = c[8];
              if (actorKey) {
                const actorIdent = c[9];
                specMap.get(specKey).actors.push({
                  apiKey: actorKey,
                  identifier: actorIdent,
                  name: c[10] || actorIdent,
                  description: c[11] || '',
                  isDefault: c[12] === '1',
                });
              }
            }
          }

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ specs: Array.from(specMap.values()) }));
        } catch (e: any) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: e.message }));
        }
      });

      server.middlewares.use('/api/registration/org-name-available', async (req, res) => {
        if (req.method !== 'GET') { res.statusCode = 405; res.end(''); return; }
        try {
          const u = new URL(req.url || '/', `http://${req.headers.host}`);
          const name = (u.searchParams.get('name') || '').trim();
          if (!name) {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ available: false, reason: 'empty' }));
            return;
          }
          // Direct DB check — does NOT expose any list to the caller. Match by
          // sname OR fname (vendors enter just one name, we check both columns).
          // Escape single-quotes to keep the dbQuery interpolation safe.
          const safe = name.replace(/'/g, "''");
          const hit = dbQuery(
            `SELECT 1 FROM Organizations ` +
            `WHERE sname = '${safe}' OR fname = '${safe}' LIMIT 1`
          );
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ available: !hit }));
        } catch (e: any) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: e.message, available: false }));
        }
      });

      server.middlewares.use('/api/registration/org', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(''); return; }
        try {
          const body = JSON.parse(await readBody(req));
          const name = (body.name || '').trim();
          if (!name) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'name required' }));
            return;
          }
          // Re-check name availability server-side (defence in depth).
          const safe = name.replace(/'/g, "''");
          const hit = dbQuery(
            `SELECT 1 FROM Organizations WHERE sname = '${safe}' OR fname = '${safe}' LIMIT 1`
          );
          // TODO: when env.VENDOR_REG_ALLOW_DUPLICATES is true, append a suffix instead of rejecting.
          if (hit) {
            res.statusCode = 409;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'name_taken' }));
            return;
          }
          // Create via ITB REST using the server's community key. Crucially this does
          // NOT mutate state.selected_organisation/state.organisation_api_key — that
          // would conflict with concurrent admin sessions and concurrent vendors.
          const r = await itbFetch('/organisation', {
            method: 'PUT',
            body: JSON.stringify({
              shortName: name,
              fullName: body.fullName || name,
              description: body.description || '',
            }),
          }, undefined, 'community');
          const data = await r.json();
          res.statusCode = r.status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(data));
        } catch (e: any) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: e.message }));
        }
      });

      server.middlewares.use('/api/registration/system', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(''); return; }
        try {
          const body = JSON.parse(await readBody(req));
          const name = (body.name || '').trim();
          const orgApiKey = body.organisation || '';
          if (!name || !orgApiKey) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'name and organisation required' }));
            return;
          }
          if (!/^[A-Za-z0-9_-]+$/.test(orgApiKey)) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'invalid organisation key' }));
            return;
          }
          const r = await itbFetch('/system', {
            method: 'PUT',
            body: JSON.stringify({
              shortName: name,
              fullName: body.fullName || name,
              description: body.description || '',
              version: body.version || '1.0',
              organisation: orgApiKey,
            }),
          }, undefined, 'community');
          const data = await r.json();
          res.statusCode = r.status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(data));
        } catch (e: any) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: e.message }));
        }
      });

      // POST /api/registration/conformance
      // Body: { orgApiKey, systemApiKey, actorApiKeys: [string] }
      // Each actorApiKey produces one ConformanceStatement (System, Actor) — that's
      // the atomic unit of conformance in ITB. The Specification a given actor belongs
      // to is implicit (an actor lives in exactly one Spec).
      // Auth: ITB's PUT /api/rest/conformance/{system}/{actor} requires the
      // organisation's api_key (community-level keys are silently ignored).
      // The client knows the orgApiKey from Step 1 of the wizard; if it's
      // omitted, fall back to looking it up from the system row.
      server.middlewares.use('/api/registration/conformance', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(''); return; }
        try {
          const body = JSON.parse(await readBody(req));
          const systemKey = body.systemApiKey || '';
          let orgKey: string = body.orgApiKey || '';
          const actorKeys: string[] = Array.isArray(body.actorApiKeys) ? body.actorApiKeys : [];
          if (!systemKey || actorKeys.length === 0) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'systemApiKey and actorApiKeys required' }));
            return;
          }
          for (const k of [systemKey, ...actorKeys, ...(orgKey ? [orgKey] : [])]) {
            if (!/^[A-Za-z0-9_-]+$/.test(k)) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'invalid key' }));
              return;
            }
          }
          // Fallback: derive orgApiKey from the system row if the client didn't pass it.
          if (!orgKey) {
            const sysSafe = systemKey.replace(/'/g, "''");
            const orgRow = dbQuery(
              `SELECT o.api_key FROM Systems s ` +
              `JOIN Organizations o ON o.id = s.owner ` +
              `WHERE s.api_key = '${sysSafe}' LIMIT 1`
            );
            if (orgRow) orgKey = orgRow;
          }

          // Defence-in-depth: never let a vendor claim conformance against an
          // actor that isn't SUT in any testcase (e.g. infra/validator). The
          // /api/registration/specs response already filters these out, but
          // a malicious client could still POST any actor api_key here.
          // Actors with no testcase mapping default to 'SUT' for back-compat.
          const sutByKey = new Map<string, boolean>();
          if (actorKeys.length > 0) {
            const inList = actorKeys.map(k => `'${k.replace(/'/g, "''")}'`).join(',');
            const rows = dbQuery(
              `SELECT a.api_key, COALESCE(MAX(tha.sut), 1) AS is_sut ` +
              `FROM Actors a ` +
              `LEFT JOIN TestCaseHasActors tha ON tha.actor = a.id ` +
              `WHERE a.api_key IN (${inList}) ` +
              `GROUP BY a.api_key`
            );
            if (rows) {
              for (const line of rows.split('\n')) {
                const c = line.split('\t');
                if (c.length < 2) continue;
                sutByKey.set(c[0], c[1] === '1');
              }
            }
          }
          const blocked = actorKeys.filter(k => sutByKey.get(k) === false);
          if (blocked.length > 0) {
            res.statusCode = 403;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'role_not_claimable', actors: blocked }));
            return;
          }

          const created: any[] = [];
          for (const actorKey of actorKeys) {
            try {
              // ITB's conformance endpoint requires the organisation's api_key.
              // No body — the existing working call elsewhere uses an empty PUT.
              const cr = await itbFetch(
                `/conformance/${systemKey}/${actorKey}`,
                { method: 'PUT' },
                orgKey || undefined,
                'organisation'
              );
              const ok = cr.ok;
              const errText = ok ? undefined : await cr.text().catch(() => `HTTP ${cr.status}`);
              if (!ok) console.warn(`[registration/conformance] ${systemKey}/${actorKey} → ${cr.status}: ${errText}`);
              created.push({ actorApiKey: actorKey, ok, error: errText });
            } catch (e: any) {
              created.push({ actorApiKey: actorKey, ok: false, error: e.message });
            }
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ created }));
        } catch (e: any) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: e.message }));
        }
      });

      // GET /api/registration/itb-org-url?org={apiKey}
      // Returns the ITB UI URL where the vendor can see their org's conformance
      // statements. Resolves the numeric org id and points at:
      //   {base}/app#/organisation/conformance/{orgId}
      // Uses the existing community-side session (no OAuth yet).
      server.middlewares.use('/api/registration/itb-org-url', async (req, res) => {
        if (req.method !== 'GET') { res.statusCode = 405; res.end(''); return; }
        try {
          const u = new URL(req.url || '/', `http://${req.headers.host}`);
          const orgKey = u.searchParams.get('org') || '';
          if (!orgKey || !/^[A-Za-z0-9_-]+$/.test(orgKey)) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'invalid org' }));
            return;
          }
          const row = dbQuery(`SELECT id FROM Organizations WHERE api_key = '${orgKey}' LIMIT 1`);
          const state = loadState();
          const base = (state.itb_url || 'http://localhost:10003').replace(/\/+$/, '');
          if (!row) {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ url: `${base}/app`, orgId: null }));
            return;
          }
          const orgId = Number(row);
          const url = `${base}/app#/organisation/conformance/${orgId}`;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ url, orgId }));
        } catch (e: any) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: e.message }));
        }
      });

      // ── Management — P2P matches (manager-only) ──────────────────────
      // GET    /api/management/matches            — per-spec grid + saved matches
      // POST   /api/management/matches            — create a match (one system per actor)
      // DELETE /api/management/matches/:specKey/:matchId  — remove a match
      //
      // The grid combines two ITB queries:
      //  1. SUT-eligible actors per spec (TestCaseHasActors.sut=1).
      //  2. (System, Org) pairs that have registered conformance for each
      //     actor (SystemImplementsActors).
      // The saved matches come from our local sidecar (p2p_matches.json).
      server.middlewares.use('/api/management/matches', async (req, res) => {
        try {
          // Vite mounts the middleware at /api/management/matches; req.url is
          // the path relative to that mount, e.g. '/' or '/{specKey}/{matchId}'.
          const url = new URL(req.url || '/', `http://${req.headers.host}`);
          const tail = url.pathname.replace(/^\/+/, '').replace(/\/+$/, '');

          if (req.method === 'GET' && !tail) {
            // 1) Per-spec actors (only those that are SUT in some testcase).
            //    Includes spec.id so we can scope testresults lookups by spec.
            const actorsRaw = dbQuery(
              `SELECT spec.api_key, COALESCE(spec.sname, ''), COALESCE(spec.fname, ''), ` +
              `d.api_key, COALESCE(d.sname, ''), COALESCE(d.fname, ''), ` +
              `a.api_key, COALESCE(a.actorId, ''), COALESCE(a.name, ''), ` +
              `spec.id ` +
              `FROM Specifications spec ` +
              `JOIN Domains d ON spec.domain = d.id ` +
              `LEFT JOIN ( ` +
              `  SELECT DISTINCT tha.specification AS spec_id, tha.actor AS actor_id ` +
              `  FROM TestCaseHasActors tha WHERE tha.sut = 1 ` +
              `) sut_actors ON sut_actors.spec_id = spec.id ` +
              `LEFT JOIN Actors a ON a.id = sut_actors.actor_id AND a.is_hidden = 0 ` +
              `WHERE spec.api_key IS NOT NULL AND spec.is_hidden = 0 ` +
              `ORDER BY d.sname, spec.sname, a.actorId`
            );

            // 2) (system, org) pairs registered against any SUT-eligible actor.
            const regsRaw = dbQuery(
              `SELECT spec.api_key, a.api_key, ` +
              `sys.api_key, COALESCE(sys.sname, ''), COALESCE(sys.fname, ''), ` +
              `org.api_key, COALESCE(org.sname, ''), COALESCE(org.fname, '') ` +
              `FROM SystemImplementsActors sia ` +
              `JOIN Actors a ON a.id = sia.actor_id ` +
              `JOIN Systems sys ON sys.id = sia.sut_id ` +
              `JOIN Organizations org ON org.id = sys.owner ` +
              `JOIN SpecificationHasActors sha ON sha.actor_id = a.id ` +
              `JOIN Specifications spec ON spec.id = sha.spec_id ` +
              `WHERE spec.is_hidden = 0 AND a.is_hidden = 0 ` +
              `  AND EXISTS (SELECT 1 FROM TestCaseHasActors tha ` +
              `              WHERE tha.actor = a.id AND tha.sut = 1) ` +
              `ORDER BY spec.sname, a.actorId, org.sname, sys.sname`
            );

            const specMap = new Map<string, any>();
            const actorMap = new Map<string, any>(); // (spec|actor) → actor obj
            const specIdByKey = new Map<string, string>();
            if (actorsRaw) {
              for (const line of actorsRaw.split('\n')) {
                const c = line.split('\t');
                if (c.length < 10) continue;
                const specKey = c[0];
                if (!specMap.has(specKey)) {
                  specMap.set(specKey, {
                    apiKey: specKey,
                    shortName: c[1],
                    fullName: c[2],
                    domain: { apiKey: c[3], shortName: c[4], fullName: c[5] || c[4] },
                    actors: [],
                  });
                  specIdByKey.set(specKey, c[9]);
                }
                const actorKey = c[6];
                if (actorKey) {
                  const actor = {
                    apiKey: actorKey,
                    identifier: c[7],
                    name: c[8] || c[7],
                    systems: [] as any[],
                  };
                  specMap.get(specKey).actors.push(actor);
                  actorMap.set(`${specKey}|${actorKey}`, actor);
                }
              }
            }
            if (regsRaw) {
              for (const line of regsRaw.split('\n')) {
                const c = line.split('\t');
                if (c.length < 8) continue;
                const [specKey, actorKey, sysKey, sysSname, sysFname, orgKey, orgSname, orgFname] = c;
                const actor = actorMap.get(`${specKey}|${actorKey}`);
                if (!actor) continue;
                actor.systems.push({
                  systemApiKey: sysKey,
                  systemName: sysFname || sysSname,
                  orgApiKey: orgKey,
                  orgName: orgFname || orgSname,
                });
              }
            }

            // 3) Saved matches.
            const matches = loadMatches();

            // 4) Resolve deep links per binding. ITB's "execute" URL needs
            //    numeric ids: community / org / system / actor. Collect unique
            //    api_keys across ALL matches first, batch-resolve, then build
            //    one link per binding.
            const allSystemKeys = new Set<string>();
            const allActorKeys = new Set<string>();
            for (const list of Object.values(matches.specs)) {
              for (const m of list) {
                for (const [aKey, sKey] of Object.entries(m.bindings)) {
                  if (aKey) allActorKeys.add(aKey);
                  if (sKey) allSystemKeys.add(sKey);
                }
              }
            }

            type SysInfo = { sysId: string; sysName: string; orgId: string; orgName: string; commId: string; commName: string };
            const sysInfo = new Map<string, SysInfo>();
            const actorIdByKey = new Map<string, string>();
            const actorNameByKey = new Map<string, string>();

            if (allSystemKeys.size > 0) {
              const inList = [...allSystemKeys].map(k => `'${k.replace(/'/g, "''")}'`).join(',');
              const r = dbQuery(
                `SELECT s.api_key, s.id, COALESCE(s.fname, s.sname), ` +
                `o.id, COALESCE(o.fname, o.sname), ` +
                `c.id, COALESCE(c.fname, c.sname) ` +
                `FROM Systems s ` +
                `JOIN Organizations o ON o.id = s.owner ` +
                `JOIN Communities c ON c.id = o.community ` +
                `WHERE s.api_key IN (${inList})`
              );
              if (r) {
                for (const line of r.split('\n')) {
                  const c = line.split('\t');
                  if (c.length < 7) continue;
                  sysInfo.set(c[0], {
                    sysId: c[1], sysName: c[2],
                    orgId: c[3], orgName: c[4],
                    commId: c[5], commName: c[6],
                  });
                }
              }
            }
            if (allActorKeys.size > 0) {
              const inList = [...allActorKeys].map(k => `'${k.replace(/'/g, "''")}'`).join(',');
              const r = dbQuery(
                `SELECT a.api_key, a.id, COALESCE(a.name, a.actorId) FROM Actors a WHERE a.api_key IN (${inList})`
              );
              if (r) {
                for (const line of r.split('\n')) {
                  const c = line.split('\t');
                  if (c.length < 3) continue;
                  actorIdByKey.set(c[0], c[1]);
                  actorNameByKey.set(c[0], c[2]);
                }
              }
            }

            const state = loadState();
            const itbBase = (state.itb_url || 'http://localhost:10003').replace(/\/+$/, '');

            // Resolve the FIRST testcase per (spec, actor) where the actor
            // is SUT — that's what ITB wants in `?tc=<id>` to render the
            // diagram. Falling back to `?ts=` (testsuite) lands on an empty
            // execution view, so prefer a concrete testcase per binding.
            const tcIdBySpecAndActor = new Map<string, string>(); // `${specId}|${actorId}` → tcId
            const tsIdBySpec = new Map<string, string>(); // specId → first testsuite id (fallback)
            if (specIdByKey.size > 0) {
              const idList = [...specIdByKey.values()].filter(Boolean).join(',');
              if (idList) {
                const tcRaw = dbQuery(
                  `SELECT specification, actor, MIN(testcase) ` +
                  `FROM TestCaseHasActors ` +
                  `WHERE sut = 1 AND specification IN (${idList}) ` +
                  `GROUP BY specification, actor`
                );
                if (tcRaw) {
                  for (const line of tcRaw.split('\n')) {
                    const c = line.split('\t');
                    if (c.length < 3) continue;
                    tcIdBySpecAndActor.set(`${c[0]}|${c[1]}`, c[2]);
                  }
                }
                const tsRaw = dbQuery(
                  `SELECT spec, MIN(testsuite) FROM SpecificationHasTestSuites ` +
                  `WHERE spec IN (${idList}) GROUP BY spec`
                );
                if (tsRaw) {
                  for (const line of tsRaw.split('\n')) {
                    const c = line.split('\t');
                    if (c.length < 2) continue;
                    if (c[1]) tsIdBySpec.set(c[0], c[1]);
                  }
                }
              }
            }

            // Enrich each match with a `links` array — one entry per binding.
            // Each link is per-vendor: send the URL to that vendor and they
            // land in ITB scoped to their (system, actor, testcase) view.
            function buildMatchLinks(m: P2PMatch, specApiKey: string) {
              const links: any[] = [];
              const specId = specIdByKey.get(specApiKey);
              for (const [actorKey, sysKey] of Object.entries(m.bindings)) {
                const sys = sysInfo.get(sysKey);
                const aId = actorIdByKey.get(actorKey);
                let url: string | null = null;
                if (sys && aId) {
                  url = `${itbBase}/app#/admin/users/community/${sys.commId}/organisation/${sys.orgId}/test/${sys.sysId}/${aId}/execute`;
                  // Per-actor: prefer a SUT testcase for this actor in this
                  // spec. Fall back to the first testsuite of the spec.
                  const tcId = specId ? tcIdBySpecAndActor.get(`${specId}|${aId}`) : undefined;
                  if (tcId) url += `?tc=${tcId}`;
                  else if (specId && tsIdBySpec.get(specId)) url += `?ts=${tsIdBySpec.get(specId)}`;
                }
                links.push({
                  actorApiKey: actorKey,
                  actorName: actorNameByKey.get(actorKey) || actorKey,
                  systemApiKey: sysKey,
                  systemName: sys?.sysName || sysKey,
                  orgName: sys?.orgName || '',
                  url, // may be null if any id couldn't be resolved
                });
              }
              return links;
            }

            // 5) Per-binding execution status. A participant has "executed
            //    their side" when there is at least one ENDED testresults row
            //    for (sut_id, actor_id) within the spec's testcases. The match
            //    is "done" when every participant is done. Result aggregates:
            //    if any session FAILURE → failed, else passed.
            type ParticipantStatus = {
              status: 'not-started' | 'in-progress' | 'done';
              result: 'passed' | 'failed' | null;
              total: number;
              completed: number;
              failed: number;
              lastSessionAt: string | null;
            };
            const participantByKey = new Map<string, ParticipantStatus>(); // key=`${specApiKey}|${actorApiKey}|${systemApiKey}`

            // Collect (specId, sysId, actorId) triples we need to query for.
            const triples: Array<{ specApiKey: string; actorApiKey: string; systemApiKey: string; specId: string; sysId: string; actorId: string }> = [];
            for (const [specApiKey, list] of Object.entries(matches.specs)) {
              const specId = specIdByKey.get(specApiKey);
              if (!specId) continue;
              for (const m of list) {
                for (const [actorKey, sysKey] of Object.entries(m.bindings)) {
                  const sys = sysInfo.get(sysKey);
                  const aId = actorIdByKey.get(actorKey);
                  if (sys && aId) {
                    triples.push({
                      specApiKey, actorApiKey: actorKey, systemApiKey: sysKey,
                      specId, sysId: sys.sysId, actorId: aId,
                    });
                  }
                }
              }
            }

            if (triples.length > 0) {
              // Build OR-list — small N, OK to inline. Numeric ids only, safe.
              const conds = triples
                .map(t => `(specification_id=${t.specId} AND sut_id=${t.sysId} AND actor_id=${t.actorId})`)
                .join(' OR ');
              const r = dbQuery(
                `SELECT specification_id, sut_id, actor_id, ` +
                `COUNT(*) AS total, ` +
                `SUM(CASE WHEN end_time IS NOT NULL THEN 1 ELSE 0 END) AS completed, ` +
                `SUM(CASE WHEN result='FAILURE' THEN 1 ELSE 0 END) AS failed, ` +
                `COALESCE(MAX(end_time), '') AS last_end ` +
                `FROM testresults ` +
                `WHERE ${conds} ` +
                `GROUP BY specification_id, sut_id, actor_id`
              );
              const aggMap = new Map<string, { total: number; completed: number; failed: number; lastEnd: string }>();
              if (r) {
                for (const line of r.split('\n')) {
                  const c = line.split('\t');
                  if (c.length < 7) continue;
                  aggMap.set(`${c[0]}|${c[1]}|${c[2]}`, {
                    total: Number(c[3]) || 0,
                    completed: Number(c[4]) || 0,
                    failed: Number(c[5]) || 0,
                    lastEnd: c[6] || '',
                  });
                }
              }
              for (const t of triples) {
                const agg = aggMap.get(`${t.specId}|${t.sysId}|${t.actorId}`);
                let status: ParticipantStatus;
                if (!agg || agg.total === 0) {
                  status = { status: 'not-started', result: null, total: 0, completed: 0, failed: 0, lastSessionAt: null };
                } else if (agg.completed < agg.total) {
                  status = { status: 'in-progress', result: null, total: agg.total, completed: agg.completed, failed: agg.failed, lastSessionAt: agg.lastEnd || null };
                } else {
                  status = {
                    status: 'done',
                    result: agg.failed > 0 ? 'failed' : 'passed',
                    total: agg.total, completed: agg.completed, failed: agg.failed,
                    lastSessionAt: agg.lastEnd || null,
                  };
                }
                participantByKey.set(`${t.specApiKey}|${t.actorApiKey}|${t.systemApiKey}`, status);
              }
            }

            // Aggregate match-level status from its participants.
            type MatchStatus =
              | { overall: 'not-started' | 'in-progress' | 'partial' | 'done-passed' | 'done-failed'; doneCount: number; total: number; failedCount: number };
            function aggregateMatch(specApiKey: string, m: P2PMatch): MatchStatus {
              const entries = Object.entries(m.bindings);
              const total = entries.length;
              const parts = entries.map(([aKey, sKey]) =>
                participantByKey.get(`${specApiKey}|${aKey}|${sKey}`) ||
                { status: 'not-started' as const, result: null, total: 0, completed: 0, failed: 0, lastSessionAt: null }
              );
              const doneCount = parts.filter(p => p.status === 'done').length;
              const inProg = parts.some(p => p.status === 'in-progress');
              const failedCount = parts.filter(p => p.result === 'failed').length;
              if (doneCount === 0 && !inProg) return { overall: 'not-started', doneCount, total, failedCount };
              if (doneCount === total) {
                return { overall: failedCount > 0 ? 'done-failed' : 'done-passed', doneCount, total, failedCount };
              }
              if (inProg && doneCount === 0) return { overall: 'in-progress', doneCount, total, failedCount };
              return { overall: 'partial', doneCount, total, failedCount };
            }

            const out = Array.from(specMap.values()).map(s => ({
              ...s,
              matches: (matches.specs[s.apiKey] || []).map(m => ({
                ...m,
                links: buildMatchLinks(m, s.apiKey).map(l => ({
                  ...l,
                  participantStatus: participantByKey.get(`${s.apiKey}|${l.actorApiKey}|${l.systemApiKey}`) || null,
                })),
                status: aggregateMatch(s.apiKey, m),
              })),
            }));

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ specs: out }));
            return;
          }

          if (req.method === 'POST' && !tail) {
            const body = JSON.parse(await readBody(req));
            const specKey = body.specApiKey || '';
            const bindings = body.bindings || {};
            const name = (body.name || '').toString().slice(0, 200);
            if (!specKey || !/^[A-Za-z0-9_-]+$/.test(specKey)) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'specApiKey required' }));
              return;
            }
            if (!bindings || typeof bindings !== 'object' || Object.keys(bindings).length === 0) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'bindings required' }));
              return;
            }
            for (const [k, v] of Object.entries(bindings)) {
              if (!/^[A-Za-z0-9_-]+$/.test(k) || typeof v !== 'string' || !/^[A-Za-z0-9_-]+$/.test(v)) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: 'invalid binding key' }));
                return;
              }
            }

            const data = loadMatches();
            const list = data.specs[specKey] || [];
            const id = `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const match: P2PMatch = {
              id,
              name: name || undefined,
              bindings: bindings as Record<string, string>,
              createdAt: new Date().toISOString(),
            };
            list.push(match);
            data.specs[specKey] = list;
            saveMatches(data);

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(match));
            return;
          }

          if (req.method === 'DELETE') {
            // tail = "<specKey>/<matchId>"
            const parts = tail.split('/');
            if (parts.length !== 2 || !parts[0] || !parts[1]) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'expected /api/management/matches/{specKey}/{matchId}' }));
              return;
            }
            const [specKey, matchId] = parts;
            const data = loadMatches();
            const list = data.specs[specKey] || [];
            const before = list.length;
            data.specs[specKey] = list.filter(m => m.id !== matchId);
            if (data.specs[specKey].length === before) {
              res.statusCode = 404;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'not found' }));
              return;
            }
            saveMatches(data);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
            return;
          }

          res.statusCode = 405;
          res.end('');
        } catch (e: any) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: e.message }));
        }
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

      // POST /api/igs/record — persist IG provenance after a client-side deploy.
      // Body shape:
      //   {
      //     key: string,                      // IG package id (top-level map key)
      //     name?: string, version?: string, url?: string,
      //     spec_keys: string[],              // all Specifications touched in this deploy
      //     testPlans?: {                     // per-TestPlan mapping for re-import detection
      //       [stableIdOrId: string]: {
      //         specKey: string, name?: string, lastDeployedAt?: string
      //       }
      //     }
      //   }
      //
      // testPlans entries are keyed by `TestPlan.identifier[system=STABLE_ID_SYSTEM].value`
      // when available (preferred — durable across IG versions), else by `TestPlan.id`
      // (less stable; warn the user when matching against this).
      server.middlewares.use('/api/igs/record', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(''); return; }
        try {
          const body = JSON.parse(await readBody(req));
          if (!body.key || !Array.isArray(body.spec_keys)) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'key and spec_keys required' }));
            return;
          }
          const state = loadState();
          state.imported_igs = state.imported_igs || {};
          const prev = state.imported_igs[body.key] || {};
          const prevSpecKeys: string[] = Array.isArray(prev.spec_keys) ? prev.spec_keys : [];
          const mergedKeys = Array.from(new Set([...prevSpecKeys, ...body.spec_keys]));

          // Shallow-merge testPlans: incoming entries overwrite same-keyed prev entries
          // (the latest deploy wins), older entries are preserved.
          const prevTestPlans = (prev.testPlans && typeof prev.testPlans === 'object') ? prev.testPlans : {};
          const incomingTestPlans = (body.testPlans && typeof body.testPlans === 'object') ? body.testPlans : {};
          const mergedTestPlans = { ...prevTestPlans, ...incomingTestPlans };

          state.imported_igs[body.key] = {
            version: body.version ?? prev.version ?? '',
            url: body.url ?? prev.url ?? '',
            spec_keys: mergedKeys,
            testPlans: mergedTestPlans,
          };
          saveState(state);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, imported_igs: state.imported_igs }));
        } catch (e: any) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: e.message }));
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