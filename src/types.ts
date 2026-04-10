/** Shared type definitions for the Gherkin FHIR Compiler */

export interface DataModel {
  id: string;
  name: string;
  description: string;
  baseUrl: string;
  extensions: Record<string, {
    id: string;
    name: string;
    description: string;
    stepMappings: Record<string, string>;
  }>;
}

export interface ExampleScenario {
  id: string;
  title: string;
  description?: string;
  dataModel: string;
  content: string;
  featureFile?: string;
  tags?: string[];
}

export interface GherkinStep {
  type: 'Given' | 'When' | 'Then' | 'And' | 'But';
  text: string;
  table?: Record<string, string>[];
  docString?: string;
  line?: number;
}

export type Step = GherkinStep;

export interface GherkinScenario {
  feature: string;
  name: string;
  steps: Step[];
}

export interface ParseIssue {
  severity: 'error' | 'warning' | 'info';
  message: string;
  line?: number;
}

export type ParseError = ParseIssue;

export interface ParsedScenario {
  scenario: GherkinScenario;
  errors?: ParseIssue[];
  /** Populated by expandScenarioToIR */
  __scenarioIRs?: { name: string; ir: any[] }[];
  __ir?: any[];
  __scenarios?: { name: string; steps: Step[] }[];
  __featureTitle?: string;
  __featureDescription?: string;
}
