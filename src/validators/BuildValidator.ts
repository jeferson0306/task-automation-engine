import { execSync } from 'child_process';
import { ExecutionContext, ValidationResult } from '../core/types';
import logger from '../utils/logger';

/**
 * Validates that the project compiles successfully
 */
class BuildValidator {
  async validate(context: ExecutionContext): Promise<ValidationResult> {
    const startTime = Date.now();
    logger.info('Starting build validation...');

    try {
      const projectPath = context.task.projectPath;
      const projectAnalysis = context.projectAnalysis;

      if (!projectAnalysis) {
        return {
          phase: 'BUILD_VALIDATION',
          success: false,
          errors: ['Project analysis not completed. Run Phase 1 first.'],
          warnings: [],
          duration: Date.now() - startTime,
          details: {},
        };
      }

      const buildTool = projectAnalysis.buildTool;
      const errors: string[] = [];
      const warnings: string[] = [];
      const details: Record<string, unknown> = {};

      // Build command by tool
      let buildCommand = '';
      switch (buildTool.toLowerCase()) {
        case 'maven':
          buildCommand = 'mvn clean package -DskipTests -q';
          break;
        case 'gradle':
          buildCommand = './gradlew clean build -x test -q';
          break;
        case 'npm':
          buildCommand = 'npm run build';
          break;
        case 'yarn':
          buildCommand = 'yarn build';
          break;
        case 'cargo':
          buildCommand = 'cargo build --release';
          break;
        case 'go':
          buildCommand = 'go build -o app ./...';
          break;
        default:
          return {
            phase: 'BUILD_VALIDATION',
            success: false,
            errors: [`Unknown build tool: ${buildTool}`],
            warnings: [],
            duration: Date.now() - startTime,
            details: { buildTool },
          };
      }

      try {
        logger.info(`Executing: ${buildCommand}`);
        const output = execSync(buildCommand, {
          cwd: projectPath,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        details.buildOutput = output.substring(0, 1000); // First 1000 chars
        logger.info('✓ Build successful');
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        errors.push(`Build failed: ${errorMsg.substring(0, 500)}`);
        details.buildError = errorMsg;
        logger.error('Build failed', { error: errorMsg });
      }

      return {
        phase: 'BUILD_VALIDATION',
        success: errors.length === 0,
        errors,
        warnings,
        duration: Date.now() - startTime,
        details,
      };
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Build validation error', { error: errorMsg });
      return {
        phase: 'BUILD_VALIDATION',
        success: false,
        errors: [errorMsg],
        warnings: [],
        duration: Date.now() - startTime,
        details: {},
      };
    }
  }
}

export default new BuildValidator();
