Feature: Client submits allergies and a monitor validates them
  As a client
  I want to submit allergy resources, have them validated, and get monitor approval
  So that the client's conformance to the Belgian allergy IG is verified end-to-end

  Background:
    Given Client is the system under test on http://localhost:9000/fhir as defined by http://hl7.org/fhir/ActorDefinition/client
    And FHIRServer is available on http://hapi.fhir.org/baseR4 as defined by http://hl7.org/fhir/ActorDefinition/server
    And Validator is available as defined by http://hl7.org/fhir/ActorDefinition/validator
    And Validator is loaded with package "hl7.fhir.be.allergy#1.1.2"
    And FHIRServer is configured with data pool "default"

  # ------------------------------------------------------------------
  # Happy path: submit, validate, FHIRPath, monitor approval
  # ------------------------------------------------------------------
  Scenario: tc-client-001 Submit a valid allergy with monitor approval
    Given Client creates an allergy resource with:
      | resourceType       | AllergyIntolerance.code.coding.code | AllergyIntolerance.code.coding.display | AllergyIntolerance.code.text | AllergyIntolerance.reaction.substance.coding.code | AllergyIntolerance.reaction.substance.coding.display |
      | AllergyIntolerance | 762952008                           | Peanut (substance)                     | Allergic to peanuts          | 39579001                                          | Anaphylaxis                                          |
    When Client submits the created allergy
    Then the resource is correctly uploaded to the server
    And save the returned identifier as "allergyId"

    # Validate against Belgian profile via the validator actor
    And the validator validates it against https://www.ehealth.fgov.be/standards/fhir/allergy/StructureDefinition/be-allergyintolerance
    And the validation summary shows 0 errors and 0 warnings

    # Inspect SNOMED coding
    And evaluate FHIRPath "AllergyIntolerance.code.coding.where(system='http://snomed.info/sct').code" as "snomedCode"
    And evaluate FHIRPath "AllergyIntolerance.code.coding.count()" and expect "1"

    # Monitor reviews and approves
    And inform the monitor "Please review the allergy submission for clinical correctness"
    And wait for monitor validation within 60 seconds
    And the monitor marks the submission as "Pass"

  # ------------------------------------------------------------------
  # Quick implicit validation (no profile URL)
  # ------------------------------------------------------------------
  Scenario: tc-client-002 Submit and validate using meta.profile
    Given Client creates an allergy resource with:
      | resourceType       | AllergyIntolerance.code.coding.code | AllergyIntolerance.code.coding.display | AllergyIntolerance.code.text |
      | AllergyIntolerance | 418689008                           | Allergy to grass pollen                | Grass pollen allergy         |
    When Client submits the created allergy
    Then the resource is correctly uploaded to the server
    And the resource is valid

  # ------------------------------------------------------------------
  # Proxy traffic observation
  # ------------------------------------------------------------------
  Scenario: tc-client-003 Verify client sends a POST via proxy
    Given capture initial traffic count
    And Client creates an allergy resource with:
      | resourceType       | AllergyIntolerance.code.coding.code | AllergyIntolerance.code.coding.display | AllergyIntolerance.code.text |
      | AllergyIntolerance | 762952008                           | Peanut (substance)                     | Allergic to peanuts          |
    When Client submits the created allergy
    Then the resource is correctly uploaded to the server
    And wait for a new request with methods "POST" and filter "AllergyIntolerance" within 30 seconds every 5 seconds

  # ------------------------------------------------------------------
  # Generate test data, validate, match, then submit
  # ------------------------------------------------------------------
  Scenario: tc-client-004 Generate a patient, validate, and inspect
    # Generate a Belgian patient with inline FHIR paths
    Given generate test data from profile "https://www.ehealth.fgov.be/standards/fhir/core/StructureDefinition/be-patient" with:
      | Patient.name.given | Patient.name.family | Patient.birthDate | Patient.gender |
      | Marie              | Dubois              | 1985-03-22        | female         |
    Then the generated resource type should be "Patient"

    # Validate the generated resource
    And validate "generatedResource" against "https://www.ehealth.fgov.be/standards/fhir/core/StructureDefinition/be-patient"
    And the validation should pass

    # FHIRPath assertions
    And evaluate FHIRPath "Patient.name.family" on "generatedResource" and expect "Dubois"
    And evaluate FHIRPath "Patient.name.given" on "generatedResource" and expect "Marie"
    And evaluate FHIRPath "Patient.gender" on "generatedResource" and expect "female"

    # Structural match
    And partially match "generatedResource" against expected:
      | resourceType | name                                       |
      | Patient      | [{"family": "Dubois", "given": ["Marie"]}] |

  # ------------------------------------------------------------------
  # Define reusable mappings + data, generate, validate, match
  # ------------------------------------------------------------------
  Scenario: tc-client-005 Generate patients with reusable mappings
    Given define mappings "patientMappings" with parts:
      | path                    | part   | expression                                                          |
      | Patient.identifier:SSIN | system | 'https://www.ehealth.fgov.be/standards/fhir/core/NamingSystem/ssin' |
      | Patient.identifier:SSIN | value  | column('ssin')                                                      |
      | Patient.name            | family | column('family')                                                    |
      | Patient.name            | given  | column('given')                                                     |
      | Patient.gender          |        | column('gender')                                                    |
    And define data "testPatients":
      | ssin        | family  | given | gender |
      | 85032212345 | Dubois  | Marie | female |
    When generate test data from profile "https://www.ehealth.fgov.be/standards/fhir/core/StructureDefinition/be-patient" with mappings "patientMappings" and data "testPatients" as "bePatient"
    Then "bePatient" is valid
    And evaluate FHIRPath "Patient.identifier.where(system='https://www.ehealth.fgov.be/standards/fhir/core/NamingSystem/ssin').value" on "bePatient" and expect "85032212345"

  # ------------------------------------------------------------------
  # Inline resource definition + validation failure
  # ------------------------------------------------------------------
  Scenario: tc-client-006 Detect invalid resource with missing required fields
    Given define resource "badAllergy" as:
      """
      {
        "resourceType": "AllergyIntolerance",
        "code": {
          "coding": [{"code": "762952008"}]
        }
      }
      """
    When validate "badAllergy" against "https://www.ehealth.fgov.be/standards/fhir/allergy/StructureDefinition/be-allergyintolerance"
    Then the validation should fail
    And the validation should have no "fatal" issues

  # ------------------------------------------------------------------
  # Variable assertions and extraction
  # ------------------------------------------------------------------
  Scenario: tc-client-007 Extract and assert values from a submission
    Given Client creates an allergy resource with:
      | resourceType       | AllergyIntolerance.code.coding.code | AllergyIntolerance.code.coding.display | AllergyIntolerance.code.text |
      | AllergyIntolerance | 762952008                           | Peanut (substance)                     | Allergic to peanuts          |
    When Client submits the created allergy
    Then the resource is correctly uploaded to the server
    And save the returned identifier as "allergyId"
    And the value of "allergyId" is not empty

    # Set and verify a variable
    And set "expectedCode" to "762952008"
    And the value of "expectedCode" is "762952008"
