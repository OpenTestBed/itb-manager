Feature: Generate a test Bundle from data rows

  Background:
    Given Client is the system under test
    And FHIRServer is available
    And FHIRServer is configured

  Scenario: Generate Patient bundle
    Given define data "bundleData":
      | familyName | givenName | sex    |
      | Doe        | John      | male   |
      | Smith      | Jane      | female |
      | Wilson     | Bob       | male   |
    And generate test bundle from profile "http://hl7.org/fhir/StructureDefinition/Patient" with data "bundleData"
    Then evaluate FHIRPath "Bundle.entry.count()" on "generatedBundle" and expect "3"
