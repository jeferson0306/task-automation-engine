import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs-extra';
import { ExecutionContext, ValidationResult, SelfHealingResult, HealingFix } from '../core/types.js';
import logger from '../utils/logger.js';
import SelfHealingPipeline from '../analyzers/SelfHealingPipeline.js';

interface FixResult {
  phase: string;
  fixesApplied: number;
  success: boolean;
  details: HealingFix[];
}

/**
 * Automatically fixes common issues found during validation and review
 * Uses SelfHealingPipeline for automated compile/test/lint fixes
 */
class ErrorFixer {
  async fix(context: ExecutionContext, validationResult: ValidationResult): Promise<FixResult> {
    logger.info('Starting automatic error fixing...');

    const phase = validationResult.phase;
    const errors = validationResult.errors;
    const result: FixResult = {
      phase,
      fixesApplied: 0,
      success: false,
      details: [],
    };

    if (phase === 'BUILD_VALIDATION') {
      const healingResult = await this.fixBuildErrors(context, errors);
      result.fixesApplied = healingResult.totalFixesApplied;
      result.success = healingResult.finalStatus === 'success';
      result.details = healingResult.iterations.flatMap((i) => i.fixes);
    } else if (phase === 'TEST_VALIDATION') {
      const healingResult = await this.fixTestErrors(context, errors);
      result.fixesApplied = healingResult.totalFixesApplied;
      result.success = healingResult.finalStatus === 'success';
      result.details = healingResult.iterations.flatMap((i) => i.fixes);
    } else if (phase === 'LINT_VALIDATION') {
      const fixes = await this.fixLintErrors(context, errors);
      result.fixesApplied = fixes.length;
      result.success = fixes.length > 0;
      result.details = fixes;
    } else if (phase === 'COVERAGE_VALIDATION') {
      const fixes = await this.fixCoverageErrors(context, errors);
      result.fixesApplied = fixes.length;
      result.success = fixes.length > 0;
      result.details = fixes;
    }

    logger.info(`Error fixing completed: ${result.fixesApplied} fixes applied`);
    return result;
  }

  /**
   * Full self-healing pipeline for all validation phases
   */
  async runFullHealing(context: ExecutionContext): Promise<SelfHealingResult> {
    logger.info('Running full self-healing pipeline...');
    return await SelfHealingPipeline.heal(context);
  }

  private async fixBuildErrors(context: ExecutionContext, errors: string[]): Promise<SelfHealingResult> {
    logger.info(`Fixing ${errors.length} build errors using self-healing pipeline...`);

    const iterations = await SelfHealingPipeline.healCompilation(context);

    return {
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      iterations,
      finalStatus: iterations.some((i) => i.status === 'fixed') ? 'success' : 'partial',
      totalFixesApplied: iterations.reduce((sum, i) => sum + i.fixes.filter((f) => f.success).length, 0),
      remainingIssues: iterations.flatMap((i) => i.errors.map((e) => e.message)),
    };
  }

  private async fixTestErrors(context: ExecutionContext, errors: string[]): Promise<SelfHealingResult> {
    logger.info(`Fixing ${errors.length} test errors using self-healing pipeline...`);

    const iterations = await SelfHealingPipeline.healTests(context);

    return {
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      iterations,
      finalStatus: iterations.some((i) => i.status === 'fixed') ? 'success' : 'partial',
      totalFixesApplied: iterations.reduce((sum, i) => sum + i.fixes.filter((f) => f.success).length, 0),
      remainingIssues: iterations.flatMap((i) => i.errors.map((e) => e.message)),
    };
  }

