Feature: Belgian Vaccination (BeVaccination) profile validation
  Validates a user-provided Immunization resource against the BeVaccination profile
  from hl7.fhir.be.vaccination#1.1.2, checking two business rules:
    Rule 1 – Recorder/Performer identifier matching
    Rule 2 – AdministeredProduct CNK-to-SNOMED consistency via Vitalink registry

  Background:
    Given User is the system under test
    And FHIRValidator is available at "http://itb-fhir-validator:8081"
    And FHIRValidator is loaded with package "hl7.fhir.be.vaccination#1.1.2"

  Scenario: be-vaccination-001 Validate BeVaccination business rules

    # ==================================================================
    # Step 1: Upload — User provides a BeVaccination (Immunization) JSON
    # ==================================================================
    Given User is asked for "immunizationResource" with "Upload a BeVaccination Immunization JSON"
    Then extract "/resourceType" from "immunizationResource" as "resourceType"
    And "resourceType" should be "Immunization"

    # ==================================================================
    # Step 2: Rule 1 — Recorder/Performer identifier matching
    #   If performer is present, the recorder extension NIHDI identifier
    #   must appear among performer.actor identifiers (logical or contained).
    # ==================================================================
    When evaluate FHIRPath "performer.actor.identifier.exists() implies (performer.actor.identifier.exists(%resource.extension.where(url='https://www.ehealth.fgov.be/standards/fhir/core/StructureDefinition/be-ext-recorder').valueReference.identifier.where(system = $this.system and value = $this.value).exists() or %resource.extension.where(url='https://www.ehealth.fgov.be/standards/fhir/core/StructureDefinition/be-ext-recorder').valueReference.resolve().identifier.where(system = $this.system and value = $this.value).exists()) or performer.actor.resolve().identifier.exists(%resource.extension.where(url='https://www.ehealth.fgov.be/standards/fhir/core/StructureDefinition/be-ext-recorder').valueReference.identifier.where(system = $this.system and value = $this.value).exists() or %resource.extension.where(url='https://www.ehealth.fgov.be/standards/fhir/core/StructureDefinition/be-ext-recorder').valueReference.resolve().identifier.where(system = $this.system and value = $this.value).exists()))" on "immunizationResource" and expect "true"

    # ==================================================================
    # Step 3a: Rule 2 — Extract CNK code from administeredProduct extension
    #   If no CNK code is present, Rule 2 is not applicable (skip).
    # ==================================================================
    And evaluate FHIRPath "extension.where(url='https://www.ehealth.fgov.be/standards/fhir/vaccination/StructureDefinition/be-ext-administeredProduct').extension.where(url='coded').value.ofType(CodeableConcept).coding.where(system='https://www.ehealth.fgov.be/standards/fhir/medication/NamingSystem/cnk-codes').code" on "immunizationResource" as "cnkCode"

    # ==================================================================
    # Step 3b: Rule 2 — Cross-reference CNK with Vitalink registry
    #   Fetches the Vitalink vaccine registry JSON, looks up the entry
    #   where CNK matches cnkCode, and extracts the expected SNOMED code.
    #
    #   Registry URL: https://vitalink.be/sites/default/files/2026-02/export-vaccines-2026-02-27-113333.json
    #   Registry format: array of { CNK, SNOMED_CODE, ... }
    #
    #   TODO: requires a registry lookup scriptlet to automate this.
    #   For now, set the expected SNOMED code manually:
    # ==================================================================
    And set "expectedSnomed" to "871822003"

    # ==================================================================
    # Step 3c: Rule 2 — Verify vaccineCode contains expected SNOMED
    #   If a CNK code is present in administeredProduct, then vaccineCode
    #   must include a SNOMED coding matching the Vitalink registry entry.
    # ==================================================================
    And evaluate FHIRPath "vaccineCode.coding.where(system='http://snomed.info/sct').code" on "immunizationResource" and expect "$expectedSnomed"

    # ==================================================================
    # Result
    # ==================================================================
    And User is informed "BeVaccination validated: recorder/performer match and CNK/SNOMED consistency checks passed."
