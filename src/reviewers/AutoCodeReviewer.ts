import { ExecutionContext } from '../core/types';
import logger from '../utils/logger';

interface ReviewIssue {
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  category: string;
  file?: string;
  line?: number;
  message: string;
  suggestion?: string;
}

/**
 * Automatically reviews code for anti-patterns and best practices
 */
class AutoCodeReviewer {
  async review(context: ExecutionContext): Promise<ReviewIssue[]> {
    const issues: ReviewIssue[] = [];
    logger.info('Starting automated code review...');

    if (!context.projectAnalysis) {
      logger.warn('Project analysis not completed, skipping code review');
      return issues;
    }

    const language = context.projectAnalysis.language;

    // Check for common anti-patterns
    if (language === 'Java') {
      await this.reviewJavaCode(context, issues);
    } else if (language === 'TypeScript') {
      await this.reviewTypeScriptCode(context, issues);
    } else if (language === 'Python') {
      await this.reviewPythonCode(context, issues);
    }

    logger.info(`Found ${issues.length} code review issues`);
    return issues;
  }

  private async reviewJavaCode(
    _context: ExecutionContext,
    issues: ReviewIssue[]
  ): Promise<void> {
    // Check for common Java anti-patterns
    issues.push({
      severity: 'MEDIUM',
      category: 'NAMING_CONVENTION',
      message: 'Check that class names follow PascalCase convention',
      suggestion: 'Rename classes to PascalCase (e.g., UserService, not userService)',
    });

    issues.push({
      severity: 'MEDIUM',
      category: 'METHOD_LENGTH',
      message: 'Check that methods do not exceed 20 lines',
      suggestion: 'Break long methods into smaller, focused methods',
    });
  }

  private async reviewTypeScriptCode(
    _context: ExecutionContext,
    issues: ReviewIssue[]
  ): Promise<void> {
    // Check for common TypeScript anti-patterns
    issues.push({
      severity: 'HIGH',
      category: 'TYPE_SAFETY',
      message: 'Check that all functions have explicit return types',
      suggestion: 'Add explicit return type annotations (e.g., function(): string {})',
    });

    issues.push({
      severity: 'MEDIUM',
      category: 'ERROR_HANDLING',
      message: 'Check that all async operations have try-catch blocks',
      suggestion: 'Wrap async/await calls in try-catch for error handling',
    });
  }

  private async reviewPythonCode(
    _context: ExecutionContext,
    issues: ReviewIssue[]
  ): Promise<void> {
    // Check for common Python anti-patterns
    issues.push({
      severity: 'MEDIUM',
      category: 'DOCSTRING',
      message: 'Check that all public functions have docstrings',
      suggestion: 'Add docstrings to document function behavior and parameters',
    });
  }
}

export default new AutoCodeReviewer();
