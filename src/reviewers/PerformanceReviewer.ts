import path from 'path';
import fs from 'fs-extra';
import { ExecutionContext, ScannedFile, ParsedFileAST } from '../core/types.js';
import logger from '../utils/logger.js';
import ProjectScanner from '../analyzers/ProjectScanner.js';
import ASTParser from '../parsers/ASTParser.js';

interface PerformanceIssue {
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  category: string;
  file?: string;
  line?: number;
  message: string;
  impact: string;
  optimization: string;
  codeSnippet?: string;
}

interface PerformancePattern {
  id: string;
  category: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  pattern: RegExp;
  message: string;
  impact: string;
  optimization: string;
  languages: string[];
}

/**
 * Reviews code for performance issues and optimization opportunities
 * Uses real pattern matching and AST analysis
 */
class PerformanceReviewer {
  private patterns: PerformancePattern[] = [];

  constructor() {
    this.initializePatterns();
  }

  async review(context: ExecutionContext): Promise<PerformanceIssue[]> {
    const issues: PerformanceIssue[] = [];
    logger.info('Starting performance review with real pattern analysis...');

    if (!context.projectAnalysis) {
      logger.warn('Project analysis not completed, skipping performance review');
      return issues;
    }

    const snapshot = context.projectSnapshot || (await ProjectScanner.scan(context.workingDir));
    context.projectSnapshot = snapshot;

    for (const file of snapshot.files) {
      if (file.classification !== 'test' && file.classification !== 'config') {
        await this.reviewFile(file, issues);
      }
    }

    await this.reviewArchitecturalPatterns(snapshot, issues);

    issues.sort((a, b) => {
      const severityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });

    logger.info(`Found ${issues.length} performance issues`);
    return issues;
  }

  private async reviewFile(file: ScannedFile, issues: PerformanceIssue[]): Promise<void> {
    let content = file.content;

    if (!content) {
      try {
        content = await fs.readFile(file.path, 'utf-8');
      } catch {
        return;
      }
    }

    const lines = content.split('\n');
    const applicablePatterns = this.patterns.filter(
      (p) => p.languages.includes('*') || p.languages.some((l) => file.language.toLowerCase().includes(l.toLowerCase()))
    );

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum];

