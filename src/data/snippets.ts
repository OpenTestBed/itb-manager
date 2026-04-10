// Categorized step templates for the snippet palette.
// Each snippet maps 1:1 to a step definition in en.yml.
// {{placeholders}} indicate values the user needs to fill in.

export interface Snippet {
  id: string;
  label: string;
  description: string;
  template: string;
  keyword: 'Given' | 'When' | 'Then' | 'And';
}

export interface SnippetCategory {
  id: string;
  label: string;
  icon: string;
  snippets: Snippet[];
}

export const snippetCategories: SnippetCategory[] = [
  // ── Structure ──────────────────────────────────────────────────────
  {
    id: 'structure',
    label: 'Structure',
    icon: 'S',
    snippets: [
      {
        id: 'feature',
        label: 'Feature block',
        description: 'Feature header with description',
        template: 'Feature: {{Feature name}}\n  {{Description of the feature}}\n',
        keyword: 'Given',
      },
      {
        id: 'background',
        label: 'Background',
        description: 'Shared setup for all scenarios',
        template: '  Background:\n    Given {{Client}} is the system under test\n    And {{FHIRServer}} is available\n    And {{FHIRServer}} is configured\n',
        keyword: 'Given',
      },
      {
        id: 'background-pool',
        label: 'Background (data pool)',
        description: 'Shared setup with a named sample data pool',
        template: '  Background:\n    Given {{Client}} is the system under test\n    And {{FHIRServer}} is available\n    And {{FHIRServer}} is configured with data pool "{{pool-name}}"\n',
        keyword: 'Given',
      },
      {
        id: 'scenario',
        label: 'Scenario',
        description: 'New test case scenario',
        template: '  Scenario: {{Scenario name}}\n',
        keyword: 'Given',
      },
      {
        id: 'actor-sut',
        label: 'Declare system under test',
        description: 'Declare the client/SUT actor',
        template: '    Given {{Client}} is the system under test',
        keyword: 'Given',
      },
      {
        id: 'actor-available',
        label: 'Declare available actor',
        description: 'Declare a service or actor that is available',
        template: '    And {{FHIRServer}} is available',
        keyword: 'And',
      },
      {
        id: 'actor-named',
        label: 'Declare actor (with name)',
        description: 'Declare an actor with a descriptive display name',
        template: '    And {{FHIRValidator}} is available as "{{FHIR Validation Service}}"',
        keyword: 'And',
      },
    ],
  },

  // ── Implementation Guide ───────────────────────────────────────────
  {
    id: 'ig',
    label: 'Load IG',
    icon: 'IG',
    snippets: [
      {
        id: 'load-ig',
        label: 'Load IG',
        description: 'Load an implementation guide into the validator',
        template: '    Given load implementation guide "{{package#version}}"',
        keyword: 'Given',
      },
      {
        id: 'load-ig-verify',
        label: 'Load IG and verify',
        description: 'Load IG and assert it loaded successfully',
        template: '    And load implementation guide "{{package#version}}" and verify',
        keyword: 'And',
      },
      {
        id: 'preload-package',
        label: 'Preload package',
        description: 'Preload an IG package into a named actor (package id or URL)',
        template: '    And {{Actor}} is preloaded with package {{package#version}}',
        keyword: 'And',
      },
    ],
  },

  // ── Resources & Variables ──────────────────────────────────────────
  {
    id: 'resources',
    label: 'Resources & Variables',
    icon: 'R',
    snippets: [
      {
        id: 'define-resource',
        label: 'Define inline resource',
        description: 'Define a resource from an inline JSON doc string',
        template: '    Given define resource "{{variableName}}" as:\n      """\n      {"resourceType":"{{Patient}}","name":[{"family":"{{Smith}}"}]}\n      """',
        keyword: 'Given',
      },
      {
        id: 'set-variable',
        label: 'Set variable',
        description: 'Assign a string value to a variable',
        template: '    Given set "{{variableName}}" to "{{value}}"',
        keyword: 'Given',
      },
      {
        id: 'save-identifier',
        label: 'Save returned identifier',
        description: 'Save the last returned identifier to a variable',
        template: '    And save the returned identifier as "{{variableName}}"',
        keyword: 'And',
      },
      {
        id: 'extract-jsonpointer',
        label: 'Extract value (JSON Pointer)',
        description: 'Extract a value from a resource using a JSON Pointer path',
        template: '    And extract "{{/resourceType}}" from "{{variableName}}" as "{{savedName}}"',
        keyword: 'And',
      },
      {
        id: 'assert-value-equals',
        label: 'Assert variable equals',
        description: 'Assert that a variable equals an expected value',
        template: '    Then the value of "{{variableName}}" is "{{expectedValue}}"',
        keyword: 'Then',
      },
      {
        id: 'assert-value-contains',
        label: 'Assert variable contains',
        description: 'Assert that a variable contains a substring',
        template: '    Then the value of "{{variableName}}" contains "{{substring}}"',
        keyword: 'Then',
      },
      {
        id: 'assert-value-not-empty',
        label: 'Assert variable not empty',
        description: 'Assert that a variable is not empty',
        template: '    Then the value of "{{variableName}}" is not empty',
        keyword: 'Then',
      },
    ],
  },

  // ── Allergy (create, submit, register) ─────────────────────────────
  {
    id: 'allergy',
    label: 'Allergy Workflow',
    icon: 'A',
    snippets: [
      {
        id: 'create-allergy',
        label: 'Create allergy resource',
        description: 'Create an allergy resource from a data table',
        template: '    Given {{Client}} creates an allergy resource with:\n      | resourceType       | code.coding.code | code.coding.display | code.text     | reaction.code | reaction.display |\n      | AllergyIntolerance | {{code}}         | {{display}}         | {{text}}      | {{rxCode}}    | {{rxDisplay}}    |',
        keyword: 'Given',
      },
      {
        id: 'submit-allergy',
        label: 'Submit allergy',
        description: 'Submit the created allergy',
        template: '    When {{Client}} submits the created allergy',
        keyword: 'When',
      },
      {
        id: 'submit-allergy-to',
        label: 'Submit allergy (to actor)',
        description: 'Submit the created allergy to a named actor',
        template: '    When {{Client}} submits the created allergy to {{FHIRServer}}',
        keyword: 'When',
      },
      {
        id: 'register-allergy',
        label: 'Register allergy',
        description: 'Register an allergy with the server',
        template: '    Given {{Client}} registers an allergy with:\n      | code.coding.code | code.coding.display | code.text     | reaction.code | reaction.display |\n      | {{code}}         | {{display}}         | {{text}}      | {{rxCode}}    | {{rxDisplay}}    |',
        keyword: 'Given',
      },
      {
        id: 'register-allergy-on',
        label: 'Register allergy (on actor)',
        description: 'Register an allergy on a named actor',
        template: '    Given {{Client}} registers an allergy on {{FHIRServer}} with:\n      | code.coding.code | code.coding.display | code.text     | reaction.code | reaction.display |\n      | {{code}}         | {{display}}         | {{text}}      | {{rxCode}}    | {{rxDisplay}}    |',
        keyword: 'Given',
      },
      {
        id: 'check-allergies',
        label: 'Check registered allergies',
        description: 'Assert the patient\'s registered allergies include expected entries',
        template: '    Then the patient\'s registered allergies should include:\n      | code       | identifier      |\n      | {{code}}   | {{identifier}}  |',
        keyword: 'Then',
      },
    ],
  },

  // ── Response & Status Checks ───────────────────────────────────────
  {
    id: 'response',
    label: 'Response Checks',
    icon: 'RC',
    snippets: [
      {
        id: 'resource-uploaded',
        label: 'Assert resource uploaded (201)',
        description: 'Assert the resource was correctly uploaded to the server',
        template: '    Then the resource is correctly uploaded to the server',
        keyword: 'Then',
      },
      {
        id: 'response-status',
        label: 'Assert response status',
        description: 'Assert the HTTP response status code',
        template: '    Then the response status should be "{{200}}"',
        keyword: 'Then',
      },
      {
        id: 'oo-check',
        label: 'Check OperationOutcome value',
        description: 'Assert a value in the OperationOutcome at a JSON pointer path',
        template: '    And the OperationOutcome at "{{/issue/0/severity}}" should be "{{error}}"',
        keyword: 'And',
      },
    ],
  },

  // ── Validation ─────────────────────────────────────────────────────
  {
    id: 'validation',
    label: 'Validation',
    icon: 'V',
    snippets: [
      {
        id: 'validate-url',
        label: 'Validate against URL',
        description: 'Validate the last submission against a profile URL',
        template: '    And validate against {{http://hl7.org/fhir/StructureDefinition/Patient}}',
        keyword: 'And',
      },
      {
        id: 'validate-profile',
        label: 'Validate against profile (quoted)',
        description: 'Validate the last submission against a quoted profile',
        template: '    And validate against "{{http://hl7.org/fhir/StructureDefinition/Patient}}"',
        keyword: 'And',
      },
      {
        id: 'validate-named',
        label: 'Validate named variable',
        description: 'Validate a named resource variable against a profile',
        template: '    And validate "{{variableName}}" against "{{profileUrl}}"',
        keyword: 'And',
      },
      {
        id: 'validate-bp',
        label: 'Validate with best practice',
        description: 'Validate with best practice warning level',
        template: '    And validate against "{{profileUrl}}" with best practice "{{Warning}}"',
        keyword: 'And',
      },
      {
        id: 'validate-resid',
        label: 'Validate with resource id',
        description: 'Validate requiring a specific resource id rule',
        template: '    And validate against "{{profileUrl}}" with resource id "{{required}}"',
        keyword: 'And',
      },
      {
        id: 'validate-summary',
        label: 'Validation summary',
        description: 'Assert error and warning counts from validation',
        template: '    Then the validation summary should show {{0}} errors and {{0}} warnings',
        keyword: 'Then',
      },
      {
        id: 'validate-pass',
        label: 'Assert validation passes',
        description: 'Assert that validation produced no errors',
        template: '    Then the validation should pass',
        keyword: 'Then',
      },
      {
        id: 'validate-fail',
        label: 'Assert validation fails',
        description: 'Assert that validation produced at least one error',
        template: '    Then the validation should fail',
        keyword: 'Then',
      },
      {
        id: 'validate-issues-contain',
        label: 'Check issue text',
        description: 'Assert validation issues contain a specific message',
        template: '    And the validation issues should contain "{{expected text}}"',
        keyword: 'And',
      },
      {
        id: 'validate-no-severity',
        label: 'No issues of severity',
        description: 'Assert no validation issues of a given severity',
        template: '    And the validation should have no "{{fatal}}" issues',
        keyword: 'And',
      },
    ],
  },

  // ── FHIRPath ───────────────────────────────────────────────────────
  {
    id: 'fhirpath',
    label: 'FHIRPath',
    icon: 'FP',
    snippets: [
      {
        id: 'fp-as',
        label: 'Evaluate and save',
        description: 'Evaluate FHIRPath on last submission and save to variable',
        template: '    And evaluate FHIRPath "{{expression}}" as "{{variableName}}"',
        keyword: 'And',
      },
      {
        id: 'fp-expect',
        label: 'Assert FHIRPath value',
        description: 'Evaluate FHIRPath and expect a specific value',
        template: '    And evaluate FHIRPath "{{expression}}" and expect "{{expectedValue}}"',
        keyword: 'And',
      },
      {
        id: 'fp-on-expect',
        label: 'Assert value on variable',
        description: 'Evaluate FHIRPath on a named variable and assert value',
        template: '    And evaluate FHIRPath "{{expression}}" on "{{variableName}}" and expect "{{expectedValue}}"',
        keyword: 'And',
      },
      {
        id: 'fp-exists',
        label: 'Assert element exists',
        description: 'Check that a FHIRPath expression returns results',
        template: '    Then evaluate FHIRPath "{{Patient.name}}" exists',
        keyword: 'Then',
      },
      {
        id: 'fp-count',
        label: 'Assert element count',
        description: 'Check the count of a FHIRPath expression',
        template: '    And evaluate FHIRPath "{{Patient.name}}" count is {{1}}',
        keyword: 'And',
      },
      {
        id: 'fp-on-as',
        label: 'Evaluate on variable and save',
        description: 'Evaluate FHIRPath on a variable and save the result',
        template: '    And evaluate FHIRPath "{{expression}}" on "{{variableName}}" as "{{savedName}}"',
        keyword: 'And',
      },
    ],
  },

  // ── Match ──────────────────────────────────────────────────────────
  {
    id: 'match',
    label: 'Match',
    icon: 'M',
    snippets: [
      {
        id: 'match-complete-table',
        label: 'Complete match (table)',
        description: 'Exactly match a variable against expected values in a table',
        template: '    Then match "{{variableName}}" against expected:\n      | resourceType | {{field}} |\n      | {{Patient}}  | {{value}} |',
        keyword: 'Then',
      },
      {
        id: 'match-partial-table',
        label: 'Partial match (table)',
        description: 'Partially match a variable against expected values in a table',
        template: '    Then partially match "{{variableName}}" against expected:\n      | resourceType | {{field}} |\n      | {{Patient}}  | {{value}} |',
        keyword: 'Then',
      },
      {
        id: 'match-partial-json',
        label: 'Partial match (JSON)',
        description: 'Partially match using inline JSON with wildcards',
        template: '    And partially match "{{variableName}}" against:\n      """\n      {"resourceType":"{{Patient}}","name":[{"family":"$string$"}]}\n      """',
        keyword: 'And',
      },
      {
        id: 'match-exact-json',
        label: 'Exact match (JSON)',
        description: 'Exactly match a resource against inline JSON',
        template: '    And exactly match "{{variableName}}" against:\n      """\n      {"resourceType":"{{Patient}}","name":[{"family":"{{Smith}}"}]}\n      """',
        keyword: 'And',
      },
      {
        id: 'match-pattern',
        label: 'Match against pattern string',
        description: 'Match a variable against an inline JSON pattern string',
        template: '    And match "{{variableName}}" against pattern "{{jsonPattern}}"',
        keyword: 'And',
      },
      {
        id: 'match-submission',
        label: 'Match submission',
        description: 'Match the last submission against expected values',
        template: '    Then the submission should match:\n      | resourceType |\n      | {{Patient}}  |',
        keyword: 'Then',
      },
      {
        id: 'match-mismatch',
        label: 'Assert mismatch (JSON)',
        description: 'Assert that a resource does NOT match a pattern',
        template: '    And "{{variableName}}" should NOT match:\n      """\n      {"resourceType":"{{Patient}}","name":[{"family":"{{WrongName}}"}]}\n      """',
        keyword: 'And',
      },
      {
        id: 'match-mismatch-inline',
        label: 'Assert mismatch (inline)',
        description: 'Assert mismatch using inline pattern string',
        template: '    And "{{variableName}}" should not match pattern "{{jsonPattern}}"',
        keyword: 'And',
      },
      {
        id: 'match-compare-as',
        label: 'Compare and save result',
        description: 'Match and capture the comparison result for inspection',
        template: '    And compare "{{variableName}}" against expected as "{{resultName}}"',
        keyword: 'And',
      },
    ],
  },

  // ── Test Data Generation ───────────────────────────────────────────
  {
    id: 'testdata',
    label: 'Test Data',
    icon: 'TD',
    snippets: [
      {
        id: 'gen-simple',
        label: 'Generate from profile',
        description: 'Generate a test resource from a StructureDefinition',
        template: '    Given generate test data from profile "{{profileUrl}}"',
        keyword: 'Given',
      },
      {
        id: 'gen-named',
        label: 'Generate and save',
        description: 'Generate test data and save to a named variable',
        template: '    Given generate test data from profile "{{profileUrl}}" as "{{variableName}}"',
        keyword: 'Given',
      },
      {
        id: 'gen-validate',
        label: 'Generate and validate',
        description: 'Generate test data and immediately validate',
        template: '    Given generate and validate test data from profile "{{profileUrl}}"',
        keyword: 'Given',
      },
      {
        id: 'define-mappings',
        label: 'Define mappings',
        description: 'Define named column-to-path mappings for reuse',
        template: '    Given define mappings "{{mappingsName}}":\n      | path                    | expression             |\n      | {{Patient.name.family}} | {{column(\'family\')}} |',
        keyword: 'Given',
      },
      {
        id: 'define-mappings-parts',
        label: 'Define mappings (with parts)',
        description: 'Define named mappings with parts for complex types',
        template: '    Given define mappings "{{mappingsName}}" with parts:\n      | path                   | part   | expression             |\n      | {{Patient.identifier}} | system | {{\'https://...\'}}      |\n      | {{Patient.identifier}} | value  | {{column(\'id\')}}       |\n      | {{Patient.name}}       | family | {{column(\'family\')}}   |',
        keyword: 'Given',
      },
      {
        id: 'define-data',
        label: 'Define data',
        description: 'Define a named data table for reuse',
        template: '    Given define data "{{dataName}}":\n      | family   | given  | birthDate    |\n      | {{Smith}} | {{John}} | {{1990-01-15}} |',
        keyword: 'Given',
      },
      {
        id: 'gen-with-mappings-data',
        label: 'Generate with mappings and data',
        description: 'Generate from profile using named mappings and named data',
        template: '    And generate test data from profile "{{profileUrl}}" with mappings "{{mappingsName}}" and data "{{dataName}}"',
        keyword: 'And',
      },
      {
        id: 'gen-inline-table',
        label: 'Generate with inline table',
        description: 'Generate using FHIR paths as column headers (mapping + data in one table)',
        template: '    And generate test data from profile "{{profileUrl}}" with:\n      | Patient.name.family | Patient.name.given | Patient.birthDate |\n      | {{Smith}}           | {{John}}           | {{1990-01-15}}    |',
        keyword: 'And',
      },
      {
        id: 'gen-bundle',
        label: 'Generate Bundle',
        description: 'Generate a Bundle of resources using named data',
        template: '    And generate test bundle from profile "{{profileUrl}}" with data "{{dataName}}"',
        keyword: 'And',
      },
      {
        id: 'gen-bundle-mappings',
        label: 'Generate Bundle (with mappings)',
        description: 'Generate a Bundle using named mappings and named data',
        template: '    And generate test bundle from profile "{{profileUrl}}" with mappings "{{mappingsName}}" and data "{{dataName}}"',
        keyword: 'And',
      },
      {
        id: 'gen-assert-type',
        label: 'Assert resource type',
        description: 'Assert the type of the generated resource',
        template: '    Then the generated resource type should be "{{Patient}}"',
        keyword: 'Then',
      },
      {
        id: 'gen-assert-type-named',
        label: 'Assert resource type (named)',
        description: 'Assert the resource type of a named variable',
        template: '    Then the "{{variableName}}" resource type should be "{{Patient}}"',
        keyword: 'Then',
      },
    ],
  },

  // ── Monitor & Manual Flows ─────────────────────────────────────────
  {
    id: 'monitor',
    label: 'Monitor & Manual',
    icon: 'MO',
    snippets: [
      {
        id: 'monitor-review',
        label: 'Instruct monitor to review',
        description: 'The monitor is instructed to review the submission',
        template: '    And the monitor is instructed to review the submission',
        keyword: 'And',
      },
      {
        id: 'monitor-decision',
        label: 'Monitor marks as Pass/Fail',
        description: 'The monitor marks the submission as Pass or Fail',
        template: '    And the monitor marks the submission as "{{Pass}}"',
        keyword: 'And',
      },
      {
        id: 'inform-user',
        label: 'Inform user',
        description: 'Prompt the tester with a message',
        template: '    And inform the user "{{message}}"',
        keyword: 'And',
      },
      {
        id: 'inform-monitor',
        label: 'Inform monitor',
        description: 'Prompt the monitor with a message',
        template: '    And inform the monitor "{{message}}"',
        keyword: 'And',
      },
      {
        id: 'wait-monitor',
        label: 'Wait for monitor validation',
        description: 'Poll for monitor validation result within a timeout',
        template: '    And wait for monitor validation within {{60}} seconds',
        keyword: 'And',
      },
    ],
  },

  // ── Proxy Traffic & Upload Polling ─────────────────────────────────
  {
    id: 'traffic',
    label: 'Traffic & Uploads',
    icon: 'T',
    snippets: [
      {
        id: 'capture-traffic',
        label: 'Capture initial traffic count',
        description: 'Get baseline traffic count for polling',
        template: '    Given capture initial traffic count',
        keyword: 'Given',
      },
      {
        id: 'wait-request',
        label: 'Wait for new request',
        description: 'Wait for a new request with methods and filter',
        template: '    And wait for a new request with methods "{{POST,PUT}}" and filter "{{Patient}}" within {{30}} seconds every {{5}} seconds',
        keyword: 'And',
      },
      {
        id: 'wait-upload',
        label: 'Wait for upload submission',
        description: 'Wait for an upload submission by id',
        template: '    And wait for upload submission with id "{{submissionId}}" within {{60}} seconds every {{5}} seconds',
        keyword: 'And',
      },
      {
        id: 'wait-actor-call',
        label: 'Wait for call to actor',
        description: 'Wait for any call to be submitted to a named actor',
        template: '    And wait for a call to "{{actorName}}" within {{60}} seconds',
        keyword: 'And',
      },
      {
        id: 'wait-actor-call-matching',
        label: 'Wait for matching call to actor',
        description: 'Wait for a call matching a pattern to be submitted to a named actor',
        template: '    And wait for a call matching "{{pattern}}" to "{{actorName}}" within {{60}} seconds',
        keyword: 'And',
      },
    ],
  },

  /* HCERT / QR Code snippets removed — see public/components/hcert-decoder/
  {
    id: 'hcert',
    label: 'HCERT / QR Code',
    icon: 'QR',
    snippets: [
      {
        id: 'qr-presented',
        label: 'Receiver presented QR Code',
        description: 'A Receiver is presented a QR Code',
        template: '    Given a Receiver is presented a QR Code',
        keyword: 'Given',
      },
      {
        id: 'qr-iso',
        label: 'QR format ISO 18004',
        description: 'QR code uses ISO/IEC 18004:2015 format',
        template: '    And the QR code uses a format as defined in (ISO/IEC 18004:2015)',
        keyword: 'And',
      },
      {
        id: 'qr-alphanumeric',
        label: 'QR Alphanumeric mode',
        description: 'QR code uses Alphanumeric mode (Mode 2)',
        template: '    And the QR code uses Alphanumeric mode (Mode 2) encoding',
        keyword: 'And',
      },
      {
        id: 'qr-base45',
        label: 'QR Base45 encoding',
        description: 'QR code uses Base45 encoding',
        template: '    And the QR code uses Base45 encoding',
        keyword: 'And',
      },
      {
        id: 'qr-scan',
        label: 'Scan QR Code',
        description: 'The Receiver scans the QR Code',
        template: '    When the Receiver scans the QR Code',
        keyword: 'When',
      },
      {
        id: 'qr-decoded',
        label: 'QR decoded successfully',
        description: 'Assert QR code was successfully decoded',
        template: '    Then the QR code is successfully decoded',
        keyword: 'Then',
      },
      {
        id: 'qr-hc1-prefix',
        label: 'Has HC1: prefix',
        description: 'Decoded string starts with HC1: prefix',
        template: '    And the decoded raw Alphanumeric string starts with "HC1:" prefix',
        keyword: 'And',
      },
      {
        id: 'qr-no-hc1',
        label: 'No HC1: prefix',
        description: 'Decoded string does not start with HC1: prefix',
        template: '    And the decoded raw Alphanumeric string does not start with "HC1:" prefix',
        keyword: 'And',
      },
      {
        id: 'qr-rejected',
        label: 'QR rejected with error',
        description: 'QR Code is rejected with an Error',
        template: '    Then the QR Code is rejected with an Error',
        keyword: 'Then',
      },
      {
        id: 'hcert-decode',
        label: 'Decode HCERT string',
        description: 'Receiver decodes the raw Alphanumeric string from QR Code',
        template: '    When Receiver decodes the raw Alphanumeric string from QR Code',
        keyword: 'When',
      },
      {
        id: 'hcert-remove-prefix',
        label: 'Remove HC1: prefix',
        description: 'Removes the HC1: prefix from the decoded string',
        template: '    And removes the "HC1:" prefix',
        keyword: 'And',
      },
      {
        id: 'hcert-base45-decoded',
        label: 'Base45 decoded',
        description: 'Remaining string can be Base45 decoded',
        template: '    Then the remaining Alphanumeric string can be Base45 decoded to retrieve a binary payload',
        keyword: 'Then',
      },
      {
        id: 'hcert-zlib',
        label: 'ZLIB decompression',
        description: 'ZLIB decompression can be applied to the binary payload',
        template: '    And ZLIB decompression can be applied to the binary payload',
        keyword: 'And',
      },
      {
        id: 'cwt-valid',
        label: 'Valid CWT payload',
        description: 'Payload is a valid CBOR Web Token (CWT)',
        template: '    Then the retrieved Payload is a valid CBOR Web Token (CWT) as defined [here]({{url}})',
        keyword: 'Then',
      },
      {
        id: 'cwt-decoded',
        label: 'Valid CWT from QR',
        description: 'A valid CBOR CWT token is decoded from a QR Code',
        template: '    Given a valid CBOR CWT token is decoded from a QR Code',
        keyword: 'Given',
      },
      {
        id: 'cwt-parsed',
        label: 'CWT is parsed',
        description: 'THE CWT is parsed',
        template: '    And THE CWT is parsed',
        keyword: 'And',
      },
      {
        id: 'cwt-validate-sd',
        label: 'Validate CWT against SD',
        description: 'CWT structure validates against a StructureDefinition',
        template: '    And CWT structure validates against the StructureDefinition as defined [here]({{url}})',
        keyword: 'And',
      },
      {
        id: 'cwt-algorithm',
        label: 'Validate algorithm claim',
        description: 'Receiver validates algorithm Claim 1 in Header',
        template: '    When the Receiver validates the algorithm i.e. Claim \'1\' in the Header',
        keyword: 'When',
      },
      {
        id: 'cwt-algorithm-types',
        label: 'Check supported algorithms',
        description: 'Algorithm is one of the supported types',
        template: '    Then the algorithm is be one of the supported types:\n      | Algorithm   | COSE Parameter | SOG-IT Level |\n      | {{ES256}}   | {{-7}}         | {{1}}        |',
        keyword: 'Then',
      },
      {
        id: 'cwt-key-id',
        label: 'Extract Key Identifier',
        description: 'Extract Key Identifier (Claim 4) from the Header',
        template: '    And the Receiver extracts the Key Identifier i.e. Claim \'4\' in the Header',
        keyword: 'And',
      },
      {
        id: 'cwt-issuer',
        label: 'Extract Issuer',
        description: 'Extract Issuer (Claim 1) from the Payload',
        template: '    And extracts the Issuer i.e. Claim \'1\' from the Payload',
        keyword: 'And',
      },
      {
        id: 'cwt-key-8bytes',
        label: 'Key ID is 8 bytes',
        description: 'Extracted Key Id is 8 bytes',
        template: '    Then the extracted Key Id is 8 bytes',
        keyword: 'Then',
      },
      {
        id: 'cwt-issuer-country',
        label: 'Issuer is country code',
        description: 'Issuer is ISO 3166-1 alpha-2 Country Code',
        template: '    And the extracted issuer is ISO 3166-1 alpha-2 Country Code',
        keyword: 'And',
      },
      {
        id: 'cwt-public-key',
        label: 'Retrieve public key',
        description: 'Retrieve public key from trust network',
        template: '    And the public key can be retrieved from the trust network using the Country Code and Key Id',
        keyword: 'And',
      },
      {
        id: 'cwt-extract-pubkey',
        label: 'Extract public key from trust network',
        description: 'Receiver extracts public key matching Key Id in COSE Header',
        template: '    And the Receiver extracts the public key of the issuer from the trust network that matches the Key Id in the COSE Header',
        keyword: 'And',
      },
      {
        id: 'cwt-not-expired',
        label: 'Payload not expired',
        description: 'Current time is between Issued at and Expiration Date',
        template: '    And the payload has not expired i.e. current time is between Issued at (Claim \'6\') and  Expiration Date (Claim \'4\')',
        keyword: 'And',
      },
      {
        id: 'cwt-signature-valid',
        label: 'Signature is valid',
        description: 'Signature is cryptographically valid',
        template: '    Then the signature is cryptographically valid',
        keyword: 'Then',
      },
      {
        id: 'hcert-extract-payload',
        label: 'Extract HCERT payload',
        description: 'Receiver extracts HCERT Payload using claim key -260',
        template: '    And the Receiver extracts the HCERT Payload using claim key -260',
        keyword: 'And',
      },
      {
        id: 'hcert-validate-sd',
        label: 'Validate HCERT structure',
        description: 'HCERT structure validates against a StructureDefinition',
        template: '    Then the extracted HCERT structure validates against the StructureDefinition as defined [here]({{url}})',
        keyword: 'Then',
      },
    ],
  },
  END HCERT block */

  // ── Wildcards Reference ────────────────────────────────────────────
  {
    id: 'wildcards',
    label: 'Wildcards',
    icon: 'W',
    snippets: [
      {
        id: 'wc-string',
        label: '$string$',
        description: 'Matches any string value',
        template: '$string$',
        keyword: 'And',
      },
      {
        id: 'wc-uuid',
        label: '$uuid$',
        description: 'Matches a UUID pattern',
        template: '$uuid$',
        keyword: 'And',
      },
      {
        id: 'wc-date',
        label: '$date$',
        description: 'Matches a date (YYYY-MM-DD)',
        template: '$date$',
        keyword: 'And',
      },
      {
        id: 'wc-instant',
        label: '$instant$',
        description: 'Matches a FHIR instant',
        template: '$instant$',
        keyword: 'And',
      },
      {
        id: 'wc-choice',
        label: '$choice:...$',
        description: 'Matches one of the listed values',
        template: '$choice:{{value1}}|{{value2}}$',
        keyword: 'And',
      },
    ],
  },
];
