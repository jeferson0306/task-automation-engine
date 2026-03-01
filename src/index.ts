import { Command, OptionValues } from 'commander';
import { logger } from './utils/logger.js';
import { readJson, writeFile } from './utils/file-utils.js';
import taskParser from './core/TaskParser.js';
import { runAnalysisWorkflow } from './workflows/analysis-workflow.js';
import ProjectScanner from './analyzers/ProjectScanner.js';
import XRayAnalyzer from './analyzers/XRayAnalyzer.js';
import ContractExtractor from './analyzers/ContractExtractor.js';
import AntiPatternDetector from './analyzers/AntiPatternDetector.js';
import SelfHealingPipeline from './analyzers/SelfHealingPipeline.js';
import TaskVerifier from './analyzers/TaskVerifier.js';
import AIGuidanceGenerator from './analyzers/AIGuidanceGenerator.js';
import AutoCodeReviewer from './reviewers/AutoCodeReviewer.js';
import SecurityReviewer from './reviewers/SecurityReviewer.js';
import PerformanceReviewer from './reviewers/PerformanceReviewer.js';
import reportGenerator from './core/ReportGenerator.js';
import workflowOrchestrator from './core/WorkflowOrchestrator.js';
import { Task, ExecutionContext, ParsedTask, TaskStatus, AntiPattern } from './core/types.js';
import path from 'path';

function createMinimalContext(projectPath: string, taskId: string, title: string, description = ''): ExecutionContext {
  const parsedTask: ParsedTask = {
    taskId,
    title,
    description,
    acceptanceCriteria: [],
    estimatedPoints: 0,
    projectPath,
    parsedAt: new Date().toISOString(),
    status: TaskStatus.PARSED,
  };

  return {
    task: parsedTask,
    workingDir: projectPath,
    branchName: '',
    phaseResults: new Map(),
    reports: new Map(),
  };
}

function getAntiPatternSeveritySummary(patterns: AntiPattern[]): { critical: number; high: number; medium: number; low: number } {
  return {
    critical: patterns.filter(p => p.severity === 'critical').length,
    high: patterns.filter(p => p.severity === 'high').length,
    medium: patterns.filter(p => p.severity === 'medium').length,
    low: patterns.filter(p => p.severity === 'low').length,
  };
}

const program = new Command();

program
  .name('task-automation-engine')
  .description('Automate 100% of your development workflow - from task to commit-ready code')
  .version('0.1.0');

