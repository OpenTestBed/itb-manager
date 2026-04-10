// src/validation/gitbValidator.ts
import { XMLValidator } from 'fast-xml-parser';
import { ValidationResult, ValidationError } from '../../types';

export class GITBValidator {
  private schemas: Map<string, string> = new Map();
  
  constructor() {
    // Initialize with empty schemas - will be loaded
  }

  /**
   * Load official GITB XSD files
   * Place the XSD files in public/schemas/ directory
   */
  async loadSchemas(): Promise<void> {
    try {
      // Load main testcase schema
      const testcaseXsd = await fetch('/schemas/gitb_tdl.xsd').then(r => r.text());
      this.schemas.set('testcase', testcaseXsd);

      // Load core schema if separate
      const coreXsd = await fetch('/schemas/gitb_core.xsd').then(r => r.text());
      this.schemas.set('core', coreXsd);

      // Load any additional schemas (gitb-tpl.xsd, etc.)
      const tplXsd = await fetch('/schemas/gitb_tpl.xsd').then(r => r.text());
      this.schemas.set('tpl', tplXsd);

    } catch (error) {
      console.error('Failed to load GITB schemas:', error);
      throw new Error('Could not load GITB validation schemas');
    }
  }

  /**
   * Validate XML against official GITB schemas
   */
  async validateXML(xmlContent: string): Promise<ValidationResult> {
    const errors: ValidationError[] = [];

    // First, check if XML is well-formed
    const wellFormedResult = XMLValidator.validate(xmlContent, {
      allowBooleanAttributes: true
    });

    if (wellFormedResult !== true) {
      return {
        valid: false,
        errors: [{
          message: wellFormedResult.err.msg,
          line: wellFormedResult.err.line,
          column: wellFormedResult.err.col,
          type: 'error'
        }]
      };
    }

    // For client-side XSD validation, we need a library like libxmljs
    // Since that's not available in browser, we'll do structural validation
    try {
      // Basic structural validation
      this.validateBasicStructure(xmlContent, errors);
      
      // Validate namespaces
      this.validateNamespaces(xmlContent, errors);
      
      // Check required attributes
      this.validateRequiredAttributes(xmlContent, errors);

    } catch (error) {
      errors.push({
        message: `Validation error: ${error.message}`,
        type: 'error'
      });
    }

    return {
      valid: errors.filter(e => e.type === 'error').length === 0,
      errors
    };
  }

  private validateBasicStructure(xmlContent: string, errors: ValidationError[]): void {
    const isTestSuite = xmlContent.includes('<testsuite') || xmlContent.includes('<gitb:testsuite');
    const isTestCase = xmlContent.includes('<testcase') || xmlContent.includes('<gitb:testcase');
    const isScriptlet = xmlContent.includes('<scriptlet') || xmlContent.includes('<gitb:scriptlet');

    if (!isTestSuite && !isTestCase && !isScriptlet) {
      errors.push({
        message: 'Missing root element <testcase>, <testsuite>, or <scriptlet>',
        type: 'error'
      });
    }

    // Scriptlets only require <steps> (and optionally <params>)
    if (isScriptlet) {
      if (!xmlContent.includes('<steps')) {
        errors.push({
          message: 'Missing required element <steps> in scriptlet',
          type: 'error'
        });
      }
      return;
    }

    // Both test suites and test cases require metadata and actors
    const requiredElements = ['metadata', 'actors'];
    // Only test cases require steps
    if (isTestCase && !isTestSuite) {
      requiredElements.push('steps');
    }

    for (const element of requiredElements) {
      if (!xmlContent.includes(`<gitb:${element}`) && !xmlContent.includes(`<${element}`)) {
        errors.push({
          message: `Missing required element <${element}>`,
          type: 'error'
        });
      }
    }
  }

  private validateNamespaces(xmlContent: string, errors: ValidationError[]): void {
    // Check for GITB namespace
    if (!xmlContent.includes('http://www.gitb.com/tdl/v1/')) {
      errors.push({
        message: 'Missing GITB namespace declaration (http://www.gitb.com/tdl/v1/)',
        type: 'warning'
      });
    }
  }

  private validateRequiredAttributes(xmlContent: string, errors: ValidationError[]): void {
    // Check testcase or testsuite has ID
    const rootMatch = xmlContent.match(/<(?:gitb:)?(?:testcase|testsuite|scriptlet)[^>]*>/);
    if (rootMatch && !rootMatch[0].includes('id=')) {
      const tag = rootMatch[0].includes('testsuite') ? 'testsuite' : 'testcase';
      errors.push({
        message: `Missing required attribute "id" on ${tag} element`,
        type: 'error'
      });
    }
  }
}


export async function validateTDL(xml: string)/*: Promise<ParseIssue[]>*/ {
  // TODO: plug your current XSD validation here.
  // For now return [];
  return [];
}

// src/validation/serverValidator.ts
/**
 * For full XSD validation, you'll need a server endpoint
 * This is a template for server-side validation
 */
export async function validateWithServer(xmlContent: string): Promise<ValidationResult> {
  try {
    const response = await fetch('/api/validate-gitb', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/xml',
      },
      body: xmlContent
    });

    if (!response.ok) {
      throw new Error('Validation service unavailable');
    }

    return await response.json();
  } catch (error) {
    return {
      valid: false,
      errors: [{
        message: 'Could not connect to validation service',
        type: 'error'
      }]
    };
  }
}

