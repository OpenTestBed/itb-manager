Feature: FHIRPath expression evaluation and assertions

  Scenario: FHIRPath checks on generated data
    Given generate test data from profile "http://hl7.org/fhir/StructureDefinition/Patient" as "patient"
    Then evaluate FHIRPath "Patient.name" exists
    And evaluate FHIRPath "Patient.name" count is 1
    And evaluate FHIRPath "Patient.name.family" on "patient" as "familyName"
    And evaluate FHIRPath "Patient.name.family" on "patient" and expect "Smith"
