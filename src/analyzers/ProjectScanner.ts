import path from 'path';
import fs from 'fs-extra';
import { logger } from '../utils/logger.js';
import {
  ProjectSnapshot,
  ScannedFile,
  FilePriority,
  FileClassification,
  SkeletalContent,
  ClassSkeleton,
  InterfaceSkeleton,
  FunctionSkeleton,
  MethodSignature,
  FieldSignature,
  ParameterSignature,
  DetectedService,
  ConfigFile,
  ExtendedDependency,
  DetectedStack,
  LanguageInfo,
  FrameworkInfo,
} from '../core/types.js';

const MAX_DEPTH = 15;
const MAX_FILE_SIZE_FULL = 50 * 1024; // 50KB for full read
const MAX_FILE_SIZE_SKELETAL = 200 * 1024; // 200KB for skeletal read
const TOTAL_BUDGET = 200 * 1024; // 200KB total budget for context

const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'target',
  '.gradle',
  '.idea',
  '.vscode',
  '__pycache__',
  '.pytest_cache',
  'coverage',
  '.next',
  '.nuxt',
  'vendor',
  'venv',
  '.venv',
  'env',
]);

const LANGUAGE_MAP: Record<string, string> = {
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.scala': 'Scala',
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript (React)',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript (React)',
  '.py': 'Python',
  '.go': 'Go',
  '.rs': 'Rust',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.cs': 'C#',
  '.cpp': 'C++',
  '.c': 'C',
  '.swift': 'Swift',
  '.dart': 'Dart',
  '.vue': 'Vue',
  '.svelte': 'Svelte',
};

const P0_PATTERNS = [
  /schema\.(prisma|graphql|sql)$/i,
  /\.sql$/i,
  /migration/i,
  /flyway.*\.sql$/i,
  /liquibase.*\.(xml|yaml|sql)$/i,
  /README\.md$/i,
  /ADR-.*\.md$/i,
  /ARCHITECTURE\.md$/i,
  /openapi\.(yaml|json)$/i,
  /swagger\.(yaml|json)$/i,
  /docker-compose\.ya?ml$/i,
  /Dockerfile$/i,
  /\.env\.example$/i,
  /application\.(properties|ya?ml)$/i,
  /pom\.xml$/i,
  /build\.gradle(\.kts)?$/i,
  /package\.json$/i,
  /tsconfig\.json$/i,
  /requirements\.txt$/i,
  /pyproject\.toml$/i,
  /go\.mod$/i,
  /Cargo\.toml$/i,
];

const P1_PATTERNS = [
  /Controller\.(java|kt|ts|js)$/i,
  /Resource\.(java|kt)$/i,
  /Service(Impl)?\.(java|kt|ts|js)$/i,
  /Repository\.(java|kt|ts|js)$/i,
  /Dao\.(java|kt)$/i,
  /Handler\.(java|kt|ts|js|go)$/i,
  /UseCase\.(java|kt|ts|js)$/i,
  /routes?\.(ts|js)$/i,
  /api\.(ts|js)$/i,
  /middleware\.(ts|js)$/i,
];

/**
 * Project Scanner with Skeletal Reading and Priority Classification
 * Based on jay-crew patterns
 */
export class ProjectScanner {
  private budgetUsed = 0;

  async scan(projectPath: string): Promise<ProjectSnapshot> {
    logger.info(`Scanning project: ${projectPath}`);
    this.budgetUsed = 0;

    const startTime = Date.now();
    const files: ScannedFile[] = [];
    const configFiles: ConfigFile[] = [];

    await this.walkDirectory(projectPath, projectPath, files, configFiles, 0);

    files.sort((a, b) => a.priority - b.priority);

    const snapshot: ProjectSnapshot = {
      scanTime: new Date().toISOString(),
      rootPath: projectPath,
      totalFiles: files.length,
      totalSize: files.reduce((sum, f) => sum + f.size, 0),
      languageBreakdown: this.calculateLanguageBreakdown(files),
      files,
      services: await this.detectServices(projectPath),
      configFiles,
      dependencies: await this.extractDependencies(projectPath, configFiles),
      detectedStack: await this.detectStack(projectPath, configFiles, files),
    };

    logger.info(`Scan complete: ${files.length} files in ${Date.now() - startTime}ms`);
    logger.info(`Budget used: ${(this.budgetUsed / 1024).toFixed(2)}KB / ${TOTAL_BUDGET / 1024}KB`);

    return snapshot;
  }

