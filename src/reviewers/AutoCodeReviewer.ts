import path from 'path';
import fs from 'fs-extra';
import { ExecutionContext, ParsedFileAST, ClassNode, MethodNode, FunctionNode } from '../core/types.js';
import logger from '../utils/logger.js';
import ASTParser from '../parsers/ASTParser.js';
import ProjectScanner from '../analyzers/ProjectScanner.js';

interface ReviewIssue {
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  category: string;
  file?: string;
  line?: number;
  message: string;
  suggestion?: string;
  codeSnippet?: string;
}

const MAX_METHOD_LINES = 30;
const MAX_METHOD_COMPLEXITY = 10;
const MAX_CLASS_METHODS = 20;
const MAX_PARAMETERS = 5;

/**
 * Automatically reviews code for anti-patterns and best practices
 * Uses real AST parsing for accurate analysis
 */
class AutoCodeReviewer {
  async review(context: ExecutionContext): Promise<ReviewIssue[]> {
    const issues: ReviewIssue[] = [];
    logger.info('Starting automated code review with AST parsing...');

    if (!context.projectAnalysis) {
      logger.warn('Project analysis not completed, skipping code review');
      return issues;
    }

    const snapshot = context.projectSnapshot || (await ProjectScanner.scan(context.workingDir));
    context.projectSnapshot = snapshot;

    const sourceFiles = snapshot.files.filter(
      (f) =>
        f.classification !== 'test' &&
        f.classification !== 'config' &&
        ['Java', 'TypeScript', 'JavaScript', 'Python', 'Go', 'Kotlin'].some((lang) =>
          f.language.includes(lang)
        )
    );

    for (const file of sourceFiles.slice(0, 50)) {
      try {
        const ast = await ASTParser.parseFile(file.path);
        if (ast.success) {
          await this.reviewAST(ast, issues);
        }
      } catch (error) {
        logger.warn(`Failed to parse ${file.relativePath}: ${error}`);
      }
    }

    logger.info(`Found ${issues.length} code review issues`);
    return issues;
  }

  private async reviewAST(ast: ParsedFileAST, issues: ReviewIssue[]): Promise<void> {
    const relativePath = ast.filePath;

    for (const cls of ast.classes) {
      this.reviewClass(cls, relativePath, issues);
    }

    for (const func of ast.functions) {
      this.reviewFunction(func, relativePath, issues);
    }

    this.reviewNamingConventions(ast, issues);
  }

  private reviewClass(cls: ClassNode, file: string, issues: ReviewIssue[]): void {
    if (!this.isPascalCase(cls.name)) {
      issues.push({
        severity: 'MEDIUM',
        category: 'NAMING_CONVENTION',
        file,
        line: cls.line,
        message: `Class '${cls.name}' should use PascalCase`,
        suggestion: `Rename to '${this.toPascalCase(cls.name)}'`,
      });
    }

    if (cls.methods.length > MAX_CLASS_METHODS) {
      issues.push({
        severity: 'HIGH',
        category: 'GOD_CLASS',
        file,
        line: cls.line,
        message: `Class '${cls.name}' has ${cls.methods.length} methods (max recommended: ${MAX_CLASS_METHODS})`,
        suggestion: 'Consider splitting into smaller, focused classes following Single Responsibility Principle',
      });
    }

    const publicMethods = cls.methods.filter((m) => m.visibility === 'public' && !m.name.startsWith('get') && !m.name.startsWith('set'));
    if (publicMethods.length > 10) {
      issues.push({
        severity: 'MEDIUM',
        category: 'API_SURFACE',
        file,
        line: cls.line,
        message: `Class '${cls.name}' exposes ${publicMethods.length} public methods`,
        suggestion: 'Consider reducing public API surface or extracting interfaces',
      });
    }

    for (const method of cls.methods) {
      this.reviewMethod(method, cls.name, file, issues);
    }
  }

