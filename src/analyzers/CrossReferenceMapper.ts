import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { DetectedProject, Workspace } from './MultiProjectScanner.js';

/**
 * A reference from one piece of code to another
 */
export interface CodeReference {
  type: 'import' | 'method-call' | 'class-usage' | 'interface-impl' | 'annotation' | 'endpoint-call';
  fromFile: string;
  fromProject: string;
  fromLine?: number;
  toEntity: string;  // Class, method, or endpoint name
  toFile?: string;   // Resolved file if known
  toProject?: string;
  code: string;
}

/**
 * A method or function with its callers
 */
export interface MethodCallGraph {
  method: string;
  file: string;
  project: string;
  calledBy: CallerInfo[];
  calls: string[];
}

export interface CallerInfo {
  method: string;
  file: string;
  project: string;
  line: number;
}

/**
 * Entity relationship (class hierarchies, interfaces)
 */
export interface EntityRelationship {
  entity: string;
  type: 'extends' | 'implements' | 'uses' | 'aggregates' | 'composed-of';
  relatedTo: string;
  file: string;
  project: string;
}

/**
 * API endpoint mapping
 */
export interface EndpointMapping {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  handler: string;
  file: string;
  project: string;
  callers: EndpointCaller[];
}

export interface EndpointCaller {
  file: string;
  project: string;
  line: number;
  code: string;
}

/**
 * Complete cross-reference map
 */
export interface CrossReferenceMap {
  imports: CodeReference[];
  methodCalls: MethodCallGraph[];
  entityRelations: EntityRelationship[];
  endpoints: EndpointMapping[];
  summary: {
    totalReferences: number;
    crossProjectRefs: number;
    hotspots: HotspotInfo[];
  };
}

export interface HotspotInfo {
  file: string;
  project: string;
  reason: string;
  refCount: number;
}

/**
 * Cross-Reference Mapper
 * Maps dependencies, method calls, and relationships across the codebase
 */
export class CrossReferenceMapper {
  
  /**
   * Build a complete cross-reference map for a workspace
   */
  async buildCrossReferenceMap(
    workspace: Workspace,
    focusTerms?: string[]
  ): Promise<CrossReferenceMap> {
    logger.info(`Building cross-reference map for workspace`);
    
    const imports: CodeReference[] = [];
    const methodCalls: MethodCallGraph[] = [];
    const entityRelations: EntityRelationship[] = [];
    const endpoints: EndpointMapping[] = [];
    
    // Process each project
    for (const project of workspace.projects) {
      logger.info(`  Processing ${project.name}...`);
      
      // Extract imports
      const projectImports = await this.extractImports(project);
      imports.push(...projectImports);
      
      // Extract method definitions and calls
      const projectMethods = await this.extractMethodCalls(project, focusTerms);
      methodCalls.push(...projectMethods);
      
      // Extract entity relationships
      const projectRelations = await this.extractEntityRelations(project);
      entityRelations.push(...projectRelations);
      
      // Extract API endpoints
      const projectEndpoints = await this.extractEndpoints(project);
      endpoints.push(...projectEndpoints);
    }
    
    // Resolve cross-project references
    this.resolveCrossProjectRefs(imports, workspace);
    
    // Find endpoint callers across projects
    await this.findEndpointCallers(endpoints, workspace);
    
    // Calculate summary
    const summary = this.calculateSummary(imports, methodCalls, endpoints);
    
    logger.info(`  Map complete: ${imports.length} imports, ${methodCalls.length} methods, ${endpoints.length} endpoints`);
    
    return {
      imports,
      methodCalls,
      entityRelations,
      endpoints,
      summary,
    };
  }
  
