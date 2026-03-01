import fs from 'fs-extra';
import path from 'path';
import { logger } from '../utils/logger.js';
import {
  ParsedFileAST,
  ImportNode,
  ClassNode,
  FunctionNode,
  MethodNode,
  PropertyNode,
  ParameterNode,
  VariableNode,
  ASTNode,
} from '../core/types.js';

/**
 * AST Parser - Real parsing for Java, TypeScript, Python, Go
 * Uses regex-based parsing for portability (no external dependencies)
 */
export class ASTParser {
  /**
   * Parse a source file and extract AST
   */
  async parseFile(filePath: string): Promise<ParsedFileAST> {
    const startTime = Date.now();
    const ext = path.extname(filePath).toLowerCase();

    const result: ParsedFileAST = {
      filePath,
      language: this.getLanguage(ext),
      parseTime: 0,
      success: false,
      errors: [],
      imports: [],
      classes: [],
      functions: [],
      variables: [],
    };

    try {
      const content = await fs.readFile(filePath, 'utf-8');

      switch (ext) {
        case '.java':
        case '.kt':
          this.parseJava(content, result);
          break;
        case '.ts':
        case '.tsx':
        case '.js':
        case '.jsx':
          this.parseTypeScript(content, result);
          break;
        case '.py':
          this.parsePython(content, result);
          break;
        case '.go':
          this.parseGo(content, result);
          break;
        default:
          result.errors.push(`Unsupported file type: ${ext}`);
      }

      result.success = result.errors.length === 0;
    } catch (error) {
      result.errors.push(`Failed to read file: ${error}`);
    }

    result.parseTime = Date.now() - startTime;
    return result;
  }

  /**
   * Parse multiple files
   */
  async parseFiles(filePaths: string[]): Promise<ParsedFileAST[]> {
    const results: ParsedFileAST[] = [];

    for (const filePath of filePaths) {
      const result = await this.parseFile(filePath);
      results.push(result);
    }

    return results;
  }

  private getLanguage(ext: string): string {
    const langMap: Record<string, string> = {
      '.java': 'Java',
      '.kt': 'Kotlin',
      '.ts': 'TypeScript',
      '.tsx': 'TypeScript (React)',
      '.js': 'JavaScript',
      '.jsx': 'JavaScript (React)',
      '.py': 'Python',
      '.go': 'Go',
    };
    return langMap[ext] || 'Unknown';
  }

  /**
   * Parse Java/Kotlin source code
   */
  private parseJava(content: string, result: ParsedFileAST): void {
    const lines = content.split('\n');
    let lineNum = 0;

    // Parse imports
    const importRegex = /^import\s+(static\s+)?([\w.*]+)\s*;/gm;
    let match;

    while ((match = importRegex.exec(content)) !== null) {
      const line = content.substring(0, match.index).split('\n').length;
      result.imports.push({
        type: 'import',
        start: match.index,
        end: match.index + match[0].length,
        line,
        column: 0,
        source: match[2],
        specifiers: [match[2].split('.').pop() || ''],
        isDefault: false,
        isNamespace: match[2].endsWith('*'),
      });
    }

    // Parse classes
    const classRegex =
      /(?:(@\w+(?:\([^)]*\))?)\s*)*(?:(public|private|protected)\s+)?(?:(abstract|final)\s+)?(?:class|interface|enum)\s+(\w+)(?:\s*<[^>]+>)?(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?\s*\{/g;

    while ((match = classRegex.exec(content)) !== null) {
      const line = content.substring(0, match.index).split('\n').length;
      const className = match[4];
      const classStart = match.index;
      const classEnd = this.findMatchingBrace(content, classStart + match[0].length - 1);
      const classBody = content.substring(classStart, classEnd);

      const classNode: ClassNode = {
        type: 'class',
        start: classStart,
        end: classEnd,
        line,
        column: 0,
        name: className,
        superClass: match[5],
        interfaces: match[6] ? match[6].split(',').map((s) => s.trim()) : [],
        decorators: this.extractJavaAnnotations(content, classStart),
        methods: [],
        properties: [],
        isAbstract: match[3] === 'abstract',
        isExported: match[2] === 'public',
      };

      // Parse methods within class
      classNode.methods = this.parseJavaMethods(classBody, line);
      classNode.properties = this.parseJavaProperties(classBody, line);

      result.classes.push(classNode);
    }
  }

  private parseJavaMethods(classBody: string, classStartLine: number): MethodNode[] {
    const methods: MethodNode[] = [];
    const methodRegex =
      /(?:(@\w+(?:\([^)]*\))?)\s*)*(?:(public|private|protected)\s+)?(?:(static)\s+)?(?:(abstract)\s+)?(?:(synchronized)\s+)?(?:<[\w,\s]+>\s+)?(\w+(?:<[^>]+>)?)\s+(\w+)\s*\(([^)]*)\)(?:\s*throws\s+([\w,\s]+))?\s*(?:\{|;)/g;

    let match;
    while ((match = methodRegex.exec(classBody)) !== null) {
      const line = classBody.substring(0, match.index).split('\n').length + classStartLine - 1;
      const methodName = match[7];
      const returnType = match[6];
      const paramsStr = match[8];

      const methodStart = match.index;
      let methodEnd = methodStart + match[0].length;
      let body: string | undefined;
      let complexity = 1;

      if (match[0].endsWith('{')) {
        methodEnd = this.findMatchingBrace(classBody, methodStart + match[0].length - 1);
        body = classBody.substring(methodStart + match[0].length, methodEnd - 1);
        complexity = this.calculateComplexity(body);
      }

      methods.push({
        type: 'method',
        start: methodStart,
        end: methodEnd,
        line,
        column: 0,
        name: methodName,
        visibility: (match[2] as 'public' | 'private' | 'protected') || 'package',
        parameters: this.parseJavaParameters(paramsStr),
        returnType,
        decorators: this.extractJavaAnnotations(classBody, methodStart),
        isStatic: !!match[3],
        isAsync: false,
        isAbstract: !!match[4],
        body,
        complexity,
      });
    }

    return methods;
  }

