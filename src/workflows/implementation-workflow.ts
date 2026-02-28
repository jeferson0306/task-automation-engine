import { ExecutionContext, WorkflowResult } from '../core/types';
import ReportGenerator from '../core/ReportGenerator';
import WorkflowOrchestrator from '../core/WorkflowOrchestrator';
import AgentOrchestrator, { AgentRequest, AgentResponse } from '../agents/AgentOrchestrator';
import BuildValidator from '../validators/BuildValidator';
import logger from '../utils/logger';

/**
 * Phase 3: Implementation Workflow
 *
 * Uses FeatureImplementer agent to generate feature code based on:
 * 1. Task requirements and acceptance criteria
 * 2. Detected project architecture and patterns
 * 3. Existing code samples from the project
 *
 * Then validates with BuildValidator
 */
export async function runImplementationWorkflow(
  context: ExecutionContext
): Promise<void> {
  logger.info('========== IMPLEMENTATION WORKFLOW (Phase 3) ==========');

  const orchestrator = WorkflowOrchestrator;
  const agentOrchestrator = AgentOrchestrator;
  const startTime = Date.now();

  try {
    // Phase 3: Feature Implementation
    logger.info('\n--- Phase 3: Feature Implementation ---');

    if (!context.projectAnalysis) {
      throw new Error('Project analysis required. Run Phase 1 first.');
    }

    // Prepare agent request
    const agentRequest: AgentRequest = {
      agentId: 'feature-implementer',
      task: `Implement the following feature:

Task ID: ${context.task.taskId}
Title: ${context.task.title}
Description: ${context.task.description}

Acceptance Criteria:
${context.task.acceptanceCriteria.map(c => `- ${c}`).join('\n')}

Estimated Effort: ${context.task.estimatedPoints} story points

Project Type: ${context.projectAnalysis.language} / ${context.projectAnalysis.buildTool}
Framework: ${context.projectAnalysis.framework}
Test Framework: ${context.projectAnalysis.testFramework}`,

      context: {
        projectAnalysis: context.projectAnalysis,
        testPatterns: context.testPatterns,
        codeStylePatterns: context.codeStylePatterns,
        taskRequirements: {
          id: context.task.taskId,
          title: context.task.title,
          criteria: context.task.acceptanceCriteria,
        },
      },
    };

    // Invoke FeatureImplementer agent
    logger.info('Invoking FeatureImplementer agent...');
    const agentResponse = await agentOrchestrator.invoke(agentRequest);

    if (!agentResponse.success) {
      throw new Error(`Agent invocation failed: ${agentResponse.errors?.join(', ')}`);
    }

    // Save generated code
    const generatedCodePath = await saveGeneratedCode(context, agentResponse);

    logger.info(`✓ Feature implementation generated: ${generatedCodePath}`);
    logger.info(`  Duration: ${agentResponse.metadata.duration}ms`);

    // Validate build
    logger.info('\n--- Build Validation ---');
    const buildResult = await BuildValidator.validate(context);

    const phaseResult: WorkflowResult = {
      phase: 3,
      status: buildResult.success ? 'SUCCESS' : 'FAILURE',
      duration: Date.now() - startTime,
      message: `Feature implementation ${buildResult.success ? 'successful' : 'failed'}`,
      data: {
        agentResponse: {
          duration: agentResponse.metadata.duration,
          tokensUsed: agentResponse.metadata.tokensUsed,
        },
        buildValidation: buildResult.success ? 'PASSED' : 'FAILED',
        generatedCodePath,
      },
      errors: buildResult.errors,
    };

    orchestrator.recordPhaseResult(3, phaseResult);

    // Generate phase report
    const reportPath = await ReportGenerator.generateImplementationReport(context, phaseResult);
    orchestrator.recordReport('Phase3', reportPath);

    logger.info(`✓ Implementation phase complete: ${reportPath}`);

    if (!buildResult.success) {
      logger.warn('Build validation failed. Review errors above.');
    } else {
      logger.info('✓ Build validation passed');
    }
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Implementation workflow error:', { error: errorMsg });

    const phaseResult: WorkflowResult = {
      phase: 3,
      status: 'FAILURE',
      duration: Date.now() - startTime,
      message: 'Implementation workflow failed',
      errors: [errorMsg],
    };

    orchestrator.recordPhaseResult(3, phaseResult);
  }

  logger.info('\n========== IMPLEMENTATION WORKFLOW COMPLETE ==========');
}

async function saveGeneratedCode(context: ExecutionContext, response: AgentResponse): Promise<string> {
  // In real implementation, this would parse agent output and save to actual files
  // For now, save a report of what was generated
  const { writeFile } = await import('../utils/file-utils');

  const reportPath = `${context.workingDir}/task-automation-generated-code-report.md`;
  const content = `# Generated Code Report
> Generated: ${new Date().toISOString()}

## Implementation Status
- **Agent**: FeatureImplementer
- **Duration**: ${response.metadata.duration}ms
- **Tokens Used**: ${response.metadata.tokensUsed}

## Generated Output
${response.output}

## Integration Steps
1. Review generated code
2. Apply changes to source files (based on agent suggestions)
3. Run full test suite
4. Execute build validation
5. Move to Phase 4: Testing

---
Generated by Task Automation Engine
`;

  await writeFile(reportPath, content);
  return reportPath;
}
