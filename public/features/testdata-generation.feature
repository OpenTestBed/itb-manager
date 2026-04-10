Feature: Test data generation with data tables

  Background:
    Given Client is the system under test
    And FHIRServer is available
    And FHIRValidator is available
    And FHIRValidator is loaded with package "hl7.fhir.us.core#5.0.1"

  Scenario: Generate and validate Patient test data
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
