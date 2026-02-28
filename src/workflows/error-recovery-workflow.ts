import { execSync } from 'child_process';
import { ExecutionContext, WorkflowResult } from '../core/types';
import ReportGenerator from '../core/ReportGenerator';
import WorkflowOrchestrator from '../core/WorkflowOrchestrator';
import AgentOrchestrator, { AgentRequest } from '../agents/AgentOrchestrator';
import BuildValidator from '../validators/BuildValidator';
import TestValidator from '../validators/TestValidator';
import LintValidator from '../validators/LintValidator';
import logger from '../utils/logger';

/**
 * Phase 3.5: Error Recovery Workflow
 *
 * Runs after implementation/testing to auto-remediate errors:
 * 1. Detect compilation errors
 * 2. Detect test failures
 * 3. Detect linting issues
 * 4. Invoke ErrorFixer agent for remediation
 * 5. Re-run validators to confirm fixes
 */
export async function runErrorRecoveryWorkflow(context: ExecutionContext): Promise<void> {
  logger.info('========== ERROR RECOVERY WORKFLOW (Phase 3.5) ==========');

  const orchestrator = WorkflowOrchestrator;
  const agentOrchestrator = AgentOrchestrator;
  const startTime = Date.now();

  try {
    // Run validators to detect errors
    logger.info('\n--- Error Detection ---');
    const buildResult = await BuildValidator.validate(context);
    const testResult = await TestValidator.validate(context);
    const lintResult = await LintValidator.validate(context);

    const allErrors = [
      ...buildResult.errors,
      ...testResult.errors,
      ...lintResult.errors,
    ];

    if (allErrors.length === 0) {
      logger.info('✓ No errors detected, skipping error recovery');
      return;
    }

    logger.warn(`Found ${allErrors.length} error(s), attempting auto-recovery...`);

    // Prepare error context
    const errorContext = {
      buildErrors: buildResult.errors,
      testErrors: testResult.errors,
      lintErrors: lintResult.errors,
      projectAnalysis: context.projectAnalysis,
      testPatterns: context.testPatterns,
    };

    // Prepare agent request
    const agentRequest: AgentRequest = {
      agentId: 'error-fixer',
      task: `Fix the following errors in the project:

Build Errors: ${buildResult.errors.length}
${buildResult.errors.map(e => `- ${e}`).join('\n')}

Test Errors: ${testResult.errors.length}
${testResult.errors.map(e => `- ${e}`).join('\n')}

Lint Errors: ${lintResult.errors.length}
${lintResult.errors.map(e => `- ${e}`).join('\n')}

For each error:
1. Identify the root cause
2. Suggest a fix
3. Provide code correction
4. Verify the fix does not break functionality`,

      context: errorContext,
    };

    // Invoke ErrorFixer agent
    logger.info('Invoking ErrorFixer agent...');
    const agentResponse = await agentOrchestrator.invoke(agentRequest);

    if (!agentResponse.success) {
      logger.error(`ErrorFixer agent failed: ${agentResponse.errors?.join(', ')}`);
      throw new Error('Error recovery failed');
    }

    logger.info(`✓ ErrorFixer suggestions generated (${agentResponse.metadata.duration}ms)`);
    logger.info(agentResponse.output);

    // Attempt auto-fix for linting errors
    logger.info('\n--- Auto-Fixing Linting Issues ---');
    if (lintResult.errors.length > 0) {
      try {
        if (context.projectAnalysis?.language === 'TypeScript') {
          execSync('npx eslint --fix src', { cwd: context.task.projectPath });
          logger.info('✓ Auto-fixed TypeScript linting issues');
        } else if (context.projectAnalysis?.language === 'Java') {
          execSync('mvn spotless:apply -q', { cwd: context.task.projectPath });
          logger.info('✓ Auto-fixed Java formatting issues');
        }
      } catch (error: unknown) {
        logger.warn(`Auto-fix attempted but needs manual review: ${error}`);
      }
    }

    // Re-run validators after fixes
    logger.info('\n--- Validating Fixes ---');
    const buildResultAfter = await BuildValidator.validate(context);
    const testResultAfter = await TestValidator.validate(context);
    const lintResultAfter = await LintValidator.validate(context);

    const remainingErrors = [
      ...buildResultAfter.errors,
      ...testResultAfter.errors,
      ...lintResultAfter.errors,
    ];

    // Record results
    const phaseResult: WorkflowResult = {
      phase: 35, // Phase 3.5
      status: remainingErrors.length === 0 ? 'SUCCESS' : 'PARTIAL',
      duration: Date.now() - startTime,
      message: `Error recovery ${remainingErrors.length === 0 ? 'successful' : 'partial'}: ${remainingErrors.length} error(s) remain`,
      data: {
        errorsInitial: allErrors.length,
        errorsRemaining: remainingErrors.length,
        errorsFixed: allErrors.length - remainingErrors.length,
        agentDuration: agentResponse.metadata.duration,
      },
      errors: remainingErrors,
    };

    orchestrator.recordPhaseResult(35, phaseResult);

    // Generate report
    const reportPath = await generateErrorRecoveryReport(context, phaseResult);
    orchestrator.recordReport('Phase35', reportPath);

    logger.info(`✓ Error recovery report: ${reportPath}`);
    logger.info(
      `✓ Fixed ${allErrors.length - remainingErrors.length}/${allErrors.length} errors`
    );
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Error recovery workflow error:', { error: errorMsg });

    const phaseResult: WorkflowResult = {
      phase: 35,
      status: 'FAILURE',
      duration: Date.now() - startTime,
      message: 'Error recovery workflow failed',
      errors: [errorMsg],
    };

    orchestrator.recordPhaseResult(35, phaseResult);
  }

  logger.info('\n========== ERROR RECOVERY WORKFLOW COMPLETE ==========');
}

