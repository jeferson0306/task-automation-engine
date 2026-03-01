import { execSync, ExecSyncOptions } from 'child_process';
import path from 'path';
import fs from 'fs-extra';
import { logger } from '../utils/logger.js';
import {
  SelfHealingResult,
  HealingIteration,
  HealingError,
  HealingFix,
  ExecutionContext,
  ProjectSnapshot,
} from '../core/types.js';
import ProjectScanner from './ProjectScanner.js';

const MAX_ITERATIONS = 3;

/**
 * Error pattern with fix strategy
 */
interface ErrorPattern {
  pattern: RegExp;
  type: 'compilation' | 'test-failure' | 'lint-violation';
  extractInfo: (match: RegExpMatchArray) => { file: string; line?: number; message: string };
  suggestFix: (error: HealingError, content: string) => HealingFix | null;
}

/**
 * Self-Healing Pipeline - Based on test-lens patterns
 * Automatically fixes compilation and test errors in a loop
 */
export class SelfHealingPipeline {
  private errorPatterns: ErrorPattern[] = [];

  constructor() {
    this.initializePatterns();
  }

  /**
   * Run self-healing pipeline until success or max iterations
   */
  async heal(context: ExecutionContext): Promise<SelfHealingResult> {
    logger.info('Starting self-healing pipeline...');

    const snapshot = context.projectSnapshot || (await ProjectScanner.scan(context.workingDir));
    context.projectSnapshot = snapshot;

    const result: SelfHealingResult = {
      startedAt: new Date().toISOString(),
      completedAt: '',
      iterations: [],
      finalStatus: 'failed',
      totalFixesApplied: 0,
      remainingIssues: [],
    };

    for (const phase of ['compile', 'test', 'lint'] as const) {
      let iterationCount = 0;
      let lastErrors: HealingError[] = [];

      while (iterationCount < MAX_ITERATIONS) {
        iterationCount++;
        logger.info(`Self-healing iteration ${iterationCount} - Phase: ${phase}`);

        const errors = await this.runPhase(phase, context);

        if (errors.length === 0) {
          result.iterations.push({
            iteration: iterationCount,
            phase,
            errors: [],
            fixes: [],
            status: 'fixed',
          });
          break;
        }

        if (this.errorsMatch(errors, lastErrors)) {
          logger.warn(`No progress made in ${phase} phase, moving on...`);
          result.iterations.push({
            iteration: iterationCount,
            phase,
            errors,
            fixes: [],
            status: 'failed',
          });
          result.remainingIssues.push(...errors.map((e) => `[${phase}] ${e.file}: ${e.message}`));
          break;
        }

        lastErrors = errors;

        const fixes = await this.attemptFixes(errors, context);
        const successfulFixes = fixes.filter((f) => f.success);

        result.totalFixesApplied += successfulFixes.length;

        result.iterations.push({
          iteration: iterationCount,
          phase,
          errors,
          fixes,
          status: successfulFixes.length > 0 ? 'partial' : 'failed',
        });

        if (successfulFixes.length === 0) {
          logger.warn(`Could not fix any errors in ${phase} phase`);
          result.remainingIssues.push(...errors.map((e) => `[${phase}] ${e.file}: ${e.message}`));
          break;
        }
      }
    }

    result.completedAt = new Date().toISOString();
    result.finalStatus = result.remainingIssues.length === 0 ? 'success' : result.totalFixesApplied > 0 ? 'partial' : 'failed';

    logger.info(`Self-healing complete: ${result.finalStatus} (${result.totalFixesApplied} fixes applied)`);

    return result;
  }

