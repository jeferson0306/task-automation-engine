import path from 'path';
import fs from 'fs-extra';
import { logger } from '../utils/logger.js';
import {
  AntiPattern,
  AntiPatternCategory,
  AntiPatternFix,
  ExecutionContext,
  ProjectSnapshot,
  ScannedFile,
} from '../core/types.js';
import ProjectScanner from './ProjectScanner.js';

/**
 * Anti-pattern definition
 */
interface PatternDefinition {
  id: string;
  name: string;
  category: AntiPatternCategory;
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  languages: string[];
  pattern: RegExp;
  fix?: (match: RegExpMatchArray, line: string) => AntiPatternFix;
}

/**
 * Anti-Pattern Detector - Based on test-lens patterns
 * Detects 35+ code and test anti-patterns
 */
export class AntiPatternDetector {
  private patterns: PatternDefinition[] = [];

  constructor() {
    this.initializePatterns();
  }

  /**
   * Detect all anti-patterns in project
   */
  async detect(context: ExecutionContext): Promise<AntiPattern[]> {
    logger.info('Detecting anti-patterns...');

    const snapshot = context.projectSnapshot || (await ProjectScanner.scan(context.workingDir));
    context.projectSnapshot = snapshot;

    const antiPatterns: AntiPattern[] = [];

    for (const file of snapshot.files) {
      if (file.content) {
        const filePatterns = await this.analyzeFile(file);
        antiPatterns.push(...filePatterns);
      } else if (file.classification !== 'config') {
        try {
          const content = await fs.readFile(file.path, 'utf-8');
          const fileWithContent = { ...file, content };
          const filePatterns = await this.analyzeFile(fileWithContent);
          antiPatterns.push(...filePatterns);
        } catch {
          // Skip unreadable files
        }
      }
    }

    antiPatterns.sort((a, b) => {
      const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });

    logger.info(`Found ${antiPatterns.length} anti-patterns`);
    return antiPatterns;
  }

  /**
   * Analyze single file for anti-patterns
   */
  private async analyzeFile(file: ScannedFile): Promise<AntiPattern[]> {
    const results: AntiPattern[] = [];
    if (!file.content) return results;

    const lines = file.content.split('\n');
    const isTestFile = file.classification === 'test' || file.relativePath.includes('test');

    const applicablePatterns = this.patterns.filter(
      (p) => p.languages.includes('*') || p.languages.some((l) => file.language.toLowerCase().includes(l.toLowerCase()))
    );

    const testPatterns = applicablePatterns.filter(
      (p) =>
        p.category === 'flaky-test' ||
        p.category === 'weak-assertion' ||
        p.category === 'mockito-misuse' ||
        p.category === 'framework-issue'
    );

    const codePatterns = applicablePatterns.filter(
      (p) =>
        p.category === 'code-smell' ||
        p.category === 'security-risk' ||
        p.category === 'performance-issue' ||
        p.category === 'maintainability'
    );

    const patternsToCheck = isTestFile ? [...testPatterns, ...codePatterns] : codePatterns;

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum];

