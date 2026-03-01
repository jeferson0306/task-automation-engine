import path from 'path';
import fs from 'fs-extra';
import { logger } from '../utils/logger.js';
import {
  ContractContext,
  EnumContract,
  EnumValue,
  ExceptionContract,
  HttpEndpointContract,
  EndpointParameter,
  EndpointResponse,
  DomainModelContract,
  DomainField,
  DomainRelationship,
  ServiceContract,
  ServiceMethod,
  MethodInvocation,
  ProjectConventions,
  ExecutionContext,
  ProjectSnapshot,
  ParameterSignature,
} from '../core/types.js';
import ProjectScanner from './ProjectScanner.js';

/**
 * Contract Extractor - Based on test-lens patterns
 * Extracts exact contracts from source code for accurate test generation
 */
export class ContractExtractor {
  /**
   * Extract all contracts from project
   */
  async extract(context: ExecutionContext): Promise<ContractContext> {
    logger.info('Extracting source contracts...');

    const snapshot = context.projectSnapshot || (await ProjectScanner.scan(context.workingDir));
    context.projectSnapshot = snapshot;

    const contracts: ContractContext = {
      extractedAt: new Date().toISOString(),
      projectPath: context.workingDir,
      enums: [],
      exceptions: [],
      httpEndpoints: [],
      domainModels: [],
      serviceContracts: [],
      conventions: this.detectConventions(snapshot),
    };

    for (const file of snapshot.files) {
      if (file.content || file.skeletalContent) {
        const content = file.content || '';

        if (file.language.includes('Java') || file.language.includes('Kotlin')) {
          await this.extractJavaContracts(file.path, content, contracts);
        } else if (file.language.includes('TypeScript') || file.language.includes('JavaScript')) {
          await this.extractTypeScriptContracts(file.path, content, contracts);
        } else if (file.language === 'Python') {
          await this.extractPythonContracts(file.path, content, contracts);
        }
      }
    }

    context.contractContext = contracts;
    logger.info(
      `Contracts extracted: ${contracts.enums.length} enums, ${contracts.exceptions.length} exceptions, ${contracts.httpEndpoints.length} endpoints`
    );

    return contracts;
  }

  /**
   * Detect project conventions from existing code
   */
  private detectConventions(snapshot: ProjectSnapshot): ProjectConventions {
    const conventions: ProjectConventions = {
      testImport: 'junit5',
      mockitoSetup: 'none',
      assertionLibrary: 'junit',
      namingConvention: 'camelCase',
      mockPattern: 'manual',
      staticImports: false,
      testDirectory: 'src/test',
      sourceDirectory: 'src/main',
    };

    for (const dep of snapshot.dependencies) {
      const name = dep.name.toLowerCase();

      if (name.includes('junit-jupiter') || name.includes('junit5')) {
        conventions.testImport = 'junit5';
      } else if (name.includes('junit:junit') || name.includes('junit4')) {
        conventions.testImport = 'junit4';
      } else if (name.includes('testng')) {
        conventions.testImport = 'testng';
      } else if (name.includes('jest')) {
        conventions.testImport = 'jest';
      } else if (name.includes('vitest')) {
        conventions.testImport = 'vitest';
      } else if (name.includes('pytest')) {
        conventions.testImport = 'pytest';
      }

      if (name.includes('assertj')) {
        conventions.assertionLibrary = 'assertj';
      } else if (name.includes('hamcrest')) {
        conventions.assertionLibrary = 'hamcrest';
      } else if (name.includes('chai')) {
        conventions.assertionLibrary = 'chai';
      }

      if (name.includes('mockito')) {
        conventions.mockPattern = '@Mock+@InjectMocks';
      } else if (name.includes('mockk')) {
        conventions.mockPattern = 'mockk';
      }
    }

    const testFiles = snapshot.files.filter((f) => f.classification === 'test');
    for (const test of testFiles) {
      if (test.skeletalContent) {
        for (const cls of test.skeletalContent.classes) {
          if (cls.annotations.includes('ExtendWith')) {
            conventions.mockitoSetup = '@ExtendWith';
          } else if (cls.annotations.includes('RunWith')) {
            conventions.mockitoSetup = '@RunWith';
          }

          for (const method of cls.methods) {
            if (method.name.includes('_when_') || method.name.includes('_should_')) {
              conventions.namingConvention = 'methodName_when_then';
            } else if (method.name.includes('_')) {
              conventions.namingConvention = 'snake_case';
            }
          }
        }

        if (test.skeletalContent.imports.some((i) => i.includes('static'))) {
          conventions.staticImports = true;
        }
      }
    }

    if (snapshot.files.some((f) => f.relativePath.includes('src/test/java'))) {
      conventions.testDirectory = 'src/test/java';
      conventions.sourceDirectory = 'src/main/java';
    } else if (snapshot.files.some((f) => f.relativePath.includes('__tests__'))) {
      conventions.testDirectory = '__tests__';
      conventions.sourceDirectory = 'src';
    } else if (snapshot.files.some((f) => f.relativePath.includes('tests/'))) {
      conventions.testDirectory = 'tests';
      conventions.sourceDirectory = 'src';
    }

    return conventions;
  }

