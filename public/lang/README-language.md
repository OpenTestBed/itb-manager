# FHIR Gherkin Language for ITB

This document describes the **FHIR Gherkin dialect** supported by the Test Workbench.
It is designed for authoring **FHIR client and server test scenarios** that run both in **ITB** and (optionally) in **Karate**.

---

## Key Features

- **Standard Gherkin support** (`Feature:`, `Scenario:`, `Given/When/Then`).
- **Actor declarations** with endpoint URLs and canonical definitions.
- **FHIR-specific testing steps** for resource creation, submission, validation, and FHIRPath.
- **Test data generation** from StructureDefinition profiles with FHIR path mappings.
- **Match/comparison** for structural assertions on resources.
- **User interaction steps** for manual workflows (user actions, monitor validation).
- **Polling and proxying steps** for asynchronous workflows.
- **Configurable language catalog** (`en.yml`) mapping phrases to actions.
- **Requirements metadata** (`requires`) so authors know which ITB services/versions are needed.

---

## Supported Functions

### 1. Standard Gherkin
- `Feature`, `Background`, `Scenario`, `Scenario Outline`
- Step keywords: `Given`, `When`, `Then`, `And`, `But`
- Step tables for structured input
- Docstrings for JSON/XML snippets
- Comments: lines starting with `#` are ignored; inline `# comments` after step text are stripped

### 2. Actor Declarations

Declare the participants in a test, optionally with endpoint URLs and canonical definitions (e.g. ActorDefinition, CapabilityStatement).

```gherkin
Given Client is the system under test on http://localhost:9000/fhir as defined by http://hl7.org/fhir/ActorDefinition/client
And FHIRServer is available on http://hapi.fhir.org/baseR4
And Validator is available
```

### 3. Validation

- **Validate against a profile URL**
  ```gherkin
  Then validate against http://hl7.org/fhir/StructureDefinition/AllergyIntolerance
  And the validation summary shows 0 errors and 0 warnings
  ```

- **Actor-targeted validation** — route the validation request to a specific actor
  ```gherkin
  Then the validator validates it against http://hl7.org/fhir/StructureDefinition/AllergyIntolerance
  ```

- **Implicit validation** — validate using `meta.profile` or the base resource type (no profile URL needed)
  ```gherkin
  Then the resource is valid

  # Or for a named variable:
  Then "myPatient" is valid
  ```

- **Validate a named variable against a specific profile**
  ```gherkin
  Then validate "generatedPatient" against "http://hl7.org/fhir/StructureDefinition/Patient"
  And the validation should pass
  ```

- **Assert validation failure**
  ```gherkin
  Then the validation should fail
  And the validation issues should contain "minimum required"
  ```

- **Enhanced options** — best-practice level, resource id requirement
  ```gherkin
  Then validate against "http://hl7.org/fhir/StructureDefinition/Patient" with best practice "Error"
  And the validation should have no "error" issues
  ```

*Requires: service `FHIR-validator` version >=1.0*

### 4. FHIRPath Evaluation

Evaluate FHIRPath expressions against the last payload or a named variable. Save results to variables or assert values directly.

```gherkin
And evaluate FHIRPath "AllergyIntolerance.code.coding.where(system='http://snomed.info/sct').code" as "snomedCodes"
And evaluate FHIRPath "Patient.name.family" on "myPatient" and expect "Pansen"
And evaluate FHIRPath "Patient.identifier" count is 2
And evaluate FHIRPath "Patient.name.exists()" on "myPatient" and expect "true"
```

*Requires: service `FHIR-validator` version >=1.0*

### 5. Resource Creation & Submission

Create resources from tabular data (columns are FHIR element paths) and submit them to a server.

```gherkin
Given Client creates an allergy resource with:
  | resourceType       | AllergyIntolerance.code.coding.code | AllergyIntolerance.code.coding.display | AllergyIntolerance.code.text |
  | AllergyIntolerance | 762952008                           | Peanut (substance)                     | Allergic to peanuts          |
When Client submits the created allergy
Then the resource is correctly uploaded to the server
And save the returned identifier as "allergyId"
```

### 6. Test Data Generation

