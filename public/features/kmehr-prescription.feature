Feature: KMEHR Prescription Processing

Scenario: Process electronic prescription
    Given the user submits a KMEHR prescription
    When the KMEHR is processed
    Then validate KMEHR message
    And process KMEHR transaction
    And inform the user "Prescription processed"