  /**
   * Find all callers of a specific method
   */
  async findMethodCallers(
    workspace: Workspace,
    methodName: string,
    className?: string
  ): Promise<CallerInfo[]> {
    const callers: CallerInfo[] = [];
    const searchPattern = className 
      ? new RegExp(`\\b${className}[.:]${methodName}\\s*\\(`, 'gi')
      : new RegExp(`\\.${methodName}\\s*\\(`, 'gi');
    
    for (const project of workspace.projects) {
      const extensions = this.getExtensions(project.language);
      await this.searchForPattern(project.path, searchPattern, extensions, project.name, callers);
    }
    
    return callers;
  }
  
  /**
   * Find all places an entity (class/interface) is used
   */
  async findEntityUsages(
    workspace: Workspace,
    entityName: string
  ): Promise<CodeReference[]> {
    const usages: CodeReference[] = [];
    const patterns = [
      new RegExp(`\\b${entityName}\\s+\\w+`, 'g'),        // Type declaration
      new RegExp(`new\\s+${entityName}\\s*\\(`, 'g'),     // Instantiation
      new RegExp(`<${entityName}>`, 'g'),                  // Generic parameter
      new RegExp(`extends\\s+${entityName}`, 'g'),         // Inheritance
      new RegExp(`implements\\s+.*${entityName}`, 'g'),    // Implementation
    ];
    
    for (const project of workspace.projects) {
      const extensions = this.getExtensions(project.language);
      await this.searchDirectory(project.path, patterns, extensions, project.name, usages, 'class-usage');
    }
    
    return usages;
  }
  
