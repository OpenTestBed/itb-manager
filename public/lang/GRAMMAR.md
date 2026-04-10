# FHIR Gherkin Dialect -- Formal Grammar

EBNF-like grammar for the FHIR Gherkin Dialect core language and the FHIR Validator extension.

---

## Lexical Conventions

- Whitespace between tokens is normalized: multiple spaces collapse to a single space.
- Content inside double quotes (`"..."`) is preserved as-is, including internal whitespace.
- Steps are matched after stripping the Gherkin keyword (`Given`, `When`, `Then`, `And`, `But`).
- A trailing `:` indicates that a docstring or data table follows on subsequent lines.

## Terminals

```ebnf
Actor       = Letter , { Letter | Digit | "_" } ;
Variable    = ( Letter | "_" ) , { Letter | Digit | "_" } ;
Value       = '"' , { any-char - '"' } , '"' ;
URL         = '"' , ( "http://" | "https://" ) , { url-char } , '"' ;
Path        = '"' , { any-char - '"' } , '"' ;
JsonPointer = '"' , "/" , { any-char - '"' } , '"' ;
Number      = Digit , { Digit } ;
Package     = { any-char - '"' } ;
DocString   = '"""' , NEWLINE , { any-line } , '"""' ;
DataTable   = ( "|" , { CellValue , "|" } , NEWLINE )+ ;

Letter      = "A".."Z" | "a".."z" ;
Digit       = "0".."9" ;
```

---

## 1. Actors

```ebnf
actor-sut       = Actor , "is the system under test"
                  , [ ( "on" | "at" ) , URL ]
                  , [ "as defined by" , URL ] ;

actor-available = Actor , "is available"
                  , [ "as" , Value ]
                  , [ ( "on" | "at" ) , URL ]
                  , [ "as defined by" , URL ] ;
```

**Constraints:** `as "<name>"` is mutually exclusive with endpoint/canonical options.

## 2. HTTP Requests

```ebnf
http-post = Actor , "posts to" , Actor , "at" , Path , "with:" , DocString ;

http-get  = Actor , "gets" , Value , "as" , Value ;
```

## 3. Variables

```ebnf
set-value     = "set" , Value , "to" , Value ;

set-docstring = "set" , Value , "to:" , DocString ;

extract-from  = "extract" , JsonPointer , "from" , Value , "as" , Value ;

extract-last  = "extract" , JsonPointer , "as" , Value ;
```

## 4. Assertions

```ebnf
assert-equal    = Value , "should be" , Value ;

assert-contains = Value , "should contain" , Value ;

assert-notempty = Value , "should not be empty" ;
```

### Reserved Names

When `Value` in the left-hand position resolves to one of these strings, it maps to an internal variable:

```
"response status"      -> $lastRequest{response}{status}
"response"             -> $lastRequest{response}{body}
"validation errors"    -> $validationErrors
"validation warnings"  -> $validationWarnings
"validation outcome"   -> $validationOutcome
"validation severity"  -> $validationSeverity
```

All other values resolve via the `$<name>` variable lookup (`$$1` in the pattern).

## 5. Interaction

```ebnf
inform      = Actor , "is informed" , Value , [ "with" , Value ] ;

ask-input   = Actor , "is asked for" , Value , [ "with" , Value ] ;
```

## 6. Logging

```ebnf
log-step = "log" , Value ;
```

---

## FHIR Validator Extension

### Package Loading

```ebnf
load-package = Actor , "is loaded with package" , Value ;
```

### Validation

```ebnf
validate = "validate" , Value , "against" , Value
           , [ "with best practice" , Value
             | "with resource id" , Value ] ;

validation-pass = "the validation should pass" ;

validation-fail = "the validation should fail" ;
```

**Outputs:** `$validationOutcome`, `$validationErrors`, `$validationWarnings`, `$validationSeverity`.

### FHIRPath Evaluation

```ebnf
fhirpath-expect    = "evaluate FHIRPath" , Value
                     , [ "on" , Value ]
                     , "and expect" , Value ;

fhirpath-as        = "evaluate FHIRPath" , Value
                     , "on" , Value
                     , "as" , Value ;

fhirpath-exists    = "evaluate FHIRPath" , Value , "exists" ;

fhirpath-count     = "evaluate FHIRPath" , Value , "count is" , Number ;
```

**Note:** `fhirpath-expect` without `on` and `fhirpath-exists`/`fhirpath-count` operate on `$submitResult{payload}` (the last submitted resource).

### Matchetype Comparison

```ebnf
partial-match = "partially match" , Value , "against:" , DocString ;

exact-match   = "exactly match" , Value , "against:" , DocString ;

not-match     = Value , "should NOT match:" , DocString ;
```

### Test Data Generation

```ebnf
generate-data = "generate test data from profile" , Value
                , [ "as" , Value ] ;
```

**Output:** `$generatedResource` (default) or the named variable.

### Data/Mapping Definitions

```ebnf
define-mappings       = "define mappings" , Value , ":" , DataTable ;
                        (* table columns: path, expression *)

define-mappings-parts = "define mappings" , Value , "with parts:" , DataTable ;
                        (* table columns: path, part, expression *)

define-data           = "define data" , Value , ":" , DataTable ;
                        (* table columns: arbitrary *)
```
