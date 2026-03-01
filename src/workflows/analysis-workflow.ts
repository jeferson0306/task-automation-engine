import path from 'path';
import { logger } from '../utils/logger.js';
import { writeJson, ensureDir } from '../utils/file-utils.js';
import taskParser from '../core/TaskParser.js';
import workflowOrchestrator from '../core/WorkflowOrchestrator.js';
import architectureAnalyzer from '../analyzers/ArchitectureAnalyzer.js';
import testPatternsAnalyzer from '../analyzers/TestPatternsAnalyzer.js';
import ProjectScanner from '../analyzers/ProjectScanner.js';
import XRayAnalyzer from '../analyzers/XRayAnalyzer.js';
import ContractExtractor from '../analyzers/ContractExtractor.js';
import AntiPatternDetector from '../analyzers/AntiPatternDetector.js';
import reportGenerator from '../core/ReportGenerator.js';
import { Task, WorkflowResult, TaskStatus, ExecutionContext } from '../core/types.js';

/**
 * Phase 1-2: Analysis Workflow (Enhanced with new analyzers)
 * - Parse task
 * - Setup git branch
 * - Deep project scan (ProjectScanner)
 * - X-Ray analysis (XRayAnalyzer)
 * - Contract extraction (ContractExtractor)
 * - Anti-pattern detection (AntiPatternDetector)
 * - Extract test patterns
 * - Generate reports
 */