program
  .command('run')
  .description('Run full automation workflow')
  .option('-t, --task-file <path>', 'Path to task JSON file')
  .option('--task-id <id>', 'Task ID')
  .option('--task-title <title>', 'Task title')
  .option('--task-desc <description>', 'Task description')
  .option('--accept-criteria <criteria>', 'Acceptance criteria (comma-separated)')
  .option('--estimated-points <points>', 'Estimated points')
  .option('-p, --project-path <path>', 'Path to project')
  .action(async (options: OptionValues) => {
    try {
      let task: Task;

      if (options.taskFile) {
        task = await readJson<Task>(options.taskFile);
      } else {
        task = {
          taskId: options.taskId || 'TASK-001',
          title: options.taskTitle || 'New Feature',
          description: options.taskDesc || 'Feature description',
          acceptanceCriteria: options.acceptCriteria
            ? options.acceptCriteria.split(',').map((s: string) => s.trim())
            : [],
          estimatedPoints: parseInt(options.estimatedPoints) || 5,
          projectPath: options.projectPath || process.cwd(),
        };
      }

      await runAnalysisWorkflow(task);
    } catch (error) {
      logger.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('analyze')
  .description('Run Phase 1-2 analysis only (enhanced with all analyzers)')
  .option('-p, --project-path <path>', 'Path to project')
  .option('--task-id <id>', 'Task ID')
  .option('--task-title <title>', 'Task title')
  .option('--task-desc <description>', 'Task description for context')
  .action(async (options: OptionValues) => {
    try {
      const task: Task = {
        taskId: options.taskId || 'ANALYSIS-001',
        title: options.taskTitle || 'Analysis Only',
        description: options.taskDesc || 'Analysis without implementation',
        acceptanceCriteria: [],
        estimatedPoints: 0,
        projectPath: options.projectPath || process.cwd(),
      };

      await runAnalysisWorkflow(task);
    } catch (error) {
      logger.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('scan')
  .description('Deep project scan with skeletal reading and priority classification')
  .option('-p, --project-path <path>', 'Path to project')
  .option('-o, --output <path>', 'Output JSON file path')
  .option('--report', 'Generate markdown report')
  .action(async (options: OptionValues) => {
    try {
      const projectPath = options.projectPath || process.cwd();
      logger.info(`\n📁 Scanning project: ${projectPath}\n`);

      const snapshot = await ProjectScanner.scan(projectPath);

      logger.info('╔════════════════════════════════════════════════════════════╗');
      logger.info('║                    PROJECT SCAN RESULTS                   ║');
      logger.info('╚════════════════════════════════════════════════════════════╝');
      logger.info(`\n📊 Overview:`);
      logger.info(`  - Total Files: ${snapshot.totalFiles}`);
      logger.info(`  - Total Size: ${(snapshot.totalSize / 1024).toFixed(2)} KB`);
      logger.info(`\n🔤 Languages:`);
      snapshot.detectedStack.languages.forEach(l => {
        logger.info(`  - ${l.name}: ${l.percentage}%`);
      });
      logger.info(`\n🛠️  Frameworks:`);
      if (snapshot.detectedStack.frameworks.length > 0) {
        snapshot.detectedStack.frameworks.forEach(f => {
          logger.info(`  - ${f.name} (${f.type})`);
        });
      } else {
        logger.info(`  - None detected`);
      }
      logger.info(`\n🗄️  Infrastructure:`);
      logger.info(`  - Databases: ${snapshot.detectedStack.databases.join(', ') || 'None'}`);
      logger.info(`  - CI/CD: ${snapshot.detectedStack.cicd.join(', ') || 'None'}`);
      logger.info(`  - Containers: ${snapshot.detectedStack.containerization.join(', ') || 'None'}`);

      if (snapshot.services.length > 1) {
        logger.info(`\n📦 Services (Monorepo):`);
        snapshot.services.forEach(s => {
          logger.info(`  - ${s.name} (${s.type}): ${s.language}`);
        });
      }

      if (options.output) {
        await writeFile(options.output, JSON.stringify(snapshot, null, 2));
        logger.info(`\n✅ Scan results saved to: ${options.output}`);
      }

      if (options.report) {
        const context = createMinimalContext(projectPath, 'SCAN', 'Scan');
        context.projectSnapshot = snapshot;
        const reportPath = await reportGenerator.generateScanReport(context);
        logger.info(`📋 Report generated: ${reportPath}`);
      }

      logger.info('');
    } catch (error) {
      logger.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('xray')
  .description('X-Ray analysis with specialist perspectives (Backend, Frontend, Security, etc)')
  .option('-p, --project-path <path>', 'Path to project')
  .option('-t, --task <description>', 'Task context for focused analysis')
  .option('-o, --output <path>', 'Output JSON file path')
  .option('--report', 'Generate markdown report')
  .action(async (options: OptionValues) => {
    try {
      const projectPath = options.projectPath || process.cwd();
      const taskContext = options.task || '';

      logger.info(`\n🔬 Running X-Ray analysis: ${projectPath}`);
      if (taskContext) {
        logger.info(`   Task context: ${taskContext}`);
      }
      logger.info('');

      const snapshot = await ProjectScanner.scan(projectPath);
      const context = createMinimalContext(projectPath, 'XRAY', 'X-Ray', taskContext);
      context.projectSnapshot = snapshot;

      const xrayReport = await XRayAnalyzer.analyze(context, taskContext);

      logger.info('╔════════════════════════════════════════════════════════════╗');
      logger.info('║                   X-RAY ANALYSIS RESULTS                  ║');
      logger.info('╚════════════════════════════════════════════════════════════╝');

      const totalFindings = xrayReport.specialists.reduce((sum, s) => sum + s.findings.length, 0);
      logger.info(`\n📊 Summary:`);
      logger.info(`  - Specialists: ${xrayReport.specialists.length}`);
      logger.info(`  - Total Findings: ${totalFindings}`);

      logger.info(`\n👥 Specialist Analysis:`);
      xrayReport.specialists.forEach(s => {
        const icon = s.riskLevel === 'high' ? '🔴' : s.riskLevel === 'medium' ? '🟡' : '🟢';
        logger.info(`  ${icon} ${s.specialistName}: ${s.findings.length} findings (${s.riskLevel} risk)`);
      });

      logger.info(`\n📝 Executive Summary:`);
      logger.info(`   ${xrayReport.synthesis.executiveSummary}`);

      if (xrayReport.synthesis.immediateActions.length > 0) {
        logger.info(`\n⚡ Immediate Actions:`);
        xrayReport.synthesis.immediateActions.forEach(a => {
          logger.info(`   - ${a}`);
        });
      }

      if (options.output) {
        await writeFile(options.output, JSON.stringify(xrayReport, null, 2));
        logger.info(`\n✅ X-Ray results saved to: ${options.output}`);
      }

      if (options.report) {
        context.xrayReport = xrayReport;
        const reportPath = await reportGenerator.generateXRayReport(context);
        logger.info(`📋 Report generated: ${reportPath}`);
      }

      logger.info('');
    } catch (error) {
      logger.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('contracts')
  .description('Extract contracts: enums, exceptions, HTTP endpoints, services')
  .option('-p, --project-path <path>', 'Path to project')
  .option('-o, --output <path>', 'Output JSON file path')
  .option('--report', 'Generate markdown report')
  .action(async (options: OptionValues) => {
    try {
      const projectPath = options.projectPath || process.cwd();
      logger.info(`\n📜 Extracting contracts: ${projectPath}\n`);

      const snapshot = await ProjectScanner.scan(projectPath);
      const context = createMinimalContext(projectPath, 'CONTRACTS', 'Contracts');
      context.projectSnapshot = snapshot;

      const contracts = await ContractExtractor.extract(context);

      logger.info('╔════════════════════════════════════════════════════════════╗');
      logger.info('║                  CONTRACT EXTRACTION                      ║');
      logger.info('╚════════════════════════════════════════════════════════════╝');

      logger.info(`\n📊 Extracted:`);
      logger.info(`  - Enums: ${contracts.enums.length}`);
      logger.info(`  - Exceptions: ${contracts.exceptions.length}`);
      logger.info(`  - HTTP Endpoints: ${contracts.httpEndpoints.length}`);
      logger.info(`  - Domain Models: ${contracts.domainModels.length}`);
      logger.info(`  - Service Contracts: ${contracts.serviceContracts.length}`);

      if (contracts.enums.length > 0) {
        logger.info(`\n📋 Enums:`);
        contracts.enums.slice(0, 5).forEach(e => {
          logger.info(`   - ${e.name}: ${e.values.map(v => v.name).join(', ')}`);
        });
        if (contracts.enums.length > 5) {
          logger.info(`   ... and ${contracts.enums.length - 5} more`);
        }
      }

      if (contracts.httpEndpoints.length > 0) {
        logger.info(`\n🌐 HTTP Endpoints:`);
        contracts.httpEndpoints.slice(0, 10).forEach(ep => {
          logger.info(`   - ${ep.method.toUpperCase()} ${ep.path}`);
        });
        if (contracts.httpEndpoints.length > 10) {
          logger.info(`   ... and ${contracts.httpEndpoints.length - 10} more`);
        }
      }

      logger.info(`\n📝 Conventions:`);
      logger.info(`   - Test Import: ${contracts.conventions.testImport}`);
      logger.info(`   - Assertion Library: ${contracts.conventions.assertionLibrary}`);
      logger.info(`   - Naming Convention: ${contracts.conventions.namingConvention}`);

      if (options.output) {
        await writeFile(options.output, JSON.stringify(contracts, null, 2));
        logger.info(`\n✅ Contracts saved to: ${options.output}`);
      }

      if (options.report) {
        context.contractContext = contracts;
        const reportPath = await reportGenerator.generateContractsReport(context);
        logger.info(`📋 Report generated: ${reportPath}`);
      }

      logger.info('');
    } catch (error) {
      logger.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('antipatterns')
  .description('Detect anti-patterns (35+ patterns) in code')
  .option('-p, --project-path <path>', 'Path to project')
  .option('-o, --output <path>', 'Output JSON file path')
  .option('--report', 'Generate markdown report')
  .option('--severity <level>', 'Filter by severity (critical, high, medium, low)')
  .option('--category <cat>', 'Filter by category')
  .action(async (options: OptionValues) => {
    try {
      const projectPath = options.projectPath || process.cwd();
      logger.info(`\n🔍 Detecting anti-patterns: ${projectPath}\n`);

      const snapshot = await ProjectScanner.scan(projectPath);
      const context = createMinimalContext(projectPath, 'ANTIPATTERNS', 'Anti-Patterns');
      context.projectSnapshot = snapshot;

      let antiPatterns = await AntiPatternDetector.detect(context);

      if (options.severity) {
        antiPatterns = antiPatterns.filter(p => p.severity === options.severity);
      }
      if (options.category) {
        antiPatterns = antiPatterns.filter(p => p.category === options.category);
      }

      const summary = getAntiPatternSeveritySummary(antiPatterns);

      logger.info('╔════════════════════════════════════════════════════════════╗');
      logger.info('║                 ANTI-PATTERN DETECTION                    ║');
      logger.info('╚════════════════════════════════════════════════════════════╝');

      logger.info(`\n📊 Summary:`);
      logger.info(`  - Total: ${antiPatterns.length}`);
      logger.info(`  - 🔴 Critical: ${summary.critical}`);
      logger.info(`  - 🟠 High: ${summary.high}`);
      logger.info(`  - 🟡 Medium: ${summary.medium}`);
      logger.info(`  - 🟢 Low: ${summary.low}`);

      const critical = antiPatterns.filter(p => p.severity === 'critical');
      if (critical.length > 0) {
        logger.info(`\n🔴 Critical Issues:`);
        critical.forEach(p => {
          logger.info(`   - ${p.file}:${p.line} - ${p.name}`);
          logger.info(`     ${p.description}`);
        });
      }

      const high = antiPatterns.filter(p => p.severity === 'high');
      if (high.length > 0) {
        logger.info(`\n🟠 High Priority:`);
        high.slice(0, 10).forEach(p => {
          logger.info(`   - ${p.file}:${p.line} - ${p.name}`);
        });
        if (high.length > 10) {
          logger.info(`   ... and ${high.length - 10} more`);
        }
      }

      const autoFixable = antiPatterns.filter(p => p.fix?.autoFixable);
      if (autoFixable.length > 0) {
        logger.info(`\n🔧 Auto-fixable: ${autoFixable.length} issues`);
      }

      if (options.output) {
        await writeFile(options.output, JSON.stringify(antiPatterns, null, 2));
        logger.info(`\n✅ Anti-patterns saved to: ${options.output}`);
      }

      if (options.report) {
        const reportPath = await reportGenerator.generateAntiPatternsReport(context, antiPatterns);
        logger.info(`📋 Report generated: ${reportPath}`);
      }

      logger.info('');
    } catch (error) {
      logger.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('heal')
  .description('Run self-healing pipeline: compile → fix → test → fix → repeat')
  .option('-p, --project-path <path>', 'Path to project')
  .option('--compile-only', 'Only heal compilation errors')
  .option('--test-only', 'Only heal test errors')
  .option('--lint-only', 'Only heal lint errors')
  .option('--report', 'Generate markdown report')
  .action(async (options: OptionValues) => {
    try {
      const projectPath = options.projectPath || process.cwd();
      logger.info(`\n🏥 Running self-healing pipeline: ${projectPath}\n`);

      const snapshot = await ProjectScanner.scan(projectPath);
      const context = createMinimalContext(projectPath, 'HEAL', 'Self-Healing');
      context.projectSnapshot = snapshot;

      logger.info('╔════════════════════════════════════════════════════════════╗');
      logger.info('║                  SELF-HEALING PIPELINE                    ║');
      logger.info('╚════════════════════════════════════════════════════════════╝');

      let result: { iterations: any[]; finalStatus: string; totalFixesApplied: number; remainingIssues: string[] };

      if (options.compileOnly) {
        logger.info('\n🔨 Healing compilation errors...\n');
        const iterations = await SelfHealingPipeline.healCompilation(context);
        const lastIter = iterations[iterations.length - 1];
        result = {
          iterations,
          finalStatus: lastIter?.status === 'fixed' ? 'success' : 'partial',
          totalFixesApplied: iterations.reduce((sum, i) => sum + i.fixes.filter((f: { success: boolean }) => f.success).length, 0),
          remainingIssues: lastIter?.errors?.map((e: { file: string; message: string }) => `${e.file}: ${e.message}`) || [],
        };
      } else if (options.testOnly) {
        logger.info('\n🧪 Healing test errors...\n');
        const iterations = await SelfHealingPipeline.healTests(context);
        const lastIter = iterations[iterations.length - 1];
        result = {
          iterations,
          finalStatus: lastIter?.status === 'fixed' ? 'success' : 'partial',
          totalFixesApplied: iterations.reduce((sum, i) => sum + i.fixes.filter((f: { success: boolean }) => f.success).length, 0),
          remainingIssues: lastIter?.errors?.map((e: { file: string; message: string }) => `${e.file}: ${e.message}`) || [],
        };
      } else {
        if (options.lintOnly) {
          logger.info('\n🔍 Healing lint errors (full cycle with lint focus)...\n');
        } else {
          logger.info('\n🔄 Running full healing cycle...\n');
        }
        const fullResult = await SelfHealingPipeline.heal(context);
        result = {
          iterations: fullResult.iterations,
          finalStatus: fullResult.finalStatus,
          totalFixesApplied: fullResult.totalFixesApplied,
          remainingIssues: fullResult.remainingIssues,
        };
      }

      logger.info(`\n📊 Results:`);
      logger.info(`  - Status: ${result.finalStatus.toUpperCase()}`);
      logger.info(`  - Iterations: ${result.iterations.length}`);
      logger.info(`  - Total Fixes Applied: ${result.totalFixesApplied}`);

      if (result.remainingIssues.length > 0) {
        logger.info(`\n⚠️  Remaining Issues: ${result.remainingIssues.length}`);
        result.remainingIssues.slice(0, 5).forEach((i: string) => {
          logger.info(`   - ${i}`);
        });
      } else {
        logger.info(`\n✅ All issues resolved!`);
      }

      if (options.report && !options.compileOnly && !options.testOnly) {
        const fullResult = await SelfHealingPipeline.heal(context);
        const reportPath = await reportGenerator.generateSelfHealingReport(context, fullResult);
        logger.info(`📋 Report generated: ${reportPath}`);
      }

      logger.info('');
    } catch (error) {
      logger.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('review')
  .description('Run code review (code quality, security, performance)')
  .option('-p, --project-path <path>', 'Path to project')
  .option('--code', 'Run code quality review only')
  .option('--security', 'Run security review only')
  .option('--performance', 'Run performance review only')
  .option('--report', 'Generate markdown reports')
  .action(async (options: OptionValues) => {
    try {
      const projectPath = options.projectPath || process.cwd();
      logger.info(`\n📝 Running code review: ${projectPath}\n`);

      const snapshot = await ProjectScanner.scan(projectPath);
      const task: Task = {
        taskId: 'REVIEW',
        title: 'Code Review',
        description: '',
        acceptanceCriteria: [],
        estimatedPoints: 0,
        projectPath,
      };
      const parsedTask = taskParser.parseFromObject(task);
      const context = await workflowOrchestrator.initialize(parsedTask);
      context.projectSnapshot = snapshot;

      logger.info('╔════════════════════════════════════════════════════════════╗');
      logger.info('║                     CODE REVIEW                           ║');
      logger.info('╚════════════════════════════════════════════════════════════╝');

      const runAll = !options.code && !options.security && !options.performance;

      if (runAll || options.code) {
        logger.info('\n🔍 Code Quality Review...');
        const codeIssues = await AutoCodeReviewer.review(context);
        logger.info(`   Found ${codeIssues.length} issues`);
        logger.info(`   - Critical: ${codeIssues.filter(i => i.severity === 'CRITICAL').length}`);
        logger.info(`   - High: ${codeIssues.filter(i => i.severity === 'HIGH').length}`);
        logger.info(`   - Medium: ${codeIssues.filter(i => i.severity === 'MEDIUM').length}`);

        if (options.report) {
          const reportPath = await reportGenerator.generateCodeReviewReport(context, codeIssues);
          logger.info(`   📋 Report: ${reportPath}`);
        }
      }

      if (runAll || options.security) {
        logger.info('\n🔒 Security Review...');
        const securityFindings = await SecurityReviewer.review(context);
        logger.info(`   Found ${securityFindings.length} findings`);
        logger.info(`   - Critical: ${securityFindings.filter(f => f.severity === 'CRITICAL').length}`);
        logger.info(`   - High: ${securityFindings.filter(f => f.severity === 'HIGH').length}`);

        if (options.report) {
          const reportPath = await reportGenerator.generateSecurityReport(context, securityFindings);
          logger.info(`   📋 Report: ${reportPath}`);
        }
      }

      if (runAll || options.performance) {
        logger.info('\n⚡ Performance Review...');
        const perfIssues = await PerformanceReviewer.review(context);
        logger.info(`   Found ${perfIssues.length} issues`);
        logger.info(`   - High Impact: ${perfIssues.filter(i => i.severity === 'HIGH').length}`);
        logger.info(`   - Medium Impact: ${perfIssues.filter(i => i.severity === 'MEDIUM').length}`);

        if (options.report) {
          const reportPath = await reportGenerator.generatePerformanceReport(context, perfIssues);
          logger.info(`   📋 Report: ${reportPath}`);
        }
      }

      logger.info('\n✅ Code review complete!\n');
    } catch (error) {
      logger.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('verify-task')
  .description('Verify if a task has been implemented (checks git, code, and semantic matches)')
  .option('-p, --project-path <path>', 'Path to project')
  .option('--task-id <id>', 'Task ID (e.g., PROJ-123, ISSUE-456)')
  .option('--task-title <title>', 'Task title')
  .option('--task-desc <description>', 'Task description (detailed)')
  .option('--accept-criteria <criteria>', 'Acceptance criteria (comma-separated)')
  .option('-o, --output <path>', 'Output JSON file path')
  .option('--report', 'Generate markdown report')
  .option('--ai-guidance', 'Generate AI guidance document')
  .action(async (options: OptionValues) => {
    try {
      const projectPath = options.projectPath || process.cwd();
      const taskId = options.taskId || 'TASK-VERIFY';
      const taskTitle = options.taskTitle || 'Task Verification';
      const taskDesc = options.taskDesc || '';

      if (!taskDesc) {
        logger.error('❌ Task description is required. Use --task-desc "..."');
        process.exit(1);
      }

      logger.info(`\n🔍 Verifying task: ${taskId}`);
      logger.info(`   Project: ${projectPath}`);
      logger.info(`   Description: ${taskDesc.substring(0, 100)}...`);
      logger.info('');

      const snapshot = await ProjectScanner.scan(projectPath);
      const context = createMinimalContext(projectPath, taskId, taskTitle, taskDesc);
      context.projectSnapshot = snapshot;

      if (options.acceptCriteria) {
        context.task.acceptanceCriteria = options.acceptCriteria.split(',').map((s: string) => s.trim());
      }

      const verification = await TaskVerifier.verify(context, taskDesc);

      logger.info('╔════════════════════════════════════════════════════════════╗');
      logger.info('║                  TASK VERIFICATION RESULT                 ║');
      logger.info('╚════════════════════════════════════════════════════════════╝');

      const statusIcons: Record<string, string> = {
        'NOT_IMPLEMENTED': '❌',
        'PARTIALLY_IMPLEMENTED': '🟡',
        'IMPLEMENTED_NOT_COMMITTED': '🟠',
        'IMPLEMENTED': '✅',
        'NEEDS_REVIEW': '🔍',
      };

      logger.info(`\n📊 Status: ${statusIcons[verification.status]} ${verification.status}`);
      logger.info(`   Confidence: ${verification.confidence}%`);
      logger.info(`   Summary: ${verification.summary}`);

      if (verification.evidence.length > 0) {
        logger.info(`\n📋 Evidence Found (${verification.evidence.length} items):`);
        verification.evidence.slice(0, 10).forEach(e => {
          const icon = e.confidence >= 80 ? '🟢' : e.confidence >= 50 ? '🟡' : '🔴';
          logger.info(`   ${icon} [${e.type}] ${e.file}${e.line ? `:${e.line}` : ''}`);
          logger.info(`      ${e.description}`);
        });
        if (verification.evidence.length > 10) {
          logger.info(`   ... and ${verification.evidence.length - 10} more`);
        }
      }

      if (verification.gitChanges.length > 0) {
        logger.info(`\n📁 Git Changes (${verification.gitChanges.length} files):`);
        verification.gitChanges.forEach(g => {
          const icon = g.staged ? '✓' : '○';
          logger.info(`   ${icon} ${g.status}: ${g.file}`);
        });
      }

      logger.info(`\n🧪 Test Coverage:`);
      logger.info(`   Status: ${verification.testCoverage.coverageStatus}`);
      if (verification.testCoverage.testFiles.length > 0) {
        logger.info(`   Test Files: ${verification.testCoverage.testFiles.join(', ')}`);
      }

      logger.info(`\n🤖 AI Guidance:`);
      logger.info(`   Action: ${verification.aiGuidance.action.toUpperCase()}`);
      logger.info(`   Priority: ${verification.aiGuidance.priority}`);
      logger.info(`   Steps:`);
      verification.aiGuidance.steps.forEach(s => {
        logger.info(`     ${s}`);
      });

      if (verification.aiGuidance.warnings.length > 0) {
        logger.info(`\n⚠️  Warnings:`);
        verification.aiGuidance.warnings.forEach(w => {
          logger.info(`   - ${w}`);
        });
      }

      logger.info(`\n💡 Recommendations:`);
      verification.recommendations.forEach(r => {
        logger.info(`   - ${r}`);
      });

      if (options.output) {
        await writeFile(options.output, JSON.stringify(verification, null, 2));
        logger.info(`\n✅ Verification results saved to: ${options.output}`);
      }

      if (options.report) {
        const reportPath = path.join(projectPath, `task-verification-${taskId}.md`);
        const reportContent = generateVerificationReport(verification);
        await writeFile(reportPath, reportContent);
        logger.info(`📋 Verification report saved to: ${reportPath}`);
      }

      if (options.aiGuidance) {
        const instructionSet = await AIGuidanceGenerator.generate(context, verification, taskDesc);
        const guidanceMarkdown = await AIGuidanceGenerator.generateMarkdown(instructionSet);
        const guidancePath = path.join(projectPath, `ai-guidance-${taskId}.md`);
        await writeFile(guidancePath, guidanceMarkdown);
        logger.info(`🤖 AI guidance document saved to: ${guidancePath}`);
      }

      logger.info('');
    } catch (error) {
      logger.error('Error:', error);
      process.exit(1);
    }
  });

function generateVerificationReport(verification: any): string {
  let report = `# Task Verification Report: ${verification.taskId}\n\n`;
  report += `> Generated: ${new Date().toISOString()}\n\n`;

  report += `## Summary\n`;
  report += `- **Status:** ${verification.status}\n`;
  report += `- **Confidence:** ${verification.confidence}%\n`;
  report += `- **Summary:** ${verification.summary}\n\n`;

  if (verification.evidence.length > 0) {
    report += `## Evidence\n`;
    for (const e of verification.evidence) {
      report += `### ${e.type} - ${e.file}${e.line ? `:${e.line}` : ''}\n`;
      report += `- Confidence: ${e.confidence}%\n`;
      report += `- Description: ${e.description}\n`;
      report += `- Snippet: \`${e.snippet}\`\n\n`;
    }
  }

  if (verification.gitChanges.length > 0) {
    report += `## Git Changes\n`;
    for (const g of verification.gitChanges) {
      report += `- ${g.status}: ${g.file} (${g.staged ? 'staged' : 'unstaged'})\n`;
    }
    report += '\n';
  }

  report += `## Test Coverage\n`;
  report += `- Status: ${verification.testCoverage.coverageStatus}\n`;
  report += `- Test Files: ${verification.testCoverage.testFiles.join(', ') || 'None'}\n\n`;

  report += `## AI Guidance\n`;
  report += `- Action: ${verification.aiGuidance.action}\n`;
  report += `- Priority: ${verification.aiGuidance.priority}\n\n`;
  report += `### Steps\n`;
  for (const step of verification.aiGuidance.steps) {
    report += `${step}\n`;
  }
  report += '\n';

  if (verification.aiGuidance.filesToModify.length > 0) {
    report += `### Files to Modify\n`;
    for (const f of verification.aiGuidance.filesToModify) {
      report += `- ${f}\n`;
    }
    report += '\n';
  }

  report += `## Recommendations\n`;
  for (const r of verification.recommendations) {
    report += `- ${r}\n`;
  }

  return report;
}

program
  .command('init')
  .description('Initialize a new project')
  .action(() => {
    logger.info('╔════════════════════════════════════════════════════════════╗');
    logger.info('║           TASK AUTOMATION ENGINE - INITIALIZED            ║');
    logger.info('╚════════════════════════════════════════════════════════════╝');
    logger.info('\n✅ Dependencies ready\n');
    logger.info('Available Commands:');
    logger.info('  verify-task - Verify if a task is implemented (NEW!)');
    logger.info('  analyze     - Full analysis workflow (scan + xray + contracts + antipatterns)');
    logger.info('  scan        - Deep project scan with skeletal reading');
    logger.info('  xray        - X-Ray analysis with specialist perspectives');
    logger.info('  contracts   - Extract enums, exceptions, HTTP endpoints, services');
    logger.info('  antipatterns- Detect 35+ anti-patterns');
    logger.info('  review      - Code review (quality + security + performance)');
    logger.info('  heal        - Self-healing pipeline');
    logger.info('  run         - Full automation workflow');
    logger.info('\nExamples:');
    logger.info('  npm run dev -- verify-task -p ./my-project --task-id PROJ-123 --task-desc "Add validation to user input"');
    logger.info('  npm run dev -- scan -p ./my-project --report');
    logger.info('  npm run dev -- analyze -p ./my-project --task-desc "Add user authentication"');
    logger.info('  npm run dev -- xray -p ./my-project -t "Implement caching layer"');
    logger.info('  npm run dev -- review -p ./my-project --security --report');
    logger.info('');
  });

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
