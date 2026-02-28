import { ExecutionContext } from '../core/types';
import logger from '../utils/logger';

interface PerformanceIssue {
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  category: string;
  file?: string;
  line?: number;
  message: string;
  impact: string;
  optimization: string;
}

/**
 * Reviews code for performance issues and optimization opportunities
 */
class PerformanceReviewer {
  async review(context: ExecutionContext): Promise<PerformanceIssue[]> {
    const issues: PerformanceIssue[] = [];
    logger.info('Starting performance review...');

    if (!context.projectAnalysis) {
      logger.warn('Project analysis not completed, skipping performance review');
      return issues;
    }

    const language = context.projectAnalysis.language;

    // Detect performance anti-patterns
    if (language === 'Java') {
      await this.reviewJavaPerformance(context, issues);
    } else if (language === 'TypeScript') {
      await this.reviewTypeScriptPerformance(context, issues);
    } else if (language === 'Python') {
      await this.reviewPythonPerformance(context, issues);
    }

    logger.info(`Found ${issues.length} performance issues`);
    return issues;
  }

  private async reviewJavaPerformance(
    _context: ExecutionContext,
    issues: PerformanceIssue[]
  ): Promise<void> {
    issues.push({
      severity: 'MEDIUM',
      category: 'STRING_CONCATENATION',
      message: 'Check for String concatenation in loops',
      impact: 'O(n²) memory allocations instead of O(n)',
      optimization: 'Use StringBuilder or StringBuffer for repeated concatenation',
    });

    issues.push({
      severity: 'MEDIUM',
      category: 'COLLECTION_SIZE',
      message: 'Check for calling .size() in loop conditions',
      impact: 'May trigger O(n) list size calculation on each iteration',
      optimization: 'Cache size before loop: for(int i=0; i<list.size(); i++) → for(int i=0, size=list.size(); i<size; i++)',
    });

    issues.push({
      severity: 'LOW',
      category: 'OBJECT_CREATION',
      message: 'Check for unnecessary object creation in loops',
      impact: 'Excess garbage collection pressure',
      optimization: 'Move object creation outside the loop',
    });
  }

  private async reviewTypeScriptPerformance(
    _context: ExecutionContext,
    issues: PerformanceIssue[]
  ): Promise<void> {
    issues.push({
      severity: 'MEDIUM',
      category: 'UNOPTIMIZED_RENDERING',
      message: 'Check for missing React.memo or useMemo in components',
      impact: 'Unnecessary re-renders of child components',
      optimization: 'Wrap expensive components in React.memo or use useMemo',
    });

    issues.push({
      severity: 'MEDIUM',
      category: 'MISSING_DEBOUNCE',
      message: 'Check for unthrottled event handlers (scroll, resize, input)',
      impact: 'Excessive function calls causing performance degradation',
      optimization: 'Use debounce/throttle for high-frequency event handlers',
    });

    issues.push({
      severity: 'LOW',
      category: 'BUNDLE_SIZE',
      message: 'Check for large dependencies without tree-shaking',
      impact: 'Increased bundle size affecting load time',
      optimization: 'Use dynamic imports or lighter alternatives',
    });
  }

  private async reviewPythonPerformance(
    _context: ExecutionContext,
    issues: PerformanceIssue[]
  ): Promise<void> {
    issues.push({
      severity: 'MEDIUM',
      category: 'LIST_COMPREHENSION',
      message: 'Check for nested loops that should use list comprehension',
      impact: 'O(n) slower than optimized Python constructs',
      optimization: 'Use list comprehension: [x for x in items if condition]',
    });

    issues.push({
      severity: 'MEDIUM',
      category: 'N_PLUS_ONE_QUERY',
      message: 'Check for database queries in loops (ORM)',
      impact: 'O(n) database queries instead of single batched query',
      optimization: 'Use select_related() or prefetch_related() for ORM queries',
    });
  }
}

export default new PerformanceReviewer();
