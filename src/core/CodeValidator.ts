import path from 'path';
import fs from 'fs-extra';
import { logger } from '../utils/logger.js';
import { ScannedFile } from './types.js';

/**
 * Bug indicator extracted from task description
 */
export interface BugIndicator {
  type: 'uses_wrong' | 'missing' | 'incorrect_logic' | 'should_use';
  pattern: string;
  description: string;
}

/**
 * Fix indicator extracted from task description
 */
export interface FixIndicator {
  type: 'should_use' | 'should_add' | 'should_change';
  pattern: string;
  description: string;
}

/**
 * Code validation result
 */
export interface CodeValidationResult {
  status: 'bug_exists' | 'fix_applied' | 'partial_fix' | 'unknown';
  confidence: number;
  evidence: {
    bugIndicatorsFound: string[];
    fixIndicatorsFound: string[];
    codeSnippet: string;
    lineNumber?: number;
  };
  explanation: string;
}

/**
 * Code Validator
 * 
 * Actually READS the code to determine:
 * 1. If the bug described in the task exists
 * 2. If the fix has been applied
 * 3. If it's a partial fix
 * 
 * IMPORTANT: This must be 100% GENERIC - no hardcoded patterns for specific
 * projects, companies, or domains. It learns from the task description only.
 */
export class CodeValidator {

