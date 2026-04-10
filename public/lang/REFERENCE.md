# FHIR Gherkin Dialect -- Language Reference

A Gherkin-based DSL for writing FHIR interoperability test cases. Steps are matched against patterns defined in the core language (`en.yml`) and component extensions.

---

## 1. Actors

```
<Actor> is the system under test
<Actor> is the system under test at "<endpoint>"
<Actor> is the system under test at "<endpoint>" as defined by "<canonical>"
<Actor> is the system under test as defined by "<canonical>"
<Actor> is available
<Actor> is available as "<name>"
<Actor> is available at "<endpoint>"
<Actor> is available at "<endpoint>" as defined by "<canonical>"
<Actor> is available as defined by "<canonical>"
```

- `<Actor>` -- an identifier matching `[A-Za-z][A-Za-z0-9_]*`
- `at` / `on` are interchangeable
- Declaring an actor at an endpoint also sets `<Actor>Base` to that URL

## 2. HTTP Requests

```
<Actor> posts to <Actor> at "<path>" with:
  """
  <body>
  """

<Actor> gets "<url>" as "<variable>"
```

- `posts to` sends a POST with JSON headers and the docstring as body
- `gets` sends a GET and stores the response body in `<variable>`

## 3. Variables

```
set "<variable>" to "<value>"
set "<variable>" to:
  """
  <content>
  """
extract "<jsonPointer>" from "<variable>" as "<variable>"
extract "<jsonPointer>" as "<variable>"
```

- `extract` without `from` operates on the last HTTP response body
- JSON Pointer syntax (e.g. `/resourceType`, `/entry/0/resource`)

## 4. Assertions

```
"<name>" should be "<value>"
"<name>" should contain "<value>"
"<name>" should not be empty
```

### Reserved assertion names

| Name | Value |
|---|---|
| `response status` | HTTP status code of last request |
| `response` | Full response body of last request |
| `validation errors` | Count of error-level issues (`$validationErrors`) |
| `validation warnings` | Count of warning-level issues (`$validationWarnings`) |
| `validation outcome` | Raw OperationOutcome JSON (`$validationOutcome`) |
| `validation severity` | Highest severity across all issues (`$validationSeverity`) |

## 5. Interaction

```
<Actor> is informed "<message>"
<Actor> is informed "<message>" with "<content>"
<Actor> is asked for "<variable>"
<Actor> is asked for "<variable>" with "<message>"
```

- `is informed` displays a message to the user
- `is asked for` prompts the user to upload/provide a value

## 6. Logging

```
log "<message or variable>"
```

---

## FHIR Validator Extension

Provided by the `fhir-validator` component. Requires a FHIR Validator actor with its base URL set.

### Package Loading

```
<Actor> is loaded with package "<package>"
```

Loads an IG package into the validator (e.g. `hl7.fhir.be.vaccination#1.1.2`).

### Validation

```
validate "<resource>" against "<profiles>"
validate "<resource>" against "<profiles>" with best practice "<level>"
validate "<resource>" against "<profiles>" with resource id "<rule>"
the validation should pass
the validation should fail
```

All `validate` steps produce: `$validationOutcome`, `$validationErrors`, `$validationWarnings`, `$validationSeverity`.

### FHIRPath Evaluation

```
evaluate FHIRPath "<expression>" on "<resource>" and expect "<value>"
evaluate FHIRPath "<expression>" and expect "<value>"
evaluate FHIRPath "<expression>" on "<resource>" as "<variable>"
evaluate FHIRPath "<expression>" exists
evaluate FHIRPath "<expression>" count is <number>
```

- `and expect` asserts the result equals the expected value
- `as` stores the result in a variable
- `exists` wraps the expression in `.exists()` and asserts `true`
- `count is` wraps in `.count()` and asserts the number
- Without `on`, uses the last submitted resource (`$submitResult{payload}`)

### Matchetype Comparison

