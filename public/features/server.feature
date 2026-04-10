Feature: FHIR server allergy flows
  As a FHIR server
  I want to handle valid and invalid allergy submissions
  So that clients see correct outcomes

  Background:
    Given Client is the system under test
    And FHIRServer is available
    And FHIRServer is configured with data pool "default"

  Scenario: tc-server-001 Submit two allergies and verify
    When Client registers an allergy with:
      | code.coding.code | code.coding.display    | code.text              | reaction.code | reaction.display       |
      | 762952008        | Peanut (substance)     | Allergic to peanut     | 39579001      | Anaphylactic reaction  |
    And save the returned identifier as "registeredIdentifier1"

    When Client registers an allergy with:
      | code.coding.code | code.coding.display     | code.text                | reaction.code | reaction.display       |
      | 227346004        | Chick peas (substance)  | Allergic to chick peas   | 39579001      | Anaphylactic reaction  |
    And save the returned identifier as "registeredIdentifier2"

    Then the patient's registered allergies should include:
      | code      | identifier             |
      | 762952008 | $registeredIdentifier1 |
      | 227346004 | $registeredIdentifier2 |

  Scenario: tc-server-002 Reject invalid allergy due to wrong resource type
    Given Client creates an allergy resource with:
      | resourceType           | code.coding.code | code.coding.display  | code.text           | reaction.code | reaction.display       |
      | AllergyIntoleranceXXX  | 762952008        | Peanut (substance)   | Allergic to peanut  | 39579001      | Anaphylactic reaction  |
    When Client submits the created allergy
    Then the response status should be "400"
    And the OperationOutcome at "/issue/0/severity" should be "error"