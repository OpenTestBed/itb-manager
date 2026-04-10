Feature: Tutorial - Validating a Belgian Patient resource
  This tutorial walks through a complete conformance test:
  load an Implementation Guide, generate test data with mappings,
  validate against a profile, check structure with match patterns,
  and extract values with FHIRPath expressions.

  Background:
    Given Client is the system under test
    And FHIRServer is available
    And Validator is available as "FHIR Validation Service"
    And FHIRValidator is available
    And FHIRValidator is loaded with package "hl7.fhir.be.core#2.1.2"

  Scenario: tutorial-001 Generate, validate, match, and assert

    # ── Step 1: Define how columns map to FHIR paths ─────────────
    #
    # Mappings tell the test data generator which FHIR paths to populate
    # and how to get the values from the data table columns.
    # "with parts" means some paths have sub-elements (e.g. Identifier
    # has both 'system' and 'value').

    Given define mappings "patientMappings" with parts:
      | path               | part   | expression          |
      | Patient.name       | family | column('family')    |
      | Patient.name       | given  | column('given')     |
      | Patient.gender     |        | column('gender')    |
      | Patient.birthDate  |        | column('birthDate') |

    # ── Step 2: Define the test data ─────────────────────────────
    #
    # A named data table that can be reused across scenarios.
    # Column names must match what the mappings reference.

    And define data "patients":
      | family  | given | gender | birthDate  |
      | Dupont  | Marie | female | 1985-03-15 |

    # ── Step 3: Generate a test resource ─────────────────────────
    #
    # The generator takes the profile, applies the mappings to map
    # columns to FHIR paths, and fills them with the data rows.
    # The result is stored in a variable called "generatedResource".

    And generate test data from profile "https://www.ehealth.fgov.be/standards/fhir/core/StructureDefinition/be-patient" with mappings "patientMappings" and data "patients"
    Then the generated resource type should be "Patient"

    # ── Step 4: Validate against the profile ─────────────────────
    #
    # Sends the resource to the FHIR Validator, which checks it
    # against the StructureDefinition. Returns an OperationOutcome.

    And validate "generatedResource" against "https://www.ehealth.fgov.be/standards/fhir/core/StructureDefinition/be-patient"
    And the validation should pass

    # ── Step 5: Check structure with a partial match ─────────────
    #
    # Verify the resource has the right shape using wildcards:
    #   $string$  = any string value
    #   $date$    = any valid date
    #   $choice:a|b|c$ = one of the listed values
    # "partially" means extra fields are allowed.

    And partially match "generatedResource" against:
      """
      {"resourceType":"Patient","name":[{"family":"$string$","given":["$string$"]}],"gender":"$choice:male|female|other|unknown$","birthDate":"$date$"}
      """

    # ── Step 6: Extract and assert values with FHIRPath ──────────
    #
    # FHIRPath expressions navigate the resource structure.
    # "as" saves the result to a variable; "and expect" asserts it.

    And evaluate FHIRPath "Patient.name.family" on "generatedResource" and expect "Dupont"
    And evaluate FHIRPath "Patient.gender" on "generatedResource" as "gender"
    Then the value of "gender" is "female"

    # ── Step 7: Assert existence and count ───────────────────────

    And evaluate FHIRPath "Patient.name" exists
    And evaluate FHIRPath "Patient.name" count is 1