async function generateErrorRecoveryReport(
  context: ExecutionContext,
  result: WorkflowResult
): Promise<string> {
  const { writeFile } = await import('../utils/file-utils');

  const reportPath = `${context.workingDir}/task-automation-error-recovery-report.md`;
  const content = `# Task Automation - Phase 3.5 Error Recovery Report
> Generated: ${new Date().toISOString()}

## Error Recovery Summary
- **Status**: ${result.status}
- **Duration**: ${(result.duration / 1000).toFixed(1)}s
- **Errors Initially Found**: ${result.data?.errorsInitial || 0}
- **Errors Fixed**: ${result.data?.errorsFixed || 0}
- **Errors Remaining**: ${result.data?.errorsRemaining || 0}

## Error Categories

### Build Errors
${result.data?.buildErrors ? `- Count: ${(result.data?.buildErrors as any).length}` : '- None'}

### Test Errors
${result.data?.testErrors ? `- Count: ${(result.data?.testErrors as any).length}` : '- None'}

### Lint Errors
${result.data?.lintErrors ? `- Count: ${(result.data?.lintErrors as any).length}` : '- None'}

## Recovery Actions

### Auto-Fixed Issues
- ESLint violations (TypeScript)
- Spotless formatting (Java)
- Code style issues

### Manual Review Required
${
  result.errors && result.errors.length > 0
    ? result.errors.map(e => `- ${e}`).join('\n')
    : '- None'
}

## Agent Metrics
- Duration: ${result.data?.agentDuration || 'N/A'}ms
- Model: claude-opus-4.6
- Purpose: Analyze errors and suggest fixes

## Next Steps
${
  result.data?.errorsRemaining && (result.data?.errorsRemaining as number) > 0
    ? `1. Review remaining errors above
2. Apply suggested fixes manually
3. Re-run validators
4. Address any new issues
5. Continue with Phase 4`
    : `1. ✓ All errors resolved
2. Continue with Phase 4: Testing`
}

---
Generated by Task Automation Engine
`;

  await writeFile(reportPath, content);
  return reportPath;
}