  private reviewMethod(method: MethodNode, className: string, file: string, issues: ReviewIssue[]): void {
    if (method.body) {
      const lineCount = method.body.split('\n').length;
      if (lineCount > MAX_METHOD_LINES) {
        issues.push({
          severity: 'MEDIUM',
          category: 'METHOD_LENGTH',
          file,
          line: method.line,
          message: `Method '${className}.${method.name}' has ${lineCount} lines (max recommended: ${MAX_METHOD_LINES})`,
          suggestion: 'Break into smaller, focused methods',
        });
      }
    }

    if (method.complexity > MAX_METHOD_COMPLEXITY) {
      issues.push({
        severity: 'HIGH',
        category: 'COMPLEXITY',
        file,
        line: method.line,
        message: `Method '${className}.${method.name}' has cyclomatic complexity ${method.complexity} (max recommended: ${MAX_METHOD_COMPLEXITY})`,
        suggestion: 'Reduce complexity by extracting conditions into separate methods or using polymorphism',
      });
    }

    if (method.parameters.length > MAX_PARAMETERS) {
      issues.push({
        severity: 'MEDIUM',
        category: 'PARAMETER_COUNT',
        file,
        line: method.line,
        message: `Method '${className}.${method.name}' has ${method.parameters.length} parameters (max recommended: ${MAX_PARAMETERS})`,
        suggestion: 'Consider using a parameter object or builder pattern',
      });
    }

    if (method.visibility === 'public' && !method.returnType && method.name !== 'constructor') {
      issues.push({
        severity: 'MEDIUM',
        category: 'TYPE_SAFETY',
        file,
        line: method.line,
        message: `Public method '${className}.${method.name}' is missing return type`,
        suggestion: 'Add explicit return type for better type safety',
      });
    }

    if (method.body && method.body.includes('// TODO') || method.body?.includes('// FIXME')) {
      issues.push({
        severity: 'LOW',
        category: 'INCOMPLETE_CODE',
        file,
        line: method.line,
        message: `Method '${className}.${method.name}' contains TODO/FIXME marker`,
        suggestion: 'Address the TODO or create a tracking issue',
      });
    }

    if (!this.isCamelCase(method.name) && method.name !== 'constructor' && !method.name.startsWith('_')) {
      issues.push({
        severity: 'LOW',
        category: 'NAMING_CONVENTION',
        file,
        line: method.line,
        message: `Method '${method.name}' should use camelCase`,
        suggestion: `Rename to '${this.toCamelCase(method.name)}'`,
      });
    }
  }

  private reviewFunction(func: FunctionNode, file: string, issues: ReviewIssue[]): void {
    if (func.body) {
      const lineCount = func.body.split('\n').length;
      if (lineCount > MAX_METHOD_LINES) {
        issues.push({
          severity: 'MEDIUM',
          category: 'FUNCTION_LENGTH',
          file,
          line: func.line,
          message: `Function '${func.name}' has ${lineCount} lines (max recommended: ${MAX_METHOD_LINES})`,
          suggestion: 'Break into smaller, focused functions',
        });
      }
    }

    if (func.complexity > MAX_METHOD_COMPLEXITY) {
      issues.push({
        severity: 'HIGH',
        category: 'COMPLEXITY',
        file,
        line: func.line,
        message: `Function '${func.name}' has cyclomatic complexity ${func.complexity} (max recommended: ${MAX_METHOD_COMPLEXITY})`,
        suggestion: 'Reduce complexity by extracting helper functions',
      });
    }

    if (func.parameters.length > MAX_PARAMETERS) {
      issues.push({
        severity: 'MEDIUM',
        category: 'PARAMETER_COUNT',
        file,
        line: func.line,
        message: `Function '${func.name}' has ${func.parameters.length} parameters (max recommended: ${MAX_PARAMETERS})`,
        suggestion: 'Consider using an options object pattern',
      });
    }

    if (func.isExported && !func.returnType) {
      issues.push({
        severity: 'MEDIUM',
        category: 'TYPE_SAFETY',
        file,
        line: func.line,
        message: `Exported function '${func.name}' is missing return type`,
        suggestion: 'Add explicit return type for better type safety and documentation',
      });
    }
  }

  private reviewNamingConventions(ast: ParsedFileAST, issues: ReviewIssue[]): void {
    for (const imp of ast.imports) {
      if (imp.source.includes('../../../')) {
        issues.push({
          severity: 'LOW',
          category: 'IMPORT_PATH',
          file: ast.filePath,
          line: imp.line,
          message: `Deep relative import: '${imp.source}'`,
          suggestion: 'Consider using path aliases or restructuring modules',
        });
      }
    }

    for (const cls of ast.classes) {
      for (const prop of cls.properties) {
        if (prop.visibility === 'public' && !prop.isReadonly && !prop.name.startsWith('_')) {
          const hasSetter = cls.methods.some((m) => m.name === `set${prop.name.charAt(0).toUpperCase()}${prop.name.slice(1)}`);
          if (!hasSetter) {
            issues.push({
              severity: 'LOW',
              category: 'ENCAPSULATION',
              file: ast.filePath,
              line: prop.line,
              message: `Public mutable field '${cls.name}.${prop.name}' without setter`,
              suggestion: 'Consider making private with getter/setter for better encapsulation',
            });
          }
        }
      }
    }
  }

  private isPascalCase(name: string): boolean {
    return /^[A-Z][a-zA-Z0-9]*$/.test(name);
  }

  private isCamelCase(name: string): boolean {
    return /^[a-z][a-zA-Z0-9]*$/.test(name);
  }

  private toPascalCase(name: string): string {
    return name.charAt(0).toUpperCase() + name.slice(1).replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  }

  private toCamelCase(name: string): string {
    return name.charAt(0).toLowerCase() + name.slice(1).replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  }
}

export default new AutoCodeReviewer();