```
partially match "<resource>" against:
  """
  <expected JSON>
  """

exactly match "<resource>" against:
  """
  <expected JSON>
  """

"<resource>" should NOT match:
  """
  <expected JSON>
  """
```

### Test Data Generation

```
generate test data from profile "<profileUrl>"
generate test data from profile "<profileUrl>" as "<variable>"
```

Stores the result in `$generatedResource` or the named variable.

### Data/Mapping Definitions

```
define mappings "<variable>":
  | path | expression |
  | ...  | ...        |

define mappings "<variable>" with parts:
  | path | part | expression |
  | ...  | ...  | ...        |

define data "<variable>":
  | col1 | col2 | ... |
  | ...  | ...  | ... |
```

---

## Example: Belgian Vaccination Validation

```gherkin
Feature: Belgian Vaccination (BeVaccination) profile validation
  Validates a user-provided Immunization resource against the BeVaccination profile
  from hl7.fhir.be.vaccination#1.1.2, checking two business rules:
    Rule 1 - Recorder/Performer identifier matching
    Rule 2 - AdministeredProduct CNK-to-SNOMED consistency via Vitalink registry

  Background:
    Given User is the system under test
    And FHIRValidator is available at "http://itb-fhir-validator:8081"
    And FHIRValidator is loaded with package "hl7.fhir.be.vaccination#1.1.2"

  Scenario: be-vaccination-001 Validate BeVaccination business rules

    Given User is asked for "immunizationResource" with "Upload a BeVaccination Immunization JSON"
    Then extract "/resourceType" from "immunizationResource" as "resourceType"
    And "resourceType" should be "Immunization"

    When evaluate FHIRPath "performer.actor.identifier.exists() implies (...)" on "immunizationResource" and expect "true"

    And evaluate FHIRPath "extension.where(...).coding.where(system='...cnk-codes').code" on "immunizationResource" as "cnkCode"

    And set "expectedSnomed" to "871822003"

    And evaluate FHIRPath "vaccineCode.coding.where(system='http://snomed.info/sct').code" on "immunizationResource" and expect "$expectedSnomed"

    And User is informed "BeVaccination validated: recorder/performer match and CNK/SNOMED consistency checks passed."
```

---

## Compilation API

The test workbench exposes a REST API for Gherkin-to-TDL compilation.

**Base URL:** `http://localhost:3000/api`

### POST /api/compile

Compile a Gherkin feature file to an ITB TDL test suite ZIP.

```
POST /api/compile
Content-Type: text/plain

Feature: My Test
  Scenario: test-001
    Given User is the system under test
    And log "hello"
```

**Success (200):** Returns `application/zip` with the TDL files.

**Validation error (422):**
```json
{"error": "1 error(s) in Gherkin", "issues": [{"line": 3, "severity": "error", "message": "No mapping for step: ..."}]}
```

**Bad request (400):**
```json
{"error": "Empty Gherkin content"}
```

### POST /api/compile/testplan

Compile from a FHIR TestPlan resource. Extracts the Gherkin feature file path from `suite[0].input[?name=gherkin-script].file`, loads the file from the server, compiles, and returns the ZIP.

```
POST /api/compile/testplan
Content-Type: application/json

{
  "resourceType": "TestPlan",
  "suite": [{
    "input": [{"name": "gherkin-script", "file": "features/be-vaccination.feature"}],
    "test": [...]
  }]
}
```

**Success (200):** Returns `application/zip`.

**Feature not found (404):**
```json
{"error": "Feature file not found: features/missing.feature"}
```

### curl examples

```bash
# Compile a .feature file
curl -X POST http://localhost:3000/api/compile \
  -H "Content-Type: text/plain" \
  --data-binary @my-test.feature \
  -o output.zip

# Compile from a TestPlan
curl -X POST http://localhost:3000/api/compile/testplan \
  -H "Content-Type: application/json" \
  -d @TestPlan-be-vaccination-gherkin.json \
  -o output.zip
```