  /**
   * Extract imports from a project
   */
  private async extractImports(project: DetectedProject): Promise<CodeReference[]> {
    const imports: CodeReference[] = [];
    const extensions = this.getExtensions(project.language);
    
    const importPatterns: Record<string, RegExp[]> = {
      'java': [
        /import\s+(static\s+)?([a-zA-Z0-9_.]+)\s*;/g,
      ],
      'kotlin': [
        /import\s+([a-zA-Z0-9_.]+)\s*/g,
      ],
      'typescript': [
        /import\s+(?:{[^}]+}|[^;]+)\s+from\s+['"]([^'"]+)['"]/g,
        /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      ],
      'javascript': [
        /import\s+(?:{[^}]+}|[^;]+)\s+from\s+['"]([^'"]+)['"]/g,
        /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      ],
      'python': [
        /from\s+([a-zA-Z0-9_.]+)\s+import/g,
        /import\s+([a-zA-Z0-9_.]+)/g,
      ],
    };
    
    const patterns = importPatterns[project.language] || importPatterns['java'];
    
    await this.processFiles(project.path, extensions, async (file, content, relativePath) => {
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        for (const pattern of patterns) {
          let match;
          while ((match = pattern.exec(lines[i])) !== null) {
            const importPath = match[2] || match[1];
            if (importPath) {
              imports.push({
                type: 'import',
                fromFile: relativePath,
                fromProject: project.name,
                fromLine: i + 1,
                toEntity: importPath,
                code: lines[i].trim(),
              });
            }
          }
        }
      }
    });
    
    return imports;
  }
  
  /**
   * Extract method definitions and their calls
   */
  private async extractMethodCalls(
    project: DetectedProject,
    focusTerms?: string[]
  ): Promise<MethodCallGraph[]> {
    const methods: MethodCallGraph[] = [];
    const extensions = this.getExtensions(project.language);
    
    const methodPatterns: Record<string, RegExp> = {
      'java': /(?:public|private|protected)?\s*(?:static)?\s*(?:<[^>]+>\s*)?(\w+)\s+(\w+)\s*\([^)]*\)\s*(?:throws\s+[^{]+)?\s*\{/g,
      'kotlin': /(?:fun|override\s+fun)\s+(\w+)\s*\([^)]*\)/g,
      'typescript': /(?:async\s+)?(?:function\s+)?(\w+)\s*(?:<[^>]+>)?\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/g,
      'javascript': /(?:async\s+)?(?:function\s+)?(\w+)\s*\([^)]*\)\s*\{/g,
      'python': /def\s+(\w+)\s*\([^)]*\)\s*(?:->\s*[^:]+)?\s*:/g,
    };
    
    const pattern = methodPatterns[project.language] || methodPatterns['java'];
    
    await this.processFiles(project.path, extensions, async (file, content, relativePath) => {
      let match;
      const lines = content.split('\n');
      
      while ((match = pattern.exec(content)) !== null) {
        const methodName = match[2] || match[1];
        
        // Skip if not in focus terms (if provided)
        if (focusTerms && focusTerms.length > 0) {
          const matchesFocus = focusTerms.some(term => 
            methodName.toLowerCase().includes(term.toLowerCase())
          );
          if (!matchesFocus) continue;
        }
        
        // Find line number
        const upToMatch = content.slice(0, match.index);
        const lineNumber = (upToMatch.match(/\n/g) || []).length + 1;
        
        methods.push({
          method: methodName,
          file: relativePath,
          project: project.name,
          calledBy: [],
          calls: this.extractCallsFromMethod(content, match.index, project.language),
        });
      }
    });
    
    return methods;
  }
  
  /**
   * Extract method calls within a method body
   */
  private extractCallsFromMethod(content: string, methodStart: number, language: string): string[] {
    const calls: string[] = [];
    
    // Find the method body (between { and matching })
    let braceCount = 0;
    let bodyStart = content.indexOf('{', methodStart);
    if (bodyStart === -1) return calls;
    
    let bodyEnd = bodyStart;
    for (let i = bodyStart; i < content.length; i++) {
      if (content[i] === '{') braceCount++;
      if (content[i] === '}') braceCount--;
      if (braceCount === 0) {
        bodyEnd = i;
        break;
      }
    }
    
    const methodBody = content.slice(bodyStart, bodyEnd);
    
    // Find method calls
    const callPattern = /\b([a-zA-Z_]\w*)\s*\(/g;
    let match;
    while ((match = callPattern.exec(methodBody)) !== null) {
      const call = match[1];
      // Filter out language keywords
      const keywords = ['if', 'for', 'while', 'switch', 'catch', 'new', 'return', 'throw'];
      if (!keywords.includes(call) && !calls.includes(call)) {
        calls.push(call);
      }
    }
    
    return calls;
  }
  
  /**
   * Extract entity relationships
   */
  private async extractEntityRelations(project: DetectedProject): Promise<EntityRelationship[]> {
    const relations: EntityRelationship[] = [];
    const extensions = this.getExtensions(project.language);
    
    const patterns: Record<string, { pattern: RegExp, type: EntityRelationship['type'] }[]> = {
      'java': [
        { pattern: /class\s+(\w+)\s+extends\s+(\w+)/g, type: 'extends' },
        { pattern: /class\s+(\w+)\s+implements\s+([\w,\s]+)/g, type: 'implements' },
        { pattern: /interface\s+(\w+)\s+extends\s+(\w+)/g, type: 'extends' },
      ],
      'kotlin': [
        { pattern: /class\s+(\w+)\s*(?:\([^)]*\))?\s*:\s*(\w+)/g, type: 'extends' },
      ],
      'typescript': [
        { pattern: /class\s+(\w+)\s+extends\s+(\w+)/g, type: 'extends' },
        { pattern: /class\s+(\w+)\s+implements\s+([\w,\s]+)/g, type: 'implements' },
        { pattern: /interface\s+(\w+)\s+extends\s+(\w+)/g, type: 'extends' },
      ],
    };
    
    const langPatterns = patterns[project.language] || patterns['java'];
    
    await this.processFiles(project.path, extensions, async (file, content, relativePath) => {
      for (const { pattern, type } of langPatterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          const entity = match[1];
          const relatedRaw = match[2];
          
          // Handle comma-separated interfaces
          const relatedEntities = relatedRaw.split(',').map(s => s.trim());
          for (const related of relatedEntities) {
            if (related) {
              relations.push({
                entity,
                type,
                relatedTo: related,
                file: relativePath,
                project: project.name,
              });
            }
          }
        }
      }
    });
    
    return relations;
  }
  
  /**
   * Extract API endpoints
   */
  private async extractEndpoints(project: DetectedProject): Promise<EndpointMapping[]> {
    const endpoints: EndpointMapping[] = [];
    const extensions = this.getExtensions(project.language);
    
    // Patterns for different frameworks
    const endpointPatterns = [
      // JAX-RS (Java)
      { pattern: /@(GET|POST|PUT|DELETE|PATCH)\s*\n\s*@Path\s*\(\s*["']([^"']+)["']\s*\)/g, handler: 3 },
      { pattern: /@Path\s*\(\s*["']([^"']+)["']\s*\)\s*\n\s*@(GET|POST|PUT|DELETE|PATCH)/g, handler: 3 },
      // Spring (Java)
      { pattern: /@(GetMapping|PostMapping|PutMapping|DeleteMapping)\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/g, handler: 3 },
      { pattern: /@RequestMapping\s*\([^)]*method\s*=\s*RequestMethod\.(GET|POST|PUT|DELETE)[^)]*value\s*=\s*["']([^"']+)["']/g, handler: 3 },
      // Express (Node.js)
      { pattern: /\.(get|post|put|delete|patch)\s*\(\s*["']([^"']+)["']/gi, handler: 3 },
      // NestJS
      { pattern: /@(Get|Post|Put|Delete|Patch)\s*\(\s*["']?([^"')]+)["']?\s*\)/g, handler: 3 },
    ];
    
    await this.processFiles(project.path, extensions, async (file, content, relativePath) => {
      for (const { pattern } of endpointPatterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          const method = match[1].toUpperCase().replace('MAPPING', '') as EndpointMapping['method'];
          const endpointPath = match[2];
          
          endpoints.push({
            method: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(method) ? method : 'GET',
            path: endpointPath,
            handler: relativePath,
            file: relativePath,
            project: project.name,
            callers: [],
          });
        }
      }
    });
    
    return endpoints;
  }
  
  /**
   * Find callers of endpoints across projects
   */
  private async findEndpointCallers(endpoints: EndpointMapping[], workspace: Workspace): Promise<void> {
    for (const endpoint of endpoints) {
      // Search for calls to this endpoint path
      for (const project of workspace.projects) {
        if (project.type === 'frontend' || project.type === 'api') {
          const extensions = this.getExtensions(project.language);
          await this.processFiles(project.path, extensions, async (file, content, relativePath) => {
            if (content.includes(endpoint.path)) {
              const lines = content.split('\n');
              for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes(endpoint.path)) {
                  endpoint.callers.push({
                    file: relativePath,
                    project: project.name,
                    line: i + 1,
                    code: lines[i].trim(),
                  });
                }
              }
            }
          });
        }
      }
    }
  }
  
  /**
   * Resolve cross-project references
   */
  private resolveCrossProjectRefs(imports: CodeReference[], workspace: Workspace): void {
    const projectPackages = new Map<string, string>();
    
    // Build a map of package prefixes to projects
    for (const project of workspace.projects) {
      // Extract base package from project structure
      projectPackages.set(project.name.toLowerCase(), project.name);
    }
    
    // Try to resolve imports to projects
    for (const imp of imports) {
      const importLower = imp.toEntity.toLowerCase();
      for (const [prefix, projectName] of projectPackages) {
        if (importLower.includes(prefix) && projectName !== imp.fromProject) {
          imp.toProject = projectName;
          break;
        }
      }
    }
  }
  
  /**
   * Calculate summary statistics
   */
  private calculateSummary(
    imports: CodeReference[],
    methods: MethodCallGraph[],
    endpoints: EndpointMapping[]
  ): CrossReferenceMap['summary'] {
    const crossProjectRefs = imports.filter(i => i.toProject && i.toProject !== i.fromProject).length;
    
    // Find hotspots (files with many references)
    const fileCounts = new Map<string, number>();
    for (const imp of imports) {
      const key = `${imp.fromProject}:${imp.fromFile}`;
      fileCounts.set(key, (fileCounts.get(key) || 0) + 1);
    }
    
    const hotspots: HotspotInfo[] = [...fileCounts.entries()]
      .filter(([_, count]) => count > 5)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([key, count]) => {
        const [project, file] = key.split(':');
        return {
          file,
          project,
          reason: 'High number of dependencies',
          refCount: count,
        };
      });
    
    return {
      totalReferences: imports.length + methods.length + endpoints.length,
      crossProjectRefs,
      hotspots,
    };
  }
  
  /**
   * Process all files in a directory
   */
  private async processFiles(
    dirPath: string,
    extensions: string[],
    processor: (file: string, content: string, relativePath: string) => Promise<void>
  ): Promise<void> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        
        if (entry.isDirectory() && !this.isIgnored(entry.name)) {
          await this.processFiles(fullPath, extensions, processor);
        } else if (entry.isFile() && extensions.some(ext => entry.name.endsWith(ext))) {
          try {
            const content = await fs.readFile(fullPath, 'utf-8');
            const relativePath = path.relative(process.cwd(), fullPath);
            await processor(fullPath, content, relativePath);
          } catch {
            // File not readable
          }
        }
      }
    } catch {
      // Directory not readable
    }
  }
  
  /**
   * Search directory for pattern
   */
  private async searchDirectory(
    dirPath: string,
    patterns: RegExp[],
    extensions: string[],
    projectName: string,
    results: CodeReference[],
    type: CodeReference['type']
  ): Promise<void> {
    await this.processFiles(dirPath, extensions, async (file, content, relativePath) => {
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        for (const pattern of patterns) {
          if (pattern.test(lines[i])) {
            results.push({
              type,
              fromFile: relativePath,
              fromProject: projectName,
              fromLine: i + 1,
              toEntity: '',
              code: lines[i].trim(),
            });
          }
        }
      }
    });
  }
  
  /**
   * Search for a pattern and populate callers
   */
  private async searchForPattern(
    dirPath: string,
    pattern: RegExp,
    extensions: string[],
    projectName: string,
    callers: CallerInfo[]
  ): Promise<void> {
    await this.processFiles(dirPath, extensions, async (file, content, relativePath) => {
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (pattern.test(lines[i])) {
          // Try to find the enclosing method
          const methodName = this.findEnclosingMethod(lines, i);
          callers.push({
            method: methodName || 'unknown',
            file: relativePath,
            project: projectName,
            line: i + 1,
          });
        }
      }
    });
  }
  
  /**
   * Find the method that encloses a line
   */
  private findEnclosingMethod(lines: string[], lineIndex: number): string | null {
    // Search backwards for a method signature
    for (let i = lineIndex; i >= 0 && i > lineIndex - 50; i--) {
      const line = lines[i];
      const methodMatch = line.match(/(?:fun|function|def|void|public|private|protected)\s+(\w+)\s*\(/);
      if (methodMatch) {
        return methodMatch[1];
      }
    }
    return null;
  }
  
  /**
   * Get file extensions for a language
   */
  private getExtensions(language: string): string[] {
    const extensions: Record<string, string[]> = {
      'java': ['.java'],
      'kotlin': ['.kt', '.kts'],
      'typescript': ['.ts', '.tsx'],
      'javascript': ['.js', '.jsx', '.mjs'],
      'python': ['.py'],
      'go': ['.go'],
      'unknown': ['.java', '.kt', '.ts', '.js', '.py'],
    };
    return extensions[language] || extensions['unknown'];
  }
  
  /**
   * Check if directory should be ignored
   */
  private isIgnored(name: string): boolean {
    const ignored = [
      'node_modules', '.git', '.idea', '.vscode',
      'target', 'build', 'dist', 'out',
      '__pycache__', '.pytest_cache', 'venv',
      '.gradle', '.mvn',
    ];
    return ignored.includes(name) || name.startsWith('.');
  }
}

export default new CrossReferenceMapper();
