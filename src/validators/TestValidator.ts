import { execSync } from 'child_process';
import { ExecutionContext, ValidationResult } from '../core/types';
import logger from '../utils/logger';

/**
 * Validates that all tests pass
 */
class TestValidator {
  async validate(context: ExecutionContext): Promise<ValidationResult> {
    const startTime = Date.now();
    logger.info('Starting test validation...');

    try {
      const projectPath = context.task.projectPath;
      const projectAnalysis = context.projectAnalysis;

      if (!projectAnalysis) {
        return {
          phase: 'TEST_VALIDATION',
          success: false,
          errors: ['Project analysis not completed.'],
          warnings: [],
          duration: Date.now() - startTime,
          details: {},
        };
      }

      const testFramework = projectAnalysis.testFramework;
      const errors: string[] = [];
      const warnings: string[] = [];
      const details: Record<string, unknown> = {};

      let testCommand = '';
      switch (projectAnalysis.buildTool.toLowerCase()) {
        case 'maven':
          testCommand = 'mvn test -q';
          break;
        case 'gradle':
          testCommand = './gradlew test';
          break;
        case 'npm':
          testCommand = 'npm test';
          break;
        case 'yarn':
          testCommand = 'yarn test';
          break;
        case 'cargo':
          testCommand = 'cargo test';
          break;
        case 'go':
          testCommand = 'go test ./...';
          break;
        default:
          testCommand = 'npm test'; // Fallback
      }

      try {
        logger.info(`Executing: ${testCommand}`);
        const output = execSync(testCommand, {
          cwd: projectPath,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        const testResult = this.parseTestOutput(output, projectAnalysis.buildTool);
        details.testResult = testResult;

        if (testResult.failed > 0) {
          errors.push(`${testResult.failed} test(s) failed`);
        } else {
          logger.info(`✓ All tests passed (${testResult.passed} tests)`);
        }
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        errors.push(`Tests failed: ${errorMsg.substring(0, 300)}`);
        details.testError = errorMsg;
        logger.error('Tests failed', { error: errorMsg });
      }

      return {
        phase: 'TEST_VALIDATION',
        success: errors.length === 0,
        errors,
        warnings,
        duration: Date.now() - startTime,
        details,
      };
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Test validation error', { error: errorMsg });
      return {
        phase: 'TEST_VALIDATION',
        success: false,
        errors: [errorMsg],
        warnings: [],
        duration: Date.now() - startTime,
        details: {},
      };
    }
  }

  private parseTestOutput(
    output: string,
    buildTool: string
  ): { passed: number; failed: number } {
    const result = { passed: 0, failed: 0 };

    if (buildTool.toLowerCase() === 'maven') {
      const match = output.match(/Tests run: (\d+), Failures: (\d+)/);
      if (match) {
        result.passed = parseInt(match[1], 10) - parseInt(match[2], 10);
        result.failed = parseInt(match[2], 10);
      }
    } else if (buildTool.toLowerCase() === 'gradle') {
      const match = output.match(/(\d+) tests?[,\s]+(\d+) failures?/);
      if (match) {
        result.passed = parseInt(match[1], 10);
        result.failed = parseInt(match[2], 10);
      }
    }

    return result;
  }
}

export default new TestValidator();