      for (const pattern of patternsToCheck) {
        const match = line.match(pattern.pattern);
        if (match) {
          results.push({
            id: pattern.id,
            category: pattern.category,
            severity: pattern.severity,
            name: pattern.name,
            description: pattern.description,
            file: file.relativePath,
            line: lineNum + 1,
            codeSnippet: this.getCodeSnippet(lines, lineNum),
            fix: pattern.fix ? pattern.fix(match, line) : undefined,
          });
        }
      }
    }

    results.push(...this.detectMultiLinePatterns(file, lines, isTestFile));

    return results;
  }

  /**
   * Get code snippet around a line
   */
  private getCodeSnippet(lines: string[], lineNum: number): string {
    const start = Math.max(0, lineNum - 1);
    const end = Math.min(lines.length, lineNum + 2);
    return lines.slice(start, end).join('\n');
  }

  /**
   * Detect patterns that span multiple lines
   */
  private detectMultiLinePatterns(file: ScannedFile, lines: string[], isTestFile: boolean): AntiPattern[] {
    const results: AntiPattern[] = [];
    const content = file.content || '';

    if (isTestFile && file.language.includes('Java')) {
      const mockedStaticInBeforeEach = /@BeforeEach[\s\S]*?MockedStatic/;
      if (mockedStaticInBeforeEach.test(content)) {
        const lineNum = this.findPatternLine(lines, 'MockedStatic');
        results.push({
          id: 'mockito-static-before-each',
          category: 'mockito-misuse',
          severity: 'high',
          name: 'MockedStatic in @BeforeEach',
          description: 'MockedStatic should be used inside @Test with try-with-resources, not in @BeforeEach',
          file: file.relativePath,
          line: lineNum,
          codeSnippet: this.getCodeSnippet(lines, lineNum - 1),
          fix: {
            description: 'Move MockedStatic inside @Test method with try-with-resources',
            before: '@BeforeEach\nvoid setUp() {\n  mockedStatic = mockStatic(Util.class);\n}',
            after:
              '@Test\nvoid test() {\n  try (MockedStatic<Util> mockedStatic = mockStatic(Util.class)) {\n    // test code\n  }\n}',
            autoFixable: false,
          },
        });
      }

      const testWithoutAssert = /@Test[\s\S]*?void\s+\w+\([^)]*\)\s*\{[^}]*\}/g;
      let match;
      while ((match = testWithoutAssert.exec(content)) !== null) {
        const methodContent = match[0];
        if (
          !methodContent.includes('assert') &&
          !methodContent.includes('verify') &&
          !methodContent.includes('expect') &&
          !methodContent.includes('should')
        ) {
          const lineNum = this.findPatternLine(lines, methodContent.substring(0, 50));
          results.push({
            id: 'test-without-assertion',
            category: 'weak-assertion',
            severity: 'high',
            name: 'Test Without Assertion',
            description: 'Test method has no assertions or verifications',
            file: file.relativePath,
            line: lineNum,
            codeSnippet: methodContent.substring(0, 200),
          });
        }
      }
    }

    const longMethod = /(?:public|private|protected|void|function|def|func)\s+\w+[^{]*\{/g;
    let methodMatch;
    while ((methodMatch = longMethod.exec(content)) !== null) {
      const methodStart = methodMatch.index;
      let braceCount = 1;
      let methodEnd = methodStart + methodMatch[0].length;

      for (let i = methodEnd; i < content.length && braceCount > 0; i++) {
        if (content[i] === '{') braceCount++;
        else if (content[i] === '}') braceCount--;
        methodEnd = i;
      }

      const methodBody = content.substring(methodStart, methodEnd);
      const methodLines = methodBody.split('\n').length;

      if (methodLines > 50) {
        const lineNum = content.substring(0, methodStart).split('\n').length;
        results.push({
          id: 'long-method',
          category: 'maintainability',
          severity: 'medium',
          name: 'Long Method',
          description: `Method has ${methodLines} lines (max recommended: 50)`,
          file: file.relativePath,
          line: lineNum,
          codeSnippet: methodBody.substring(0, 100) + '...',
        });
      }
    }

    return results;
  }

  private findPatternLine(lines: string[], pattern: string): number {
    const searchStr = pattern.substring(0, Math.min(50, pattern.length));
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(searchStr)) {
        return i + 1;
      }
    }
    return 1;
  }

  /**
   * Initialize all 35+ anti-pattern definitions
   */
  private initializePatterns(): void {
    this.patterns = [
      // ============ FLAKY TEST PATTERNS ============
      {
        id: 'hardcoded-date',
        name: 'Hardcoded Date',
        category: 'flaky-test',
        severity: 'high',
        description: 'Hardcoded date will cause test failures over time',
        languages: ['*'],
        pattern: /new Date\s*\(\s*['"]?\d{4}[-/]\d{2}[-/]\d{2}['"]?\s*\)/,
        fix: (match) => ({
          description: 'Use Clock or time provider for testable dates',
          before: match[0],
          after: 'clock.instant()',
          autoFixable: false,
        }),
      },
      {
        id: 'system-current-time',
        name: 'System.currentTimeMillis()',
        category: 'flaky-test',
        severity: 'high',
        description: 'System time makes tests non-deterministic',
        languages: ['java', 'kotlin'],
        pattern: /System\.currentTimeMillis\s*\(\)/,
        fix: () => ({
          description: 'Inject Clock and use clock.millis()',
          before: 'System.currentTimeMillis()',
          after: 'clock.millis()',
          autoFixable: true,
        }),
      },
      {
        id: 'date-now',
        name: 'Date.now() in tests',
        category: 'flaky-test',
        severity: 'high',
        description: 'Date.now() makes tests time-dependent',
        languages: ['typescript', 'javascript'],
        pattern: /Date\.now\s*\(\)/,
        fix: () => ({
          description: 'Mock Date.now or use jest.useFakeTimers()',
          before: 'Date.now()',
          after: "jest.useFakeTimers().setSystemTime(new Date('2024-01-01'))",
          autoFixable: false,
        }),
      },
      {
        id: 'random-without-seed',
        name: 'Random without seed',
        category: 'flaky-test',
        severity: 'high',
        description: 'Random values without seed cause non-reproducible tests',
        languages: ['java', 'kotlin'],
        pattern: /new Random\s*\(\s*\)/,
        fix: () => ({
          description: 'Use fixed seed for reproducibility',
          before: 'new Random()',
          after: 'new Random(12345L)',
          autoFixable: true,
        }),
      },
      {
        id: 'math-random',
        name: 'Math.random() in tests',
        category: 'flaky-test',
        severity: 'high',
        description: 'Math.random() produces non-reproducible results',
        languages: ['typescript', 'javascript'],
        pattern: /Math\.random\s*\(\)/,
        fix: () => ({
          description: 'Use seeded random or mock Math.random',
          before: 'Math.random()',
          after: 'jest.spyOn(Math, "random").mockReturnValue(0.5)',
          autoFixable: false,
        }),
      },
      {
        id: 'thread-sleep',
        name: 'Thread.sleep() in tests',
        category: 'flaky-test',
        severity: 'critical',
        description: 'Thread.sleep makes tests slow and unreliable',
        languages: ['java', 'kotlin'],
        pattern: /Thread\.sleep\s*\(\s*\d+\s*\)/,
        fix: () => ({
          description: 'Use Awaitility or CountDownLatch for async testing',
          before: 'Thread.sleep(1000)',
          after: 'await().atMost(1, SECONDS).until(() -> condition)',
          autoFixable: false,
        }),
      },
      {
        id: 'settimeout-test',
        name: 'setTimeout in tests',
        category: 'flaky-test',
        severity: 'high',
        description: 'setTimeout makes tests slow and flaky',
        languages: ['typescript', 'javascript'],
        pattern: /setTimeout\s*\([^,]+,\s*\d+\)/,
        fix: () => ({
          description: 'Use jest.useFakeTimers() and jest.advanceTimersByTime()',
          before: 'setTimeout(callback, 1000)',
          after: 'jest.useFakeTimers(); jest.advanceTimersByTime(1000)',
          autoFixable: false,
        }),
      },

      // ============ WEAK ASSERTION PATTERNS ============
      {
        id: 'assert-not-null-class',
        name: 'assertNotNull on Class',
        category: 'weak-assertion',
        severity: 'high',
        description: 'assertNotNull(SomeClass.class) always passes',
        languages: ['java', 'kotlin'],
        pattern: /assertNotNull\s*\(\s*\w+\.class\s*\)/,
        fix: (match) => ({
          description: 'Assert on actual value, not class literal',
          before: match[0],
          after: 'assertNotNull(actualInstance)',
          autoFixable: false,
        }),
      },
      {
        id: 'assert-true-false',
        name: 'assertEquals with boolean',
        category: 'weak-assertion',
        severity: 'low',
        description: 'Use assertTrue/assertFalse instead of assertEquals',
        languages: ['java', 'kotlin'],
        pattern: /assertEquals\s*\(\s*(true|false)\s*,/,
        fix: (match) => ({
          description: 'Use assertTrue or assertFalse',
          before: `assertEquals(${match[1]}, value)`,
          after: match[1] === 'true' ? 'assertTrue(value)' : 'assertFalse(value)',
          autoFixable: true,
        }),
      },
      {
        id: 'empty-catch-test',
        name: 'Empty catch block in test',
        category: 'weak-assertion',
        severity: 'high',
        description: 'Empty catch blocks hide test failures',
        languages: ['*'],
        pattern: /catch\s*\([^)]+\)\s*\{\s*\}/,
        fix: () => ({
          description: 'Add fail() or rethrow exception',
          before: 'catch (Exception e) { }',
          after: 'catch (Exception e) { fail("Should not throw: " + e.getMessage()); }',
          autoFixable: false,
        }),
      },
      {
        id: 'expect-no-error',
        name: 'expect().not.toThrow() without call',
        category: 'weak-assertion',
        severity: 'medium',
        description: 'expect(fn).not.toThrow() should wrap actual function call',
        languages: ['typescript', 'javascript'],
        pattern: /expect\s*\([^)]+\)\.not\.toThrow\s*\(\)/,
      },
      {
        id: 'todo-test',
        name: 'TODO/FIXME in test',
        category: 'weak-assertion',
        severity: 'medium',
        description: 'Incomplete test with TODO marker',
        languages: ['*'],
        pattern: /\/\/\s*(TODO|FIXME|XXX):/i,
      },

      // ============ MOCKITO MISUSE PATTERNS ============
      {
        id: 'when-void-method',
        name: 'when() on void method',
        category: 'mockito-misuse',
        severity: 'high',
        description: 'when() cannot be used on void methods, use doNothing()',
        languages: ['java', 'kotlin'],
        pattern: /when\s*\(\s*\w+\.\w+\s*\(\s*\)\s*\)\.thenReturn\s*\(\s*null\s*\)/,
        fix: () => ({
          description: 'Use doNothing().when() for void methods',
          before: 'when(mock.voidMethod()).thenReturn(null)',
          after: 'doNothing().when(mock).voidMethod()',
          autoFixable: false,
        }),
      },
      {
        id: 'verify-no-times',
        name: 'verify() without times()',
        category: 'mockito-misuse',
        severity: 'low',
        description: 'Explicitly specify invocation count for clarity',
        languages: ['java', 'kotlin'],
        pattern: /verify\s*\(\s*\w+\s*\)\.\w+\s*\(/,
        fix: (match) => ({
          description: 'Add times(1) for explicit verification',
          before: match[0],
          after: match[0].replace('verify(', 'verify(mock, times(1))'),
          autoFixable: true,
        }),
      },
      {
        id: 'any-matcher-misuse',
        name: 'Mixing any() with literals',
        category: 'mockito-misuse',
        severity: 'high',
        description: 'Cannot mix matchers and literals in stubbing',
        languages: ['java', 'kotlin'],
        pattern: /when\s*\([^)]+any\(\)[^)]*,\s*["'\d]/,
        fix: () => ({
          description: 'Use eq() matcher for literal values',
          before: 'when(mock.method(any(), "literal"))',
          after: 'when(mock.method(any(), eq("literal")))',
          autoFixable: true,
        }),
      },

      // ============ FRAMEWORK ISSUE PATTERNS ============
      {
        id: 'wrong-test-import',
        name: 'Wrong @Test import',
        category: 'framework-issue',
        severity: 'high',
        description: 'Using JUnit 4 @Test with JUnit 5 setup',
        languages: ['java'],
        pattern: /import\s+org\.junit\.Test/,
        fix: () => ({
          description: 'Use JUnit 5 import',
          before: 'import org.junit.Test',
          after: 'import org.junit.jupiter.api.Test',
          autoFixable: true,
        }),
      },
      {
        id: 'missing-extend-with',
        name: 'Missing @ExtendWith for Mockito',
        category: 'framework-issue',
        severity: 'medium',
        description: '@Mock annotations require @ExtendWith(MockitoExtension.class)',
        languages: ['java'],
        pattern: /@Mock\s+(?!.*@ExtendWith)/,
      },
      {
        id: 'reflection-private-method',
        name: 'Reflection to test private method',
        category: 'framework-issue',
        severity: 'medium',
        description: 'Testing private methods via reflection indicates design issues',
        languages: ['java', 'kotlin'],
        pattern: /getDeclaredMethod\s*\([^)]*\)\.setAccessible\s*\(\s*true\s*\)/,
      },

      // ============ CODE SMELL PATTERNS ============
      {
        id: 'magic-number',
        name: 'Magic number',
        category: 'code-smell',
        severity: 'low',
        description: 'Use named constants instead of magic numbers',
        languages: ['*'],
        pattern: /[=<>]\s*(?<![\d.])\b(?!0|1\b)\d{2,}\b(?![\d.])/,
      },
      {
        id: 'commented-code',
        name: 'Commented out code',
        category: 'code-smell',
        severity: 'low',
        description: 'Remove commented code, use version control instead',
        languages: ['*'],
        pattern: /\/\/\s*(if|for|while|return|public|private|function|const|let|var)\s*[\({]/,
      },
      {
        id: 'console-log',
        name: 'console.log in production code',
        category: 'code-smell',
        severity: 'medium',
        description: 'Use proper logging framework instead of console.log',
        languages: ['typescript', 'javascript'],
        pattern: /console\.(log|warn|error|info)\s*\(/,
        fix: () => ({
          description: 'Use logger instead',
          before: 'console.log(message)',
          after: 'logger.info(message)',
          autoFixable: false,
        }),
      },
      {
        id: 'system-out-print',
        name: 'System.out.println',
        category: 'code-smell',
        severity: 'medium',
        description: 'Use proper logging framework',
        languages: ['java'],
        pattern: /System\.(out|err)\.(print|println)\s*\(/,
        fix: () => ({
          description: 'Use SLF4J logger',
          before: 'System.out.println(message)',
          after: 'log.info(message)',
          autoFixable: false,
        }),
      },
      {
        id: 'empty-catch',
        name: 'Empty catch block',
        category: 'code-smell',
        severity: 'high',
        description: 'Empty catch blocks silently swallow exceptions',
        languages: ['*'],
        pattern: /catch\s*\([^)]+\)\s*\{\s*\}/,
      },

      // ============ SECURITY RISK PATTERNS ============
      {
        id: 'hardcoded-password',
        name: 'Hardcoded password',
        category: 'security-risk',
        severity: 'critical',
        description: 'Password should not be hardcoded',
        languages: ['*'],
        pattern: /password\s*[=:]\s*['"][^'"]+['"]/i,
        fix: () => ({
          description: 'Use environment variable or secrets manager',
          before: 'password = "secret123"',
          after: 'password = process.env.PASSWORD',
          autoFixable: false,
        }),
      },
      {
        id: 'hardcoded-api-key',
        name: 'Hardcoded API key',
        category: 'security-risk',
        severity: 'critical',
        description: 'API keys should not be hardcoded',
        languages: ['*'],
        pattern: /(api[_-]?key|apikey|api_secret)\s*[=:]\s*['"][a-zA-Z0-9]{20,}['"]/i,
      },
      {
        id: 'sql-concatenation',
        name: 'SQL string concatenation',
        category: 'security-risk',
        severity: 'critical',
        description: 'SQL injection vulnerability - use parameterized queries',
        languages: ['*'],
        pattern: /(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)\s*.*\+\s*\w+/i,
        fix: () => ({
          description: 'Use parameterized query',
          before: '"SELECT * FROM users WHERE id = " + userId',
          after: '"SELECT * FROM users WHERE id = ?" with parameter binding',
          autoFixable: false,
        }),
      },
      {
        id: 'eval-usage',
        name: 'eval() usage',
        category: 'security-risk',
        severity: 'critical',
        description: 'eval() can execute arbitrary code - security risk',
        languages: ['typescript', 'javascript', 'python'],
        pattern: /\beval\s*\(/,
      },
      {
        id: 'innerhtml-assignment',
        name: 'innerHTML assignment',
        category: 'security-risk',
        severity: 'high',
        description: 'innerHTML can lead to XSS vulnerabilities',
        languages: ['typescript', 'javascript'],
        pattern: /\.innerHTML\s*=/,
        fix: () => ({
          description: 'Use textContent or sanitize HTML',
          before: 'element.innerHTML = userInput',
          after: 'element.textContent = userInput',
          autoFixable: false,
        }),
      },

      // ============ PERFORMANCE PATTERNS ============
      {
        id: 'string-concat-loop',
        name: 'String concatenation in loop',
        category: 'performance-issue',
        severity: 'medium',
        description: 'Use StringBuilder for string concatenation in loops',
        languages: ['java'],
        pattern: /for\s*\([^)]+\)\s*\{[^}]*\+=\s*["']/,
        fix: () => ({
          description: 'Use StringBuilder',
          before: 'for (...) { result += str; }',
          after: 'StringBuilder sb = new StringBuilder(); for (...) { sb.append(str); }',
          autoFixable: false,
        }),
      },
      {
        id: 'n-plus-one',
        name: 'Potential N+1 query',
        category: 'performance-issue',
        severity: 'high',
        description: 'Query inside loop may cause N+1 problem',
        languages: ['*'],
        pattern: /for\s*\([^)]+\)\s*\{[^}]*(findBy|query|select|fetch)/i,
      },
      {
        id: 'missing-index-hint',
        name: 'Query without index consideration',
        category: 'performance-issue',
        severity: 'low',
        description: 'Complex query may benefit from index',
        languages: ['*'],
        pattern: /WHERE\s+\w+\s*(LIKE|IN|NOT IN)\s*\(/i,
      },
      {
        id: 'sync-over-async',
        name: 'Synchronous I/O in async context',
        category: 'performance-issue',
        severity: 'medium',
        description: 'Use async I/O operations in async functions',
        languages: ['typescript', 'javascript'],
        pattern: /async\s+function[^{]+\{[^}]*readFileSync/,
      },

      // ============ MAINTAINABILITY PATTERNS ============
      {
        id: 'deep-nesting',
        name: 'Deep nesting',
        category: 'maintainability',
        severity: 'medium',
        description: 'Deeply nested code is hard to read and maintain',
        languages: ['*'],
        pattern: /\{\s*\n\s*\{\s*\n\s*\{\s*\n\s*\{/,
      },
      {
        id: 'god-class-indicator',
        name: 'Large number of fields',
        category: 'maintainability',
        severity: 'medium',
        description: 'Class may have too many responsibilities',
        languages: ['java', 'kotlin', 'typescript'],
        pattern: /(?:private|public|protected)\s+\w+\s+\w+\s*;.*(?:private|public|protected)\s+\w+\s+\w+\s*;.*(?:private|public|protected)\s+\w+\s+\w+\s*;.*(?:private|public|protected)\s+\w+\s+\w+\s*;.*(?:private|public|protected)\s+\w+\s+\w+\s*;/s,
      },
      {
        id: 'unused-import',
        name: 'Potentially unused import',
        category: 'maintainability',
        severity: 'low',
        description: 'Remove unused imports to keep code clean',
        languages: ['*'],
        pattern: /^import\s+.*\*\s*;/m,
      },
    ];
  }

  /**
   * Get summary of detected patterns by category
   */
  getSummary(patterns: AntiPattern[]): Record<AntiPatternCategory, number> {
    const summary: Record<AntiPatternCategory, number> = {
      'flaky-test': 0,
      'weak-assertion': 0,
      'code-smell': 0,
      'mockito-misuse': 0,
      'framework-issue': 0,
      'security-risk': 0,
      'performance-issue': 0,
      maintainability: 0,
    };

    for (const pattern of patterns) {
      summary[pattern.category]++;
    }

    return summary;
  }

  /**
   * Get auto-fixable patterns
   */
  getAutoFixable(patterns: AntiPattern[]): AntiPattern[] {
    return patterns.filter((p) => p.fix?.autoFixable);
  }
}

export default new AntiPatternDetector();
