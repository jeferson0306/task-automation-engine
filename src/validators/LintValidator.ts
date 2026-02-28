import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { ExecutionContext, ValidationResult } from '../core/types';
import logger from '../utils/logger';

/**
 * Validates code style and formatting
 */
class LintValidator {
  async validate(context: ExecutionContext): Promise<ValidationResult> {
    const startTime = Date.now();
    logger.info('Starting lint validation...');

    try {
      const projectPath = context.task.projectPath;
      const projectAnalysis = context.projectAnalysis;

      if (!projectAnalysis) {
        return {
          phase: 'LINT_VALIDATION',
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

      // Language-specific lint commands
      if (projectAnalysis.language === 'TypeScript' || projectAnalysis.language === 'JavaScript') {
        await this.lintTypeScript(projectPath, errors, warnings, details);
      } else if (projectAnalysis.language === 'Java') {
        await this.lintJava(projectPath, errors, warnings, details);
      } else if (projectAnalysis.language === 'Python') {
        await this.lintPython(projectPath, errors, warnings, details);
      }

      return {
        phase: 'LINT_VALIDATION',
        success: errors.length === 0,
        errors,
        warnings,
        duration: Date.now() - startTime,
        details,
      };
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Lint validation error', { error: errorMsg });
      return {
        phase: 'LINT_VALIDATION',
        success: false,
        errors: [errorMsg],
        warnings: [],
        duration: Date.now() - startTime,
        details: {},
      };
    }
  }

  private async lintTypeScript(
    projectPath: string,
    errors: string[],
    warnings: string[],
    details: Record<string, unknown>
  ): Promise<void> {
    if (!existsSync(`${projectPath}/.eslintrc.json`)) {
      warnings.push('ESLint config not found, skipping TypeScript lint');
      return;
    }

    try {
      execSync('npx eslint src --max-warnings 0', {
        cwd: projectPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      logger.info('✓ TypeScript lint passed');
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      errors.push(`ESLint failed: ${errorMsg.substring(0, 200)}`);
      details.lintError = errorMsg;
    }
  }

  private async lintJava(
    projectPath: string,
    errors: string[],
    _warnings: string[],
    details: Record<string, unknown>
  ): Promise<void> {
    if (!existsSync(`${projectPath}/checkstyle.xml`)) {
      logger.info('Checkstyle config not found, skipping Java lint');
      return;
    }

    try {
      const hasMaven = existsSync(`${projectPath}/pom.xml`);
      if (hasMaven) {
        execSync('mvn checkstyle:check -q', {
          cwd: projectPath,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        logger.info('✓ Java lint passed');
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      errors.push(`Checkstyle failed: ${errorMsg.substring(0, 200)}`);
      details.lintError = errorMsg;
    }
  }

  private async lintPython(
    projectPath: string,
    errors: string[],
    _warnings: string[],
    details: Record<string, unknown>
  ): Promise<void> {
    try {
      execSync('pylint src --fail-under=8.0', {
        cwd: projectPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      logger.info('✓ Python lint passed');
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      errors.push(`Pylint failed: ${errorMsg.substring(0, 200)}`);
      details.lintError = errorMsg;
    }
  }
}

export default new LintValidator();
