Feature: VHL Integration – QR Code Validation Flow
  Validates a QR code, retrieves VHL content, and validates the FHIR Bundle.
  End-to-end test across ITI-YY3 (Generate VHL), ITI-YY4 (Provide VHL),
  and ITI-YY5 (Retrieve Manifest).

  Background:
    Given User is the system under test
    And HCertDecoder is available at "http://hcert-validator:8080"
    And VHLResponder is available at "http://hcert-validator:8080"
    And FHIRValidator is available at "http://fhir-server:8080/fhir"
    And SmartHelper is available at "http://smart-helper:8000"

  Scenario: tc-vhl-001 Full VHL verification pipeline
    # 1. Collect all user inputs upfront
    When User uploads a QR image to HCertDecoder
    Given User enters a PIN

    # 2. Decode QR image (multipart upload) and extract raw data
    And extract "/qr_data" as "rawQRData"

    # 3. Decode HC1 with raw QR data
    When User calls HCertDecoder at "/decode/hcert" with:
      """
      {"qr_data":"$rawQRData","include_raw":true}
      """
    And extract "/cose" as "coseVal"
    And extract "/payload" as "payloadVal"
    And extract "/hcert" as "hcertVal"
    And extract "/cose/_raw" as "coseRaw"

    # 4. Extract metadata
    When User calls HCertDecoder at "/extract/metadata" with:
      """
      {"cose":"$coseVal","payload":"$payloadVal"}
      """

    # 5. Verify COSE signature
    When User verifies COSE signature on HCertDecoder with:
      | parameter                  | value    |
      | use_gdhcn                  | true     |
      | gdhcn_env                  | dev      |
      | participant                | -        |
      | usage                      | DSC      |
      | verify_did_proof           | true     |
      | allow_unverified_trustlist | true     |
      | allow_remote_contexts      | true     |
      | context_dir                | contexts |
    And extract "/valid" as "sigValid"
    And "sigValid" should be "true"

    # 6. Extract reference (short-link URL)
    When User calls HCertDecoder at "/extract/reference" with:
      """
      {"hcert":"$hcertVal","payload":"$payloadVal"}
      """
    Then the response status should be "200"
    And extract "/url" as "shlinkUrl"

    # 7. Authorize short link with PIN
    When User authorizes SHL on VHLResponder with url and pin
    Then the response status should be "200"
    And extract "/manifest" as "manifestVal"

    # 8. Fetch FHIR via manifest
    When User fetches FHIR from VHLResponder with manifest
    Then the response status should be "200"
    And extract "/fhir/0/resource" as "firstResource"

    # 9. Load IG and validate
    When User loads IG "https://lacpass.racsel.org" on SmartHelper
    When User validates "firstResource" against "http://lacpass.racsel.org/StructureDefinition/lac-bundle" on FHIRValidator

