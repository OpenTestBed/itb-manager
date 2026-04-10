Feature: L3 SOP FHIR Implementation Guide Development

Scenario: Develop FHIR Implementation Guide following L3 SOP
    Given create FHIR profiles for Patient and Immunization resources
    When define value sets for vaccine codes and administration sites
    And specify code systems for immunization status
    Then create capability statements for immunization registry
    And validate FHIR resources against profiles
    And publish implementation guide to registry