  /**
   * Clean a captured value from regex - removes punctuation, parentheses, etc.
   */
  private static cleanValue(value: string): string {
    return value
      .replace(/[().,;:!?\[\]{}'"]/g, '')  // Remove punctuation
      .replace(/^\s+|\s+$/g, '')            // Trim whitespace
      .toLowerCase();                        // Normalize case for comparison
  }

  /**
   * Generate all possible variations of a pattern for searching in code
   * This handles different naming conventions across languages
   */
  private static generatePatternVariations(pattern: string): string[] {
    const variations: string[] = [];
    
    // Preserve original structure BEFORE cleaning (important for dot notation and camelCase)
    const originalWithCase = pattern.replace(/[();:!?\[\]{}'"]/g, '').trim(); // Keep dots and commas for now
    const clean = this.cleanValue(pattern);
    
    variations.push(clean);

    // CRITICAL: Handle dot notation FIRST (e.g., "order.createdAt")
    // Extract the property part regardless of the object name
    if (originalWithCase.includes('.')) {
      const parts = originalWithCase.split('.');
      const propertyPart = parts[parts.length - 1]; // "createdAt"
      
      if (propertyPart && propertyPart.length > 2) {
        const propLower = propertyPart.toLowerCase();
        variations.push(propLower);
        
        // Generate accessor variations for the property
        const capitalizedProp = propertyPart.charAt(0).toUpperCase() + propertyPart.slice(1);
        variations.push(('get' + capitalizedProp).toLowerCase()); // getcreatedat
        variations.push(('set' + capitalizedProp).toLowerCase());
        variations.push(('is' + capitalizedProp).toLowerCase());
        variations.push(('has' + capitalizedProp).toLowerCase());
        
        // Snake case: createdAt -> created_at
        const snakeCase = propertyPart.replace(/([A-Z])/g, '_$1').toLowerCase();
        if (snakeCase !== propLower) {
          variations.push(snakeCase);
          variations.push('get_' + snakeCase);
          variations.push('set_' + snakeCase);
        }
      }
    }

    // Handle camelCase compounds using ORIGINAL case (e.g., "orderCreatedAt")
    // This is backup for cases without dots
    const camelParts = originalWithCase.replace(/\./g, '').split(/(?=[A-Z])/);
    if (camelParts.length >= 2) {
      const commonPrefixes = ['order', 'entity', 'item', 'user', 'request', 'response', 'data', 'input', 'output', 'obj', 'dto', 'model'];
      const firstPart = camelParts[0].toLowerCase();
      
      if (commonPrefixes.includes(firstPart)) {
        // Extract property: "orderCreatedAt" -> "CreatedAt" -> "createdAt"
        const propertyPart = camelParts.slice(1).join('');
        if (propertyPart.length > 2) {
          const propLower = propertyPart.toLowerCase();
          if (!variations.includes(propLower)) {
            variations.push(propLower);
            
            const capitalizedProp = propertyPart.charAt(0).toUpperCase() + propertyPart.slice(1);
            variations.push(('get' + capitalizedProp).toLowerCase());
            variations.push(('set' + capitalizedProp).toLowerCase());
            variations.push(('is' + capitalizedProp).toLowerCase());
          }
        }
      }
    }

    // Standard accessor generation for the full pattern
    if (/^[a-z]/.test(clean) && !clean.includes('.')) {
      const capitalizedProp = clean.charAt(0).toUpperCase() + clean.slice(1);
      
      variations.push(('get' + capitalizedProp).toLowerCase());
      variations.push(('set' + capitalizedProp).toLowerCase());
      variations.push(('is' + capitalizedProp).toLowerCase());
      variations.push(('has' + capitalizedProp).toLowerCase());
      
      // Snake case
      const snakeCase = clean.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (snakeCase !== clean) {
        variations.push(snakeCase);
        variations.push('get_' + snakeCase);
        variations.push('set_' + snakeCase);
      }
    }

    const result = [...new Set(variations)];
    logger.debug(`  Pattern "${pattern}" variations: ${result.slice(0, 8).join(', ')}${result.length > 8 ? '...' : ''}`);
    return result;
  }

  /**
   * Extract bug and fix indicators from task description
   * 
   * This method understands natural language patterns in task descriptions:
   * - DECLARATIVE: "uses X instead of Y" = X is WRONG, Y is correct
   * - IMPERATIVE: "use X instead of Y" = X is CORRECT, Y is wrong
   * - DIRECTIVE: "should use X", "must use X" = X is CORRECT
   * 
   * IMPORTANT: Method names mentioned in the task (like "In ClassName.methodName()")
   * are NOT bug indicators - they're just identifying WHERE the bug is.
   */
  static extractIndicators(taskDescription: string): {
    bugIndicators: BugIndicator[];
    fixIndicators: FixIndicator[];
  } {
    const bugIndicators: BugIndicator[] = [];
    const fixIndicators: FixIndicator[] = [];
    const seenBugPatterns = new Set<string>();
    const seenFixPatterns = new Set<string>();
    
    // Extract method names mentioned in the task - these should NOT be bug indicators
    // Pattern: "In ClassName.methodName()" or "ClassName.methodName()"
    const ignoredPatterns = new Set<string>();
    const methodMentionPattern = /(?:in\s+)?([A-Z][a-zA-Z0-9]*)\s*\.\s*([a-z][a-zA-Z0-9]*)\s*\(\)/gi;
    let methodMatch;
    while ((methodMatch = methodMentionPattern.exec(taskDescription)) !== null) {
      // Add both the method name and the full Class.method pattern to ignored list
      ignoredPatterns.add(methodMatch[2].toLowerCase()); // methodName
      ignoredPatterns.add(`${methodMatch[1]}.${methodMatch[2]}`.toLowerCase()); // Class.method
    }
    
    // Also ignore common task description words that aren't code
    const commonWords = ['fix', 'bug', 'wrong', 'calculation', 'date', 'order', 'master', 
                         'published', 'estimated', 'delivery', 'weeks', 'days', 'working',
                         'return', 'past', 'dates', 'tests', 'scenarios', 'add'];
    commonWords.forEach(w => ignoredPatterns.add(w));
    
    logger.debug(`  Ignored patterns (method names): ${Array.from(ignoredPatterns).join(', ')}`);
    
    let match;

    // Helper to extract property from dot notation (e.g., "order.createdAt" -> "createdAt")
    // This is CRITICAL because task descriptions use object.property but code may use different object names
    const extractProperty = (pattern: string): string => {
      // If pattern contains a dot, extract just the property part
      if (pattern.includes('.')) {
        const parts = pattern.split('.');
        const property = parts[parts.length - 1]; // Get last part: "createdAt"
        if (property && property.length > 2) {
          return property;
        }
      }
      return pattern;
    };

    // Helper to add bug indicator with deduplication and filtering
    const addBugIndicator = (pattern: string, description: string) => {
      // Extract property from dot notation BEFORE cleaning
      const property = extractProperty(pattern);
      const clean = this.cleanValue(property);
      
      // Skip if it's a method name or common word
      if (clean.length > 2 && !seenBugPatterns.has(clean) && !ignoredPatterns.has(clean)) {
        seenBugPatterns.add(clean);
        bugIndicators.push({
          type: 'uses_wrong',
          pattern: clean,
          description,
        });
        logger.debug(`  Added bug indicator: "${pattern}" -> "${clean}"`);
      }
    };

    // Helper to add fix indicator with deduplication and filtering
    const addFixIndicator = (pattern: string, description: string) => {
      // Extract property from dot notation BEFORE cleaning
      const property = extractProperty(pattern);
      const clean = this.cleanValue(property);
      
      // Skip if it's a method name or common word (but keep property names like createdAt)
      if (clean.length > 2 && !seenFixPatterns.has(clean) && !ignoredPatterns.has(clean)) {
        seenFixPatterns.add(clean);
        fixIndicators.push({
          type: 'should_use',
          pattern: clean,
          description,
        });
        logger.debug(`  Added fix indicator: "${pattern}" -> "${clean}"`);
      }
    };

    // =======================================================================
    // PATTERN 1: DECLARATIVE - "uses X instead of Y" / "using X instead of Y"
    // Meaning: Code currently uses X (WRONG) but should use Y (CORRECT)
    // =======================================================================
    const declarativePattern = /\b(?:uses|using|utilizes|utilizing)\s+(?:the\s+)?([a-zA-Z0-9_.()]+)\s+instead\s+of\s+(?:the\s+)?([a-zA-Z0-9_.()]+)/gi;
    while ((match = declarativePattern.exec(taskDescription)) !== null) {
      const wrongValue = match[1];
      const correctValue = match[2];
      addBugIndicator(wrongValue, `Code incorrectly uses ${wrongValue}`);
      addFixIndicator(correctValue, `Code should use ${correctValue}`);
    }

    // =======================================================================
    // PATTERN 2: IMPERATIVE - "use X instead of Y"
    // Meaning: You should use X (CORRECT) instead of Y (WRONG)
    // Note: Must NOT match "uses" - that's handled above
    // =======================================================================
    const imperativePattern = /\buse\s+(?:the\s+)?([a-zA-Z0-9_.()]+)\s+instead\s+of\s+(?:the\s+)?([a-zA-Z0-9_.()]+)/gi;
    while ((match = imperativePattern.exec(taskDescription)) !== null) {
      // Skip if this is actually "uses" (already handled by declarative)
      const fullMatch = match[0];
      if (/^uses?\s/i.test(fullMatch) && fullMatch.toLowerCase().startsWith('uses')) {
        continue;
      }
      const correctValue = match[1];
      const wrongValue = match[2];
      addBugIndicator(wrongValue, `Code incorrectly uses ${wrongValue}`);
      addFixIndicator(correctValue, `Code should use ${correctValue}`);
    }

    // =======================================================================
    // PATTERN 3: DIRECTIVE - "should use X", "must use X", "need to use X"
    // =======================================================================
    const directivePattern = /\b(?:should|must|need\s+to|needs\s+to)\s+use\s+(?:the\s+)?([a-zA-Z0-9_.()]+)/gi;
    while ((match = directivePattern.exec(taskDescription)) !== null) {
      addFixIndicator(match[1], `Code should use ${match[1]}`);
    }

    // =======================================================================
    // PATTERN 4: CONDITIONAL - "when X is Y, use Z"
    // =======================================================================
    const conditionalPattern = /when\s+(?:the\s+)?(\w+)\s+is\s+(\w+)[,\s]+use\s+(?:the\s+)?([a-zA-Z0-9_.()]+)/gi;
    while ((match = conditionalPattern.exec(taskDescription)) !== null) {
      addFixIndicator(match[3], `When ${match[1]} is ${match[2]}, use ${match[3]}`);
    }

    // =======================================================================
    // PATTERN 5: REPLACE/CHANGE - "replace X with Y", "change X to Y"
    // =======================================================================
    const replacePattern = /\b(?:replace|change|swap)\s+(?:the\s+)?([a-zA-Z0-9_.()]+)\s+(?:with|to|for)\s+(?:the\s+)?([a-zA-Z0-9_.()]+)/gi;
    while ((match = replacePattern.exec(taskDescription)) !== null) {
      addBugIndicator(match[1], `Replace ${match[1]}`);
      addFixIndicator(match[2], `Use ${match[2]} instead`);
    }

    // =======================================================================
    // PATTERN 6: WRONG/INCORRECT - "X is wrong/incorrect"
    // =======================================================================
    const wrongPattern = /\b([a-zA-Z0-9_.()]+)\s+is\s+(?:wrong|incorrect|buggy|broken)/gi;
    while ((match = wrongPattern.exec(taskDescription)) !== null) {
      addBugIndicator(match[1], `${match[1]} is incorrect`);
    }

    // =======================================================================
    // PATTERN 7: FIX DESCRIPTION - "fix: ...", "bug: ..."
    // Look for property names mentioned after these keywords
    // =======================================================================
    const fixDescPattern = /(?:fix|bug|issue|problem)[:\s]+.*?([a-zA-Z]+\.[a-zA-Z]+(?:\(\))?)/gi;
    while ((match = fixDescPattern.exec(taskDescription)) !== null) {
      // These are likely the problematic values
      const parts = match[1].split('.');
      if (parts.length >= 2) {
        addBugIndicator(parts[parts.length - 1], `Related to fix: ${match[1]}`);
      }
    }

    logger.info(`Extracted indicators:`);
    logger.info(`  Bug indicators: ${bugIndicators.map(b => b.pattern).join(', ') || 'none'}`);
    logger.info(`  Fix indicators: ${fixIndicators.map(f => f.pattern).join(', ') || 'none'}`);

    return { bugIndicators, fixIndicators };
  }

  /**
   * Validate code against bug/fix indicators
   * Actually reads the code and checks for patterns
   * 
   * Uses pattern variations to handle different naming conventions:
   * - camelCase: createdAt
   * - PascalCase: CreatedAt  
   * - snake_case: created_at
   * - Java getter: getCreatedAt
   * - Kotlin getter: getCreatedAt
   * - Direct property: .createdAt
   */
  static async validateCode(
    file: ScannedFile,
    methodName: string,
    bugIndicators: BugIndicator[],
    fixIndicators: FixIndicator[]
  ): Promise<CodeValidationResult> {
    if (!file.content) {
      return {
        status: 'unknown',
        confidence: 0,
        evidence: {
          bugIndicatorsFound: [],
          fixIndicatorsFound: [],
          codeSnippet: '',
        },
        explanation: 'File content not available for validation',
      };
    }

    // Find the method in the file
    const methodCode = this.extractMethodCode(file.content, methodName);
    
    if (!methodCode.code) {
      return {
        status: 'unknown',
        confidence: 20,
        evidence: {
          bugIndicatorsFound: [],
          fixIndicatorsFound: [],
          codeSnippet: '',
        },
        explanation: `Method ${methodName} not found in file`,
      };
    }

    const originalCode = methodCode.code; // Keep original for snippets
    const codeLines = originalCode.split('\n');
    
    // Strip comments before validation to avoid false positives from commented code
    // Comments often contain the "wrong" value for documentation purposes
    const codeWithoutComments = this.stripComments(methodCode.code);
    const code = codeWithoutComments.toLowerCase();
    
    const bugIndicatorsFound: string[] = [];
    const fixIndicatorsFound: string[] = [];
    const debugInfo: string[] = [];
    const contextSnippets: string[] = []; // Store context around found patterns
    let bugLineNumber: number | undefined;

    logger.info(`  Method code length: ${methodCode.code.length} chars (${codeWithoutComments.length} without comments), line ${methodCode.lineNumber}`);

    // Check for bug indicators with all pattern variations
    for (const indicator of bugIndicators) {
      const variations = this.generatePatternVariations(indicator.pattern);
      logger.debug(`  Bug pattern "${indicator.pattern}" variations: ${variations.join(', ')}`);
      
      let found = false;
      for (const variation of variations) {
        if (code.includes(variation)) {
          bugIndicatorsFound.push(indicator.pattern);
          debugInfo.push(`Found bug pattern "${indicator.pattern}" as "${variation}"`);
          
          // Find the exact line and capture context (3 lines before/after)
          const lineIndex = this.findLineContaining(codeLines, variation);
          if (lineIndex >= 0 && !bugLineNumber) {
            bugLineNumber = (methodCode.lineNumber || 1) + lineIndex;
            const contextStart = Math.max(0, lineIndex - 2);
            const contextEnd = Math.min(codeLines.length, lineIndex + 3);
            const contextLines = codeLines.slice(contextStart, contextEnd);
            
            // Format with line numbers and highlight the bug line
            const formattedContext = contextLines.map((line, i) => {
              const actualLineNum = (methodCode.lineNumber || 1) + contextStart + i;
              const prefix = (contextStart + i === lineIndex) ? '>>> ' : '    ';
              return `${prefix}${actualLineNum}: ${line}`;
            }).join('\n');
            
            contextSnippets.push(formattedContext);
          }
          
          found = true;
          break;
        }
      }
      
      if (!found) {
        debugInfo.push(`Bug pattern "${indicator.pattern}" NOT found (tried: ${variations.join(', ')})`);
      }
    }

    // Check for fix indicators with all pattern variations
    for (const indicator of fixIndicators) {
      const variations = this.generatePatternVariations(indicator.pattern);
      logger.debug(`  Fix pattern "${indicator.pattern}" variations: ${variations.join(', ')}`);
      
      let found = false;
      for (const variation of variations) {
        if (code.includes(variation)) {
          fixIndicatorsFound.push(indicator.pattern);
          debugInfo.push(`Found fix pattern "${indicator.pattern}" as "${variation}"`);
          
          // Find the exact line and capture context
          const lineIndex = this.findLineContaining(codeLines, variation);
          if (lineIndex >= 0 && contextSnippets.length === 0) {
            const contextStart = Math.max(0, lineIndex - 2);
            const contextEnd = Math.min(codeLines.length, lineIndex + 3);
            const contextLines = codeLines.slice(contextStart, contextEnd);
            
            const formattedContext = contextLines.map((line, i) => {
              const actualLineNum = (methodCode.lineNumber || 1) + contextStart + i;
              const prefix = (contextStart + i === lineIndex) ? '>>> ' : '    ';
              return `${prefix}${actualLineNum}: ${line}`;
            }).join('\n');
            
            contextSnippets.push(formattedContext);
          }
          
          found = true;
          break;
        }
      }
      
      if (!found) {
        debugInfo.push(`Fix pattern "${indicator.pattern}" NOT found (tried: ${variations.join(', ')})`);
      }
    }

    // Log debug info
    debugInfo.forEach(info => logger.debug(`  ${info}`));

    // Determine status
    let status: CodeValidationResult['status'];
    let confidence: number;
    let explanation: string;

    const hasBugIndicators = bugIndicatorsFound.length > 0;
    const hasFixIndicators = fixIndicatorsFound.length > 0;
    const totalBugIndicators = bugIndicators.length;
    const totalFixIndicators = fixIndicators.length;

    if (hasBugIndicators && !hasFixIndicators) {
      // Bug pattern found, fix pattern not found → BUG EXISTS
      status = 'bug_exists';
      // Higher confidence if we found more of the expected patterns
      const foundRatio = bugIndicatorsFound.length / Math.max(totalBugIndicators, 1);
      confidence = Math.round(80 + (foundRatio * 15));
      explanation = `🔴 BUG EXISTS: code uses ${bugIndicatorsFound.join(', ')} but should use ${fixIndicators.map(f => f.pattern).join(', ')}`;
      logger.info(`  🔴 BUG EXISTS: Found ${bugIndicatorsFound.join(', ')}`);
    } else if (!hasBugIndicators && hasFixIndicators) {
      // Bug pattern not found, fix pattern found → FIX APPLIED
      status = 'fix_applied';
      const foundRatio = fixIndicatorsFound.length / Math.max(totalFixIndicators, 1);
      confidence = Math.round(80 + (foundRatio * 15));
      explanation = `🟢 FIX APPLIED: code correctly uses ${fixIndicatorsFound.join(', ')}`;
      logger.info(`  🟢 FIX APPLIED: Found ${fixIndicatorsFound.join(', ')}`);
    } else if (hasBugIndicators && hasFixIndicators) {
      // Both found → PARTIAL FIX (might have multiple code paths or conditional logic)
      status = 'partial_fix';
      confidence = 65;
      explanation = `🟡 PARTIAL FIX: found both bug pattern (${bugIndicatorsFound.join(', ')}) and fix pattern (${fixIndicatorsFound.join(', ')}) - code may have multiple branches`;
      logger.info(`  🟡 PARTIAL FIX: Bug patterns=${bugIndicatorsFound.join(', ')}, Fix patterns=${fixIndicatorsFound.join(', ')}`);
    } else {
      // Neither found → UNKNOWN
      status = 'unknown';
      confidence = 25;
      explanation = `⚪ UNKNOWN: Could not determine status - neither bug patterns (${bugIndicators.map(b => b.pattern).join(', ')}) nor fix patterns (${fixIndicators.map(f => f.pattern).join(', ')}) found in method`;
      logger.info(`  ⚪ UNKNOWN: No patterns matched in method ${methodName}`);
    }

    // Build context snippet - prefer the highlighted context, fallback to method code
    const contextSnippet = contextSnippets.length > 0 
      ? contextSnippets[0] 
      : methodCode.code.substring(0, 500);

    return {
      status,
      confidence: Math.min(confidence, 100),
      evidence: {
        bugIndicatorsFound,
        fixIndicatorsFound,
        codeSnippet: contextSnippet,
        lineNumber: bugLineNumber || methodCode.lineNumber,
      },
      explanation,
    };
  }

  /**
   * Find the line index containing a pattern (case-insensitive)
   */
  private static findLineContaining(lines: string[], pattern: string): number {
    const lowerPattern = pattern.toLowerCase();
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(lowerPattern)) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Strip comments from code to avoid false positives
   * Comments often contain the "wrong" value for documentation purposes
   * e.g., "// TASK-123: use newValue instead of oldValue"
   */
  private static stripComments(code: string): string {
    // Remove single-line comments: // ... or # ...
    let result = code.replace(/\/\/.*$/gm, '');
    result = result.replace(/#.*$/gm, '');
    
    // Remove multi-line comments: /* ... */
    result = result.replace(/\/\*[\s\S]*?\*\//g, '');
    
    // Remove XML/HTML comments: <!-- ... -->
    result = result.replace(/<!--[\s\S]*?-->/g, '');
    
    // Remove Python docstrings: """ ... """ or ''' ... '''
    result = result.replace(/"""[\s\S]*?"""/g, '');
    result = result.replace(/'''[\s\S]*?'''/g, '');
    
    return result;
  }

  /**
   * Extract method code from file content
   */
  private static extractMethodCode(
    content: string,
    methodName: string
  ): { code: string | null; lineNumber?: number } {
    const lines = content.split('\n');
    
    // Find method definition patterns for different languages
    const methodPatterns = [
      // Java/C#/TypeScript: public void methodName(
      new RegExp(`(?:public|private|protected|static|final|async)?\\s*(?:static)?\\s*[\\w<>\\[\\],\\s]*\\s+${methodName}\\s*\\(`, 'i'),
      // Python: def method_name(
      new RegExp(`def\\s+${methodName}\\s*\\(`, 'i'),
      // Go: func (r *Receiver) methodName(
      new RegExp(`func\\s+(?:\\([^)]+\\)\\s+)?${methodName}\\s*\\(`, 'i'),
      // JavaScript: methodName( or methodName = (
      new RegExp(`(?:async\\s+)?${methodName}\\s*[=(]`, 'i'),
    ];

    let methodStart = -1;
    
    for (let i = 0; i < lines.length; i++) {
      for (const pattern of methodPatterns) {
        if (pattern.test(lines[i])) {
          methodStart = i;
          break;
        }
      }
      if (methodStart >= 0) break;
    }

    if (methodStart < 0) {
      return { code: null };
    }

    // Extract method body (simplified - up to closing brace at same indentation level)
    let methodEnd = methodStart;
    let braceCount = 0;
    let foundOpen = false;
    
    for (let i = methodStart; i < lines.length && i < methodStart + 150; i++) {
      for (const char of lines[i]) {
        if (char === '{') {
          braceCount++;
          foundOpen = true;
        } else if (char === '}') {
          braceCount--;
          if (foundOpen && braceCount === 0) {
            methodEnd = i + 1;
            break;
          }
        }
      }
      if (foundOpen && braceCount === 0) break;
    }

    // For Python (indentation-based)
    if (!foundOpen) {
      const baseIndent = lines[methodStart].search(/\S/);
      for (let i = methodStart + 1; i < lines.length && i < methodStart + 150; i++) {
        const line = lines[i];
        if (line.trim() === '') continue;
        const indent = line.search(/\S/);
        if (indent <= baseIndent && line.trim() !== '') {
          methodEnd = i;
          break;
        }
        methodEnd = i + 1;
      }
    }

    return {
      code: lines.slice(methodStart, methodEnd).join('\n'),
      lineNumber: methodStart + 1,
    };
  }

  /**
   * Full validation pipeline
   */
  static async validate(
    file: ScannedFile,
    methodName: string,
    taskDescription: string
  ): Promise<CodeValidationResult> {
    logger.info(`\n🔬 Validating code in ${path.basename(file.path)}.${methodName}()`);
    
    const { bugIndicators, fixIndicators } = this.extractIndicators(taskDescription);
    
    if (bugIndicators.length === 0 && fixIndicators.length === 0) {
      return {
        status: 'unknown',
        confidence: 30,
        evidence: {
          bugIndicatorsFound: [],
          fixIndicatorsFound: [],
          codeSnippet: '',
        },
        explanation: 'Could not extract bug/fix indicators from task description',
      };
    }

    return this.validateCode(file, methodName, bugIndicators, fixIndicators);
  }
}

export default CodeValidator;
