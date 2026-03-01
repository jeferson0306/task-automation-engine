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
 */
export class CodeValidator {

  /**
   * Extract bug and fix indicators from task description
   */
  static extractIndicators(taskDescription: string): {
    bugIndicators: BugIndicator[];
    fixIndicators: FixIndicator[];
  } {
    const bugIndicators: BugIndicator[] = [];
    const fixIndicators: FixIndicator[] = [];

    // Pattern: "uses X instead of Y" or "using X instead of Y"
    const usesInsteadPattern = /uses?\s+(?:the\s+)?([a-zA-Z.()_]+)\s+instead\s+of\s+(?:the\s+)?([a-zA-Z.()_]+)/gi;
    let match;
    while ((match = usesInsteadPattern.exec(taskDescription)) !== null) {
      const wrongValue = match[1].replace(/[()]/g, '');
      const correctValue = match[2].replace(/[()]/g, '');
      
      bugIndicators.push({
        type: 'uses_wrong',
        pattern: wrongValue,
        description: `Code incorrectly uses ${wrongValue}`,
      });
      
      fixIndicators.push({
        type: 'should_use',
        pattern: correctValue,
        description: `Code should use ${correctValue}`,
      });
    }

    // Pattern: "use X instead of Y"
    const useInsteadPattern = /use\s+([a-zA-Z.()_]+)\s+instead\s+of\s+([a-zA-Z.()_]+)/gi;
    while ((match = useInsteadPattern.exec(taskDescription)) !== null) {
      const correctValue = match[1].replace(/[()]/g, '');
      const wrongValue = match[2].replace(/[()]/g, '');
      
      bugIndicators.push({
        type: 'uses_wrong',
        pattern: wrongValue,
        description: `Code incorrectly uses ${wrongValue}`,
      });
      
      fixIndicators.push({
        type: 'should_use',
        pattern: correctValue,
        description: `Code should use ${correctValue}`,
      });
    }

    // Pattern: "should use X" or "must use X"
    const shouldUsePattern = /(?:should|must|need\s+to)\s+use\s+([a-zA-Z.()_]+)/gi;
    while ((match = shouldUsePattern.exec(taskDescription)) !== null) {
      const value = match[1].replace(/[()]/g, '');
      if (!fixIndicators.some(f => f.pattern === value)) {
        fixIndicators.push({
          type: 'should_use',
          pattern: value,
          description: `Code should use ${value}`,
        });
      }
    }

    // Pattern: "when X, use Y" (conditional fix)
    const whenUsePattern = /when\s+(?:the\s+)?(\w+)\s+is\s+(\w+)[,\s]+use\s+([a-zA-Z.()_]+)/gi;
    while ((match = whenUsePattern.exec(taskDescription)) !== null) {
      const condition = `${match[1]} is ${match[2]}`;
      const value = match[3].replace(/[()]/g, '');
      
      fixIndicators.push({
        type: 'should_use',
        pattern: value,
        description: `When ${condition}, use ${value}`,
      });
    }

    // Pattern: property/field names like ".propertyName" or "entity.property"
    const propertyPattern = /\.([a-zA-Z_][a-zA-Z0-9_]*(?:\(\))?)/g;
    const properties = new Set<string>();
    while ((match = propertyPattern.exec(taskDescription)) !== null) {
      properties.add(match[1].replace(/[()]/g, ''));
    }

    // Pattern: method calls like "getX()" or "calculateX()"
    const methodPattern = /\b(get[A-Z]\w*|calculate\w*|compute\w*|find\w*)\s*\(\)/g;
    while ((match = methodPattern.exec(taskDescription)) !== null) {
      properties.add(match[1]);
    }

    logger.info(`Extracted indicators:`);
    logger.info(`  Bug indicators: ${bugIndicators.map(b => b.pattern).join(', ') || 'none'}`);
    logger.info(`  Fix indicators: ${fixIndicators.map(f => f.pattern).join(', ') || 'none'}`);

    return { bugIndicators, fixIndicators };
  }

  /**
   * Validate code against bug/fix indicators
   * Actually reads the code and checks for patterns
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

    const code = methodCode.code.toLowerCase();
    const bugIndicatorsFound: string[] = [];
    const fixIndicatorsFound: string[] = [];

    // Check for bug indicators
    for (const indicator of bugIndicators) {
      const pattern = indicator.pattern.toLowerCase();
      // Check for the pattern in various forms
      const patterns = [
        pattern,
        pattern.replace(/([A-Z])/g, '_$1').toLowerCase(), // camelCase to snake_case
        pattern.replace(/_/g, ''), // remove underscores
      ];
      
      for (const p of patterns) {
        if (code.includes(p)) {
          bugIndicatorsFound.push(indicator.pattern);
          break;
        }
      }
    }

    // Check for fix indicators
    for (const indicator of fixIndicators) {
      const pattern = indicator.pattern.toLowerCase();
      const patterns = [
        pattern,
        pattern.replace(/([A-Z])/g, '_$1').toLowerCase(),
        pattern.replace(/_/g, ''),
      ];
      
      for (const p of patterns) {
        if (code.includes(p)) {
          fixIndicatorsFound.push(indicator.pattern);
          break;
        }
      }
    }

    // Determine status
    let status: CodeValidationResult['status'];
    let confidence: number;
    let explanation: string;

    const hasBugIndicators = bugIndicatorsFound.length > 0;
    const hasFixIndicators = fixIndicatorsFound.length > 0;

    if (hasBugIndicators && !hasFixIndicators) {
      // Bug pattern found, fix pattern not found → BUG EXISTS
      status = 'bug_exists';
      confidence = 85 + (bugIndicatorsFound.length * 5);
      explanation = `Bug pattern found: code uses ${bugIndicatorsFound.join(', ')} but should use ${fixIndicators.map(f => f.pattern).join(', ')}`;
    } else if (!hasBugIndicators && hasFixIndicators) {
      // Bug pattern not found, fix pattern found → FIX APPLIED
      status = 'fix_applied';
      confidence = 85 + (fixIndicatorsFound.length * 5);
      explanation = `Fix appears applied: code uses ${fixIndicatorsFound.join(', ')} as expected`;
    } else if (hasBugIndicators && hasFixIndicators) {
      // Both found → PARTIAL FIX (might have multiple code paths)
      status = 'partial_fix';
      confidence = 60;
      explanation = `Partial fix: found both bug pattern (${bugIndicatorsFound.join(', ')}) and fix pattern (${fixIndicatorsFound.join(', ')})`;
    } else {
      // Neither found → UNKNOWN
      status = 'unknown';
      confidence = 30;
      explanation = `Could not determine status: neither bug nor fix patterns found in method`;
    }

    return {
      status,
      confidence: Math.min(confidence, 100),
      evidence: {
        bugIndicatorsFound,
        fixIndicatorsFound,
        codeSnippet: methodCode.code.substring(0, 500),
        lineNumber: methodCode.lineNumber,
      },
      explanation,
    };
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