  /**
   * Run a specific phase and collect errors
   */
  private async runPhase(
    phase: 'compile' | 'test' | 'lint',
    context: ExecutionContext
  ): Promise<HealingError[]> {
    const errors: HealingError[] = [];
    const projectPath = context.workingDir;
    const language = context.projectAnalysis?.language || 'Unknown';

    const execOptions: ExecSyncOptions = {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 120000,
    };

    try {
      let command = '';

      if (phase === 'compile') {
        if (language === 'Java') {
          if (await fs.pathExists(path.join(projectPath, 'pom.xml'))) {
            command = 'mvn compile -q';
          } else if (await fs.pathExists(path.join(projectPath, 'build.gradle'))) {
            command = './gradlew compileJava -q';
          }
        } else if (language === 'TypeScript') {
          command = 'npx tsc --noEmit';
        } else if (language === 'Go') {
          command = 'go build ./...';
        }
      } else if (phase === 'test') {
        if (language === 'Java') {
          if (await fs.pathExists(path.join(projectPath, 'pom.xml'))) {
            command = 'mvn test -q';
          } else {
            command = './gradlew test -q';
          }
        } else if (language === 'TypeScript' || language === 'JavaScript') {
          command = 'npm test -- --passWithNoTests 2>&1 || true';
        } else if (language === 'Python') {
          command = 'pytest -v 2>&1 || true';
        } else if (language === 'Go') {
          command = 'go test ./... 2>&1 || true';
        }
      } else if (phase === 'lint') {
        if (language === 'TypeScript' || language === 'JavaScript') {
          command = 'npx eslint . --ext .ts,.tsx,.js,.jsx 2>&1 || true';
        } else if (language === 'Python') {
          command = 'pylint **/*.py 2>&1 || true';
        } else if (language === 'Java') {
          command = 'mvn checkstyle:check -q 2>&1 || true';
        }
      }

      if (!command) {
        logger.warn(`No ${phase} command for ${language}`);
        return errors;
      }

      logger.info(`Running: ${command}`);
      execSync(command, execOptions);
    } catch (error: unknown) {
      const execError = error as { stdout?: string; stderr?: string; message?: string };
      const output = execError.stdout || execError.stderr || execError.message || '';
      errors.push(...this.parseErrors(output, phase));
    }

    return errors;
  }

  /**
   * Parse error output into structured errors
   */
  private parseErrors(output: string, phase: 'compile' | 'test' | 'lint'): HealingError[] {
    const errors: HealingError[] = [];
    const lines = output.split('\n');

    for (const errorPattern of this.errorPatterns) {
      if (
        (phase === 'compile' && errorPattern.type !== 'compilation') ||
        (phase === 'test' && errorPattern.type !== 'test-failure') ||
        (phase === 'lint' && errorPattern.type !== 'lint-violation')
      ) {
        continue;
      }

      for (const line of lines) {
        const match = line.match(errorPattern.pattern);
        if (match) {
          const info = errorPattern.extractInfo(match);
          errors.push({
            type: errorPattern.type,
            file: info.file,
            line: info.line,
            message: info.message,
          });
        }
      }
    }

    return errors;
  }

  /**
   * Attempt to fix detected errors
   */
  private async attemptFixes(errors: HealingError[], context: ExecutionContext): Promise<HealingFix[]> {
    const fixes: HealingFix[] = [];

    for (const error of errors) {
      const filePath = path.join(context.workingDir, error.file);

      if (!(await fs.pathExists(filePath))) {
        logger.warn(`File not found: ${error.file}`);
        continue;
      }

      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const fix = this.generateFix(error, content);

        if (fix) {
          const newContent = content.replace(fix.before, fix.after);

          if (newContent !== content) {
            await fs.writeFile(filePath, newContent, 'utf-8');
            fix.success = true;
            logger.info(`Applied fix in ${error.file}: ${fix.description}`);
          }
        }

        if (fix) {
          fixes.push(fix);
        }
      } catch (err) {
        logger.warn(`Failed to fix ${error.file}: ${err}`);
      }
    }

