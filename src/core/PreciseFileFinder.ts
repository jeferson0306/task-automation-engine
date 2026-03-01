import path from 'path';
import fs from 'fs-extra';
import { logger } from '../utils/logger.js';
import { ProjectSnapshot, ScannedFile } from './types.js';
import FilePolicy from './FilePolicy.js';

/**
 * Result of precise file search
 */
export interface PreciseFileMatch {
  file: string;
  matchType: 'exact_class' | 'exact_method' | 'exact_file' | 'likely_related' | 'keyword_match';
  confidence: number;
  evidence: string;
  lineNumber?: number;
  snippet?: string;
  policy: ReturnType<typeof FilePolicy.evaluate>;
}

/**
 * Extracted code references from task description
 */
export interface CodeReferences {
  classes: string[];
  methods: string[];
  files: string[];
  packages: string[];
  patterns: string[];
}

/**
 * Precise File Finder
 * 
 * Instead of generic keyword matching, this component:
 * 1. Extracts EXACT class/method names from task description
 * 2. Searches for those SPECIFIC files/methods
 * 3. Validates findings against file policy
 * 4. Only returns high-confidence matches
 */
export class PreciseFileFinder {
  
  /**
   * Extract code references from task description
   * Looks for explicit mentions of classes, methods, files
   */
  static extractCodeReferences(description: string): CodeReferences {
    const references: CodeReferences = {
      classes: [],
      methods: [],
      files: [],
      packages: [],
      patterns: [],
    };

    // Extract explicit method calls: ClassName.methodName() or methodName()
    const methodCallPatterns = [
      /\b([A-Z][a-zA-Z0-9]*)\s*\.\s*([a-z][a-zA-Z0-9]*)\s*\(\)/g,  // Class.method()
      /\b([a-z][a-zA-Z0-9]*)\s*\(\)/g,                              // method()
    ];
    
    for (const pattern of methodCallPatterns) {
      let match;
      while ((match = pattern.exec(description)) !== null) {
        if (match[2]) {
          // Class.method() pattern
          references.classes.push(match[1]);
          references.methods.push(match[2]);
          references.patterns.push(`${match[1]}.${match[2]}`);
        } else if (match[1]) {
          // method() pattern
          references.methods.push(match[1]);
        }
      }
    }

    // Extract class names (PascalCase)
    const classPattern = /\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g;
    let match;
    while ((match = classPattern.exec(description)) !== null) {
      const className = match[1];
      // Filter out common English compound words that look like class names
      const commonCompoundWords = ['StartDate', 'EndDate', 'FirstName', 'LastName', 'UserName', 'DateTime'];
      if (!commonCompoundWords.includes(className)) {
        if (!references.classes.includes(className)) {
          references.classes.push(className);
        }
      }
    }

    // Extract file paths mentioned (e.g., src/main/java/...)
    const filePathPattern = /(?:src\/[^\s,;]+|[a-zA-Z]+\/[a-zA-Z]+\/[^\s,;]+\.(?:java|ts|py|go|js))/g;
    while ((match = filePathPattern.exec(description)) !== null) {
      references.files.push(match[0]);
    }

    // Extract package/namespace references
    const packagePattern = /\b([a-z]+(?:\.[a-z]+){2,})\b/g;
    while ((match = packagePattern.exec(description)) !== null) {
      references.packages.push(match[1]);
    }

    // Extract backtick code references
    const backtickPattern = /`([^`]+)`/g;
    while ((match = backtickPattern.exec(description)) !== null) {
      const ref = match[1];
      if (ref.includes('.') && ref.includes('(')) {
        // Looks like Class.method()
        const parts = ref.replace('()', '').split('.');
        if (parts.length >= 2) {
          references.classes.push(parts[0]);
          references.methods.push(parts[parts.length - 1]);
          references.patterns.push(ref.replace('()', ''));
        }
      } else if (/^[A-Z]/.test(ref)) {
        references.classes.push(ref);
      } else {
        references.methods.push(ref);
      }
    }

    // Deduplicate
    references.classes = [...new Set(references.classes)];
    references.methods = [...new Set(references.methods)];
    references.files = [...new Set(references.files)];
    references.packages = [...new Set(references.packages)];
    references.patterns = [...new Set(references.patterns)];

    logger.info(`Extracted code references:`);
    logger.info(`  Classes: ${references.classes.join(', ') || 'none'}`);
    logger.info(`  Methods: ${references.methods.join(', ') || 'none'}`);
    logger.info(`  Patterns: ${references.patterns.join(', ') || 'none'}`);

    return references;
  }

  /**
   * Find files that EXACTLY match the code references
   * This is surgical - only returns high-confidence matches
   */
  static async findPreciseMatches(
    snapshot: ProjectSnapshot,
    references: CodeReferences
  ): Promise<PreciseFileMatch[]> {
    const matches: PreciseFileMatch[] = [];

    // 1. Search for exact class files
    for (const className of references.classes) {
      const classMatches = await this.findClassFile(snapshot, className);
      matches.push(...classMatches);
    }

    // 2. Search for exact method implementations
    for (const pattern of references.patterns) {
      const [className, methodName] = pattern.split('.');
      if (className && methodName) {
        const methodMatches = await this.findMethodInClass(snapshot, className, methodName);
        matches.push(...methodMatches);
      }
    }

    // 3. Search for explicit file paths
    for (const filePath of references.files) {
      const fileMatches = await this.findExplicitFile(snapshot, filePath);
      matches.push(...fileMatches);
    }

    // Deduplicate by file path, keeping highest confidence
    const uniqueMatches = this.deduplicateMatches(matches);

    // Filter by policy - exclude files that cannot be modified
    const filteredMatches = uniqueMatches.filter(m => {
      if (!m.policy.canModify) {
        logger.info(`  Excluding ${m.file}: ${m.policy.reason}`);
        return false;
      }
      return true;
    });

    // Sort by confidence
    filteredMatches.sort((a, b) => b.confidence - a.confidence);

    return filteredMatches;
  }

  /**
   * Find a class file by name
   */
  private static async findClassFile(
    snapshot: ProjectSnapshot,
    className: string
  ): Promise<PreciseFileMatch[]> {
    const matches: PreciseFileMatch[] = [];

    // Possible file names for this class
    const possibleFileNames = [
      `${className}.java`,
      `${className}.ts`,
      `${className}.tsx`,
      `${className}.py`,
      `${className}.go`,
      `${className}.kt`,
      `${className}.scala`,
      `${className}.cs`,
      `${className}.rb`,
      // Also check snake_case for Python
      `${this.toSnakeCase(className)}.py`,
    ];

    for (const file of snapshot.files) {
      const fileName = path.basename(file.path);
      
      if (possibleFileNames.includes(fileName)) {
        const policy = FilePolicy.evaluate(file.path);
        
        matches.push({
          file: file.path,
          matchType: 'exact_class',
          confidence: 95,
          evidence: `File name matches class: ${className}`,
          policy,
        });
      }
    }

    return matches;
  }

  /**
   * Find a method within a class file
   * Checks both full content and skeletal content, and reads file directly if needed
   */
  private static async findMethodInClass(
    snapshot: ProjectSnapshot,
    className: string,
    methodName: string
  ): Promise<PreciseFileMatch[]> {
    const matches: PreciseFileMatch[] = [];

    // First find the class file
    const classMatches = await this.findClassFile(snapshot, className);
    
    for (const classMatch of classMatches) {
      const file = snapshot.files.find(f => f.path === classMatch.file);
      if (!file) continue;

      const policy = FilePolicy.evaluate(file.path);

      // Option 1: Check skeletal content first (faster, no I/O)
      if (file.skeletalContent) {
        for (const classInfo of file.skeletalContent.classes || []) {
          for (const method of classInfo.methods || []) {
            if (method.name.toLowerCase() === methodName.toLowerCase()) {
              matches.push({
                file: file.path,
                matchType: 'exact_method',
                confidence: 95, // Slightly lower since we didn't see the actual code
                evidence: `Found method ${className}.${methodName}() in skeletal content`,
                snippet: `${method.visibility || ''} ${method.returnType || 'void'} ${method.name}(${
                  method.parameters?.map(p => `${p.type} ${p.name}`).join(', ') || ''
                })`,
                policy,
              });
            }
          }
        }
        // If found in skeletal, return
        if (matches.length > 0) continue;
      }

      // Option 2: Check full content if available
      let content = file.content;

      // Option 3: Read file directly if no content (allows validation later)
      if (!content) {
        try {
          content = await fs.readFile(file.path, 'utf-8');
        } catch {
          logger.warn(`Could not read file for method search: ${file.path}`);
          // Still add the class match with lower confidence if we found the class
          matches.push({
            file: file.path,
            matchType: 'likely_related',
            confidence: 70,
            evidence: `Class file found for ${className}, method ${methodName} not verified`,
            policy,
          });
          continue;
        }
      }

      // Search for method definition
      const methodPatterns = [
        // Java/C#/TypeScript: public void methodName(
        new RegExp(`(?:public|private|protected)?\\s*(?:static)?\\s*[\\w<>\\[\\],\\s]*\\s+${methodName}\\s*\\(`, 'gmi'),
        // Python: def method_name(
        new RegExp(`def\\s+${methodName}\\s*\\(`, 'gmi'),
        // Go: func (r *Receiver) methodName(
        new RegExp(`func\\s+(?:\\([^)]+\\)\\s+)?${methodName}\\s*\\(`, 'gmi'),
        // JavaScript/TypeScript: methodName( or methodName = ( or async methodName(
        new RegExp(`(?:async\\s+)?${methodName}\\s*[=(]`, 'gmi'),
        // Kotlin: fun methodName(
        new RegExp(`fun\\s+${methodName}\\s*\\(`, 'gmi'),
      ];

      const lines = content.split('\n');
      let found = false;
      
      for (let i = 0; i < lines.length && !found; i++) {
        const line = lines[i];
        for (const pattern of methodPatterns) {
          pattern.lastIndex = 0; // Reset regex state
          if (pattern.test(line)) {
            matches.push({
              file: file.path,
              matchType: 'exact_method',
              confidence: 98,
              evidence: `Found method ${className}.${methodName}()`,
              lineNumber: i + 1,
              snippet: line.trim().substring(0, 100),
              policy,
            });
            found = true;
            break;
          }
        }
      }

      // If method not found in content, still add the class as related
      if (!found && classMatches.length > 0) {
        matches.push({
          file: file.path,
          matchType: 'likely_related',
          confidence: 60,
          evidence: `Class ${className} found but method ${methodName} not located`,
          policy,
        });
      }
    }

    return matches;
  }

  /**
   * Find an explicitly mentioned file path
   */
  private static async findExplicitFile(
    snapshot: ProjectSnapshot,
    filePath: string
  ): Promise<PreciseFileMatch[]> {
    const matches: PreciseFileMatch[] = [];

    for (const file of snapshot.files) {
      if (file.path.includes(filePath) || file.path.endsWith(filePath)) {
        const policy = FilePolicy.evaluate(file.path);
        
        matches.push({
          file: file.path,
          matchType: 'exact_file',
          confidence: 99,
          evidence: `Explicit file path match: ${filePath}`,
          policy,
        });
      }
    }

    return matches;
  }

  /**
   * Convert PascalCase to snake_case
   */
  private static toSnakeCase(str: string): string {
    return str
      .replace(/([A-Z])/g, '_$1')
      .toLowerCase()
      .replace(/^_/, '');
  }

  /**
   * Deduplicate matches, keeping highest confidence
   */
  private static deduplicateMatches(matches: PreciseFileMatch[]): PreciseFileMatch[] {
    const byFile = new Map<string, PreciseFileMatch>();
    
    for (const match of matches) {
      const existing = byFile.get(match.file);
      if (!existing || match.confidence > existing.confidence) {
        byFile.set(match.file, match);
      }
    }
    
    return Array.from(byFile.values());
  }

  /**
   * Analyze if the found code matches the bug description
   * This validates that we found the RIGHT code
   */
  static async validateCodeMatchesBug(
    file: ScannedFile,
    methodName: string,
    bugDescription: string
  ): Promise<{ matches: boolean; evidence: string; currentCode?: string }> {
    if (!file.content) {
      return { matches: false, evidence: 'File content not available' };
    }

    // Find the method
    const methodPatterns = [
      new RegExp(`(?:public|private|protected)?\\s*(?:static)?\\s*\\w+\\s+${methodName}\\s*\\([^)]*\\)\\s*\\{`, 'gm'),
      new RegExp(`def\\s+${methodName}\\s*\\([^)]*\\)\\s*:`, 'gm'),
      new RegExp(`func\\s+(?:\\([^)]+\\)\\s+)?${methodName}\\s*\\([^)]*\\)`, 'gm'),
    ];

    let methodStart = -1;
    const lines = file.content.split('\n');
    
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
      return { matches: false, evidence: `Method ${methodName} not found in file` };
    }

    // Extract method body (simplified - up to 50 lines or closing brace)
    let methodEnd = Math.min(methodStart + 50, lines.length);
    let braceCount = 0;
    let foundOpen = false;
    
    for (let i = methodStart; i < lines.length && i < methodStart + 100; i++) {
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

    const methodCode = lines.slice(methodStart, methodEnd).join('\n');

    // Now check if the code matches the bug description
    // Extract key patterns from bug description
    const bugIndicators = this.extractBugIndicators(bugDescription);
    
    let matchCount = 0;
    for (const indicator of bugIndicators) {
      if (methodCode.toLowerCase().includes(indicator.toLowerCase())) {
        matchCount++;
      }
    }

    const matches = matchCount >= bugIndicators.length * 0.5;
    
    return {
      matches,
      evidence: matches 
        ? `Found ${matchCount}/${bugIndicators.length} bug indicators in method code`
        : `Only ${matchCount}/${bugIndicators.length} bug indicators found`,
      currentCode: methodCode,
    };
  }

  /**
   * Extract bug indicators from description
   */
  private static extractBugIndicators(description: string): string[] {
    const indicators: string[] = [];
    
    // Look for specific mentions of wrong/old behavior
    const wrongPatterns = description.match(/(?:uses?|using|with)\s+([a-zA-Z.]+)/gi);
    if (wrongPatterns) {
      indicators.push(...wrongPatterns.map(p => p.replace(/uses?|using|with/i, '').trim()));
    }

    // Look for variable/field names
    const fieldPatterns = description.match(/\b([a-z][a-zA-Z]*(?:Date|Time|Status|Id|Name))\b/g);
    if (fieldPatterns) {
      indicators.push(...fieldPatterns);
    }

    // Look for method names
    const methodPatterns = description.match(/\b(get[A-Z][a-zA-Z]*|set[A-Z][a-zA-Z]*)\b/g);
    if (methodPatterns) {
      indicators.push(...methodPatterns);
    }

    return [...new Set(indicators)].slice(0, 10);
  }
}

export default PreciseFileFinder;