export async function runAnalysisWorkflow(task: Task): Promise<ExecutionContext> {
  logger.info('╔════════════════════════════════════════════════════════════╗');
  logger.info('║         PHASE 0-2: ANALYSIS WORKFLOW (ENHANCED)           ║');
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

    // Phase 1: Deep Project Analysis
    logger.info('► PHASE 1: DEEP PROJECT ANALYSIS');
    const phase1Start = Date.now();

    // 1.1 Project Scan (Skeletal Reading + Priority Classification)
    logger.info('  → Running ProjectScanner...');
    const projectSnapshot = await ProjectScanner.scan(context.workingDir);
    context.projectSnapshot = projectSnapshot;
    logger.info(`    ✓ Scanned ${projectSnapshot.totalFiles} files`);
    logger.info(`    ✓ Languages: ${projectSnapshot.detectedStack.languages.map(l => l.name).join(', ')}`);
    logger.info(`    ✓ Frameworks: ${projectSnapshot.detectedStack.frameworks.map(f => f.name).join(', ') || 'None detected'}`);

    // 1.2 Legacy architecture analysis (for backward compatibility)
    const projectAnalysis = await architectureAnalyzer.analyze(context);
    context.projectAnalysis = projectAnalysis;

    // 1.3 X-Ray Analysis (Specialist deep-dive)
    logger.info('  → Running XRayAnalyzer...');
    const xrayReport = await XRayAnalyzer.analyze(context, task.description);
    context.xrayReport = xrayReport;
    const totalFindings = xrayReport.specialists.reduce((sum, s) => sum + s.findings.length, 0);
    logger.info(`    ✓ ${xrayReport.specialists.length} specialists analyzed`);
    logger.info(`    ✓ ${totalFindings} findings detected`);

    // 1.4 Contract Extraction
    logger.info('  → Running ContractExtractor...');
    const contractContext = await ContractExtractor.extract(context);
    context.contractContext = contractContext;
    logger.info(`    ✓ ${contractContext.enums.length} enums extracted`);
    logger.info(`    ✓ ${contractContext.httpEndpoints.length} HTTP endpoints mapped`);
    logger.info(`    ✓ ${contractContext.serviceContracts.length} service contracts found`);

    // Generate analysis report
    const analysisReportPath = await reportGenerator.generateAnalysisReport(context);
    workflowOrchestrator.recordReport('phase-1-analysis', analysisReportPath);

    // Generate X-Ray report
    const xrayReportPath = await reportGenerator.generateXRayReport(context);
    workflowOrchestrator.recordReport('phase-1-xray', xrayReportPath);

    // Generate contracts report
    const contractsReportPath = await reportGenerator.generateContractsReport(context);
    workflowOrchestrator.recordReport('phase-1-contracts', contractsReportPath);

    const phase1Duration = Date.now() - phase1Start;
    workflowOrchestrator.recordPhaseResult(1, {
      phase: 1,
      status: 'SUCCESS',
      duration: phase1Duration,
      message: 'Deep project analysis complete',
      data: {
        filesScanned: projectSnapshot.totalFiles,
        specialistsRun: xrayReport.specialists.length,
        findingsCount: totalFindings,
        enumsExtracted: contractContext.enums.length,
        endpointsMapped: contractContext.httpEndpoints.length,
      },
    });
    logger.info(`✓ Phase 1 complete (${phase1Duration}ms)\n`);

    // Phase 2: Patterns & Anti-Patterns
    logger.info('► PHASE 2: PATTERNS & ANTI-PATTERNS');
    const phase2Start = Date.now();

    // 2.1 Test Patterns
    logger.info('  → Extracting test patterns...');
    const testPatterns = await testPatternsAnalyzer.analyze(context);
    context.testPatterns = testPatterns;
    logger.info(`    ✓ Framework: ${testPatterns.framework} ${testPatterns.frameworkVersion}`);
    logger.info(`    ✓ Naming: ${testPatterns.namingConvention}`);
    logger.info(`    ✓ Coverage baseline: ${testPatterns.coverageBaseline}%`);

    // 2.2 Anti-Pattern Detection
    logger.info('  → Detecting anti-patterns...');
    const antiPatterns = await AntiPatternDetector.detect(context);
    const antiPatternSummary = AntiPatternDetector.getSummary(antiPatterns);
    logger.info(`    ✓ ${antiPatterns.length} anti-patterns detected`);
    logger.info(`    ✓ Critical: ${antiPatterns.filter(p => p.severity === 'critical').length}`);
    logger.info(`    ✓ High: ${antiPatterns.filter(p => p.severity === 'high').length}`);
    logger.info(`    ✓ Medium: ${antiPatterns.filter(p => p.severity === 'medium').length}`);

    // Generate patterns report
    const patternsReportPath = await reportGenerator.generatePatternsReport(context);
    workflowOrchestrator.recordReport('phase-2-patterns', patternsReportPath);

    // Generate anti-patterns report
    const antiPatternsReportPath = await reportGenerator.generateAntiPatternsReport(context, antiPatterns);
    workflowOrchestrator.recordReport('phase-2-antipatterns', antiPatternsReportPath);

    const phase2Duration = Date.now() - phase2Start;
    workflowOrchestrator.recordPhaseResult(2, {
      phase: 2,
      status: 'SUCCESS',
      duration: phase2Duration,
      message: 'Patterns and anti-patterns extracted',
      data: {
        testFramework: testPatterns.framework,
        coverageBaseline: testPatterns.coverageBaseline,
        antiPatternsCount: antiPatterns.length,
        antiPatternSummary,
      },
    });
    logger.info(`✓ Phase 2 complete (${phase2Duration}ms)\n`);

    // Save context
    await workflowOrchestrator.saveContext();

    // Summary
    const totalDuration = Date.now() - startTime;
    const summaryPath = await reportGenerator.generateExecutionSummary(context);

    logger.info('╔════════════════════════════════════════════════════════════╗');
    logger.info('║               ✅ ANALYSIS COMPLETE (ENHANCED)             ║');
    logger.info('╚════════════════════════════════════════════════════════════╝');
    logger.info(`\nTotal Duration: ${totalDuration}ms (~${(totalDuration / 1000).toFixed(1)}s)`);
    logger.info(`\n📊 Analysis Results:`);
    logger.info(`  - Files scanned: ${projectSnapshot.totalFiles}`);
    logger.info(`  - X-Ray findings: ${totalFindings}`);
    logger.info(`  - Anti-patterns: ${antiPatterns.length}`);
    logger.info(`  - Contracts extracted: ${contractContext.enums.length + contractContext.httpEndpoints.length + contractContext.serviceContracts.length}`);
    logger.info(`\n📋 Reports Generated:`);
    logger.info(`  - Setup: ${setupReportPath}`);
    logger.info(`  - Analysis: ${analysisReportPath}`);
    logger.info(`  - X-Ray: ${xrayReportPath}`);
    logger.info(`  - Contracts: ${contractsReportPath}`);
    logger.info(`  - Patterns: ${patternsReportPath}`);
    logger.info(`  - Anti-Patterns: ${antiPatternsReportPath}`);
    logger.info(`  - Summary: ${summaryPath}`);
    logger.info(`\n🚀 Next: Run Phase 3-4 for implementation\n`);

    return context;
  } catch (error) {
    logger.error('❌ Analysis workflow failed:', error);
    throw error;
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