    return fixes;
  }

  /**
   * Generate fix for an error
   */
  private generateFix(error: HealingError, content: string): HealingFix | null {
    for (const pattern of this.errorPatterns) {
      if (pattern.type === error.type) {
        const fix = pattern.suggestFix(error, content);
        if (fix) {
          return fix;
        }
      }
    }

    return this.generateGenericFix(error, content);
  }

  /**
   * Generate generic fixes based on common patterns
   */
  private generateGenericFix(error: HealingError, content: string): HealingFix | null {
    if (error.message.includes('cannot find symbol') || error.message.includes('Cannot find name')) {
      const missingMatch = error.message.match(/symbol:\s*(?:class|variable|method)\s+(\w+)/);
      if (missingMatch) {
        const missingSymbol = missingMatch[1];

        const importPatterns: Record<string, string> = {
          List: 'import java.util.List;',
          ArrayList: 'import java.util.ArrayList;',
          Map: 'import java.util.Map;',
          HashMap: 'import java.util.HashMap;',
          Optional: 'import java.util.Optional;',
          Stream: 'import java.util.stream.Stream;',
          Collectors: 'import java.util.stream.Collectors;',
          Test: 'import org.junit.jupiter.api.Test;',
          BeforeEach: 'import org.junit.jupiter.api.BeforeEach;',
          AfterEach: 'import org.junit.jupiter.api.AfterEach;',
          Mock: 'import org.mockito.Mock;',
          InjectMocks: 'import org.mockito.InjectMocks;',
          MockitoExtension: 'import org.mockito.junit.jupiter.MockitoExtension;',
        };

        if (importPatterns[missingSymbol]) {
          const importStatement = importPatterns[missingSymbol];
          const packageMatch = content.match(/^package\s+[\w.]+;\s*\n/m);

          if (packageMatch && !content.includes(importStatement)) {
            return {
              errorType: error.type,
              file: error.file,
              description: `Add missing import for ${missingSymbol}`,
              before: packageMatch[0],
              after: packageMatch[0] + '\n' + importStatement,
              success: false,
            };
          }
        }
      }
    }

    if (error.message.includes('is not a functional interface')) {
      return {
        errorType: error.type,
        file: error.file,
        description: 'Lambda expression issue - review functional interface usage',
        before: '',
        after: '',
        success: false,
      };
    }

    if (error.message.includes('semi-expected') || error.message.includes("';' expected")) {
      const lines = content.split('\n');
      if (error.line && lines[error.line - 1]) {
        const line = lines[error.line - 1];
        if (!line.trim().endsWith(';') && !line.trim().endsWith('{') && !line.trim().endsWith('}')) {
          return {
            errorType: error.type,
            file: error.file,
            description: 'Add missing semicolon',
            before: line,
            after: line.trimEnd() + ';',
            success: false,
          };
        }
      }
    }

    if (error.message.includes('unused import') || error.message.includes('Unused import')) {
      const importMatch = error.message.match(/import\s+([\w.]+)/);
      if (importMatch) {
        const importLine = `import ${importMatch[1]};`;
        if (content.includes(importLine)) {
          return {
            errorType: error.type,
            file: error.file,
            description: `Remove unused import ${importMatch[1]}`,
            before: importLine + '\n',
            after: '',
            success: false,
          };
        }
      }
    }

    return null;
  }

  /**
   * Check if two error sets are equivalent
   */
  private errorsMatch(a: HealingError[], b: HealingError[]): boolean {
    if (a.length !== b.length) return false;

    const aSet = new Set(a.map((e) => `${e.file}:${e.line}:${e.message}`));
    const bSet = new Set(b.map((e) => `${e.file}:${e.line}:${e.message}`));

    for (const item of aSet) {
      if (!bSet.has(item)) return false;
    }

    return true;
  }

  /**
   * Initialize error patterns
   */
  private initializePatterns(): void {
    this.errorPatterns = [
      // Java compilation errors
      {
        pattern: /\[ERROR\]\s+(.+?\.java):\[(\d+),\d+\]\s*(.+)/,
        type: 'compilation',
        extractInfo: (match) => ({
          file: match[1],
          line: parseInt(match[2]),
          message: match[3],
        }),
        suggestFix: (error, content) => {
          if (error.message.includes('cannot find symbol')) {
            return {
              errorType: error.type,
              file: error.file,
              description: 'Missing import or undefined symbol',
              before: '',
              after: '',
              success: false,
            };
          }
          return null;
        },
      },
      // TypeScript compilation errors
      {
        pattern: /(.+\.tsx?)\((\d+),\d+\):\s*error\s+TS\d+:\s*(.+)/,
        type: 'compilation',
        extractInfo: (match) => ({
          file: match[1],
          line: parseInt(match[2]),
          message: match[3],
        }),
        suggestFix: (error, content) => {
          if (error.message.includes("has no exported member")) {
            const memberMatch = error.message.match(/has no exported member '(\w+)'/);
            if (memberMatch) {
              return {
                errorType: error.type,
                file: error.file,
                description: `Missing export for ${memberMatch[1]}`,
                before: '',
                after: '',
                success: false,
              };
            }
          }
          return null;
        },
      },
      // Java test failures
      {
        pattern: /\[ERROR\]\s+(\w+)\.(\w+):\d+\s+(.+)/,
        type: 'test-failure',
        extractInfo: (match) => ({
          file: match[1] + '.java',
          message: `${match[2]}: ${match[3]}`,
        }),
        suggestFix: () => null,
      },
      // Jest test failures
      {
        pattern: /FAIL\s+(.+\.tsx?)/,
        type: 'test-failure',
        extractInfo: (match) => ({
          file: match[1],
          message: 'Test failed',
        }),
        suggestFix: () => null,
      },
      // ESLint errors
      {
        pattern: /(.+\.tsx?):(\d+):\d+:\s*(.+)/,
        type: 'lint-violation',
        extractInfo: (match) => ({
          file: match[1],
          line: parseInt(match[2]),
          message: match[3],
        }),
        suggestFix: (error, content) => {
          if (error.message.includes('prefer-const')) {
            const lines = content.split('\n');
            if (error.line && lines[error.line - 1]) {
              const line = lines[error.line - 1];
              if (line.includes('let ')) {
                return {
                  errorType: error.type,
                  file: error.file,
                  description: 'Change let to const',
                  before: line,
                  after: line.replace(/\blet\s+/, 'const '),
                  success: false,
                };
              }
            }
          }
          return null;
        },
      },
      // Checkstyle errors
      {
        pattern: /\[WARN\]\s+(.+\.java):(\d+)(?::\d+)?:\s*(.+)/,
        type: 'lint-violation',
        extractInfo: (match) => ({
          file: match[1],
          line: parseInt(match[2]),
          message: match[3],
        }),
        suggestFix: () => null,
      },
      // Python pytest failures
      {
        pattern: /FAILED\s+(.+\.py)::(\w+)/,
        type: 'test-failure',
        extractInfo: (match) => ({
          file: match[1],
          message: `Test ${match[2]} failed`,
        }),
        suggestFix: () => null,
      },
      // Pylint errors
      {
        pattern: /(.+\.py):(\d+):\d+:\s*(\w+):\s*(.+)/,
        type: 'lint-violation',
        extractInfo: (match) => ({
          file: match[1],
          line: parseInt(match[2]),
          message: `${match[3]}: ${match[4]}`,
        }),
        suggestFix: () => null,
      },
      // Go compilation errors
      {
        pattern: /(.+\.go):(\d+):\d+:\s*(.+)/,
        type: 'compilation',
        extractInfo: (match) => ({
          file: match[1],
          line: parseInt(match[2]),
          message: match[3],
        }),
        suggestFix: (error, content) => {
          if (error.message.includes('undefined:')) {
            return {
              errorType: error.type,
              file: error.file,
              description: 'Undefined symbol',
              before: '',
              after: '',
              success: false,
            };
          }
          return null;
        },
      },
    ];
  }

  /**
   * Run only compilation phase
   */
  async healCompilation(context: ExecutionContext): Promise<HealingIteration[]> {
    const iterations: HealingIteration[] = [];

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const errors = await this.runPhase('compile', context);

      if (errors.length === 0) {
        iterations.push({
          iteration: i + 1,
          phase: 'compile',
          errors: [],
          fixes: [],
          status: 'fixed',
        });
        break;
      }

      const fixes = await this.attemptFixes(errors, context);

      iterations.push({
        iteration: i + 1,
        phase: 'compile',
        errors,
        fixes,
        status: fixes.some((f) => f.success) ? 'partial' : 'failed',
      });

      if (!fixes.some((f) => f.success)) break;
    }

    return iterations;
  }

  /**
   * Run only test phase
   */
  async healTests(context: ExecutionContext): Promise<HealingIteration[]> {
    const iterations: HealingIteration[] = [];

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const errors = await this.runPhase('test', context);

      if (errors.length === 0) {
        iterations.push({
          iteration: i + 1,
          phase: 'test',
          errors: [],
          fixes: [],
          status: 'fixed',
        });
        break;
      }

      const fixes = await this.attemptFixes(errors, context);

      iterations.push({
        iteration: i + 1,
        phase: 'test',
        errors,
        fixes,
        status: fixes.some((f) => f.success) ? 'partial' : 'failed',
      });

      if (!fixes.some((f) => f.success)) break;
    }

    return iterations;
  }
}

export default new SelfHealingPipeline();
