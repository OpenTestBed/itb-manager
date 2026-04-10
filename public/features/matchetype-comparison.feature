Feature: Match comparison with wildcards

  Background:
    Given Client is the system under test
    And FHIRServer is available

  Scenario: Partial match with wildcard patterns
    Given generate test data from profile "http://hl7.org/fhir/StructureDefinition/Patient" as "patient"
    Then partially match "patient" against expected:
      | resourceType | name                     |
      | Patient      | [{"family": "$string$"}] |

  Scenario: Validate and match a submitted resource
    Given Client creates an allergy resource with:
      | resourceType       | code.coding.code | code.coding.display | code.text          | reaction.code | reaction.display      |
      | AllergyIntolerance | 762952008        | Peanut (substance)  | Allergic to peanut | 39579001      | Anaphylactic reaction |
    When Client submits the created allergy
    Then the resource is correctly uploaded to the server
    And the submission should match:
      | resourceType       |
      | AllergyIntolerance |
