Feature: Enhanced validation options

  Background:
    Given Client is the system under test
    And FHIRServer is available
    And FHIRValidator is available
    And FHIRValidator is loaded with package "hl7.fhir.us.core#5.0.1"

  Scenario: Validate with best practice warnings as errors
    Given generate and validate test data from profile "http://hl7.org/fhir/StructureDefinition/Patient"

  Scenario: Check for specific validation issues
    Given Client creates an allergy resource with:
      | resourceType          | code.coding.code | code.coding.display | code.text          | reaction.code | reaction.display      |
      | AllergyIntoleranceXXX | 762952008        | Peanut (substance)  | Allergic to peanut | 39579001      | Anaphylactic reaction |
    When Client submits the created allergy
    And validate against "http://hl7.org/fhir/StructureDefinition/AllergyIntolerance" with best practice "Warning"
    Then the validation should fail
    And the validation issues should contain "resourceType"
    And the validation should have no "fatal" issues
