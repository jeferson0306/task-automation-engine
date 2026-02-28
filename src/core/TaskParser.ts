import path from 'path';
import { readJson, fileExists } from '../utils/file-utils.js';
import { logger } from '../utils/logger.js';
import { Task, ParsedTask, TaskStatus } from './types.js';

/**
 * Parses task from JSON file or object
 */
export class TaskParser {
  /**
   * Parse task from JSON file
   */
  async parseFromFile(filePath: string): Promise<ParsedTask> {
    logger.info(`Parsing task from file: ${filePath}`);

    if (!(await fileExists(filePath))) {
      throw new Error(`Task file not found: ${filePath}`);
    }

    const task = await readJson<Task>(filePath);
    return this.validateAndParse(task);
  }

  /**
   * Parse task from object
   */
  parseFromObject(task: Task): ParsedTask {
    logger.info(`Parsing task from object: ${task.taskId}`);
    return this.validateAndParse(task);
  }

  /**
   * Parse task from CLI arguments
   */
  parseFromCLI(args: Record<string, unknown>): ParsedTask {
    logger.info(`Parsing task from CLI arguments`);

    const task: Task = {
      taskId: args.taskId as string,
      title: args.taskTitle as string,
      description: args.taskDesc as string,
      acceptanceCriteria: (args.acceptCriteria as string | string[])
        ? Array.isArray(args.acceptCriteria)
          ? (args.acceptCriteria as string[])
          : [(args.acceptCriteria as string)]
        : [],
      estimatedPoints: parseInt(args.estimatedPoints as string) || 0,
      projectPath: args.projectPath as string,
    };

    return this.validateAndParse(task);
  }

  /**
   * Validate task data
   */
  private validateAndParse(task: Task): ParsedTask {
    const errors: string[] = [];

    if (!task.taskId || task.taskId.trim() === '') {
      errors.push('taskId is required');
    }

    if (!task.title || task.title.trim() === '') {
      errors.push('title is required');
    }

    if (!task.description || task.description.trim() === '') {
      errors.push('description is required');
    }

    if (!task.projectPath || task.projectPath.trim() === '') {
      errors.push('projectPath is required');
    }

    if (errors.length > 0) {
      throw new Error(`Task validation failed:\n${errors.join('\n')}`);
    }

    const absoluteProjectPath = path.resolve(task.projectPath);

    const parsedTask: ParsedTask = {
      ...task,
      projectPath: absoluteProjectPath,
      parsedAt: new Date().toISOString(),
      status: TaskStatus.PARSED,
    };

    logger.info(`Task parsed successfully: ${parsedTask.taskId}`);
    return parsedTask;
  }
}

export default new TaskParser();
