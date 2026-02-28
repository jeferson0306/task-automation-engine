import { ExecutionContext, WorkflowResult } from '../core/types';
import ReportGenerator from '../core/ReportGenerator';
import WorkflowOrchestrator from '../core/WorkflowOrchestrator';
import BuildValidator from '../validators/BuildValidator';
import TestValidator from '../validators/TestValidator';
import LintValidator from '../validators/LintValidator';
import CodeCoverageValidator from '../validators/CodeCoverageValidator';
import logger from '../utils/logger';

/**
 * Phase 3-4: Validation Workflow
 *
 * Runs all validators in sequence:
 * 1. Build Validation (ensure project compiles)
 * 2. Test Validation (run full test suite)
 * 3. Lint Validation (code style checks)
 * 4. Code Coverage Validation (coverage thresholds)
 */
export async function runValidationWorkflow(
  context: ExecutionContext
): Promise<void> {
  logger.info('========== VALIDATION WORKFLOW (Phase 3-4) ==========');

  const orchestrator = WorkflowOrchestrator;
  const validators = [
    {
      name: 'Build',
      phase: 3,
      validator: BuildValidator,
    },
    {
      name: 'Test',
      phase: 4,
      validator: TestValidator,
    },
    {
      name: 'Lint',
      phase: 5,
      validator: LintValidator,
    },
    {
      name: 'Coverage',
      phase: 6,
      validator: CodeCoverageValidator,
    },
  ];

  for (const validatorConfig of validators) {
    const startTime = Date.now();
    logger.info(`\n--- Phase ${validatorConfig.phase}: ${validatorConfig.name} Validation ---`);

    try {
      const result = await validatorConfig.validator.validate(context);

      const phaseResult: WorkflowResult = {
        phase: validatorConfig.phase,
        status: result.success ? 'SUCCESS' : 'FAILURE',
        duration: result.duration,
        message: `${validatorConfig.name} validation ${result.success ? 'passed' : 'failed'}`,
        data: result.details,
        errors: result.errors,
      };

      orchestrator.recordPhaseResult(validatorConfig.phase, phaseResult);

      // Generate phase report
      const reportPath = await ReportGenerator.generateValidationReport(
        context,
        validatorConfig.phase,
        result
      );
      orchestrator.recordReport(`Phase${validatorConfig.phase}`, reportPath);

      if (!result.success) {
        logger.warn(`${validatorConfig.name} validation failed with ${result.errors.length} error(s)`);
        for (const error of result.errors) {
          logger.error(`  - ${error}`);
        }
      } else {
        logger.info(`✓ ${validatorConfig.name} validation passed in ${result.duration}ms`);
      }

      if (result.warnings.length > 0) {
        for (const warning of result.warnings) {
          logger.warn(`  - ${warning}`);
        }
      }
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`${validatorConfig.name} validation error:`, { error: errorMsg });

      const phaseResult: WorkflowResult = {
        phase: validatorConfig.phase,
        status: 'FAILURE',
        duration: Date.now() - startTime,
        message: `${validatorConfig.name} validation failed`,
        errors: [errorMsg],
      };

      orchestrator.recordPhaseResult(validatorConfig.phase, phaseResult);
    }
  }

  logger.info('\n========== VALIDATION WORKFLOW COMPLETE ==========');
}
