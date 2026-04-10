/**
 * Server-side Gherkin-to-TDL compilation.
 * Used by the /api/compile Vite middleware via SSR module loading.
 *
 * Unlike the browser, this loads YAML catalogs from the filesystem
 * instead of fetching them via HTTP.
 */
import yaml from 'js-yaml';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { GherkinParser } from '../parser/gherkinParser';
import { XMLGenerator } from '../parser/xmlGenerator';
import { mergeCatalog, type Catalog, type ComponentInfo, type ExtensionCatalog, type ComponentManifest } from '../parser/languageCatalog';
import { dataModels } from '../data/models';

const publicDir = join(process.cwd(), 'public');

/** Load catalog and components from filesystem (server-side) */
function loadCatalogFromDisk(): { catalog: Catalog; components: ComponentInfo[] } {
  // Load core catalog
  const coreYml = readFileSync(join(publicDir, 'lang', 'en.yml'), 'utf-8');
  const core = yaml.load(coreYml) as Catalog;

  // Load components
  const components: ComponentInfo[] = [];
  const indexPath = join(publicDir, 'components', 'index.json');
  if (existsSync(indexPath)) {
    const index = JSON.parse(readFileSync(indexPath, 'utf-8'));
    for (const id of index.components || []) {
      const manifestPath = join(publicDir, 'components', id, 'component.yml');
      if (!existsSync(manifestPath)) continue;
      const manifest = yaml.load(readFileSync(manifestPath, 'utf-8')) as ComponentManifest;

      let extension: ExtensionCatalog | undefined;
      if (manifest.language) {
        const extPath = join(publicDir, 'components', id, manifest.language);
        if (existsSync(extPath)) {
          extension = yaml.load(readFileSync(extPath, 'utf-8')) as ExtensionCatalog;
        }
      }
      components.push({ manifest, extension, enabled: true, status: 'unknown' });
    }
  }

  return { catalog: mergeCatalog(core, components), components };
}

export async function compileGherkin(gherkinContent: string): Promise<{
  files: { filename: string; xml: string; type: string }[];
  testcaseName: string;
  error?: string;
  issues?: any[];
}> {
  try {
    // Pre-load catalog from filesystem
    const { catalog, components } = loadCatalogFromDisk();

    const parser = new GherkinParser(dataModels[0], {
      services: { 'FHIR-validator': '1.2.0' },
      strictRequirements: false,
    });

    // Inject the pre-loaded catalog so the parser doesn't try to fetch()
    (parser as any).catalog = catalog;
    (parser as any).components = components;

    const parsed = parser.parse(gherkinContent);
    await parser.expandScenarioToIR(parsed);

    const errors = (parsed.errors ?? []).filter((e: any) => e.severity === 'error');
    if (errors.length > 0) {
      return {
        files: [],
        testcaseName: '',
        error: `${errors.length} error(s) in Gherkin`,
        issues: parsed.errors,
      };
    }

    const generator = new XMLGenerator(parser);
    const output = generator.generate(parsed);

    return {
      files: output.files,
      testcaseName: output.testcaseName,
    };
  } catch (e: any) {
    return {
      files: [],
      testcaseName: '',
      error: e.message || String(e),
    };
  }
}
