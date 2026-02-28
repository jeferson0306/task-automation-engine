import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { ExecutionContext, ValidationResult } from '../core/types';
import logger from '../utils/logger';

/**
 * Validates code coverage meets minimum threshold
 */
class CodeCoverageValidator {
  private minCoveragePercent = 70;

  async validate(context: ExecutionContext): Promise<ValidationResult> {
    const startTime = Date.now();
    logger.info('Starting code coverage validation...');

    try {
      const projectPath = context.task.projectPath;
      const projectAnalysis = context.projectAnalysis;

      if (!projectAnalysis) {
        return {
          phase: 'COVERAGE_VALIDATION',
          success: false,
          errors: ['Project analysis not completed.'],
          warnings: [],
          duration: Date.now() - startTime,
          details: {},
        };
      }

      const errors: string[] = [];
      const warnings: string[] = [];
      const details: Record<string, unknown> = {};

      // Generate coverage report
      if (projectAnalysis.buildTool === 'Maven') {
        await this.validateMavenCoverage(projectPath, errors, warnings, details);
      } else if (projectAnalysis.buildTool === 'Gradle') {
        await this.validateGradleCoverage(projectPath, errors, warnings, details);
      } else if (projectAnalysis.language === 'TypeScript' || projectAnalysis.language === 'JavaScript') {
        await this.validateJestCoverage(projectPath, errors, warnings, details);
      }

      return {
        phase: 'COVERAGE_VALIDATION',
        success: errors.length === 0,
        errors,
        warnings,
        duration: Date.now() - startTime,
        details,
      };
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Coverage validation error', { error: errorMsg });
      return {
        phase: 'COVERAGE_VALIDATION',
        success: false,
        errors: [errorMsg],
        warnings: [],
        duration: Date.now() - startTime,
        details: {},
      };
    }
  }

  private async validateMavenCoverage(
    projectPath: string,
    errors: string[],
    _warnings: string[],
    details: Record<string, unknown>
  ): Promise<void> {
    try {
      execSync('mvn clean test jacoco:report -q', {
        cwd: projectPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Parse JaCoCo report
      const reportPath = `${projectPath}/target/site/jacoco/index.html`;
      if (existsSync(reportPath)) {
        const content = readFileSync(reportPath, 'utf-8');
        const match = content.match(/Total.*?([\d.]+)%/);
        if (match) {
          const coverage = parseFloat(match[1]);
          details.coverage = coverage;

          if (coverage < this.minCoveragePercent) {
            errors.push(
              `Code coverage ${coverage}% is below minimum ${this.minCoveragePercent}%`
            );
          } else {
            logger.info(`✓ Code coverage: ${coverage}%`);
          }
        }
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      errors.push(`JaCoCo coverage check failed: ${errorMsg.substring(0, 200)}`);
      details.coverageError = errorMsg;
    }
  }

  private async validateGradleCoverage(
    projectPath: string,
    errors: string[],
    _warnings: string[],
    details: Record<string, unknown>
  ): Promise<void> {
    try {
      execSync('./gradlew jacocoTestReport -q', {
        cwd: projectPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const reportPath = `${projectPath}/build/reports/jacoco/test/html/index.html`;
      if (existsSync(reportPath)) {
        const content = readFileSync(reportPath, 'utf-8');
        const match = content.match(/Total.*?([\d.]+)%/);
        if (match) {
          const coverage = parseFloat(match[1]);
          details.coverage = coverage;

          if (coverage < this.minCoveragePercent) {
            errors.push(
              `Code coverage ${coverage}% is below minimum ${this.minCoveragePercent}%`
            );
          }
        }
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      errors.push(`JaCoCo coverage check failed: ${errorMsg.substring(0, 200)}`);
      details.coverageError = errorMsg;
    }
  }

  private async validateJestCoverage(
    projectPath: string,
    errors: string[],
    _warnings: string[],
    details: Record<string, unknown>
  ): Promise<void> {
    try {
      const output = execSync('npm test -- --coverage --passWithNoTests', {
        cwd: projectPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Parse Jest output
      const match = output.match(/Lines\s*:\s*([\d.]+)%/);
      if (match) {
        const coverage = parseFloat(match[1]);
        details.coverage = coverage;

        if (coverage < this.minCoveragePercent) {
          errors.push(
            `Code coverage ${coverage}% is below minimum ${this.minCoveragePercent}%`
          );
        } else {
          logger.info(`✓ Code coverage: ${coverage}%`);
        }
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      errors.push(`Jest coverage check failed: ${errorMsg.substring(0, 200)}`);
      details.coverageError = errorMsg;
    }
  }
}

export default new CodeCoverageValidator();