  private parseJavaProperties(classBody: string, classStartLine: number): PropertyNode[] {
    const properties: PropertyNode[] = [];
    const fieldRegex =
      /(?:(@\w+(?:\([^)]*\))?)\s*)*(?:(public|private|protected)\s+)?(?:(static)\s+)?(?:(final)\s+)?(\w+(?:<[^>]+>)?)\s+(\w+)\s*(?:=\s*([^;]+))?\s*;/g;

    let match;
    while ((match = fieldRegex.exec(classBody)) !== null) {
      const line = classBody.substring(0, match.index).split('\n').length + classStartLine - 1;

      properties.push({
        type: 'property',
        start: match.index,
        end: match.index + match[0].length,
        line,
        column: 0,
        name: match[6],
        propertyType: match[5],
        visibility: (match[2] as 'public' | 'private' | 'protected') || 'package',
        decorators: this.extractJavaAnnotations(classBody, match.index),
        isStatic: !!match[3],
        isReadonly: !!match[4],
        initialValue: match[7]?.trim(),
      });
    }

    return properties;
  }

  private parseJavaParameters(paramsStr: string): ParameterNode[] {
    const params: ParameterNode[] = [];
    if (!paramsStr.trim()) return params;

    const paramParts = this.splitParameters(paramsStr);

    for (const part of paramParts) {
      const paramMatch = part.trim().match(/(?:(@\w+)\s+)?(?:(final)\s+)?(\w+(?:<[^>]+>)?)\s+(\w+)/);
      if (paramMatch) {
        params.push({
          type: 'parameter',
          start: 0,
          end: 0,
          line: 0,
          column: 0,
          name: paramMatch[4],
          parameterType: paramMatch[3],
          isOptional: false,
          isRest: false,
          decorators: paramMatch[1] ? [paramMatch[1]] : [],
        });
      }
    }

    return params;
  }

  private extractJavaAnnotations(content: string, position: number): string[] {
    const annotations: string[] = [];
    const beforeContent = content.substring(Math.max(0, position - 500), position);
    const lines = beforeContent.split('\n').reverse();

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('@')) {
        const match = trimmed.match(/@(\w+)/);
        if (match) {
          annotations.unshift(match[1]);
        }
      } else if (trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('*')) {
        break;
      }
    }

    return annotations;
  }

  /**
   * Parse TypeScript/JavaScript source code
   */
  private parseTypeScript(content: string, result: ParsedFileAST): void {
    // Parse imports
    const importRegex = /import\s+(?:(\*\s+as\s+\w+)|(?:\{([^}]+)\})|(\w+))?(?:\s*,\s*(?:\{([^}]+)\}|(\w+)))?\s+from\s+['"]([^'"]+)['"]/g;

    let match;
    while ((match = importRegex.exec(content)) !== null) {
      const line = content.substring(0, match.index).split('\n').length;
      const specifiers: string[] = [];

      if (match[1]) specifiers.push(match[1].replace('* as ', ''));
      if (match[2]) specifiers.push(...match[2].split(',').map((s) => s.trim().split(' as ')[0]));
      if (match[3]) specifiers.push(match[3]);
      if (match[4]) specifiers.push(...match[4].split(',').map((s) => s.trim().split(' as ')[0]));
      if (match[5]) specifiers.push(match[5]);

      result.imports.push({
        type: 'import',
        start: match.index,
        end: match.index + match[0].length,
        line,
        column: 0,
        source: match[6],
        specifiers,
        isDefault: !!match[3] || !!match[5],
        isNamespace: !!match[1],
      });
    }

    // Parse classes
    const classRegex =
      /(?:(@\w+(?:\([^)]*\))?)\s*)*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s*<[^>]+>)?(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?\s*\{/g;

    while ((match = classRegex.exec(content)) !== null) {
      const line = content.substring(0, match.index).split('\n').length;
      const className = match[2];
      const classStart = match.index;
      const classEnd = this.findMatchingBrace(content, classStart + match[0].length - 1);
      const classBody = content.substring(classStart, classEnd);

      const classNode: ClassNode = {
        type: 'class',
        start: classStart,
        end: classEnd,
        line,
        column: 0,
        name: className,
        superClass: match[3],
        interfaces: match[4] ? match[4].split(',').map((s) => s.trim()) : [],
        decorators: this.extractTsDecorators(content, classStart),
        methods: [],
        properties: [],
        isAbstract: content.substring(Math.max(0, classStart - 50), classStart).includes('abstract'),
        isExported: content.substring(Math.max(0, classStart - 50), classStart).includes('export'),
      };

      classNode.methods = this.parseTsMethods(classBody, line);
      classNode.properties = this.parseTsProperties(classBody, line);

      result.classes.push(classNode);
    }

    // Parse standalone functions
    const funcRegex =
      /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]+>)?\s*\(([^)]*)\)(?:\s*:\s*([^\{]+))?\s*\{/g;

    while ((match = funcRegex.exec(content)) !== null) {
      const line = content.substring(0, match.index).split('\n').length;
      const funcStart = match.index;
      const funcEnd = this.findMatchingBrace(content, funcStart + match[0].length - 1);
      const body = content.substring(funcStart + match[0].length, funcEnd - 1);

      result.functions.push({
        type: 'function',
        start: funcStart,
        end: funcEnd,
        line,
        column: 0,
        name: match[1],
        parameters: this.parseTsParameters(match[2]),
        returnType: match[3]?.trim(),
        isAsync: content.substring(Math.max(0, funcStart - 20), funcStart).includes('async'),
        isExported: content.substring(Math.max(0, funcStart - 20), funcStart).includes('export'),
        isArrow: false,
        body,
        complexity: this.calculateComplexity(body),
      });
    }

    // Parse arrow functions (exported const)
    const arrowRegex = /(?:export\s+)?const\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s+)?\([^)]*\)\s*(?::\s*[^=]+)?\s*=>/g;

    while ((match = arrowRegex.exec(content)) !== null) {
      const line = content.substring(0, match.index).split('\n').length;

      result.functions.push({
        type: 'function',
        start: match.index,
        end: match.index + match[0].length,
        line,
        column: 0,
        name: match[1],
        parameters: [],
        isAsync: match[0].includes('async'),
        isExported: match[0].includes('export'),
        isArrow: true,
        complexity: 1,
      });
    }
  }

  private parseTsMethods(classBody: string, classStartLine: number): MethodNode[] {
    const methods: MethodNode[] = [];
    const methodRegex =
      /(?:(@\w+(?:\([^)]*\))?)\s*)*(?:(public|private|protected)\s+)?(?:(static)\s+)?(?:(async)\s+)?(?:(abstract)\s+)?(\w+)\s*(?:<[^>]+>)?\s*\(([^)]*)\)(?:\s*:\s*([^\{;]+))?\s*(?:\{|;)/g;

    let match;
    while ((match = methodRegex.exec(classBody)) !== null) {
      const line = classBody.substring(0, match.index).split('\n').length + classStartLine - 1;
      const methodName = match[6];

      if (['constructor', 'if', 'for', 'while', 'switch', 'catch'].includes(methodName)) {
        if (methodName !== 'constructor') continue;
      }

      const methodStart = match.index;
      let methodEnd = methodStart + match[0].length;
      let body: string | undefined;
      let complexity = 1;

      if (match[0].endsWith('{')) {
        methodEnd = this.findMatchingBrace(classBody, methodStart + match[0].length - 1);
        body = classBody.substring(methodStart + match[0].length, methodEnd - 1);
        complexity = this.calculateComplexity(body);
      }

      methods.push({
        type: 'method',
        start: methodStart,
        end: methodEnd,
        line,
        column: 0,
        name: methodName,
        visibility: (match[2] as 'public' | 'private' | 'protected') || 'public',
        parameters: this.parseTsParameters(match[7]),
        returnType: match[8]?.trim(),
        decorators: this.extractTsDecorators(classBody, methodStart),
        isStatic: !!match[3],
        isAsync: !!match[4],
        isAbstract: !!match[5],
        body,
        complexity,
      });
    }

    return methods;
  }

  private parseTsProperties(classBody: string, classStartLine: number): PropertyNode[] {
    const properties: PropertyNode[] = [];
    const propRegex =
      /(?:(@\w+(?:\([^)]*\))?)\s*)*(?:(public|private|protected)\s+)?(?:(static)\s+)?(?:(readonly)\s+)?(\w+)(?:\?)?(?:\s*:\s*([^=;\n]+))?\s*(?:=\s*([^;\n]+))?\s*;/g;

    let match;
    while ((match = propRegex.exec(classBody)) !== null) {
      const line = classBody.substring(0, match.index).split('\n').length + classStartLine - 1;

      properties.push({
        type: 'property',
        start: match.index,
        end: match.index + match[0].length,
        line,
        column: 0,
        name: match[5],
        propertyType: match[6]?.trim(),
        visibility: (match[2] as 'public' | 'private' | 'protected') || 'public',
        decorators: this.extractTsDecorators(classBody, match.index),
        isStatic: !!match[3],
        isReadonly: !!match[4],
        initialValue: match[7]?.trim(),
      });
    }

    return properties;
  }

  private parseTsParameters(paramsStr: string): ParameterNode[] {
    const params: ParameterNode[] = [];
    if (!paramsStr?.trim()) return params;

    const paramParts = this.splitParameters(paramsStr);

    for (const part of paramParts) {
      const paramMatch = part.trim().match(/(?:(@\w+)\s+)?(?:(public|private|protected|readonly)\s+)?(\.\.\.)?([\w]+)(\?)?(?:\s*:\s*(.+?))?(?:\s*=\s*(.+))?$/);

      if (paramMatch) {
        params.push({
          type: 'parameter',
          start: 0,
          end: 0,
          line: 0,
          column: 0,
          name: paramMatch[4],
          parameterType: paramMatch[6]?.trim(),
          isOptional: !!paramMatch[5] || !!paramMatch[7],
          isRest: !!paramMatch[3],
          defaultValue: paramMatch[7]?.trim(),
          decorators: paramMatch[1] ? [paramMatch[1]] : [],
        });
      }
    }

    return params;
  }

  private extractTsDecorators(content: string, position: number): string[] {
    const decorators: string[] = [];
    const beforeContent = content.substring(Math.max(0, position - 500), position);
    const lines = beforeContent.split('\n').reverse();

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('@')) {
        const match = trimmed.match(/@(\w+)/);
        if (match) {
          decorators.unshift(match[1]);
        }
      } else if (trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('*')) {
        break;
      }
    }

    return decorators;
  }

  /**
   * Parse Python source code
   */
  private parsePython(content: string, result: ParsedFileAST): void {
    // Parse imports
    const importRegex = /(?:from\s+([\w.]+)\s+)?import\s+([^#\n]+)/g;

    let match;
    while ((match = importRegex.exec(content)) !== null) {
      const line = content.substring(0, match.index).split('\n').length;
      const source = match[1] || match[2].split(',')[0].trim().split(' as ')[0];
      const specifiers = match[2].split(',').map((s) => s.trim().split(' as ')[0]);

      result.imports.push({
        type: 'import',
        start: match.index,
        end: match.index + match[0].length,
        line,
        column: 0,
        source,
        specifiers,
        isDefault: !match[1],
        isNamespace: match[2].includes('*'),
      });
    }

    // Parse classes
    const classRegex = /(?:@(\w+)(?:\([^)]*\))?\s*\n)*class\s+(\w+)(?:\s*\(([^)]*)\))?\s*:/g;

    while ((match = classRegex.exec(content)) !== null) {
      const line = content.substring(0, match.index).split('\n').length;
      const className = match[2];
      const classStart = match.index;
      const classEnd = this.findPythonBlockEnd(content, classStart + match[0].length);
      const classBody = content.substring(classStart, classEnd);

      const parents = match[3] ? match[3].split(',').map((s) => s.trim()) : [];

      const classNode: ClassNode = {
        type: 'class',
        start: classStart,
        end: classEnd,
        line,
        column: 0,
        name: className,
        superClass: parents[0],
        interfaces: parents.slice(1),
        decorators: match[1] ? [match[1]] : [],
        methods: [],
        properties: [],
        isAbstract: classBody.includes('@abstractmethod'),
        isExported: !className.startsWith('_'),
      };

      classNode.methods = this.parsePythonMethods(classBody, line);

      result.classes.push(classNode);
    }

    // Parse standalone functions
    const funcRegex = /(?:@(\w+)(?:\([^)]*\))?\s*\n)*(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*([^:]+))?\s*:/g;

    while ((match = funcRegex.exec(content)) !== null) {
      const line = content.substring(0, match.index).split('\n').length;

      if (content.substring(0, match.index).includes('class ')) {
        const lastClass = content.substring(0, match.index).lastIndexOf('class ');
        const indentMatch = content.substring(match.index - 10, match.index).match(/\n(\s+)/);
        if (indentMatch && indentMatch[1].length > 0) {
          continue;
        }
      }

      const funcStart = match.index;
      const funcEnd = this.findPythonBlockEnd(content, funcStart + match[0].length);
      const body = content.substring(funcStart + match[0].length, funcEnd);

      result.functions.push({
        type: 'function',
        start: funcStart,
        end: funcEnd,
        line,
        column: 0,
        name: match[2],
        parameters: this.parsePythonParameters(match[3]),
        returnType: match[4]?.trim(),
        isAsync: content.substring(Math.max(0, funcStart - 20), funcStart).includes('async'),
        isExported: !match[2].startsWith('_'),
        isArrow: false,
        body,
        complexity: this.calculateComplexity(body),
      });
    }
  }

  private parsePythonMethods(classBody: string, classStartLine: number): MethodNode[] {
    const methods: MethodNode[] = [];
    const methodRegex = /(?:@(\w+)(?:\([^)]*\))?\s*\n\s*)*(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*([^:]+))?\s*:/g;

    let match;
    while ((match = methodRegex.exec(classBody)) !== null) {
      const line = classBody.substring(0, match.index).split('\n').length + classStartLine - 1;
      const methodStart = match.index;
      const methodEnd = this.findPythonBlockEnd(classBody, methodStart + match[0].length);
      const body = classBody.substring(methodStart + match[0].length, methodEnd);

      const decorators: string[] = [];
      const beforeMethod = classBody.substring(Math.max(0, methodStart - 200), methodStart);
      const decoratorMatches = beforeMethod.match(/@(\w+)/g);
      if (decoratorMatches) {
        decorators.push(...decoratorMatches.map((d) => d.substring(1)));
      }

      const visibility = match[2].startsWith('__')
        ? 'private'
        : match[2].startsWith('_')
          ? 'protected'
          : 'public';

      methods.push({
        type: 'method',
        start: methodStart,
        end: methodEnd,
        line,
        column: 0,
        name: match[2],
        visibility,
        parameters: this.parsePythonParameters(match[3]),
        returnType: match[4]?.trim(),
        decorators,
        isStatic: decorators.includes('staticmethod'),
        isAsync: classBody.substring(Math.max(0, methodStart - 20), methodStart).includes('async'),
        isAbstract: decorators.includes('abstractmethod'),
        body,
        complexity: this.calculateComplexity(body),
      });
    }

    return methods;
  }

  private parsePythonParameters(paramsStr: string): ParameterNode[] {
    const params: ParameterNode[] = [];
    if (!paramsStr?.trim()) return params;

    const paramParts = this.splitParameters(paramsStr);

    for (const part of paramParts) {
      const trimmed = part.trim();
      if (trimmed === 'self' || trimmed === 'cls') continue;

      const paramMatch = trimmed.match(/(\*{0,2})(\w+)(?:\s*:\s*([^=]+?))?(?:\s*=\s*(.+))?$/);

      if (paramMatch) {
        params.push({
          type: 'parameter',
          start: 0,
          end: 0,
          line: 0,
          column: 0,
          name: paramMatch[2],
          parameterType: paramMatch[3]?.trim(),
          isOptional: !!paramMatch[4],
          isRest: paramMatch[1] === '*' || paramMatch[1] === '**',
          defaultValue: paramMatch[4]?.trim(),
          decorators: [],
        });
      }
    }

    return params;
  }

  /**
   * Parse Go source code
   */
  private parseGo(content: string, result: ParsedFileAST): void {
    // Parse imports
    const singleImportRegex = /import\s+"([^"]+)"/g;
    const multiImportRegex = /import\s+\(([\s\S]*?)\)/g;

    let match;
    while ((match = singleImportRegex.exec(content)) !== null) {
      const line = content.substring(0, match.index).split('\n').length;

      result.imports.push({
        type: 'import',
        start: match.index,
        end: match.index + match[0].length,
        line,
        column: 0,
        source: match[1],
        specifiers: [match[1].split('/').pop() || ''],
        isDefault: false,
        isNamespace: false,
      });
    }

    while ((match = multiImportRegex.exec(content)) !== null) {
      const line = content.substring(0, match.index).split('\n').length;
      const imports = match[1].match(/"[^"]+"/g) || [];

      for (const imp of imports) {
        const source = imp.replace(/"/g, '');
        result.imports.push({
          type: 'import',
          start: match.index,
          end: match.index + match[0].length,
          line,
          column: 0,
          source,
          specifiers: [source.split('/').pop() || ''],
          isDefault: false,
          isNamespace: false,
        });
      }
    }

    // Parse structs (classes)
    const structRegex = /type\s+(\w+)\s+struct\s*\{([^}]*)\}/g;

    while ((match = structRegex.exec(content)) !== null) {
      const line = content.substring(0, match.index).split('\n').length;
      const structName = match[1];
      const fieldsStr = match[2];

      const classNode: ClassNode = {
        type: 'class',
        start: match.index,
        end: match.index + match[0].length,
        line,
        column: 0,
        name: structName,
        interfaces: [],
        decorators: [],
        methods: [],
        properties: [],
        isAbstract: false,
        isExported: /^[A-Z]/.test(structName),
      };

      const fieldLines = fieldsStr.split('\n').filter((l) => l.trim());
      for (const fieldLine of fieldLines) {
        const fieldMatch = fieldLine.trim().match(/^(\w+)\s+(.+?)(?:\s+`[^`]+`)?$/);
        if (fieldMatch) {
          classNode.properties.push({
            type: 'property',
            start: 0,
            end: 0,
            line,
            column: 0,
            name: fieldMatch[1],
            propertyType: fieldMatch[2],
            visibility: /^[A-Z]/.test(fieldMatch[1]) ? 'public' : 'private',
            decorators: [],
            isStatic: false,
            isReadonly: false,
          });
        }
      }

      result.classes.push(classNode);
    }

    // Parse functions and methods
    const funcRegex = /func\s+(?:\((\w+)\s+\*?(\w+)\)\s+)?(\w+)\s*\(([^)]*)\)(?:\s*\(([^)]*)\)|\s*(\w+))?\s*\{/g;

    while ((match = funcRegex.exec(content)) !== null) {
      const line = content.substring(0, match.index).split('\n').length;
      const isMethod = !!match[1];
      const receiverType = match[2];
      const funcName = match[3];
      const paramsStr = match[4];
      const returnType = match[5] || match[6];

      const funcStart = match.index;
      const funcEnd = this.findMatchingBrace(content, funcStart + match[0].length - 1);
      const body = content.substring(funcStart + match[0].length, funcEnd - 1);

      if (isMethod) {
        const classIndex = result.classes.findIndex((c) => c.name === receiverType);
        if (classIndex >= 0) {
          result.classes[classIndex].methods.push({
            type: 'method',
            start: funcStart,
            end: funcEnd,
            line,
            column: 0,
            name: funcName,
            visibility: /^[A-Z]/.test(funcName) ? 'public' : 'private',
            parameters: this.parseGoParameters(paramsStr),
            returnType,
            decorators: [],
            isStatic: false,
            isAsync: false,
            isAbstract: false,
            body,
            complexity: this.calculateComplexity(body),
          });
        }
      } else {
        result.functions.push({
          type: 'function',
          start: funcStart,
          end: funcEnd,
          line,
          column: 0,
          name: funcName,
          parameters: this.parseGoParameters(paramsStr),
          returnType,
          isAsync: false,
          isExported: /^[A-Z]/.test(funcName),
          isArrow: false,
          body,
          complexity: this.calculateComplexity(body),
        });
      }
    }
  }

  private parseGoParameters(paramsStr: string): ParameterNode[] {
    const params: ParameterNode[] = [];
    if (!paramsStr?.trim()) return params;

    const paramParts = this.splitParameters(paramsStr);

    for (const part of paramParts) {
      const paramMatch = part.trim().match(/^(\.\.\.)?([\w,\s]+)\s+(\*?\w+(?:\[\w*\])?)$/);
      if (paramMatch) {
        const names = paramMatch[2].split(',').map((n) => n.trim());
        for (const name of names) {
          params.push({
            type: 'parameter',
            start: 0,
            end: 0,
            line: 0,
            column: 0,
            name,
            parameterType: paramMatch[3],
            isOptional: false,
            isRest: !!paramMatch[1],
            decorators: [],
          });
        }
      }
    }

    return params;
  }

  /**
   * Find matching closing brace
   */
  private findMatchingBrace(content: string, openBraceIndex: number): number {
    let braceCount = 1;

    for (let i = openBraceIndex + 1; i < content.length; i++) {
      if (content[i] === '{') braceCount++;
      else if (content[i] === '}') {
        braceCount--;
        if (braceCount === 0) return i + 1;
      }
    }

    return content.length;
  }

  /**
   * Find end of Python block based on indentation
   */
  private findPythonBlockEnd(content: string, startIndex: number): number {
    const lines = content.substring(startIndex).split('\n');
    if (lines.length === 0) return content.length;

    const firstLine = lines[0];
    let baseIndent = 0;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === '' || line.trim().startsWith('#')) continue;

      const indent = line.match(/^(\s*)/)?.[1].length || 0;
      if (baseIndent === 0) {
        baseIndent = indent;
      } else if (indent <= baseIndent && line.trim() && !line.trim().startsWith('#')) {
        return startIndex + lines.slice(0, i).join('\n').length;
      }
    }

    return content.length;
  }

  /**
   * Split parameters respecting nested generics and parentheses
   */
  private splitParameters(paramsStr: string): string[] {
    const params: string[] = [];
    let current = '';
    let depth = 0;

    for (const char of paramsStr) {
      if (char === '<' || char === '(' || char === '[' || char === '{') {
        depth++;
        current += char;
      } else if (char === '>' || char === ')' || char === ']' || char === '}') {
        depth--;
        current += char;
      } else if (char === ',' && depth === 0) {
        params.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }

    if (current.trim()) {
      params.push(current.trim());
    }

    return params;
  }

  /**
   * Calculate cyclomatic complexity
   */
  private calculateComplexity(body: string): number {
    if (!body) return 1;

    let complexity = 1;

    const patterns = [
      /\bif\b/g,
      /\belse\s+if\b/g,
      /\bfor\b/g,
      /\bwhile\b/g,
      /\bcase\b/g,
      /\bcatch\b/g,
      /\b\?\s*[^:]+\s*:/g, // ternary
      /&&/g,
      /\|\|/g,
    ];

    for (const pattern of patterns) {
      const matches = body.match(pattern);
      if (matches) {
        complexity += matches.length;
      }
    }

    return complexity;
  }
}

export default new ASTParser();
