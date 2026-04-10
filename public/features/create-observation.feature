Feature: Observation Resource Creation

Scenario: Create a vital signs observation
    Given the user submits an Observation resource
    When the resource is processed
    Then validate against http://hl7.org/fhir/StructureDefinition/Observation
    And poll for processing status
    And inform the user "Observation created successfully"