  private async walkDirectory(
    rootPath: string,
    currentPath: string,
    files: ScannedFile[],
    configFiles: ConfigFile[],
    depth: number
  ): Promise<void> {
    if (depth > MAX_DEPTH) return;

    const dirName = path.basename(currentPath);
    if (EXCLUDED_DIRS.has(dirName)) return;

    let entries: fs.Dirent[];
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        await this.walkDirectory(rootPath, fullPath, files, configFiles, depth + 1);
      } else if (entry.isFile()) {
        const scannedFile = await this.scanFile(rootPath, fullPath);
        if (scannedFile) {
          files.push(scannedFile);

          if (scannedFile.priority === FilePriority.P0_CRITICAL && scannedFile.classification === 'config') {
            configFiles.push({
              path: scannedFile.relativePath,
              type: this.getConfigType(entry.name),
              content: scannedFile.content || '',
            });
          }
        }
      }
    }
  }

  private async scanFile(rootPath: string, filePath: string): Promise<ScannedFile | null> {
    const ext = path.extname(filePath);
    const language = LANGUAGE_MAP[ext];

    if (!language && !this.isConfigFile(filePath)) {
      return null;
    }

    let stats: fs.Stats;
    try {
      stats = await fs.stat(filePath);
    } catch {
      return null;
    }

    const relativePath = path.relative(rootPath, filePath);
    const priority = this.classifyPriority(filePath);
    const classification = this.classifyFile(filePath);

    const scannedFile: ScannedFile = {
      path: filePath,
      relativePath,
      priority,
      language: language || 'config',
      size: stats.size,
      classification,
    };

    if (priority === FilePriority.P0_CRITICAL && this.budgetUsed + stats.size <= TOTAL_BUDGET) {
      if (stats.size <= MAX_FILE_SIZE_FULL) {
        try {
          scannedFile.content = await fs.readFile(filePath, 'utf-8');
          this.budgetUsed += stats.size;
        } catch {
          logger.warn(`Failed to read P0 file: ${relativePath}`);
        }
      }
    } else if (priority === FilePriority.P1_IMPORTANT && stats.size <= MAX_FILE_SIZE_SKELETAL) {
      if (this.budgetUsed + (stats.size / 4) <= TOTAL_BUDGET) {
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          scannedFile.skeletalContent = this.extractSkeleton(content, language);
          this.budgetUsed += stats.size / 4;
        } catch {
          logger.warn(`Failed to read P1 file: ${relativePath}`);
        }
      }
    }

    return scannedFile;
  }

  private classifyPriority(filePath: string): FilePriority {
    const fileName = path.basename(filePath);

    for (const pattern of P0_PATTERNS) {
      if (pattern.test(filePath) || pattern.test(fileName)) {
        return FilePriority.P0_CRITICAL;
      }
    }

    for (const pattern of P1_PATTERNS) {
      if (pattern.test(filePath) || pattern.test(fileName)) {
        return FilePriority.P1_IMPORTANT;
      }
    }

    return FilePriority.P2_REGULAR;
  }

  private classifyFile(filePath: string): FileClassification {
    const fileName = path.basename(filePath).toLowerCase();
    const dirName = path.dirname(filePath).toLowerCase();

    if (/schema\.(prisma|graphql|sql)$/i.test(fileName)) return 'schema';
    if (/migration/i.test(filePath) || /\.sql$/i.test(fileName)) return 'migration';
    if (this.isConfigFile(filePath)) return 'config';
    if (/controller/i.test(fileName) || /resource\./i.test(fileName)) return 'controller';
    if (/service/i.test(fileName)) return 'service';
    if (/repository/i.test(fileName) || /dao\./i.test(fileName)) return 'repository';
    if (/entity/i.test(dirName) || /model/i.test(dirName)) return 'entity';
    if (/dto/i.test(fileName) || /dto/i.test(dirName)) return 'dto';
    if (/test/i.test(dirName) || /spec\./i.test(fileName)) return 'test';
    if (/util/i.test(fileName) || /helper/i.test(fileName)) return 'util';

    return 'unknown';
  }

  private isConfigFile(filePath: string): boolean {
    const fileName = path.basename(filePath);
    return P0_PATTERNS.some((p) => p.test(fileName));
  }

  private getConfigType(fileName: string): string {
    if (/pom\.xml$/i.test(fileName)) return 'maven';
    if (/build\.gradle/i.test(fileName)) return 'gradle';
    if (/package\.json$/i.test(fileName)) return 'npm';
    if (/tsconfig\.json$/i.test(fileName)) return 'typescript';
    if (/requirements\.txt$/i.test(fileName)) return 'pip';
    if (/pyproject\.toml$/i.test(fileName)) return 'poetry';
    if (/go\.mod$/i.test(fileName)) return 'go';
    if (/Cargo\.toml$/i.test(fileName)) return 'cargo';
    if (/docker-compose/i.test(fileName)) return 'docker-compose';
    if (/Dockerfile$/i.test(fileName)) return 'dockerfile';
    if (/application\.(properties|ya?ml)$/i.test(fileName)) return 'spring-config';
    return 'config';
  }

  /**
   * Extract skeletal content from source file
   * This reads only structure - no implementation details
   */
  private extractSkeleton(content: string, language: string): SkeletalContent {
    const skeleton: SkeletalContent = {
      imports: [],
      classes: [],
      interfaces: [],
      functions: [],
      exports: [],
    };

    const lines = content.split('\n');

    if (language === 'Java' || language === 'Kotlin') {
      this.extractJvmSkeleton(lines, skeleton);
    } else if (language?.includes('TypeScript') || language?.includes('JavaScript')) {
      this.extractTsSkeleton(lines, skeleton);
    } else if (language === 'Python') {
      this.extractPythonSkeleton(lines, skeleton);
    } else if (language === 'Go') {
      this.extractGoSkeleton(lines, skeleton);
    }

    return skeleton;
  }

  private extractJvmSkeleton(lines: string[], skeleton: SkeletalContent): void {
    let currentClass: ClassSkeleton | null = null;
    let braceCount = 0;

    for (const line of lines) {
      const trimmed = line.trim();

      const packageMatch = trimmed.match(/^package\s+([\w.]+)/);
      if (packageMatch) {
        skeleton.package = packageMatch[1];
        continue;
      }

      const importMatch = trimmed.match(/^import\s+([\w.*]+)/);
      if (importMatch && skeleton.imports.length < 10) {
        skeleton.imports.push(importMatch[1]);
        continue;
      }

      const classMatch = trimmed.match(
        /^(public\s+|private\s+|protected\s+)?(abstract\s+)?(class|interface|enum)\s+(\w+)(\s+extends\s+(\w+))?(\s+implements\s+([\w,\s]+))?/
      );
      if (classMatch) {
        if (currentClass) {
          skeleton.classes.push(currentClass);
        }

        const isInterface = classMatch[3] === 'interface';
        if (isInterface) {
          skeleton.interfaces.push({
            name: classMatch[4],
            extends: classMatch[6] ? [classMatch[6]] : [],
            methods: [],
          });
        } else {
          currentClass = {
            name: classMatch[4],
            extends: classMatch[6],
            implements: classMatch[8] ? classMatch[8].split(',').map((s) => s.trim()) : [],
            annotations: [],
            methods: [],
            fields: [],
          };
        }
        continue;
      }

      if (currentClass) {
        const annotationMatch = trimmed.match(/^@(\w+)/);
        if (annotationMatch) {
          currentClass.annotations.push(annotationMatch[1]);
          continue;
        }

        const methodMatch = trimmed.match(
          /^(public\s+|private\s+|protected\s+)?(static\s+)?([\w<>[\],\s]+)\s+(\w+)\s*\((.*?)\)/
        );
        if (methodMatch && !trimmed.includes('=')) {
          const params = this.parseJavaParams(methodMatch[5]);
          currentClass.methods.push({
            name: methodMatch[4],
            visibility: (methodMatch[1]?.trim() as 'public' | 'private' | 'protected') || 'package',
            parameters: params,
            returnType: methodMatch[3].trim(),
            annotations: [],
            isStatic: !!methodMatch[2],
            isAsync: false,
          });
        }

        const fieldMatch = trimmed.match(
          /^(public\s+|private\s+|protected\s+)?(static\s+)?(final\s+)?([\w<>[\],\s]+)\s+(\w+)\s*(=|;)/
        );
        if (fieldMatch) {
          currentClass.fields.push({
            name: fieldMatch[5],
            type: fieldMatch[4].trim(),
            visibility: (fieldMatch[1]?.trim() as 'public' | 'private' | 'protected') || 'package',
            annotations: [],
            isStatic: !!fieldMatch[2],
            isFinal: !!fieldMatch[3],
          });
        }
      }

      braceCount += (trimmed.match(/{/g) || []).length;
      braceCount -= (trimmed.match(/}/g) || []).length;
    }

    if (currentClass) {
      skeleton.classes.push(currentClass);
    }
  }

  private extractTsSkeleton(lines: string[], skeleton: SkeletalContent): void {
    for (const line of lines) {
      const trimmed = line.trim();

      const importMatch = trimmed.match(/^import\s+.*\s+from\s+['"](.+)['"]/);
      if (importMatch) {
        skeleton.imports.push(importMatch[1]);
        continue;
      }

      const exportMatch = trimmed.match(/^export\s+(const|let|var|function|class|interface|type|enum)\s+(\w+)/);
      if (exportMatch) {
        skeleton.exports.push(exportMatch[2]);
      }

      const classMatch = trimmed.match(/^(export\s+)?(abstract\s+)?class\s+(\w+)(\s+extends\s+(\w+))?(\s+implements\s+([\w,\s]+))?/);
      if (classMatch) {
        skeleton.classes.push({
          name: classMatch[3],
          extends: classMatch[5],
          implements: classMatch[7] ? classMatch[7].split(',').map((s) => s.trim()) : [],
          annotations: [],
          methods: [],
          fields: [],
        });
        continue;
      }

      const interfaceMatch = trimmed.match(/^(export\s+)?interface\s+(\w+)(\s+extends\s+([\w,\s]+))?/);
      if (interfaceMatch) {
        skeleton.interfaces.push({
          name: interfaceMatch[2],
          extends: interfaceMatch[4] ? interfaceMatch[4].split(',').map((s) => s.trim()) : [],
          methods: [],
        });
        continue;
      }

      const functionMatch = trimmed.match(/^(export\s+)?(async\s+)?function\s+(\w+)\s*(<.*>)?\s*\((.*?)\)(\s*:\s*(.+))?/);
      if (functionMatch) {
        skeleton.functions.push({
          name: functionMatch[3],
          parameters: this.parseTsParams(functionMatch[5]),
          returnType: functionMatch[7]?.trim(),
          isAsync: !!functionMatch[2],
          isExported: !!functionMatch[1],
        });
      }
    }
  }

  private extractPythonSkeleton(lines: string[], skeleton: SkeletalContent): void {
    for (const line of lines) {
      const trimmed = line.trim();

      const importMatch = trimmed.match(/^(from\s+(\S+)\s+)?import\s+(.+)/);
      if (importMatch) {
        const module = importMatch[2] || importMatch[3].split(',')[0].trim();
        skeleton.imports.push(module);
        continue;
      }

      const classMatch = trimmed.match(/^class\s+(\w+)(\s*\((.*?)\))?:/);
      if (classMatch) {
        skeleton.classes.push({
          name: classMatch[1],
          extends: classMatch[3],
          implements: [],
          annotations: [],
          methods: [],
          fields: [],
        });
        continue;
      }

      const defMatch = trimmed.match(/^(async\s+)?def\s+(\w+)\s*\((.*?)\)(\s*->\s*(.+))?:/);
      if (defMatch) {
        skeleton.functions.push({
          name: defMatch[2],
          parameters: this.parsePythonParams(defMatch[3]),
          returnType: defMatch[5]?.trim(),
          isAsync: !!defMatch[1],
          isExported: !defMatch[2].startsWith('_'),
        });
      }
    }
  }

  private extractGoSkeleton(lines: string[], skeleton: SkeletalContent): void {
    for (const line of lines) {
      const trimmed = line.trim();

      const packageMatch = trimmed.match(/^package\s+(\w+)/);
      if (packageMatch) {
        skeleton.package = packageMatch[1];
        continue;
      }

      const importMatch = trimmed.match(/^import\s+"(.+)"/);
      if (importMatch) {
        skeleton.imports.push(importMatch[1]);
        continue;
      }

      const funcMatch = trimmed.match(/^func\s+(\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\((.*?)\)(\s*\(?(.*?)\)?)?/);
      if (funcMatch) {
        skeleton.functions.push({
          name: funcMatch[2],
          parameters: this.parseGoParams(funcMatch[3]),
          returnType: funcMatch[5]?.trim(),
          isAsync: false,
          isExported: /^[A-Z]/.test(funcMatch[2]),
        });
      }

      const typeMatch = trimmed.match(/^type\s+(\w+)\s+(struct|interface)/);
      if (typeMatch) {
        if (typeMatch[2] === 'struct') {
          skeleton.classes.push({
            name: typeMatch[1],
            implements: [],
            annotations: [],
            methods: [],
            fields: [],
          });
        } else {
          skeleton.interfaces.push({
            name: typeMatch[1],
            extends: [],
            methods: [],
          });
        }
      }
    }
  }

  private parseJavaParams(paramsStr: string): ParameterSignature[] {
    if (!paramsStr.trim()) return [];

    return paramsStr.split(',').map((p) => {
      const parts = p.trim().split(/\s+/);
      const name = parts.pop() || '';
      const type = parts.join(' ');
      return { name, type, isOptional: false };
    });
  }

  private parseTsParams(paramsStr: string): ParameterSignature[] {
    if (!paramsStr.trim()) return [];

    return paramsStr.split(',').map((p) => {
      const match = p.trim().match(/^(\w+)(\?)?\s*:?\s*(.+)?$/);
      if (!match) return { name: p.trim(), type: 'any', isOptional: false };
      return {
        name: match[1],
        type: match[3]?.trim() || 'any',
        isOptional: !!match[2],
      };
    });
  }

  private parsePythonParams(paramsStr: string): ParameterSignature[] {
    if (!paramsStr.trim()) return [];

    return paramsStr
      .split(',')
      .filter((p) => p.trim() !== 'self' && p.trim() !== 'cls')
      .map((p) => {
        const match = p.trim().match(/^(\w+)(\s*:\s*(.+?))?(\s*=\s*(.+))?$/);
        if (!match) return { name: p.trim(), type: 'Any', isOptional: false };
        return {
          name: match[1],
          type: match[3]?.trim() || 'Any',
          isOptional: !!match[5],
          defaultValue: match[5]?.trim(),
        };
      });
  }

  private parseGoParams(paramsStr: string): ParameterSignature[] {
    if (!paramsStr.trim()) return [];

    return paramsStr.split(',').map((p) => {
      const parts = p.trim().split(/\s+/);
      const type = parts.pop() || '';
      const name = parts.join(' ') || type;
      return { name, type, isOptional: false };
    });
  }

  private calculateLanguageBreakdown(files: ScannedFile[]): Record<string, number> {
    const breakdown: Record<string, number> = {};
    const total = files.length;

    for (const file of files) {
      breakdown[file.language] = (breakdown[file.language] || 0) + 1;
    }

    for (const lang of Object.keys(breakdown)) {
      breakdown[lang] = Math.round((breakdown[lang] / total) * 100);
    }

    return breakdown;
  }

  private async detectServices(projectPath: string): Promise<DetectedService[]> {
    const services: DetectedService[] = [];
    const manifestFiles = ['package.json', 'pom.xml', 'build.gradle', 'go.mod', 'Cargo.toml'];

    const findManifests = async (dir: string, depth = 0): Promise<void> => {
      if (depth > 3) return;

      const dirName = path.basename(dir);
      if (EXCLUDED_DIRS.has(dirName)) return;

      let entries: fs.Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (entry.isFile() && manifestFiles.includes(entry.name)) {
          const relativePath = path.relative(projectPath, dir);
          if (relativePath && !relativePath.includes('test') && !relativePath.includes('example')) {
            services.push(await this.classifyService(dir, entry.name, relativePath));
          }
        }
        if (entry.isDirectory() && depth < 3) {
          await findManifests(path.join(dir, entry.name), depth + 1);
        }
      }
    };

    await findManifests(projectPath);
    return services;
  }

  private async classifyService(servicePath: string, manifest: string, relativePath: string): Promise<DetectedService> {
    const service: DetectedService = {
      name: path.basename(servicePath) || relativePath,
      path: relativePath || '.',
      type: 'backend',
      language: 'Unknown',
    };

    try {
      const content = await fs.readFile(path.join(servicePath, manifest), 'utf-8');

      if (manifest === 'package.json') {
        const pkg = JSON.parse(content);
        service.language = pkg.devDependencies?.typescript ? 'TypeScript' : 'JavaScript';

        if (pkg.dependencies?.react || pkg.dependencies?.vue || pkg.dependencies?.angular) {
          service.type = 'frontend';
          service.framework = pkg.dependencies?.react ? 'React' : pkg.dependencies?.vue ? 'Vue' : 'Angular';
        } else if (pkg.dependencies?.['react-native'] || pkg.dependencies?.expo) {
          service.type = 'mobile';
          service.framework = 'React Native';
        } else if (pkg.dependencies?.express || pkg.dependencies?.fastify || pkg.dependencies?.nestjs) {
          service.type = 'backend';
          service.framework = pkg.dependencies?.nestjs ? 'NestJS' : pkg.dependencies?.fastify ? 'Fastify' : 'Express';
        }
        service.buildTool = 'npm';
      } else if (manifest === 'pom.xml') {
        service.language = 'Java';
        service.buildTool = 'Maven';
        if (content.includes('spring-boot')) service.framework = 'Spring Boot';
        else if (content.includes('quarkus')) service.framework = 'Quarkus';
      } else if (manifest === 'build.gradle') {
        service.language = content.includes('.kt') ? 'Kotlin' : 'Java';
        service.buildTool = 'Gradle';
        if (content.includes('spring-boot')) service.framework = 'Spring Boot';
      } else if (manifest === 'go.mod') {
        service.language = 'Go';
        service.buildTool = 'Go Modules';
      } else if (manifest === 'Cargo.toml') {
        service.language = 'Rust';
        service.buildTool = 'Cargo';
      }
    } catch {
      // Keep defaults
    }

    return service;
  }

  private async extractDependencies(projectPath: string, configFiles: ConfigFile[]): Promise<ExtendedDependency[]> {
    const deps: ExtendedDependency[] = [];

    for (const config of configFiles) {
      if (config.type === 'npm') {
        try {
          const pkg = JSON.parse(config.content);
          for (const [name, version] of Object.entries(pkg.dependencies || {})) {
            deps.push({
              name,
              version: String(version),
              scope: 'compile',
              fixed: !String(version).startsWith('^') && !String(version).startsWith('~'),
              isOutdated: false,
              vulnerabilities: [],
            });
          }
          for (const [name, version] of Object.entries(pkg.devDependencies || {})) {
            deps.push({
              name,
              version: String(version),
              scope: 'test',
              fixed: !String(version).startsWith('^') && !String(version).startsWith('~'),
              isOutdated: false,
              vulnerabilities: [],
            });
          }
        } catch {
          // Skip malformed package.json
        }
      }
    }

    return deps;
  }

  private async detectStack(
    projectPath: string,
    configFiles: ConfigFile[],
    files: ScannedFile[]
  ): Promise<DetectedStack> {
    const stack: DetectedStack = {
      languages: [],
      frameworks: [],
      databases: [],
      messageBrokers: [],
      cloudServices: [],
      cicd: [],
      containerization: [],
    };

    const langBreakdown = this.calculateLanguageBreakdown(files);
    for (const [lang, pct] of Object.entries(langBreakdown)) {
      if (lang !== 'config') {
        stack.languages.push({ name: lang, percentage: pct });
      }
    }

    for (const config of configFiles) {
      const content = config.content.toLowerCase();

      if (content.includes('spring-boot')) stack.frameworks.push({ name: 'Spring Boot', type: 'web' });
      if (content.includes('quarkus')) stack.frameworks.push({ name: 'Quarkus', type: 'web' });
      if (content.includes('react')) stack.frameworks.push({ name: 'React', type: 'web' });
      if (content.includes('vue')) stack.frameworks.push({ name: 'Vue.js', type: 'web' });
      if (content.includes('angular')) stack.frameworks.push({ name: 'Angular', type: 'web' });
      if (content.includes('express')) stack.frameworks.push({ name: 'Express', type: 'api' });
      if (content.includes('fastify')) stack.frameworks.push({ name: 'Fastify', type: 'api' });
      if (content.includes('nestjs')) stack.frameworks.push({ name: 'NestJS', type: 'api' });

      if (content.includes('postgresql') || content.includes('postgres')) stack.databases.push('PostgreSQL');
      if (content.includes('mysql')) stack.databases.push('MySQL');
      if (content.includes('mongodb')) stack.databases.push('MongoDB');
      if (content.includes('redis')) stack.databases.push('Redis');
      if (content.includes('elasticsearch')) stack.databases.push('Elasticsearch');

      if (content.includes('kafka')) stack.messageBrokers.push('Kafka');
      if (content.includes('rabbitmq')) stack.messageBrokers.push('RabbitMQ');
      if (content.includes('sqs')) stack.messageBrokers.push('AWS SQS');

      if (content.includes('aws')) stack.cloudServices.push('AWS');
      if (content.includes('gcp') || content.includes('google-cloud')) stack.cloudServices.push('GCP');
      if (content.includes('azure')) stack.cloudServices.push('Azure');
    }

    if (await fs.pathExists(path.join(projectPath, '.github/workflows'))) {
      stack.cicd.push('GitHub Actions');
    }
    if (await fs.pathExists(path.join(projectPath, '.gitlab-ci.yml'))) {
      stack.cicd.push('GitLab CI');
    }
    if (await fs.pathExists(path.join(projectPath, 'Jenkinsfile'))) {
      stack.cicd.push('Jenkins');
    }

    if (await fs.pathExists(path.join(projectPath, 'Dockerfile'))) {
      stack.containerization.push('Docker');
    }
    if (await fs.pathExists(path.join(projectPath, 'docker-compose.yml'))) {
      stack.containerization.push('Docker Compose');
    }
    if (await fs.pathExists(path.join(projectPath, 'kubernetes')) || await fs.pathExists(path.join(projectPath, 'k8s'))) {
      stack.containerization.push('Kubernetes');
    }

    stack.databases = [...new Set(stack.databases)];
    stack.messageBrokers = [...new Set(stack.messageBrokers)];
    stack.cloudServices = [...new Set(stack.cloudServices)];

    return stack;
  }
}

export default new ProjectScanner();
