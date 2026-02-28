import { ExecutionContext, WorkflowResult } from '../core/types';
import ReportGenerator from '../core/ReportGenerator';
import WorkflowOrchestrator from '../core/WorkflowOrchestrator';
import AutoCodeReviewer from '../reviewers/AutoCodeReviewer';
import SecurityReviewer from '../reviewers/SecurityReviewer';
import PerformanceReviewer from '../reviewers/PerformanceReviewer';
import logger from '../utils/logger';

/**
 * Phase 5-6: Review Workflow
 *
 * Runs all code reviewers in parallel:
 * 1. Automated Code Review (detect anti-patterns)
 * 2. Security Review (OWASP compliance)
 * 3. Performance Review (optimization opportunities)
 */
export async function runReviewWorkflow(
  context: ExecutionContext
): Promise<void> {
  logger.info('========== REVIEW WORKFLOW (Phase 5-6) ==========');

  const orchestrator = WorkflowOrchestrator;
  const startTime = Date.now();

  try {
    // Run all reviewers in parallel
    logger.info('\nRunning code reviewers in parallel...');

    const [codeReviewIssues, securityFindings, performanceIssues] = await Promise.all([
      AutoCodeReviewer.review(context),
      SecurityReviewer.review(context),
      PerformanceReviewer.review(context),
    ]);

    // Phase 5: Code Review
    logger.info(
      `\n--- Phase 5: Code Review Complete (${codeReviewIssues.length} issues) ---`
    );
    const codeReviewResult: WorkflowResult = {
      phase: 5,
      status: codeReviewIssues.length === 0 ? 'SUCCESS' : 'PARTIAL',
      duration: Date.now() - startTime,
      message: `Code review identified ${codeReviewIssues.length} potential issues`,
      data: { issuesCount: codeReviewIssues.length, issues: codeReviewIssues },
    };
    orchestrator.recordPhaseResult(5, codeReviewResult);

    const codeReviewReport = await ReportGenerator.generateCodeReviewReport(
      context,
      codeReviewIssues
    );
    orchestrator.recordReport('Phase5', codeReviewReport);
    logger.info(`✓ Code review report saved: ${codeReviewReport}`);

    // Phase 6: Security & Performance Review
    logger.info(
      `\n--- Phase 6: Security Review Complete (${securityFindings.length} findings) ---`
    );
    logger.info(`--- Phase 6: Performance Review Complete (${performanceIssues.length} issues) ---`);

    const reviewResult: WorkflowResult = {
      phase: 6,
      status: securityFindings.length === 0 ? 'SUCCESS' : 'PARTIAL',
      duration: Date.now() - startTime,
      message: `Security review identified ${securityFindings.length} findings, Performance review identified ${performanceIssues.length} issues`,
      data: {
        securityFindings: securityFindings.length,
        performanceIssues: performanceIssues.length,
        findings: securityFindings,
        issues: performanceIssues,
      },
    };
    orchestrator.recordPhaseResult(6, reviewResult);

    const securityReport = await ReportGenerator.generateSecurityReport(
      context,
      securityFindings
    );
    const performanceReport = await ReportGenerator.generatePerformanceReport(
      context,
      performanceIssues
    );
    orchestrator.recordReport('Phase6Security', securityReport);
    orchestrator.recordReport('Phase6Performance', performanceReport);
    logger.info(`✓ Security report saved: ${securityReport}`);
    logger.info(`✓ Performance report saved: ${performanceReport}`);

    // Log severity breakdown
    const criticalCount = securityFindings.filter(f => f.severity === 'CRITICAL').length;
    const highCount = securityFindings.filter(f => f.severity === 'HIGH').length;

    if (criticalCount > 0) {
      logger.error(`⚠️  CRITICAL security findings: ${criticalCount}`);
    }
    if (highCount > 0) {
      logger.warn(`⚠️  HIGH security findings: ${highCount}`);
    }
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Review workflow error:', { error: errorMsg });

    const reviewResult: WorkflowResult = {
      phase: 5,
      status: 'FAILURE',
      duration: Date.now() - startTime,
      message: 'Review workflow failed',
      errors: [errorMsg],
    };

    orchestrator.recordPhaseResult(5, reviewResult);
  }

  logger.info('\n========== REVIEW WORKFLOW COMPLETE ==========');
}
