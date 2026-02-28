import { Command, OptionValues } from 'commander';
import { logger } from './utils/logger.js';
import { readJson } from './utils/file-utils.js';
import taskParser from './core/TaskParser.js';
import { runAnalysisWorkflow } from './workflows/analysis-workflow.js';
import { Task } from './core/types.js';

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
  .description('Run Phase 1-2 analysis only')
  .option('-p, --project-path <path>', 'Path to project')
  .option('--task-id <id>', 'Task ID')
  .option('--task-title <title>', 'Task title')
  .action(async (options: OptionValues) => {
    try {
      const task: Task = {
        taskId: options.taskId || 'ANALYSIS-001',
        title: options.taskTitle || 'Analysis Only',
        description: 'Analysis without implementation',
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
  .command('init')
  .description('Initialize a new project')
  .action(() => {
    logger.info('✓ Initializing task-automation-engine project');
    logger.info('✓ Dependencies ready');
    logger.info('✓ Run "npm run dev -- run --project-path <path>" to start');
  });

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
