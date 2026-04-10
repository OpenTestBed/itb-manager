Feature: L3 SOP FHIR Questionnaire Development

Scenario: Create structured data collection forms following L3 SOP
    Given design questionnaire structure for patient registration
    When define question items for demographic information
    And specify answer options for gender and ethnicity
    Then implement conditional logic for pregnancy status
    And validate questionnaire against FHIR specification
    And test form functionality in reference implementation