Generate synthetic FHIR resources from a StructureDefinition profile. Mappings use FHIR paths (e.g. `Patient.name`, `Patient.identifier:SSIN`).

```gherkin
# Simple inline generation with FHIR paths as columns
Given generate test data from profile "http://hl7.org/fhir/StructureDefinition/Patient" with:
  | Patient.name.given | Patient.name.family | Patient.birthDate | Patient.gender |
  | Jan                | Pansen              | 1990-05-15        | male           |

# Reusable mappings with parts for complex types
Given define mappings "patientMappings" with parts:
  | path                    | part   | expression                                                         |
  | Patient.identifier:SSIN | system | 'https://www.ehealth.fgov.be/standards/fhir/core/NamingSystem/ssin' |
  | Patient.identifier:SSIN | value  | column('ssin')                                                      |
  | Patient.name            | family | column('family')                                                    |
  | Patient.name            | given  | column('given')                                                     |
```

*Requires: service `FHIR-validator` version >=1.0*

### 7. Match / Comparison

Compare a resource against an expected pattern — full match, partial match, or mismatch detection.

```gherkin
Then partially match "generatedPatient" against expected:
  | path                         | value                  |
  | Patient.identifier[0].system | http://example.org/ids |
  | Patient.identifier[0].value  | 12345                  |

# Or with inline JSON doc strings:
Then partially match "myPatient" against:
  """
  {"name": [{"family": "Pansen"}]}
  """
```

### 8. User Interaction

Support human-in-the-loop testing with user prompts and monitor approval workflows.

```gherkin
And inform the monitor "Please review the allergy submission for clinical correctness"
And wait for monitor validation within 60 seconds
And the monitor marks the submission as "Pass"
```

### 9. Proxy & Polling

Observe HTTP traffic through a proxy and poll for expected requests or uploads.

```gherkin
Given capture initial traffic count
When Client submits the created allergy
Then wait for a new request with methods "POST" and filter "AllergyIntolerance" within 30 seconds every 5 seconds
```

### 10. Implementation Guide Loading

Load FHIR IG packages into actors for validation and test data generation.

```gherkin
Given Validator is preloaded with package hl7.fhir.be.allergy#1.1.2
And load implementation guide "hl7.fhir.us.core#6.1.0" and verify
```

---

## Requirements (`requires`)

In `en.yml`, steps may declare requirements:

```yaml
requires:
  service: FHIR-validator
  version: ">=1.0"
```

- **`service`**: ITB service or module required.
- **`version`**: Minimum version needed.
- The parser checks these and issues warnings if unsupported.

This ensures that authors only use steps that their ITB instance can run.

---

## Example Scenario

```gherkin
Feature: Client submits and monitor validates an allergy
  As a client
  I want to submit an allergy, validate its syntax and have a monitor confirm my system handles it correctly.

  Background:
    Given Client is the system under test
    And FHIRServer is available on http://hapi.fhir.org/baseR4
    And Validator is available
    And Validator is preloaded with package hl7.fhir.be.allergy#1.1.2

  Scenario: tc-client-001 Client submission with monitor approval
    Given Client creates an allergy resource with:
      | resourceType       | AllergyIntolerance.code.coding.code | AllergyIntolerance.code.coding.display | AllergyIntolerance.code.text |
      | AllergyIntolerance | 762952008                           | Peanut (substance)                     | Allergic to peanuts          |
    When Client submits the created allergy
    Then the resource is correctly uploaded to the server
    And the resource is valid
    And the validator validates it against http://hl7.org/fhir/StructureDefinition/AllergyIntolerance
    And the validation summary shows 0 errors and 0 warnings
    And evaluate FHIRPath "AllergyIntolerance.code.coding.where(system='http://snomed.info/sct').code" as "codes"
    And inform the monitor "Please review the submission"
    And wait for monitor validation within 60 seconds
    And the monitor marks the submission as "Pass"
```

---

## Files

- `en.yml`: Catalog of supported steps + requirements
- `REFERENCE.md`: Complete step-by-step language reference with examples
- `gherkinParser.ts`: Parser that expands steps using the catalog
- `xmlGenerator.ts`: Converts parsed scenarios to ITB XML
