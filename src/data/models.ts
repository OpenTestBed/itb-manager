import { DataModel, ExampleScenario } from '../types';

export const dataModels: DataModel[] = [
  {
    id: 'fhir',
    name: 'FHIR R4',
    description: 'Fast Healthcare Interoperability Resources R4',
    baseUrl: 'http://hl7.org/fhir',
    extensions: {
      GF1: {
        id: 'GF1',
        name: 'Resource Validation',
        description: 'Validate FHIR resources against StructureDefinitions',
        stepMappings: {
          'validate against (.*)': 'validate',
          'the resource should be valid': 'validate',
          'validate the (.*) resource': 'validate',
          'the validation should succeed': 'validate',
          'validation should be successful': 'validate',
          'should pass validation': 'validate'
        }
      },
      GF2: {
        id: 'GF2',
        name: 'Resource Creation',
        description: 'Create and submit FHIR resources',
        stepMappings: {
          'the user submits a (.*) resource': 'waitForUpload',
          'submit a (.*) resource': 'waitForUpload',
          'create a (.*) resource': 'waitForUpload',
          'I submit the (.*) resource': 'waitForUpload',
          'upload a (.*) resource': 'waitForUpload'
        }
      },
      GF3: {
        id: 'GF3',
        name: 'Information Display',
        description: 'Display information to users',
        stepMappings: {
          'inform the user (.*)': 'informUser',
          'display message (.*)': 'informUser',
          'show (.*)': 'informUser',
          'notify the user (.*)': 'informUser',
          'tell the user (.*)': 'informUser'
        }
      },
      GF4: {
        id: 'GF4',
        name: 'Response Polling',
        description: 'Poll for responses and status updates',
        stepMappings: {
          'poll for (.*)': 'poll',
          'wait for response': 'poll',
          'check status': 'poll',
          'monitor for (.*)': 'poll'
        }
      },
      GF5: {
        id: 'GF5',
        name: 'Processing Steps',
        description: 'General processing and workflow steps',
        stepMappings: {
          'the resource is processed': 'custom',
          'process the (.*)': 'custom',
          'handle the (.*)': 'custom',
          'execute (.*)': 'custom',
          'perform (.*)': 'custom',
          'the system processes (.*)': 'custom',
          'processing completes': 'custom',
          'the workflow continues': 'custom'
        }
      }
    }
  }
];

/**
 * Example scenario metadata. Actual .feature content lives in
 * public/features/<id>.feature and is loaded at runtime via loadExampleContent().
 */
export interface ExampleMeta {
  id: string;
  name: string;
  description: string;
  dataModel: string;
  featureFile?: string;
}

export const exampleMetas: ExampleMeta[] = [
  // Belgian Vaccination (default)
  { id: 'be-vaccination',         name: 'Belgian Vaccination (BeVaccination)', description: 'Validate BeVaccination Immunization: recorder/performer match and CNK/SNOMED consistency via Vitalink', dataModel: 'fhir' },

  // FHIR
  { id: 'server',                 name: 'Server Allergy Flows',          description: 'FHIR server allergy registration, validation, and rejection flows',  dataModel: 'fhir', featureFile: 'server.feature' },
  { id: 'validate-patient',       name: 'Validate Patient',              description: 'Basic FHIR Patient resource validation',                            dataModel: 'fhir' },
  { id: 'create-observation',     name: 'Create Observation',            description: 'Create and validate FHIR Observation',                               dataModel: 'fhir' },
  { id: 'be-patient',             name: 'Belgian Patient (be-patient)',  description: 'End-to-end: load IG, generate BePatient with SSIN/MRN, validate, matchetype, FHIRPath', dataModel: 'fhir' },
  { id: 'testdata-generation',    name: 'Test Data Generation',          description: 'Generate FHIR test data from a profile with Karate-style data tables', dataModel: 'fhir' },
  { id: 'testdata-bundle',        name: 'Test Data Bundle',              description: 'Generate a Bundle of resources from multiple data rows',              dataModel: 'fhir' },
  { id: 'fhirpath-assertions',    name: 'FHIRPath Assertions',           description: 'Use FHIRPath expressions to assert values, check existence, and count', dataModel: 'fhir' },
  { id: 'matchetype-comparison',  name: 'Matchetype Comparison',         description: 'Compare resources against expected patterns using matchetype with wildcards', dataModel: 'fhir' },
  { id: 'enhanced-validation',    name: 'Enhanced Validation',           description: 'Validate with best-practice options, severity filtering, and issue text checks', dataModel: 'fhir' },
];

/** Fetch the .feature file content for an example */
export async function loadExampleContent(meta: ExampleMeta): Promise<string> {
  const base = import.meta.env.BASE_URL || '/';
  const file = meta.featureFile ?? `${meta.id}.feature`;
  const url = `${base}features/${file}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load feature: ${url} (${res.status})`);
  return res.text();
}

/** Load all examples as ExampleScenario objects (with content) */
export async function loadExampleScenarios(): Promise<ExampleScenario[]> {
  const results = await Promise.allSettled(
    exampleMetas.map(async (meta) => {
      const content = await loadExampleContent(meta);
      return { ...meta, content } as ExampleScenario;
    })
  );
  return results
    .filter((r): r is PromiseFulfilledResult<ExampleScenario> => r.status === 'fulfilled')
    .map(r => r.value);
}

/**
 * @deprecated Use loadExampleScenarios() instead.
 * Kept so existing imports don't break at compile time.
 */
export const exampleScenarios: ExampleScenario[] = [];