      for (const pattern of applicablePatterns) {
        if (pattern.pattern.test(line)) {
          issues.push({
            severity: pattern.severity,
            category: pattern.category,
            file: file.relativePath,
            line: lineNum + 1,
            message: pattern.message,
            impact: pattern.impact,
            optimization: pattern.optimization,
            codeSnippet: this.getCodeSnippet(lines, lineNum),
          });
        }
      }
    }

    this.checkMultiLinePatterns(content, file.relativePath, file.language, issues);

    try {
      const ast = await ASTParser.parseFile(file.path);
      if (ast.success) {
        this.reviewASTPerformance(ast, issues);
      }
    } catch {
      // Skip AST analysis if parsing fails
    }
  }

  private reviewASTPerformance(ast: ParsedFileAST, issues: PerformanceIssue[]): void {
    for (const cls of ast.classes) {
      for (const method of cls.methods) {
        if (method.complexity > 15) {
          issues.push({
            severity: 'MEDIUM',
            category: 'HIGH_COMPLEXITY',
            file: ast.filePath,
            line: method.line,
            message: `Method '${cls.name}.${method.name}' has high complexity (${method.complexity})`,
            impact: 'High complexity methods are harder to optimize and test',
            optimization: 'Break into smaller methods, use early returns, simplify conditions',
          });
        }
      }
    }

    for (const func of ast.functions) {
      if (func.complexity > 15) {
        issues.push({
          severity: 'MEDIUM',
          category: 'HIGH_COMPLEXITY',
          file: ast.filePath,
          line: func.line,
          message: `Function '${func.name}' has high complexity (${func.complexity})`,
          impact: 'High complexity functions are harder to optimize and test',
          optimization: 'Break into smaller functions, use early returns',
        });
      }
    }
  }

  private checkMultiLinePatterns(content: string, file: string, language: string, issues: PerformanceIssue[]): void {
    if (language.includes('Java')) {
      const stringConcatInLoop = /for\s*\([^)]+\)\s*\{[^}]*\+=[^}]*["'][^}]*\}/gs;
      if (stringConcatInLoop.test(content)) {
        const line = this.findPatternLine(content, 'for');
        issues.push({
          severity: 'MEDIUM',
          category: 'STRING_CONCAT_LOOP',
          file,
          line,
          message: 'String concatenation in loop detected',
          impact: 'O(n²) memory allocations instead of O(n)',
          optimization: 'Use StringBuilder for repeated concatenation',
        });
      }

      if (/synchronized\s*\([^)]+\)/.test(content)) {
        const line = this.findPatternLine(content, 'synchronized');
        issues.push({
          severity: 'LOW',
          category: 'SYNCHRONIZATION',
          file,
          line,
          message: 'Synchronized block detected - check for contention',
          impact: 'Lock contention can cause thread bottlenecks',
          optimization: 'Consider using ConcurrentHashMap or other concurrent utilities',
        });
      }
    }

    if (language.includes('TypeScript') || language.includes('JavaScript')) {
      if (/\.map\([^)]+\)\.filter\([^)]+\)|\.filter\([^)]+\)\.map\([^)]+\)/.test(content)) {
        const line = this.findPatternLine(content, '.map(');
        issues.push({
          severity: 'LOW',
          category: 'ARRAY_CHAIN',
          file,
          line,
          message: 'Chained array methods create intermediate arrays',
          impact: 'Extra memory allocation for intermediate results',
          optimization: 'Use reduce() for single-pass transformation or lodash chain',
        });
      }

      if (/useEffect\s*\(\s*\([^)]*\)\s*=>\s*\{[^}]*fetch|async\s+function[^}]*useEffect/.test(content)) {
        const line = this.findPatternLine(content, 'useEffect');
        issues.push({
          severity: 'MEDIUM',
          category: 'EFFECT_FETCH',
          file,
          line,
          message: 'Data fetching in useEffect without cleanup/abort',
          impact: 'Potential memory leaks and race conditions',
          optimization: 'Use AbortController or data fetching libraries (React Query, SWR)',
        });
      }

      const componentWithoutMemo = /function\s+[A-Z]\w+\s*\([^)]*props[^)]*\)\s*\{[\s\S]*?return\s*\(/;
      if (componentWithoutMemo.test(content) && !content.includes('React.memo') && !content.includes('useMemo')) {
        issues.push({
          severity: 'LOW',
          category: 'MISSING_MEMO',
          file,
          message: 'React component may benefit from memoization',
          impact: 'Unnecessary re-renders when parent updates',
          optimization: 'Consider React.memo() for pure components or useMemo for expensive calculations',
        });
      }
    }

    if (language.includes('Python')) {
      if (/for\s+\w+\s+in\s+\w+[\s\S]*?\.query|\.filter|\.get/.test(content)) {
        const line = this.findPatternLine(content, 'for ');
        issues.push({
          severity: 'HIGH',
          category: 'N_PLUS_ONE',
          file,
          line,
          message: 'Potential N+1 query pattern detected',
          impact: 'O(n) database queries instead of single batched query',
          optimization: 'Use select_related() or prefetch_related() for ORM queries',
        });
      }

      if (/\+\s*=\s*['"][^'"]*['"]/.test(content) && /for\s+\w+\s+in/.test(content)) {
        const line = this.findPatternLine(content, 'for ');
        issues.push({
          severity: 'MEDIUM',
          category: 'STRING_CONCAT',
          file,
          line,
          message: 'String concatenation in loop detected',
          impact: 'O(n²) string operations',
          optimization: "Use ''.join() or f-strings with list comprehension",
        });
      }
    }

    const unboundedQueryPattern = /getAll|findAll|listAll|fetchAll/i;
    if (unboundedQueryPattern.test(content)) {
      const line = this.findPatternLine(content, 'All');
      issues.push({
        severity: 'HIGH',
        category: 'UNBOUNDED_QUERY',
        file,
        line,
        message: 'Unbounded query method detected (getAll/findAll)',
        impact: 'Loading entire tables into memory',
        optimization: 'Add pagination with limit/offset or cursor-based pagination',
      });
    }
  }

  private async reviewArchitecturalPatterns(snapshot: any, issues: PerformanceIssue[]): Promise<void> {
    const hasCaching = snapshot.dependencies?.some((d: any) =>
      ['redis', 'memcached', 'node-cache', 'caffeine', 'ehcache', 'ioredis'].includes(d.name.toLowerCase())
    );

    if (!hasCaching && snapshot.detectedStack?.databases?.length > 0) {
      issues.push({
        severity: 'LOW',
        category: 'NO_CACHING',
        message: 'Database detected without caching layer',
        impact: 'Every request hits the database',
        optimization: 'Consider adding Redis or in-memory caching for frequently accessed data',
      });
    }

    const hasConnectionPool = snapshot.dependencies?.some((d: any) =>
      ['hikari', 'c3p0', 'dbcp', 'pgbouncer', 'generic-pool'].includes(d.name.toLowerCase())
    );

    if (!hasConnectionPool && snapshot.detectedStack?.databases?.length > 0) {
      issues.push({
        severity: 'MEDIUM',
        category: 'NO_CONNECTION_POOL',
        message: 'Database without explicit connection pooling',
        impact: 'Connection creation overhead on each request',
        optimization: 'Use HikariCP (Java), pgBouncer (PostgreSQL), or similar connection pool',
      });
    }
  }

  private getCodeSnippet(lines: string[], lineNum: number): string {
    const start = Math.max(0, lineNum - 1);
    const end = Math.min(lines.length, lineNum + 2);
    return lines.slice(start, end).join('\n');
  }

  private findPatternLine(content: string, searchStr: string): number {
    const index = content.indexOf(searchStr);
    if (index === -1) return 1;
    return content.substring(0, index).split('\n').length;
  }

  private initializePatterns(): void {
    this.patterns = [
      {
        id: 'nested-loop',
        category: 'NESTED_LOOP',
        severity: 'MEDIUM',
        pattern: /for\s*\([^)]+\)\s*\{[^}]*for\s*\(/,
        message: 'Nested loop detected',
        impact: 'O(n²) or worse time complexity',
        optimization: 'Consider using hash maps, sets, or sorting to reduce complexity',
        languages: ['*'],
      },
      {
        id: 'regex-in-loop',
        category: 'REGEX_IN_LOOP',
        severity: 'MEDIUM',
        pattern: /for\s*\([^)]+\)\s*\{[^}]*new RegExp|Pattern\.compile/,
        message: 'Regex compilation in loop',
        impact: 'Regex compilation is expensive',
        optimization: 'Compile regex once outside the loop',
        languages: ['java', 'typescript', 'javascript'],
      },
      {
        id: 'json-parse-loop',
        category: 'JSON_IN_LOOP',
        severity: 'MEDIUM',
        pattern: /for\s*\([^)]+\)\s*\{[^}]*JSON\.parse/,
        message: 'JSON.parse in loop',
        impact: 'JSON parsing is CPU-intensive',
        optimization: 'Parse JSON once before the loop if possible',
        languages: ['typescript', 'javascript'],
      },
      {
        id: 'sync-io',
        category: 'SYNC_IO',
        severity: 'HIGH',
        pattern: /readFileSync|writeFileSync|execSync/,
        message: 'Synchronous I/O operation',
        impact: 'Blocks the event loop',
        optimization: 'Use async versions: readFile, writeFile, exec',
        languages: ['typescript', 'javascript'],
      },
      {
        id: 'array-length-loop',
        category: 'ARRAY_LENGTH',
        severity: 'LOW',
        pattern: /for\s*\(\s*\w+\s*=\s*0\s*;\s*\w+\s*<\s*\w+\.length\s*;/,
        message: 'Array length accessed in loop condition',
        impact: 'Minor: length recalculated each iteration',
        optimization: 'Cache length: for(let i=0, len=arr.length; i<len; i++)',
        languages: ['typescript', 'javascript'],
      },
      {
        id: 'console-log',
        category: 'DEBUG_LOG',
        severity: 'LOW',
        pattern: /console\.(log|debug|info)\s*\(/,
        message: 'Console log statement',
        impact: 'I/O overhead and potential memory leaks',
        optimization: 'Remove or use conditional logging in production',
        languages: ['typescript', 'javascript'],
      },
      {
        id: 'system-out',
        category: 'DEBUG_LOG',
        severity: 'LOW',
        pattern: /System\.(out|err)\.(print|println)/,
        message: 'System.out/err statement',
        impact: 'I/O overhead and not suitable for production',
        optimization: 'Use logging framework (SLF4J, Log4j2)',
        languages: ['java'],
      },
      {
        id: 'autoboxing',
        category: 'AUTOBOXING',
        severity: 'LOW',
        pattern: /List<Integer>|List<Long>|List<Double>|Map<\w+,\s*Integer>/,
        message: 'Primitive wrapper types in collection',
        impact: 'Autoboxing overhead and memory usage',
        optimization: 'Consider primitive collections (Eclipse Collections, fastutil)',
        languages: ['java'],
      },
      {
        id: 'reflection',
        category: 'REFLECTION',
        severity: 'MEDIUM',
        pattern: /\.getClass\(\)|\.getDeclaredMethod|\.getDeclaredField|Class\.forName/,
        message: 'Reflection usage detected',
        impact: 'Reflection is slow compared to direct access',
        optimization: 'Cache reflection results or use code generation',
        languages: ['java'],
      },
      {
        id: 'global-regex',
        category: 'GLOBAL_REGEX',
        severity: 'LOW',
        pattern: /\/[^/]+\/g(?!i)/,
        message: 'Global regex without optimization',
        impact: 'Regex with global flag can be slow on large strings',
        optimization: 'Consider using indexOf/includes for simple patterns',
        languages: ['typescript', 'javascript'],
      },
      {
        id: 'spread-in-reduce',
        category: 'SPREAD_REDUCE',
        severity: 'MEDIUM',
        pattern: /\.reduce\([^)]*\.\.\./,
        message: 'Spread operator in reduce callback',
        impact: 'O(n²) due to array copying on each iteration',
        optimization: 'Mutate accumulator directly: acc.push(item); return acc',
        languages: ['typescript', 'javascript'],
      },
      {
        id: 'create-element-loop',
        category: 'DOM_IN_LOOP',
        severity: 'MEDIUM',
        pattern: /for\s*\([^)]+\)\s*\{[^}]*document\.createElement/,
        message: 'DOM creation in loop',
        impact: 'DOM operations are slow',
        optimization: 'Use DocumentFragment or build HTML string',
        languages: ['typescript', 'javascript'],
      },
    ];
  }
}

export default new PerformanceReviewer();
