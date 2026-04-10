Feature: Server handles Belgian allergy resources
  As a FHIR server
  I want to accept valid Belgian allergy resources and reject invalid ones
  So that conformance to the Belgian allergy IG is verified

  Background:
    Given FHIRServer is the system under test on http://localhost:8080/fhir as defined by http://hl7.org/fhir/ActorDefinition/server
    And Client is available on http://localhost:9000/fhir as defined by http://hl7.org/fhir/ActorDefinition/client
    And Validator is available
    And Validator is loaded with package "hl7.fhir.be.allergy#1.1.2"
    And FHIRServer is configured with data pool "default"

  # ------------------------------------------------------------------
  # Happy path: create, submit, validate, inspect
  # ------------------------------------------------------------------
  Scenario: tc-server-001 Accept a valid Belgian allergy
    Given Client creates an allergy resource with:
      | resourceType       | AllergyIntolerance.code.coding.code | AllergyIntolerance.code.coding.display | AllergyIntolerance.code.text | AllergyIntolerance.reaction.substance.coding.code | AllergyIntolerance.reaction.substance.coding.display |
      | AllergyIntolerance | 762952008                           | Peanut (substance)                     | Allergic to peanuts          | 39579001                                          | Anaphylaxis                                          |
    When Client submits the created allergy to FHIRServer
    Then the resource is correctly uploaded to the server
    And save the returned identifier as "allergyId"

    # Validate against the Belgian allergy profile
    And the validator validates it against https://www.ehealth.fgov.be/standards/fhir/allergy/StructureDefinition/be-allergyintolerance
    And the validation summary shows 0 errors and 0 warnings

    # Quick implicit validation (uses meta.profile or base type)
    And the resource is valid

    # Inspect key elements with FHIRPath
    And evaluate FHIRPath "AllergyIntolerance.code.coding.where(system='http://snomed.info/sct').code" as "snomedCode"
    And evaluate FHIRPath "AllergyIntolerance.code.coding.code" and expect "762952008"
    And evaluate FHIRPath "AllergyIntolerance.reaction.substance.exists()" and expect "true"

  # ------------------------------------------------------------------
  # Submit two resources, then verify both are persisted
  # ------------------------------------------------------------------
  Scenario: tc-server-002 Register and retrieve multiple allergies
    Given Client creates an allergy resource with:
      | resourceType       | AllergyIntolerance.code.coding.code | AllergyIntolerance.code.coding.display | AllergyIntolerance.code.text | AllergyIntolerance.reaction.substance.coding.code | AllergyIntolerance.reaction.substance.coding.display |
      | AllergyIntolerance | 762952008                           | Peanut (substance)                     | Allergic to peanuts          | 39579001                                          | Anaphylaxis                                          |
    When Client submits the created allergy to FHIRServer
    Then the resource is correctly uploaded to the server
    And save the returned identifier as "allergy1"

    Given Client creates an allergy resource with:
      | resourceType       | AllergyIntolerance.code.coding.code | AllergyIntolerance.code.coding.display | AllergyIntolerance.code.text   | AllergyIntolerance.reaction.substance.coding.code | AllergyIntolerance.reaction.substance.coding.display |
      | AllergyIntolerance | 227346004                           | Chick peas (substance)                 | Allergic to chick peas         | 39579001                                          | Anaphylaxis                                          |
    When Client submits the created allergy to FHIRServer
    Then the resource is correctly uploaded to the server
    And save the returned identifier as "allergy2"

    # Verify both allergies are persisted
    Then the value of "allergy1" is not empty
    And the value of "allergy2" is not empty

  # ------------------------------------------------------------------
  # Rejection: invalid resource type
  # ------------------------------------------------------------------
  Scenario: tc-server-003 Reject an invalid resource type
    Given Client creates an allergy resource with:
      | resourceType           | AllergyIntolerance.code.coding.code | AllergyIntolerance.code.coding.display | AllergyIntolerance.code.text | AllergyIntolerance.reaction.substance.coding.code | AllergyIntolerance.reaction.substance.coding.display |
      | AllergyIntoleranceXXX  | 762952008                           | Peanut (substance)                     | Allergic to peanuts          | 39579001                                          | Anaphylaxis                                          |
    When Client submits the created allergy to FHIRServer
    Then the response status should be "400"
    And the OperationOutcome at "/issue/0/severity" should be "error"

  # ------------------------------------------------------------------
  # Test data generation + validation round-trip
  # ------------------------------------------------------------------
  Scenario: tc-server-004 Generate and validate a Belgian patient
    Given define mappings "patientMappings" with parts:
      | path                    | part   | expression                                                          |
      | Patient.identifier:SSIN | system | 'https://www.ehealth.fgov.be/standards/fhir/core/NamingSystem/ssin' |
      | Patient.identifier:SSIN | value  | column('ssin')                                                      |
      | Patient.name            | family | column('family')                                                    |
      | Patient.name            | given  | column('given')                                                     |
      | Patient.gender          |        | column('gender')                                                    |
      | Patient.birthDate       |        | column('birthDate')                                                 |
    And define data "patients":
      | ssin        | family  | given | gender | birthDate  |
      | 79121539875 | Pansen  | Jan   | male   | 1979-12-15 |
    When generate test data from profile "https://www.ehealth.fgov.be/standards/fhir/core/StructureDefinition/be-patient" with mappings "patientMappings" and data "patients" as "bePatient"
    Then the "bePatient" resource type should be "Patient"
    And "bePatient" is valid

    # Verify generated content
    And evaluate FHIRPath "Patient.name.family" on "bePatient" and expect "Pansen"
    And evaluate FHIRPath "Patient.name.given" on "bePatient" and expect "Jan"
    And evaluate FHIRPath "Patient.identifier.where(system='https://www.ehealth.fgov.be/standards/fhir/core/NamingSystem/ssin').value" on "bePatient" and expect "79121539875"

    # Match structure
    And partially match "bePatient" against expected:
      | resourceType | name                                     |
      | Patient      | [{"family": "Pansen", "given": ["Jan"]}] |
