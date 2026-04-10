Feature: Test data generation, validation, FHIRPath, and match
  As a tester using the ITB test workbench
  I want to generate test data, validate it, evaluate FHIRPath, and compare with match
  So that I can build complete automated conformance tests

  Background:
    Given Client is the system under test
    And FHIRServer is available
    And FHIRValidator is available
    And FHIRValidator is loaded with package "hl7.fhir.us.core#5.0.1"

  # ---------------------------------------------------------------
  # Test Data Generation with Karate-style data tables
  # ---------------------------------------------------------------

  Scenario: tc-gen-001 Generate and validate a Patient from a profile
    Given generate test data from profile "http://hl7.org/fhir/StructureDefinition/Patient"
    Then validate "generatedResource" against "http://hl7.org/fhir/StructureDefinition/Patient"
    And the validation should pass

  Scenario: tc-gen-002 Generate Patient with data table and mappings
    Given define mappings "mappings":
      | path              | expression              |
      | Patient.name      | column('familyName')    |
      | Patient.gender    | column('sex')           |
    And define data "data":
      | familyName | sex    |
      | Doe        | male   |
    And generate test data from profile "http://hl7.org/fhir/StructureDefinition/Patient" with mappings "mappings" and data "data"
    Then validate "generatedResource" against "http://hl7.org/fhir/StructureDefinition/Patient"
    And the validation should pass
    And evaluate FHIRPath "Patient.name.family" on "generatedResource" and expect "Doe"
    And evaluate FHIRPath "Patient.gender" on "generatedResource" and expect "male"

  Scenario: tc-gen-003 Generate a Bundle of Patients from multiple data rows
    Given define data "bundleData":
      | familyName | givenName | sex    |
      | Doe        | John      | male   |
      | Smith      | Jane      | female |
      | Wilson     | Bob       | male   |
    And generate test bundle from profile "http://hl7.org/fhir/StructureDefinition/Patient" with data "bundleData"
    Then evaluate FHIRPath "Bundle.entry.count()" on "generatedBundle" and expect "3"

  Scenario: tc-gen-004 Generate and validate in a single step
    When generate and validate test data from profile "http://hl7.org/fhir/StructureDefinition/Patient"

  # ---------------------------------------------------------------
  # FHIRPath evaluation
  # ---------------------------------------------------------------

  Scenario: tc-fp-001 FHIRPath existence and count checks
    Given generate test data from profile "http://hl7.org/fhir/StructureDefinition/Patient" as "patient"
    Then evaluate FHIRPath "Patient.name" exists
    And evaluate FHIRPath "Patient.name" count is 1
    And evaluate FHIRPath "Patient.name.family" on "patient" as "familyName"

  # ---------------------------------------------------------------
  # Enhanced validation options
  # ---------------------------------------------------------------

  Scenario: tc-val-001 Validate with best practice warnings as errors
    Given generate test data from profile "http://hl7.org/fhir/StructureDefinition/Patient" as "patient"
    When validate against "http://hl7.org/fhir/StructureDefinition/Patient" with best practice "Error"
    Then the validation should have no "error" issues

  Scenario: tc-val-002 Detect validation issues containing specific text
    Given Client creates an allergy resource with:
      | resourceType          | code.coding.code | code.coding.display | code.text          | reaction.code | reaction.display      |
      | AllergyIntoleranceXXX | 762952008        | Peanut (substance)  | Allergic to peanut | 39579001      | Anaphylactic reaction |
    When Client submits the created allergy
    And validate against "http://hl7.org/fhir/StructureDefinition/AllergyIntolerance" with best practice "Warning"
    Then the validation should fail
    And the validation issues should contain "resourceType"

  # ---------------------------------------------------------------
  # Match comparison
  # ---------------------------------------------------------------

  Scenario: tc-match-001 Partial match with wildcards
    Given generate test data from profile "http://hl7.org/fhir/StructureDefinition/Patient" as "patient"
    Then partially match "patient" against expected:
      | resourceType | name                   |
      | Patient      | [{"family": "$string$"}] |

  Scenario: tc-match-002 Match submission against inline pattern
    Given Client creates an allergy resource with:
      | resourceType       | code.coding.code | code.coding.display | code.text          | reaction.code | reaction.display      |
      | AllergyIntolerance | 762952008        | Peanut (substance)  | Allergic to peanut | 39579001      | Anaphylactic reaction |
    When Client submits the created allergy
    Then the submission should match:
      | resourceType       |
      | AllergyIntolerance |
