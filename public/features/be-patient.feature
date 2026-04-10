Feature: Belgian Patient: IG load, test data generation, validation, match, and FHIRPath
  End-to-end test: load the Belgian Core IG into the FHIR Validator, generate a BePatient
  resource with SSIN and MRN identifiers, validate against the be-patient profile, verify
  structure with match, and extract identifiers via FHIRPath.

  Background:
    Given Client is the system under test
    And FHIRServer is available
    And FHIRValidator is available
    And FHIRValidator is loaded with package "hl7.fhir.be.core#2.1.2"

  Scenario: be-patient-001 Generate, validate, match, and FHIRPath

    # ------------------------------------------------------------------
    # Step 1: Generate a BePatient with SSIN + MRN identifiers
    # ------------------------------------------------------------------
    Given define mappings "patientMappings" with parts:
      | path                    | part   | expression                                                                      |
      | Patient.identifier:SSIN | system | 'https://www.ehealth.fgov.be/standards/fhir/core/NamingSystem/ssin'              |
      | Patient.identifier:SSIN | value  | column('ssin')                                                                   |
      | Patient.identifier      | system | 'https://www.example.be/fhir/NamingSystem/mrn'                                   |
      | Patient.identifier      | value  | column('mrn')                                                                    |
      | Patient.name            | family | column('family')                                                                 |
      | Patient.name            | given  | column('given')                                                                  |
      | Patient.gender          |        | column('gender')                                                                 |
      | Patient.birthDate       |        | column('birthDate')                                                              |
    And define data "patientData":
      | family  | given | gender | birthDate  | ssin        | mrn     |
      | Dupont  | Marie | female | 1985-03-15 | 85031512345 | MRN-001 |
    And generate test data from profile "https://www.ehealth.fgov.be/standards/fhir/core/StructureDefinition/be-patient" with mappings "patientMappings" and data "patientData"
    Then the generated resource type should be "Patient"

    # ------------------------------------------------------------------
    # Step 2: Validate generated patient against be-patient profile
    # ------------------------------------------------------------------
    And validate "generatedResource" against "https://www.ehealth.fgov.be/standards/fhir/core/StructureDefinition/be-patient"
    And the validation should pass

    # ------------------------------------------------------------------
    # Step 3: Validate a hand-crafted known-good patient
    # ------------------------------------------------------------------
    Given define resource "knownPatient" as:
      """
      {"resourceType":"Patient","identifier":[{"system":"https://www.ehealth.fgov.be/standards/fhir/core/NamingSystem/ssin","value":"85031512345"},{"system":"https://www.example.be/fhir/NamingSystem/mrn","value":"MRN-001"}],"name":[{"family":"Dupont","given":["Marie"]}],"gender":"female","birthDate":"1985-03-15"}
      """
    And validate "knownPatient" against "https://www.ehealth.fgov.be/standards/fhir/core/StructureDefinition/be-patient"
    And the validation should pass

    # ------------------------------------------------------------------
    # Step 4: Partial match - structure check with wildcards
    #   Verifies identifiers, name, gender, birthDate using wildcards
    # ------------------------------------------------------------------
    And partially match "knownPatient" against:
      """
      {"resourceType":"Patient","extension":[{"url":"http://hl7.org/fhir/tools/StructureDefinition/matchetype","valueString":"partial"}],"identifier":[{"system":"https://www.ehealth.fgov.be/standards/fhir/core/NamingSystem/ssin","value":"$string$"},{"system":"https://www.example.be/fhir/NamingSystem/mrn","value":"$string$"}],"name":[{"family":"$string$","given":["$string$"]}],"gender":"$choice:male|female|other|unknown$","birthDate":"$date$"}
      """

    # ------------------------------------------------------------------
    # Step 5: Exact match - identifier and name values
    # ------------------------------------------------------------------
    And exactly match "knownPatient" against:
      """
      {"resourceType":"Patient","extension":[{"url":"http://hl7.org/fhir/tools/StructureDefinition/matchetype","valueString":"partial"}],"identifier":[{"system":"https://www.ehealth.fgov.be/standards/fhir/core/NamingSystem/ssin","value":"85031512345"},{"system":"https://www.example.be/fhir/NamingSystem/mrn","value":"MRN-001"}],"name":[{"family":"Dupont","given":["Marie"]}],"gender":"female"}
      """

    # ------------------------------------------------------------------
    # Step 6: Mismatch - deliberately wrong name (expect mismatch)
    # ------------------------------------------------------------------
    And "knownPatient" should NOT match:
      """
      {"resourceType":"Patient","extension":[{"url":"http://hl7.org/fhir/tools/StructureDefinition/matchetype","valueString":"partial"}],"name":[{"family":"WrongName","given":["WrongGiven"]}]}
      """

    # ------------------------------------------------------------------
    # Step 7: FHIRPath - extract SSIN identifier
    # ------------------------------------------------------------------
    And evaluate FHIRPath "Patient.identifier.where(system='https://www.ehealth.fgov.be/standards/fhir/core/NamingSystem/ssin').value" on "knownPatient" and expect "85031512345"

    # ------------------------------------------------------------------
    # Step 8: FHIRPath - extract MRN identifier
    # ------------------------------------------------------------------
    And evaluate FHIRPath "Patient.identifier.where(system='https://www.example.be/fhir/NamingSystem/mrn').value" on "knownPatient" and expect "MRN-001"
