import { ExecutionContext, WorkflowResult } from '../core/types';
import ReportGenerator from '../core/ReportGenerator';
import WorkflowOrchestrator from '../core/WorkflowOrchestrator';
import AgentOrchestrator, { AgentRequest, AgentResponse } from '../agents/AgentOrchestrator';
import TestValidator from '../validators/TestValidator';
import CodeCoverageValidator from '../validators/CodeCoverageValidator';
import logger from '../utils/logger';

/**
 * Phase 4: Testing Workflow
 *
 * Uses TestImplementer agent to generate comprehensive tests for implemented feature:
 * 1. Unit tests with full coverage
 * 2. Integration tests for external dependencies
 * 3. Edge case and error path tests
 *
 * Then validates with TestValidator and CodeCoverageValidator
 */
export async function runTestingWorkflow(
  context: ExecutionContext
): Promise<void> {
  logger.info('========== TESTING WORKFLOW (Phase 4) ==========');

  const orchestrator = WorkflowOrchestrator;
  const agentOrchestrator = AgentOrchestrator;
  const startTime = Date.now();

  try {
    // Phase 4: Test Implementation
    logger.info('\n--- Phase 4: Test Implementation ---');

    if (!context.projectAnalysis || !context.testPatterns) {
      throw new Error('Project analysis and test patterns required. Run Phases 1-2 first.');
    }

    // Prepare agent request
    const agentRequest: AgentRequest = {
      agentId: 'test-implementer',
      task: `Generate comprehensive tests for the following feature:

Task ID: ${context.task.taskId}
Feature: ${context.task.title}
Description: ${context.task.description}

Acceptance Criteria:
${context.task.acceptanceCriteria.map(c => `- ${c}`).join('\n')}

Test Requirements:
- Minimum Coverage: ${context.testPatterns.coverageBaseline || 70}%
- Test Framework: ${context.testPatterns.framework}
- Mocking Library: ${context.testPatterns.mockingLibrary}
- Assertion Library: ${context.testPatterns.assertionLibrary}`,

      context: {
        projectAnalysis: context.projectAnalysis,
        testPatterns: context.testPatterns,
        codeStylePatterns: context.codeStylePatterns,
        testingStrategy: {
          framework: context.testPatterns.framework,
          frameworkVersion: context.testPatterns.frameworkVersion,
          namingConvention: context.testPatterns.namingConvention,
          mockingLibrary: context.testPatterns.mockingLibrary,
          assertionLibrary: context.testPatterns.assertionLibrary,
          coverageTarget: context.testPatterns.coverageBaseline || 70,
        },
      },
    };

    // Invoke TestImplementer agent
    logger.info('Invoking TestImplementer agent...');
    const agentResponse = await agentOrchestrator.invoke(agentRequest);

    if (!agentResponse.success) {
      throw new Error(`Agent invocation failed: ${agentResponse.errors?.join(', ')}`);
    }

    // Save generated tests
    const generatedTestsPath = await saveGeneratedTests(context, agentResponse);

    logger.info(`✓ Test implementation generated: ${generatedTestsPath}`);
    logger.info(`  Duration: ${agentResponse.metadata.duration}ms`);

    // Run tests
    logger.info('\n--- Test Execution ---');
    const testResult = await TestValidator.validate(context);

    // Check coverage
    logger.info('\n--- Coverage Validation ---');
    const coverageResult = await CodeCoverageValidator.validate(context);

    const phaseResult: WorkflowResult = {
      phase: 4,
      status: testResult.success && coverageResult.success ? 'SUCCESS' : 'FAILURE',
      duration: Date.now() - startTime,
      message: `Testing phase ${
        testResult.success && coverageResult.success ? 'successful' : 'failed'
      }`,
      data: {
        agentResponse: {
          duration: agentResponse.metadata.duration,
          tokensUsed: agentResponse.metadata.tokensUsed,
        },
        testExecution: testResult.success ? 'PASSED' : 'FAILED',
        coverageValidation: coverageResult.success ? 'PASSED' : 'FAILED',
        generatedTestsPath,
        coverage: coverageResult.details.coverage,
      },
      errors: [...(testResult.errors || []), ...(coverageResult.errors || [])],
    };

    orchestrator.recordPhaseResult(4, phaseResult);

    // Generate phase report
    const reportPath = await ReportGenerator.generateTestingReport(context, phaseResult);
    orchestrator.recordReport('Phase4', reportPath);

    logger.info(`✓ Testing phase complete: ${reportPath}`);

    if (!testResult.success) {
      logger.warn('Test execution failed. Review errors above.');
    } else {
      logger.info('✓ Test execution passed');
    }

    if (!coverageResult.success) {
      logger.warn('Coverage validation failed. Review errors above.');
    } else {
      logger.info(
        `✓ Coverage validation passed (${coverageResult.details.coverage}% coverage)`
      );
    }
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Testing workflow error:', { error: errorMsg });

    const phaseResult: WorkflowResult = {
      phase: 4,
      status: 'FAILURE',
      duration: Date.now() - startTime,
      message: 'Testing workflow failed',
      errors: [errorMsg],
    };

    orchestrator.recordPhaseResult(4, phaseResult);
  }

  logger.info('\n========== TESTING WORKFLOW COMPLETE ==========');
}

async function saveGeneratedTests(context: ExecutionContext, response: AgentResponse): Promise<string> {
  // In real implementation, this would parse agent output and save to actual test files
  // For now, save a report of what was generated
  const { writeFile } = await import('../utils/file-utils');

  const reportPath = `${context.workingDir}/task-automation-generated-tests-report.md`;
  const content = `# Generated Tests Report
> Generated: ${new Date().toISOString()}

## Testing Status
- **Agent**: TestImplementer
- **Duration**: ${response.metadata.duration}ms
- **Tokens Used**: ${response.metadata.tokensUsed}

## Generated Output
${response.output}

## Integration Steps
1. Review generated tests
2. Apply changes to test files (based on agent suggestions)
3. Run full test suite
4. Verify coverage meets requirements (70%+)
5. Address any failing tests

## Next Phase
- Phase 5: Code Review
- Phase 6: Security Review & Performance Analysis
- Phase 7: Finalization & Staging

---
Generated by Task Automation Engine
`;

  await writeFile(reportPath, content);
  return reportPath;
}
