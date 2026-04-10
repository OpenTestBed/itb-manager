Feature: Language Showcase — All FHIR Gherkin Dialect Features
  Demonstrates every core language step and FHIR Validator extension step.
  Uses a Belgian Patient profile as the test subject.

  Background:
    # 1. ACTORS — declare SUT, validator, and FHIR server
    Given User is the system under test
    And FHIRValidator is available at "http://itb-fhir-validator:8081"
    And FHIRServer is available at "http://fhir-server:8080" as defined by "http://hl7.org/fhir"
    # Package loading (FHIR Validator extension)
    And FHIRValidator is loaded with package "hl7.fhir.be.core#2.1.2"

  Scenario: showcase-001 Full language demonstration

    # ------------------------------------------------------------------
    # VARIABLES — set values inline and via docstring
    # ------------------------------------------------------------------
    Given set "profileUrl" to "https://www.ehealth.fgov.be/standards/fhir/core/StructureDefinition/be-patient"
    And set "expectedFamily" to "Dupont"
    And set "patientResource" to:
      """
      {"resourceType":"Patient","identifier":[{"system":"https://www.ehealth.fgov.be/standards/fhir/core/NamingSystem/ssin","value":"85031512345"}],"name":[{"family":"Dupont","given":["Marie"]}],"gender":"female","birthDate":"1985-03-15"}
      """

    # ------------------------------------------------------------------
    # EXTRACT — JSON pointer from a variable
    # ------------------------------------------------------------------
    Then extract "/resourceType" from "patientResource" as "resourceType"
    And "resourceType" should be "Patient"
    And extract "/name/0/family" from "patientResource" as "familyName"
    And "familyName" should be "Dupont"

    # ------------------------------------------------------------------
    # ASSERTIONS — using reserved names and variable assertions
    # ------------------------------------------------------------------
    And "familyName" should contain "Dupo"
    And "familyName" should not be empty

    # ------------------------------------------------------------------
    # VALIDATION — validate against a profile
    # ------------------------------------------------------------------
    When validate "patientResource" against "https://www.ehealth.fgov.be/standards/fhir/core/StructureDefinition/be-patient"
    Then the validation should pass
    And "validation errors" should be "0"
    And "validation severity" should not be empty

    # ------------------------------------------------------------------
    # VALIDATION with parameters
    # ------------------------------------------------------------------
    When validate "patientResource" against "https://www.ehealth.fgov.be/standards/fhir/core/StructureDefinition/be-patient" with best practice "Warning"
    Then "validation warnings" should not be empty

    # ------------------------------------------------------------------
    # FHIRPATH — evaluate, expect, extract as variable
    # ------------------------------------------------------------------
    When evaluate FHIRPath "Patient.name.family" on "patientResource" and expect "Dupont"
    And evaluate FHIRPath "Patient.identifier.where(system='https://www.ehealth.fgov.be/standards/fhir/core/NamingSystem/ssin').value" on "patientResource" as "ssinValue"
    Then "ssinValue" should be "85031512345"

    # ------------------------------------------------------------------
    # TEST DATA GENERATION — generate from profile with mappings
    # ------------------------------------------------------------------
    Given define mappings "patientMappings" with parts:
      | path                    | part   | expression                                                                      |
      | Patient.identifier:SSIN | system | 'https://www.ehealth.fgov.be/standards/fhir/core/NamingSystem/ssin'              |
      | Patient.identifier:SSIN | value  | column('ssin')                                                                   |
      | Patient.name            | family | column('family')                                                                 |
      | Patient.name            | given  | column('given')                                                                  |
      | Patient.gender          |        | column('gender')                                                                 |
      | Patient.birthDate       |        | column('birthDate')                                                              |
    And define data "patientData":
      | family  | given | gender | birthDate  | ssin        |
      | Janssen | Pieter| male   | 1990-07-20 | 90072012345 |
    When generate test data from profile "https://www.ehealth.fgov.be/standards/fhir/core/StructureDefinition/be-patient" as "generatedPatient"
    Then extract "/resourceType" from "generatedPatient" as "genType"
    And "genType" should be "Patient"

    # ------------------------------------------------------------------
    # MATCHETYPE — partial and exact comparison with wildcards
    # ------------------------------------------------------------------
    And partially match "patientResource" against:
      """
      {"resourceType":"Patient","name":[{"family":"$string$"}],"gender":"$choice:male|female|other|unknown$"}
      """
    And exactly match "patientResource" against:
      """
      {"resourceType":"Patient","identifier":[{"system":"https://www.ehealth.fgov.be/standards/fhir/core/NamingSystem/ssin","value":"85031512345"}],"name":[{"family":"Dupont","given":["Marie"]}],"gender":"female","birthDate":"1985-03-15"}
      """

    # ------------------------------------------------------------------
    # HTTP REQUESTS — POST to an actor, GET a URL
    # ------------------------------------------------------------------
    When User posts to FHIRServer at "/fhir/Patient" with:
      """
      {"resourceType":"Patient","name":[{"family":"TestPost"}]}
      """
    Then "response status" should be "201"
    And extract "/id" as "createdId"
    And "createdId" should not be empty

    When User gets "http://fhir-server:8080/fhir/Patient?family=TestPost" as "searchResult"
    Then "searchResult" should contain "TestPost"

    # ------------------------------------------------------------------
    # HTTP — PUT, DELETE, PATCH, custom headers
    # ------------------------------------------------------------------
    And set header "Authorization" to "Bearer test-token-123"
    When User puts to FHIRServer at "/fhir/Patient/$createdId" with:
      """
      {"resourceType":"Patient","id":"$createdId","name":[{"family":"Updated"}]}
      """
    Then "response status" should be "200"

    When User patches on FHIRServer at "/fhir/Patient/$createdId" with:
      """
      [{"op":"replace","path":"/name/0/family","value":"Patched"}]
      """
    Then "response status" should not be "404"

    When User deletes on FHIRServer at "/fhir/Patient/$createdId"
    Then "response status" should be "200"

    # ------------------------------------------------------------------
    # CONDITIONALS — single-line guard
    # ------------------------------------------------------------------
    And if "createdId" is not empty then "response status" should be "200"
    And if "validation errors" is "0" then "validation severity" should not be empty

    # ------------------------------------------------------------------
    # WAIT / RECEIVE — intercept a message from an actor
    # ------------------------------------------------------------------
    # (commented out — requires real ITB messaging setup)
    # When User waits for FHIRServer within 30 seconds
    # Then "response" should not be empty

    # ------------------------------------------------------------------
    # INTERACTION — inform and ask
    # ------------------------------------------------------------------
    And User is informed "All automated checks passed."
    And Monitor is informed "Please review the test results." with "patientResource"

    # ------------------------------------------------------------------
    # LOGGING
    # ------------------------------------------------------------------
    And log "Test scenario completed successfully"
