Feature: SMART Guidelines ANC Workflow

Scenario: Execute antenatal care workflow
    Given collect patient data for antenatal care
    When apply clinical guidelines for ANC
    Then execute clinical decision support
    And provide clinical recommendations
    And create care plan for pregnant patient
    And calculate quality indicators for ANC program
