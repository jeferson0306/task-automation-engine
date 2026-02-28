import path from 'path';
import { logger } from '../utils/logger.js';
import { writeJson, ensureDir } from '../utils/file-utils.js';
import taskParser from '../core/TaskParser.js';
import workflowOrchestrator from '../core/WorkflowOrchestrator.js';
import architectureAnalyzer from '../analyzers/ArchitectureAnalyzer.js';
import testPatternsAnalyzer from '../analyzers/TestPatternsAnalyzer.js';
import reportGenerator from '../core/ReportGenerator.js';
import { Task, WorkflowResult, TaskStatus } from '../core/types.js';

/**
 * Phase 1-2: Analysis Workflow
 * - Parse task
 * - Setup git branch
 * - Analyze project architecture
 * - Extract test patterns
 * - Generate reports
 */
export async function runAnalysisWorkflow(task: Task): Promise<void> {
  logger.info('╔════════════════════════════════════════════════════════════╗');
  logger.info('║         PHASE 0-2: ANALYSIS WORKFLOW                       ║');
  logger.info('╚════════════════════════════════════════════════════════════╝');

  const startTime = Date.now();

  try {
    // Parse task
    logger.info('\n► PHASE 0: SETUP');
    const phaseStartTime = Date.now();

    const parsedTask = taskParser.parseFromObject(task);
    logger.info(`✓ Task parsed: ${parsedTask.taskId}`);

    // Initialize workflow
    const context = await workflowOrchestrator.initialize(parsedTask);
    logger.info(`✓ Workflow initialized`);

    // Create branch
    await workflowOrchestrator.createBranch();
    logger.info(`✓ Branch created: ${context.branchName}`);

    // Generate setup report
    const setupReportPath = await reportGenerator.generateSetupReport(context);
    workflowOrchestrator.recordReport('phase-0-setup', setupReportPath);

    const phaseDuration = Date.now() - phaseStartTime;
    workflowOrchestrator.recordPhaseResult(0, {
      phase: 0,
      status: 'SUCCESS',
      duration: phaseDuration,
      message: 'Setup complete',
    });
    logger.info(`✓ Phase 0 complete (${phaseDuration}ms)\n`);

    // Phase 1: Analysis
    logger.info('► PHASE 1: PROJECT ANALYSIS');
    const phase1Start = Date.now();

    const projectAnalysis = await architectureAnalyzer.analyze(context);
    context.projectAnalysis = projectAnalysis;
    logger.info(`✓ Project analysis complete`);
    logger.info(`  - Language: ${projectAnalysis.language}`);
    logger.info(`  - Build Tool: ${projectAnalysis.buildTool}`);
    logger.info(`  - Framework: ${projectAnalysis.framework}`);
    logger.info(`  - Test Framework: ${projectAnalysis.testFramework}`);

    const analysisReportPath = await reportGenerator.generateAnalysisReport(context);
    workflowOrchestrator.recordReport('phase-1-analysis', analysisReportPath);

    const phase1Duration = Date.now() - phase1Start;
    workflowOrchestrator.recordPhaseResult(1, {
      phase: 1,
      status: 'SUCCESS',
      duration: phase1Duration,
      message: 'Project analysis complete',
    });
    logger.info(`✓ Phase 1 complete (${phase1Duration}ms)\n`);

    // Phase 2: Test Patterns
    logger.info('► PHASE 2: EXTRACT TEST PATTERNS');
    const phase2Start = Date.now();

    const testPatterns = await testPatternsAnalyzer.analyze(context);
    context.testPatterns = testPatterns;
    logger.info(`✓ Test patterns extracted`);
    logger.info(`  - Framework: ${testPatterns.framework}`);
    logger.info(`  - Version: ${testPatterns.frameworkVersion}`);
    logger.info(`  - Naming: ${testPatterns.namingConvention}`);
    logger.info(`  - Mocking: ${testPatterns.mockingLibrary}`);

    const patternsReportPath = await reportGenerator.generatePatternsReport(context);
    workflowOrchestrator.recordReport('phase-2-patterns', patternsReportPath);

    const phase2Duration = Date.now() - phase2Start;
    workflowOrchestrator.recordPhaseResult(2, {
      phase: 2,
      status: 'SUCCESS',
      duration: phase2Duration,
      message: 'Test patterns extracted',
    });
    logger.info(`✓ Phase 2 complete (${phase2Duration}ms)\n`);

    // Save context
    await workflowOrchestrator.saveContext();

    // Summary
    const totalDuration = Date.now() - startTime;
    const summaryPath = await reportGenerator.generateExecutionSummary(context);

    logger.info('╔════════════════════════════════════════════════════════════╗');
    logger.info('║                  ✅ ANALYSIS COMPLETE                     ║');
    logger.info('╚════════════════════════════════════════════════════════════╝');
    logger.info(`\nTotal Duration: ${totalDuration}ms (~${(totalDuration / 1000).toFixed(1)}s)`);
    logger.info(`\n📋 Reports Generated:`);
    logger.info(`  - Setup Report: ${setupReportPath}`);
    logger.info(`  - Analysis Report: ${analysisReportPath}`);
    logger.info(`  - Patterns Report: ${patternsReportPath}`);
    logger.info(`  - Summary: ${summaryPath}`);
    logger.info(`\n🚀 Next: Run Phase 3-4 for implementation\n`);
  } catch (error) {
    logger.error('❌ Analysis workflow failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const sampleTask: Task = {
    taskId: 'DEMO-001',
    title: 'Test Feature',
    description: 'A test feature for demonstration',
    acceptanceCriteria: ['Feature works', 'Tests pass'],
    estimatedPoints: 5,
    projectPath: process.argv[2] || process.cwd(),
  };

  runAnalysisWorkflow(sampleTask);
}