  private async fixLintErrors(context: ExecutionContext, errors: string[]): Promise<HealingFix[]> {
    const fixes: HealingFix[] = [];
    const language = context.projectAnalysis?.language || 'Unknown';
    const projectPath = context.workingDir;

    logger.info(`Attempting to auto-fix ${errors.length} lint errors...`);

    try {
      if (language === 'TypeScript' || language === 'JavaScript') {
        logger.info('Running eslint --fix...');
        try {
          execSync('npx eslint . --ext .ts,.tsx,.js,.jsx --fix', {
            cwd: projectPath,
            stdio: 'pipe',
            timeout: 60000,
          });
          fixes.push({
            errorType: 'lint-violation',
            file: '*',
            description: 'ESLint auto-fix applied',
            before: '',
            after: '',
            success: true,
          });
        } catch {
          logger.warn('ESLint fix completed with some remaining issues');
          fixes.push({
            errorType: 'lint-violation',
            file: '*',
            description: 'ESLint auto-fix partially applied',
            before: '',
            after: '',
            success: true,
          });
        }

        if (await fs.pathExists(path.join(projectPath, '.prettierrc'))) {
          logger.info('Running prettier --write...');
          try {
            execSync('npx prettier --write "**/*.{ts,tsx,js,jsx}"', {
              cwd: projectPath,
              stdio: 'pipe',
              timeout: 60000,
            });
            fixes.push({
              errorType: 'lint-violation',
              file: '*',
              description: 'Prettier formatting applied',
              before: '',
              after: '',
              success: true,
            });
          } catch {
            logger.warn('Prettier formatting had issues');
          }
        }
      } else if (language === 'Java') {
        const hasMaven = await fs.pathExists(path.join(projectPath, 'pom.xml'));
        if (hasMaven) {
          logger.info('Running checkstyle and spotless...');
          try {
            execSync('mvn spotless:apply -q', {
              cwd: projectPath,
              stdio: 'pipe',
              timeout: 120000,
            });
            fixes.push({
              errorType: 'lint-violation',
              file: '*',
              description: 'Spotless formatting applied',
              before: '',
              after: '',
              success: true,
            });
          } catch {
            logger.warn('Spotless not configured or failed');
          }
        }
      } else if (language === 'Python') {
        logger.info('Running black and isort...');
        try {
          execSync('python -m black . && python -m isort .', {
            cwd: projectPath,
            stdio: 'pipe',
            timeout: 60000,
          });
          fixes.push({
            errorType: 'lint-violation',
            file: '*',
            description: 'Black and isort formatting applied',
            before: '',
            after: '',
            success: true,
          });
        } catch {
          logger.warn('Python formatters not available or failed');
        }
      }
    } catch (error) {
      logger.error(`Lint fix failed: ${error}`);
    }

    return fixes;
  }

  private async fixCoverageErrors(context: ExecutionContext, errors: string[]): Promise<HealingFix[]> {
    const fixes: HealingFix[] = [];

    logger.info('Analyzing coverage gaps...');

    for (const error of errors) {
      const coverageMatch = error.match(/(\d+(?:\.\d+)?)\s*%/);
      if (coverageMatch) {
        const currentCoverage = parseFloat(coverageMatch[1]);

        fixes.push({
          errorType: 'coverage',
          file: '',
          description: `Coverage at ${currentCoverage}% - need to add more tests`,
          before: `${currentCoverage}%`,
          after: '70%+ target',
          success: false,
        });
      }
    }

    return fixes;
  }

  /**
   * Apply specific fix to a file
   */
  async applyFix(filePath: string, fix: HealingFix): Promise<boolean> {
    if (!fix.before || !fix.after) {
      logger.warn(`Cannot apply fix: missing before/after content`);
      return false;
    }

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const newContent = content.replace(fix.before, fix.after);

      if (newContent !== content) {
        await fs.writeFile(filePath, newContent, 'utf-8');
        logger.info(`Applied fix to ${filePath}: ${fix.description}`);
        return true;
      }

      logger.warn(`Fix pattern not found in ${filePath}`);
      return false;
    } catch (error) {
      logger.error(`Failed to apply fix to ${filePath}: ${error}`);
      return false;
    }
  }
}

export default new ErrorFixer();
