// xmlGenerator.ts
import type { ParsedScenario } from '../types';
import type { IRAction } from './gherkinParser';
import type { ComponentScriptlet } from './languageCatalog';

export interface GeneratedFile {
  filename: string;
  xml: string;
  type: 'testsuite' | 'testcase' | 'scriptlet';
  id: string;
  name: string;
}

export interface XMLOutput {
  testcaseName: string;
  xml: string;               // backwards compat: full combined XML preview
  files: GeneratedFile[];    // individual files for zip download
  scriptletCount?: number;
}

export class XMLGenerator {
  constructor(private parser: any) {}

  /** Collect all scriptlets from enabled components loaded by the parser */
  private getComponentScriptlets(): ComponentScriptlet[] {
    const components = this.parser?.getComponents?.() ?? [];
    const scriptlets: ComponentScriptlet[] = [];
    for (const comp of components) {
      if (comp.enabled && comp.scriptlets) {
        scriptlets.push(...comp.scriptlets);
      }
    }
    return scriptlets;
  }


  generate(parsed: ParsedScenario): XMLOutput {
    const featureTitle = (parsed as any).__featureTitle ?? (parsed.scenario as any).feature ?? 'Feature';
    const featureDescription = (parsed as any).__featureDescription ?? featureTitle;
    const scenarioIRs = (parsed as any).__scenarioIRs as { name: string; ir: IRAction[] }[] | undefined;

    const files: GeneratedFile[] = [];

    // If we have multiple scenarios, generate individual test case files + a test suite
    const scenarios = scenarioIRs && scenarioIRs.length > 0
      ? scenarioIRs
      : [{ name: parsed.scenario.name || 'Test Case', ir: (parsed as any).__ir ?? [] }];

    // Generate individual test case XMLs
    for (const sc of scenarios) {
      const testcaseId = toId(sc.name);
      const actors = collectActors(sc.ir);
      const variables = collectVariables(sc.ir);
      const stepsXml = emitIR(sc.ir);
      const actorsXml = emitActors(actors);
      const variablesXml = emitVariables(variables);
      const testcaseXml = `<?xml version="1.0" encoding="UTF-8"?>
<testcase id="${escapeAttr(testcaseId)}"
          xmlns="http://www.gitb.com/tdl/v1/"
          xmlns:gitb="http://www.gitb.com/core/v1/">
  <metadata>
    <gitb:name>${escapeXml(sc.name)}</gitb:name>
    <gitb:version>1.0</gitb:version>
    <gitb:description>${escapeXml(featureTitle)}</gitb:description>
  </metadata>

  <actors>
${indent(actorsXml, 4)}
  </actors>
${variablesXml ? `\n  <variables>\n${indent(variablesXml, 4)}\n  </variables>\n` : ''}
  <steps stopOnError="true">
${indent(stepsXml || '<!-- no steps generated for this scenario -->', 4)}
  </steps>

  <output>
    <success>
      <default>"Test case completed successfully."</default>
    </success>
    <failure>
      <default>"Test case failed. Check step reports and logs."</default>
    </failure>
  </output>
</testcase>`;

      files.push({
        filename: `${testcaseId}.xml`,
        xml: testcaseXml,
        type: 'testcase',
        id: testcaseId,
        name: sc.name
      });
    }

    // Generate test suite XML
    const suiteId = toId(featureTitle);
    const testcaseRefs = files
      .filter(f => f.type === 'testcase')
      .map(f => `  <testcase id="${escapeAttr(f.id)}"/>`)
      .join('\n');

    // Collect all actors from all scenarios
    const allActors = new Map<string, { name?: string; role?: string; endpoint?: string; canonical?: string }>();
    for (const sc of scenarios) {
      for (const a of collectActors(sc.ir)) {
        if (!allActors.has(a.id)) allActors.set(a.id, { name: a.name, role: a.role, endpoint: a.endpoint, canonical: a.canonical });
      }
    }
    const suiteActorsXml = emitSuiteActors([...allActors.entries()].map(([id, v]) => ({ id, ...v })));

    const testsuiteXml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite id="${escapeAttr(suiteId)}"
           xmlns="http://www.gitb.com/tdl/v1/"
           xmlns:gitb="http://www.gitb.com/core/v1/">
  <metadata>
    <gitb:name>${escapeXml(featureTitle)}</gitb:name>
    <gitb:version>1.0</gitb:version>
    <gitb:description>${escapeXml(featureDescription)}</gitb:description>
  </metadata>

  <actors>
${indent(suiteActorsXml, 4)}
  </actors>

${testcaseRefs}

</testsuite>`;

    files.unshift({
      filename: `${suiteId}.xml`,
      xml: testsuiteXml,
      type: 'testsuite',
      id: suiteId,
      name: featureTitle
    });

    // Generate scriptlet files: use real component scriptlets when available, stubs otherwise
    const scriptletFiles = generateScriptlets(scenarios, this.getComponentScriptlets());
    files.push(...scriptletFiles);

    // Combined preview: test suite + all test cases separated by comments
    const combinedXml = files.map(f =>
      `<!-- ===== ${f.type}: ${f.filename} ===== -->\n${f.xml}`
    ).join('\n\n');

    return {
      testcaseName: featureTitle,
      xml: combinedXml,
      files,
      scriptletCount: scriptletFiles.length,
    };
  }
}


interface DeclaredActor {
  id: string;
  name?: string;
  role?: string;
  endpoint?: string;
  canonical?: string;
}

interface DeclaredVariable {
  name: string;
  varType: string;
  value?: string;
}

function collectVariables(ir: IRAction[]): DeclaredVariable[] {
  const vars: DeclaredVariable[] = [];
  const seen = new Set<string>();

  // 1. Explicitly declared variables
  for (const a of ir) {
    if (a.type === 'declareVariable' && !seen.has(a.name)) {
      seen.add(a.name);
      vars.push({ name: a.name, varType: a.varType, value: a.value });
    }
  }

  // 2. Variables created by <process output="varName"> — ITB requires pre-declaration
  for (const a of ir) {
    if (a.type === 'process' && a.output && !seen.has(a.output)) {
      seen.add(a.output);
      vars.push({ name: a.output, varType: 'string' });
    }
  }

  // 2b. Variables created by <call output="varName"> — scriptlet output
  for (const a of ir) {
    if (a.type === 'call' && a.output && !seen.has(a.output)) {
      seen.add(a.output);
      vars.push({ name: a.output, varType: 'map' });
    }
  }

  // 3. Variables created by <send id="xxx"> or <receive id="xxx">
  for (const a of ir) {
    if ((a.type === 'send' || a.type === 'receive') && a.id && !seen.has(a.id)) {
      seen.add(a.id);
      vars.push({ name: a.id, varType: 'map' });
    }
  }

  // 4a. Variables created by <assign to="varName{prop}"> — base variable is a map
  for (const a of ir) {
    if (a.type === 'assign' && a.to && a.to.includes('{')) {
      const baseName = a.to.split('{')[0];
      if (baseName && !seen.has(baseName)) {
        seen.add(baseName);
        vars.push({ name: baseName, varType: 'map' });
      }
    }
  }

  // 4b. Variables created by <assign to="varName" append="true"> — variable is a list
  for (const a of ir) {
    if (a.type === 'assign' && a.to && !a.to.includes('{') && a.append && !seen.has(a.to)) {
      seen.add(a.to);
      vars.push({ name: a.to, varType: 'list[map]' });
    }
  }

  // 4c. Other top-level assigns — plain string variables
  for (const a of ir) {
    if (a.type === 'assign' && a.to && !a.to.includes('{') && !a.append && !seen.has(a.to)) {
      seen.add(a.to);
      vars.push({ name: a.to, varType: 'string' });
    }
  }

  // 5. Variables created by <interact> requests
  for (const a of ir) {
    if (a.type === 'interact' && a.requests) {
      for (const req of a.requests) {
        // Variable may be "$rawQRData" or "rawQRData" — normalise to bare name
        const varName = req.variable?.replace(/^\$/, '');
        if (varName && !seen.has(varName)) {
          seen.add(varName);
          vars.push({ name: varName, varType: 'string' });
        }
      }
    }
  }

  // 6. Variables *referenced* in step expressions (e.g. $FHIRValidatorBase) that
  // weren't declared anywhere else. ITB requires every $var to be declared in
  // <variables> or implicitly created by a step; otherwise import fails with TDL-040.
  for (const name of collectReferencedVars(ir)) {
    if (!seen.has(name)) {
      seen.add(name);
      vars.push({ name, varType: 'string' });
    }
  }

  return vars;
}

/** TDL builtins / iterator vars that are implicitly available — never declare. */
const RESERVED_VAR_NAMES = new Set([
  'row',         // <foreach> iterator
  'tableRows',   // table rows in <foreach from="$tableRows">
  'docString',   // Gherkin doc-string content
  'iterator',    // some <foreach> variants
]);

/**
 * Walk the IR and collect every $identifier referenced in string-valued fields
 * (inputs, assign values, log values, etc.). Used to synthesize <var> declarations
 * for references that aren't otherwise declared.
 */
function collectReferencedVars(ir: IRAction[]): Set<string> {
  const refs = new Set<string>();

  const scan = (s: string | undefined) => {
    if (!s) return;
    // Match $identifier — but NOT ${...} (freemarker template syntax inside
    // string templates, where ${name} is the freemarker var, not a TDL ref).
    const re = /\$(?!\{)([A-Za-z_]\w*)/g;
    let m;
    while ((m = re.exec(s)) !== null) {
      const name = m[1];
      if (!RESERVED_VAR_NAMES.has(name)) refs.add(name);
    }
  };

  const scanInputs = (inputs?: Record<string, string>) => {
    if (!inputs) return;
    for (const v of Object.values(inputs)) scan(v);
  };

  const walk = (actions: IRAction[]) => {
    for (const a of actions) {
      if (a.type === 'send' || a.type === 'receive' || a.type === 'verify' || a.type === 'process' || a.type === 'call') {
        scanInputs(a.inputs);
      }
      if (a.type === 'assign') {
        scan(a.value);
      }
      if (a.type === 'log') {
        scan(a.value);
      }
      if (a.type === 'listAppend') {
        for (const v of Object.values(a.item)) scan(v);
      }
      if (a.type === 'foreach') {
        scan(a.from);
        if (a.do) walk(a.do);
      }
    }
  };
  walk(ir);

  return refs;
}

function emitVariables(vars: DeclaredVariable[]): string {
  if (vars.length === 0) return '';
  return vars.map(v => {
    if (v.value != null) {
      return `<var name="${escapeAttr(v.name)}" type="${escapeAttr(v.varType)}">\n  <value>${escapeXml(v.value)}</value>\n</var>`;
    }
    return `<var name="${escapeAttr(v.name)}" type="${escapeAttr(v.varType)}"/>`;
  }).join('\n');
}

function collectActors(ir: IRAction[]): DeclaredActor[] {
  const actors: DeclaredActor[] = [];
  const seen = new Set<string>();
  for (const a of ir) {
    if (a.type === 'declareActor' && !seen.has(a.id)) {
      seen.add(a.id);
      actors.push({ id: a.id, name: a.name, role: a.role, endpoint: a.endpoint, canonical: a.canonical });
    }
  }
  // If no actors were declared, use defaults
  if (actors.length === 0) {
    actors.push({ id: 'Client', role: 'SUT' });
    actors.push({ id: 'FHIRServer' });
  }
  return actors;
}

/**
 * Emit actor elements for a test case.
 * In TDL, test case actors are simple references: <actor id="..." role="..."/>
 * The role attribute is only "SUT" or "SIMULATED" (not custom strings).
 */
function emitActors(actors: DeclaredActor[]): string {
  return actors.map(a => {
    // Test case actors are simple references — endpoint config belongs in the test suite
    const roleAttr = a.role === 'SUT' ? ' role="SUT"' : '';
    return `<gitb:actor id="${escapeAttr(a.id)}"${roleAttr}/>`;
  }).join('\n');
}

/**
 * Emit actor elements for a test suite.
 */
function emitSuiteActors(actors: DeclaredActor[]): string {
  return actors.map(a => {
    const name = a.name || a.id;
    const desc = a.endpoint
      ? `Endpoint: ${a.endpoint}${a.canonical ? ' | Definition: ' + a.canonical : ''}`
      : (a.canonical ? `Definition: ${a.canonical}` : '');
    return `<gitb:actor id="${escapeAttr(a.id)}">\n  <gitb:name>${escapeXml(name)}</gitb:name>${desc ? `\n  <gitb:desc>${escapeXml(desc)}</gitb:desc>` : ''}\n</gitb:actor>`;
  }).join('\n');
}

function emitIR(ir: IRAction[]): string {
  // Find the SUT actor to use as default 'from' on send steps
  const sutDecl = ir.find(a => a.type === 'declareActor' && a.role === 'SUT') as { type: 'declareActor'; id: string } | undefined;
  const sutActor = sutDecl?.id || 'Client';

  const out: string[] = [];
  for (const a of ir) {
    if (a.type === 'declareActor') {
      // Actor declarations are handled separately in <actors> section
      continue;
    } else if (a.type === 'send') {
      const idAttr = a.id ? ` id="${escapeAttr(a.id)}"` : '';
      const descAttr = a.desc ? ` desc="${escapeAttr(a.desc)}"` : '';
      const from = a.from || sutActor;
      const fromAttr = ` from="${escapeAttr(from)}"`;
      const toAttr = a.to ? ` to="${escapeAttr(a.to)}"` : '';
      out.push(`<send${idAttr}${descAttr} handler="${escapeAttr(a.handler)}"${fromAttr}${toAttr}>`);
      out.push(...emitInputs(a.inputs));
      out.push(`</send>`);
    } else if (a.type === 'log') {
      out.push(`<log>${escapeXml(a.value)}</log>`);
    } else if (a.type === 'call') {
      out.push(`<call path="${escapeAttr(a.path)}"${a.output ? ` output="${escapeAttr(a.output)}"` : ''}>`);
      if (a.from) out.push(`  <input name="from">${escapeXml(a.from)}</input>`);
      if (a.to) out.push(`  <input name="to">${escapeXml(a.to)}</input>`);
      out.push(...emitInputs(a.inputs));
      out.push(`</call>`);
    } else if (a.type === 'verify') {
      out.push(`<verify handler="${escapeAttr(a.handler)}"${a.desc ? ` desc="${escapeAttr(a.desc)}"` : ''}>`);
      out.push(...emitInputs(a.inputs));
      out.push(`</verify>`);
    } else if (a.type === 'process') {
      out.push(
        `<process handler="${escapeAttr(a.handler)}" operation="${escapeAttr(a.operation)}"${a.output ? ` output="${escapeAttr(a.output)}"` : ''}${a.hidden ? ` hidden="true"` : ''}>`
      );
      if (a.from) out.push(`  <input name="from">${escapeXml(a.from)}</input>`);
      if (a.to) out.push(`  <input name="to">${escapeXml(a.to)}</input>`);
      out.push(...emitInputs(a.inputs));
      out.push(`</process>`);
    } else if (a.type === 'assign') {
      // Skip empty-list initializations — TDL creates lists implicitly on first append
      if (a.value === '[]' || a.value === '') continue;
      const appendAttr = a.append ? ' append="true"' : '';
      out.push(`<assign to="${escapeAttr(a.to)}"${appendAttr}>${escapeXml(a.value)}</assign>`);
    } else if (a.type === 'listAppend') {
      // TDL assign values are expressions — use single-quoted string to avoid quote conflicts
      const jsonStr = JSON.stringify(a.item).replace(/'/g, "\\'");
      out.push(
        `<assign to="${escapeAttr(a.list)}" append="true">'${escapeXml(jsonStr)}'</assign>`
      );
    } else if (a.type === 'declareVariable') {
      // Variable declarations are handled in <variables> section, not in <steps>
      continue;
    } else if (a.type === 'interact') {
      const idAttr = a.id ? ` id="${escapeAttr(a.id)}"` : '';
      const descAttr = a.desc ? ` desc="${escapeAttr(a.desc)}"` : '';
      const titleAttr = a.inputTitle ? ` inputTitle="${escapeAttr(a.inputTitle)}"` : '';
      out.push(`<interact${idAttr}${descAttr}${titleAttr}>`);
      for (const req of a.requests) {
        const nameAttr = req.name ? ` name="${escapeAttr(req.name)}"` : '';
        const typeAttr = req.inputType ? ` inputType="${escapeAttr(req.inputType)}"` : '';
        const reqAttr = req.required != null ? ` required="${req.required}"` : '';
        out.push(`  <request desc="${escapeAttr(req.desc)}"${nameAttr}${typeAttr}${reqAttr}>${escapeXml(req.variable)}</request>`);
      }
      out.push(`</interact>`);
    } else if (a.type === 'receive') {
      const idAttr = a.id ? ` id="${escapeAttr(a.id)}"` : '';
      const descAttr = a.desc ? ` desc="${escapeAttr(a.desc)}"` : '';
      const fromAttr = a.from ? ` from="${escapeAttr(a.from)}"` : '';
      const toAttr = a.to ? ` to="${escapeAttr(a.to)}"` : '';
      out.push(`<receive${idAttr}${descAttr} handler="${escapeAttr(a.handler)}"${fromAttr}${toAttr}>`);
      out.push(...emitInputs(a.inputs));
      out.push(`</receive>`);
    }
  }
  return out.join('\n');
}

function emitInputs(inputs?: Record<string, string>): string[] {
  if (!inputs) return [];
  return Object.entries(inputs).map(
    ([k, v]) => `  <input name="${escapeAttr(k)}">${escapeXml(quoteIfLiteral(v))}</input>`
  );
}

/**
 * Wrap a value in double quotes if it looks like a plain-text literal
 * rather than a TDL expression or variable reference.
 * Values starting with $ or " are already expressions/quoted.
 * Pure identifiers (letters, digits, underscores) and numbers are kept bare.
 *
 * Special handling for strings containing embedded double quotes (e.g. JSON):
 * - No $var refs → wrap in single quotes: '{"key":"value"}'
 * - With $var refs → build concat(): concat('{"key":"', $var, '"}')
 */
function quoteIfLiteral(v: string): string {
  if (!v) return v;
  // Already quoted or an expression/variable reference
  if (v.startsWith('"') || v.startsWith("'") || v.startsWith('$')) return v;
  // Function call expression (concat, contains, etc.) — don't quote
  if (/^[a-zA-Z_]\w*\s*\(/.test(v)) return v;
  // Pure number
  if (/^[0-9]+(\.[0-9]+)?$/.test(v)) return v;
  // Pure identifier (actor name, variable name, etc.)
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)) return v;
  // Boolean-like
  if (v === 'true' || v === 'false') return v;

  // If the string contains embedded double quotes (JSON bodies, etc.)
  // we can't wrap in double quotes — use single quotes or concat()
  if (v.includes('"')) {
    const hasVarRefs = /\$[a-zA-Z_]\w*(?:\{[^}]*\})*/.test(v);
    if (!hasVarRefs) {
      // Pure literal with double quotes — single-quote wrap
      // Escape any embedded single quotes to avoid breaking the TDL expression
      const escaped = v.replace(/'/g, "\\'");
      return `'${escaped}'`;
    }
    // Has $variable references — build concat() so TDL resolves them
    return buildConcatExpression(v);
  }

  // Otherwise it's a literal that needs quoting
  return `"${v}"`;
}

/**
 * Build a TDL concat() expression from a string containing $variable references.
 * e.g. {"qr_data":"$rawQRData","include_raw":true}
 *   → concat('{"qr_data":"', $rawQRData, '","include_raw":true}')
 */
function buildConcatExpression(v: string): string {
  const parts: string[] = [];
  // Match $varName or $varName{prop} or $varName{prop}{nested}
  const regex = /(\$[a-zA-Z_]\w*(?:\{[^}]*\})*)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(v)) !== null) {
    if (match.index > lastIndex) {
      const lit = v.substring(lastIndex, match.index).replace(/'/g, "\\'");
      parts.push(`'${lit}'`);
    }
    parts.push(match[1]); // variable reference bare
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < v.length) {
    const lit = v.substring(lastIndex).replace(/'/g, "\\'");
    parts.push(`'${lit}'`);
  }

  if (parts.length === 1) return parts[0];
  return `concat(${parts.join(', ')})`;
}

/**
 * Collect all unique scriptlet call paths and their input names from IR actions.
 */
function collectScriptletCalls(ir: IRAction[]): Map<string, Set<string>> {
  const calls = new Map<string, Set<string>>();
  for (const a of ir) {
    if (a.type === 'call' && a.path.startsWith('scriptlets/')) {
      const existing = calls.get(a.path) || new Set<string>();
      if (a.from) existing.add('from');
      if (a.to) existing.add('to');
      if (a.inputs) {
        for (const k of Object.keys(a.inputs)) existing.add(k);
      }
      calls.set(a.path, existing);
    }
    if (a.type === 'foreach' && a.do) {
      for (const [path, inputs] of collectScriptletCalls(a.do)) {
        const existing = calls.get(path) || new Set<string>();
        for (const k of inputs) existing.add(k);
        calls.set(path, existing);
      }
    }
  }
  return calls;
}

/**
 * Generate stub scriptlet XML files for all referenced scriptlet paths.
 * Each scriptlet is a minimal valid TDL scriptlet that declares its inputs.
 */
function generateScriptlets(
  scenarios: { name: string; ir: IRAction[] }[],
  componentScriptlets: ComponentScriptlet[] = [],
): GeneratedFile[] {
  // Merge scriptlet calls across all scenarios
  const allCalls = new Map<string, Set<string>>();
  for (const sc of scenarios) {
    for (const [path, inputs] of collectScriptletCalls(sc.ir)) {
      const existing = allCalls.get(path) || new Set<string>();
      for (const k of inputs) existing.add(k);
      allCalls.set(path, existing);
    }
  }

  // Index real component scriptlets by path
  const realScriptlets = new Map<string, ComponentScriptlet>();
  for (const s of componentScriptlets) {
    realScriptlets.set(s.path, s);
  }

  const files: GeneratedFile[] = [];

  // For each referenced scriptlet path, use real XML if available, otherwise generate a stub
  for (const [path, inputNames] of allCalls) {
    const scriptletId = path.replace(/^scriptlets\//, '').replace(/\.xml$/, '');
    const real = realScriptlets.get(path);

    if (real) {
      // Use the real scriptlet XML from the component
      files.push({
        filename: path,
        xml: real.xml,
        type: 'scriptlet',
        id: scriptletId,
        name: scriptletId,
      });
    } else {
      // Generate a stub scriptlet
      const inputsXml = [...inputNames]
        .map(name => `    <var name="${escapeAttr(name)}" type="string"/>`)
        .join('\n');

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<scriptlet id="${escapeAttr(scriptletId)}"
            xmlns="http://www.gitb.com/tdl/v1/"
            xmlns:gitb="http://www.gitb.com/core/v1/">
  <params>
${inputsXml}
  </params>
  <steps>
    <log>"Scriptlet ${escapeXml(scriptletId)} executed (stub)."</log>
  </steps>
</scriptlet>`;

      files.push({
        filename: path,
        xml,
        type: 'scriptlet',
        id: scriptletId,
        name: scriptletId,
      });
    }
  }

  // Also include any component scriptlets that weren't directly referenced
  // (they may be called by other scriptlets or useful for future steps)
  for (const s of componentScriptlets) {
    if (!allCalls.has(s.path)) {
      const scriptletId = s.path.replace(/^scriptlets\//, '').replace(/\.xml$/, '');
      files.push({
        filename: s.path,
        xml: s.xml,
        type: 'scriptlet',
        id: scriptletId,
        name: scriptletId,
      });
    }
  }

  return files;
}

function toId(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return base.length ? base : 'tc-1';
}

function escapeXml(s: string) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s: string) {
  return escapeXml(s);
}

function indent(s: string, spaces = 2): string {
  const pad = ' '.repeat(spaces);
  return s
    .split('\n')
    .map((line) => (line.length ? pad + line : line))
    .join('\n');
}