  /**
   * Extract Java/Kotlin contracts
   */
  private async extractJavaContracts(filePath: string, content: string, contracts: ContractContext): Promise<void> {
    const fileName = path.basename(filePath);
    const relativePath = filePath;

    this.extractJavaEnums(content, relativePath, contracts);
    this.extractJavaExceptions(content, relativePath, contracts);
    this.extractJavaEndpoints(content, relativePath, contracts);
    this.extractJavaDomainModels(content, relativePath, contracts);
    this.extractJavaServices(content, relativePath, contracts);
  }

  private extractJavaEnums(content: string, filePath: string, contracts: ContractContext): void {
    const enumRegex = /enum\s+(\w+)\s*\{([^}]+)\}/g;
    let match;

    while ((match = enumRegex.exec(content)) !== null) {
      const enumName = match[1];
      const enumBody = match[2];
      const values: EnumValue[] = [];

      const valueLines = enumBody.split(/[,;]/).map((v) => v.trim()).filter(Boolean);

      for (const line of valueLines) {
        const valueMatch = line.match(/^(\w+)(?:\s*\(\s*(.+?)\s*\))?/);
        if (valueMatch) {
          values.push({
            name: valueMatch[1],
            value: valueMatch[2],
          });
        }
      }

      if (values.length > 0) {
        contracts.enums.push({
          name: enumName,
          file: filePath,
          values,
          usedIn: [],
        });
      }
    }
  }

  private extractJavaExceptions(content: string, filePath: string, contracts: ContractContext): void {
    const exceptionRegex = /class\s+(\w+Exception|\w+Error)\s+extends\s+(\w+)/g;
    let match;

    while ((match = exceptionRegex.exec(content)) !== null) {
      const exceptionName = match[1];
      const extendsClass = match[2];
      const messages: string[] = [];

      const messageRegex = new RegExp(`new\\s+${exceptionName}\\s*\\(\\s*"([^"]+)"`, 'g');
      let msgMatch;
      while ((msgMatch = messageRegex.exec(content)) !== null) {
        messages.push(msgMatch[1]);
      }

      const superMessageRegex = /super\s*\(\s*"([^"]+)"/g;
      while ((msgMatch = superMessageRegex.exec(content)) !== null) {
        messages.push(msgMatch[1]);
      }

      contracts.exceptions.push({
        name: exceptionName,
        file: filePath,
        extends: extendsClass,
        messages: [...new Set(messages)],
        thrownBy: [],
      });
    }
  }

  private extractJavaEndpoints(content: string, filePath: string, contracts: ContractContext): void {
    const controllerMatch = content.match(/class\s+(\w+)/);
    if (!controllerMatch) return;
    const controllerName = controllerMatch[1];

    const methodRegex =
      /@(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|RequestMapping)\s*(?:\(\s*(?:value\s*=\s*)?["']([^"']+)["'])?[^)]*\)\s*(?:public\s+)?(?:ResponseEntity<)?(\w+)(?:>)?\s+(\w+)\s*\(([^)]*)\)/g;
    let match;

    while ((match = methodRegex.exec(content)) !== null) {
      const mapping = match[1];
      const pathValue = match[2] || '';
      const returnType = match[3];
      const methodName = match[4];
      const params = match[5];

      const httpMethod = this.mappingToHttpMethod(mapping);

      const parameters = this.parseEndpointParams(params);
      const responses = this.inferResponses(content, methodName, returnType);

      contracts.httpEndpoints.push({
        method: httpMethod,
        path: pathValue,
        controller: controllerName,
        methodName,
        parameters,
        requestBody: parameters.find((p) => p.source === 'body')?.type,
        responses,
      });
    }
  }

  private mappingToHttpMethod(mapping: string): 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' {
    const map: Record<string, 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'> = {
      GetMapping: 'GET',
      PostMapping: 'POST',
      PutMapping: 'PUT',
      DeleteMapping: 'DELETE',
      PatchMapping: 'PATCH',
      RequestMapping: 'GET',
    };
    return map[mapping] || 'GET';
  }

  private parseEndpointParams(params: string): EndpointParameter[] {
    const result: EndpointParameter[] = [];
    if (!params.trim()) return result;

    const paramParts = params.split(',').map((p) => p.trim());

    for (const param of paramParts) {
      const pathVarMatch = param.match(/@PathVariable(?:\s*\(\s*"?(\w+)"?\s*\))?\s*(\w+)\s+(\w+)/);
      if (pathVarMatch) {
        result.push({
          name: pathVarMatch[1] || pathVarMatch[3],
          type: pathVarMatch[2],
          source: 'path',
          required: true,
        });
        continue;
      }

      const queryMatch = param.match(/@RequestParam(?:\s*\([^)]*\))?\s*(\w+)\s+(\w+)/);
      if (queryMatch) {
        result.push({
          name: queryMatch[2],
          type: queryMatch[1],
          source: 'query',
          required: !param.includes('required = false'),
        });
        continue;
      }

      const bodyMatch = param.match(/@RequestBody\s*(?:@Valid\s*)?(\w+)\s+(\w+)/);
      if (bodyMatch) {
        result.push({
          name: bodyMatch[2],
          type: bodyMatch[1],
          source: 'body',
          required: true,
        });
        continue;
      }

      const headerMatch = param.match(/@RequestHeader(?:\s*\(\s*"?(\w+)"?\s*\))?\s*(\w+)\s+(\w+)/);
      if (headerMatch) {
        result.push({
          name: headerMatch[1] || headerMatch[3],
          type: headerMatch[2],
          source: 'header',
          required: !param.includes('required = false'),
        });
      }
    }

    return result;
  }

  private inferResponses(content: string, methodName: string, returnType: string): EndpointResponse[] {
    const responses: EndpointResponse[] = [];

    const methodStart = content.indexOf(methodName);
    if (methodStart === -1) return [{ status: 200, bodyType: returnType }];

    const methodEnd = content.indexOf('\n    }', methodStart);
    const methodBody = content.substring(methodStart, methodEnd > 0 ? methodEnd : methodStart + 500);

    if (methodBody.includes('ResponseEntity.ok') || methodBody.includes('HttpStatus.OK')) {
      responses.push({ status: 200, bodyType: returnType });
    }

    if (methodBody.includes('ResponseEntity.created') || methodBody.includes('HttpStatus.CREATED')) {
      responses.push({ status: 201, description: 'Created' });
    }

    if (methodBody.includes('ResponseEntity.noContent') || methodBody.includes('HttpStatus.NO_CONTENT')) {
      responses.push({ status: 204, description: 'No Content' });
    }

    if (methodBody.includes('ResponseEntity.notFound') || methodBody.includes('HttpStatus.NOT_FOUND')) {
      responses.push({ status: 404, description: 'Not Found' });
    }

    if (methodBody.includes('ResponseEntity.badRequest') || methodBody.includes('HttpStatus.BAD_REQUEST')) {
      responses.push({ status: 400, description: 'Bad Request' });
    }

    if (responses.length === 0) {
      responses.push({ status: 200, bodyType: returnType });
    }

    return responses;
  }

  private extractJavaDomainModels(content: string, filePath: string, contracts: ContractContext): void {
    const isEntity = content.includes('@Entity') || content.includes('@Document');
    const isRecord = content.includes('record ');

    if (!isEntity && !isRecord) return;

    const classMatch = content.match(/(?:class|record)\s+(\w+)/);
    if (!classMatch) return;

    const modelName = classMatch[1];
    const fields: DomainField[] = [];
    const relationships: DomainRelationship[] = [];
    const validations: string[] = [];

    const fieldRegex = /(?:@(\w+)(?:\([^)]*\))?\s*)*(?:private|public|protected)?\s+(\w+(?:<[^>]+>)?)\s+(\w+)\s*[;=]/g;
    let match;

    while ((match = fieldRegex.exec(content)) !== null) {
      const annotation = match[1];
      const fieldType = match[2];
      const fieldName = match[3];

      const isNullable = content.includes(`@Nullable`) && content.indexOf(`@Nullable`) < content.indexOf(fieldName);

      fields.push({
        name: fieldName,
        type: fieldType,
        nullable: isNullable,
        constraints: this.extractConstraints(content, fieldName),
        defaultValue: undefined,
      });

      if (['OneToOne', 'OneToMany', 'ManyToOne', 'ManyToMany'].includes(annotation)) {
        relationships.push({
          type: annotation.toLowerCase().replace('to', 'To') as DomainRelationship['type'],
          target: fieldType.replace(/.*<(\w+)>.*/, '$1'),
          cascade: [],
        });
      }
    }

    if (content.includes('@NotNull')) validations.push('NotNull');
    if (content.includes('@NotBlank')) validations.push('NotBlank');
    if (content.includes('@Size')) validations.push('Size');
    if (content.includes('@Min')) validations.push('Min');
    if (content.includes('@Max')) validations.push('Max');
    if (content.includes('@Email')) validations.push('Email');
    if (content.includes('@Pattern')) validations.push('Pattern');

    contracts.domainModels.push({
      name: modelName,
      file: filePath,
      type: isRecord ? 'record' : isEntity ? 'entity' : 'dto',
      fields,
      validations: [...new Set(validations)],
      relationships,
    });
  }

  private extractConstraints(content: string, fieldName: string): string[] {
    const constraints: string[] = [];
    const fieldIndex = content.indexOf(fieldName);
    if (fieldIndex === -1) return constraints;

    const beforeField = content.substring(Math.max(0, fieldIndex - 200), fieldIndex);

    if (beforeField.includes('@NotNull')) constraints.push('NotNull');
    if (beforeField.includes('@NotBlank')) constraints.push('NotBlank');

    const sizeMatch = beforeField.match(/@Size\s*\(\s*(?:min\s*=\s*(\d+))?\s*,?\s*(?:max\s*=\s*(\d+))?\s*\)/);
    if (sizeMatch) {
      constraints.push(`Size(min=${sizeMatch[1] || 0}, max=${sizeMatch[2] || 'MAX'})`);
    }

    const minMatch = beforeField.match(/@Min\s*\(\s*(\d+)\s*\)/);
    if (minMatch) constraints.push(`Min(${minMatch[1]})`);

    const maxMatch = beforeField.match(/@Max\s*\(\s*(\d+)\s*\)/);
    if (maxMatch) constraints.push(`Max(${maxMatch[1]})`);

    return constraints;
  }

  private extractJavaServices(content: string, filePath: string, contracts: ContractContext): void {
    const isService = content.includes('@Service') || content.includes('@Component');
    if (!isService) return;

    const classMatch = content.match(/class\s+(\w+)/);
    if (!classMatch) return;

    const serviceName = classMatch[1];
    const dependencies: string[] = [];
    const methods: ServiceMethod[] = [];

    const injectRegex = /@(?:Inject|Autowired)\s*(?:private|public|protected)?\s*(?:final\s+)?(\w+)\s+(\w+)/g;
    let match;

    while ((match = injectRegex.exec(content)) !== null) {
      dependencies.push(match[1]);
    }

    const constructorMatch = content.match(/public\s+\w+\s*\(([^)]+)\)/);
    if (constructorMatch) {
      const params = constructorMatch[1].split(',');
      for (const param of params) {
        const typeMatch = param.trim().match(/(\w+)\s+\w+$/);
        if (typeMatch && !dependencies.includes(typeMatch[1])) {
          dependencies.push(typeMatch[1]);
        }
      }
    }

    const methodRegex =
      /public\s+(?:(?:CompletableFuture|Mono|Flux)<)?(\w+)(?:>)?\s+(\w+)\s*\(([^)]*)\)(?:\s*throws\s+([\w,\s]+))?/g;

    while ((match = methodRegex.exec(content)) !== null) {
      const returnType = match[1];
      const methodName = match[2];
      const params = match[3];
      const throwsClause = match[4];

      const parameters = this.parseMethodParams(params);
      const throwsExceptions = throwsClause ? throwsClause.split(',').map((e) => e.trim()) : [];
      const invokes = this.extractInvocations(content, methodName, dependencies);

      methods.push({
        name: methodName,
        parameters,
        returnType,
        throwsExceptions,
        invokes,
      });
    }

    if (methods.length > 0) {
      contracts.serviceContracts.push({
        name: serviceName,
        file: filePath,
        dependencies,
        methods,
      });
    }
  }

  private parseMethodParams(params: string): ParameterSignature[] {
    if (!params.trim()) return [];

    return params.split(',').map((p) => {
      const parts = p.trim().split(/\s+/);
      const name = parts.pop() || '';
      const type = parts.filter((part) => !part.startsWith('@')).join(' ');

      return {
        name,
        type: type || 'Object',
        isOptional: false,
      };
    });
  }

  private extractInvocations(content: string, methodName: string, dependencies: string[]): MethodInvocation[] {
    const invocations: MethodInvocation[] = [];

    const methodStart = content.indexOf(`${methodName}(`);
    if (methodStart === -1) return invocations;

    let braceCount = 0;
    let methodEnd = methodStart;
    let foundStart = false;

    for (let i = methodStart; i < content.length; i++) {
      if (content[i] === '{') {
        braceCount++;
        foundStart = true;
      } else if (content[i] === '}') {
        braceCount--;
        if (foundStart && braceCount === 0) {
          methodEnd = i;
          break;
        }
      }
    }

    const methodBody = content.substring(methodStart, methodEnd);

    for (const dep of dependencies) {
      const depLower = dep.charAt(0).toLowerCase() + dep.slice(1);
      const callRegex = new RegExp(`${depLower}\\.([\\w]+)\\s*\\(`, 'g');
      let match;

      const callCounts: Record<string, number> = {};

      while ((match = callRegex.exec(methodBody)) !== null) {
        const calledMethod = match[1];
        callCounts[calledMethod] = (callCounts[calledMethod] || 0) + 1;
      }

      for (const [method, count] of Object.entries(callCounts)) {
        invocations.push({
          target: dep,
          method,
          expectedCalls: count,
        });
      }
    }

    return invocations;
  }

  /**
   * Extract TypeScript contracts
   */
  private async extractTypeScriptContracts(
    filePath: string,
    content: string,
    contracts: ContractContext
  ): Promise<void> {
    this.extractTypeScriptEnums(content, filePath, contracts);
    this.extractTypeScriptTypes(content, filePath, contracts);
    this.extractTypeScriptEndpoints(content, filePath, contracts);
  }

  private extractTypeScriptEnums(content: string, filePath: string, contracts: ContractContext): void {
    const enumRegex = /(?:export\s+)?enum\s+(\w+)\s*\{([^}]+)\}/g;
    let match;

    while ((match = enumRegex.exec(content)) !== null) {
      const enumName = match[1];
      const enumBody = match[2];
      const values: EnumValue[] = [];

      const valueLines = enumBody.split(',').map((v) => v.trim()).filter(Boolean);

      for (const line of valueLines) {
        const valueMatch = line.match(/^(\w+)(?:\s*=\s*(.+))?/);
        if (valueMatch) {
          values.push({
            name: valueMatch[1],
            value: valueMatch[2]?.replace(/['"`]/g, ''),
          });
        }
      }

      if (values.length > 0) {
        contracts.enums.push({
          name: enumName,
          file: filePath,
          values,
          usedIn: [],
        });
      }
    }
  }

  private extractTypeScriptTypes(content: string, filePath: string, contracts: ContractContext): void {
    const interfaceRegex = /(?:export\s+)?interface\s+(\w+)(?:\s+extends\s+[\w,\s]+)?\s*\{([^}]+)\}/g;
    let match;

    while ((match = interfaceRegex.exec(content)) !== null) {
      const typeName = match[1];
      const typeBody = match[2];
      const fields: DomainField[] = [];

      const fieldLines = typeBody.split(';').map((f) => f.trim()).filter(Boolean);

      for (const line of fieldLines) {
        const fieldMatch = line.match(/^(\w+)(\?)?\s*:\s*(.+)/);
        if (fieldMatch) {
          fields.push({
            name: fieldMatch[1],
            type: fieldMatch[3].trim(),
            nullable: !!fieldMatch[2],
            constraints: [],
          });
        }
      }

      if (fields.length > 0) {
        contracts.domainModels.push({
          name: typeName,
          file: filePath,
          type: 'dto',
          fields,
          validations: [],
          relationships: [],
        });
      }
    }
  }

  private extractTypeScriptEndpoints(content: string, filePath: string, contracts: ContractContext): void {
    const routeRegex = /(?:router|app)\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
    let match;

    while ((match = routeRegex.exec(content)) !== null) {
      contracts.httpEndpoints.push({
        method: match[1].toUpperCase() as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
        path: match[2],
        controller: path.basename(filePath, path.extname(filePath)),
        methodName: `handle${match[1].charAt(0).toUpperCase() + match[1].slice(1)}`,
        parameters: [],
        responses: [{ status: 200 }],
      });
    }
  }

  /**
   * Extract Python contracts
   */
  private async extractPythonContracts(filePath: string, content: string, contracts: ContractContext): Promise<void> {
    this.extractPythonEnums(content, filePath, contracts);
    this.extractPythonExceptions(content, filePath, contracts);
    this.extractPythonEndpoints(content, filePath, contracts);
  }

  private extractPythonEnums(content: string, filePath: string, contracts: ContractContext): void {
    const enumRegex = /class\s+(\w+)\s*\(\s*(?:str,\s*)?Enum\s*\)\s*:\s*\n((?:\s+\w+\s*=.+\n)+)/g;
    let match;

    while ((match = enumRegex.exec(content)) !== null) {
      const enumName = match[1];
      const enumBody = match[2];
      const values: EnumValue[] = [];

      const valueLines = enumBody.split('\n').filter((l) => l.trim());

      for (const line of valueLines) {
        const valueMatch = line.match(/^\s*(\w+)\s*=\s*(.+)/);
        if (valueMatch) {
          values.push({
            name: valueMatch[1],
            value: valueMatch[2].replace(/['"`]/g, '').trim(),
          });
        }
      }

      if (values.length > 0) {
        contracts.enums.push({
          name: enumName,
          file: filePath,
          values,
          usedIn: [],
        });
      }
    }
  }

  private extractPythonExceptions(content: string, filePath: string, contracts: ContractContext): void {
    const exceptionRegex = /class\s+(\w+(?:Error|Exception))\s*\(\s*(\w+)\s*\)/g;
    let match;

    while ((match = exceptionRegex.exec(content)) !== null) {
      contracts.exceptions.push({
        name: match[1],
        file: filePath,
        extends: match[2],
        messages: [],
        thrownBy: [],
      });
    }
  }

  private extractPythonEndpoints(content: string, filePath: string, contracts: ContractContext): void {
    const routeRegex = /@(?:app|router)\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
    let match;

    while ((match = routeRegex.exec(content)) !== null) {
      contracts.httpEndpoints.push({
        method: match[1].toUpperCase() as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
        path: match[2],
        controller: path.basename(filePath, path.extname(filePath)),
        methodName: '',
        parameters: [],
        responses: [{ status: 200 }],
      });
    }
  }
}

export default new ContractExtractor();
