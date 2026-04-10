Feature: openEHR Composition Validation

Scenario: Validate clinical composition
    Given the user creates a clinical composition
    When the composition is processed
    Then validate against archetype openEHR-EHR-COMPOSITION.encounter.v1
    And the composition should be valid
    And inform the user "Composition validated successfully"
