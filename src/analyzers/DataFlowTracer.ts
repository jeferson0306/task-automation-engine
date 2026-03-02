import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { Workspace, DetectedProject } from './MultiProjectScanner.js';

/**
 * A traced data point in the system
 */
export interface DataPoint {
  name: string;           // Field/property name (e.g., "estimatedDeliveryDate")
  type?: string;          // Data type if known
  location: DataLocation;
  transformations: DataTransformation[];
  sources: DataSource[];
  consumers: DataConsumer[];
}

export interface DataLocation {
  project: string;
  file: string;
  line?: number;
  layer: 'ui' | 'api' | 'service' | 'repository' | 'database' | 'unknown';
}

export interface DataTransformation {
  description: string;
  location: DataLocation;
  code: string;           // The actual transformation code
  inputs: string[];       // What data it uses
  output: string;         // What it produces
}

export interface DataSource {
  type: 'database' | 'api-call' | 'calculation' | 'user-input' | 'config' | 'unknown';
  location: DataLocation;
  description: string;
}

export interface DataConsumer {
  type: 'ui-display' | 'api-response' | 'export' | 'calculation' | 'storage' | 'unknown';
  location: DataLocation;
  description: string;
}

/**
 * Result of a data flow trace
 */
export interface DataFlowTrace {
  query: string;                    // What we searched for
  relatedTerms: string[];           // Related terms found
  dataPoints: DataPoint[];          // All places this data appears
  flowPaths: FlowPath[];            // Paths data takes through the system
  duplicateLogic: DuplicateLogic[]; // Same logic in multiple places
  recommendations: string[];        // Suggestions for investigation
}

export interface FlowPath {
  description: string;
  steps: FlowStep[];
}

export interface FlowStep {
  order: number;
  project: string;
  file: string;
  action: string;
  code?: string;
}

export interface DuplicateLogic {
  description: string;
  locations: DataLocation[];
  similarity: number;  // 0-100
  risk: 'low' | 'medium' | 'high';
}

/**
 * Data Flow Tracer
 * Investigates where data comes from, how it's transformed, and where it goes
 */
export class DataFlowTracer {
  
  /**
   * Trace a data field/concept through the entire workspace
   */
  async traceDataFlow(
    workspace: Workspace,
    searchTerms: string[],
    context?: { taskDescription?: string }
  ): Promise<DataFlowTrace> {
    logger.info(`Tracing data flow for: ${searchTerms.join(', ')}`);
    
    // Generate related terms (variations, getters, setters, etc.)
    const relatedTerms = this.generateRelatedTerms(searchTerms);
    logger.info(`  Related terms: ${relatedTerms.slice(0, 10).join(', ')}...`);
    
    // Find all occurrences across all projects
    const dataPoints: DataPoint[] = [];
    const allOccurrences: FileOccurrence[] = [];
    
    for (const project of workspace.projects) {
      const occurrences = await this.findOccurrences(project, relatedTerms);
      allOccurrences.push(...occurrences);
    }
    
    logger.info(`  Found ${allOccurrences.length} occurrences across ${workspace.projects.length} projects`);
    
    // Analyze each occurrence to understand its role
    for (const occurrence of allOccurrences) {
      const dataPoint = await this.analyzeOccurrence(occurrence, relatedTerms);
      if (dataPoint) {
        dataPoints.push(dataPoint);
      }
    }
    
    // Detect flow paths (how data moves through the system)
    const flowPaths = this.detectFlowPaths(dataPoints, workspace);
    
    // Detect duplicate logic (from dataPoints)
    let duplicateLogic = this.detectDuplicateLogic(dataPoints);
    
    // GAP 3 FIX: Also search for duplicate functions across projects by name
    const crossProjectDuplicates = await this.findCrossProjectDuplicateFunctions(workspace);
    duplicateLogic = [...duplicateLogic, ...crossProjectDuplicates];
    
    // Generate recommendations
    const recommendations = this.generateRecommendations(dataPoints, flowPaths, duplicateLogic, context);
    
    return {
      query: searchTerms.join(', '),
      relatedTerms,
      dataPoints,
      flowPaths,
      duplicateLogic,
      recommendations,
    };
  }
  
  /**
   * Generate related terms from search terms
   */
  private generateRelatedTerms(searchTerms: string[]): string[] {
    const related = new Set<string>();
    
    for (const term of searchTerms) {
      const clean = term.toLowerCase().replace(/[^a-z0-9]/g, '');
      related.add(clean);
      
      // CamelCase variations
      const camel = term.replace(/[-_\s](.)/g, (_, c) => c.toUpperCase());
      related.add(camel.toLowerCase());
      
      // Snake_case variations
      const snake = term.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
      related.add(snake);
      
      // Getter/setter variations
      if (/^[a-z]/.test(term)) {
        const capitalized = term.charAt(0).toUpperCase() + term.slice(1);
        related.add(('get' + capitalized).toLowerCase());
        related.add(('set' + capitalized).toLowerCase());
        related.add(('is' + capitalized).toLowerCase());
        related.add(('has' + capitalized).toLowerCase());
        related.add(('calculate' + capitalized).toLowerCase());
        related.add(('compute' + capitalized).toLowerCase());
      }
      
      // Common abbreviations
      if (term.toLowerCase().includes('date')) {
        related.add(term.toLowerCase().replace('date', 'dt'));
      }
      if (term.toLowerCase().includes('estimated')) {
        related.add(term.toLowerCase().replace('estimated', 'est'));
      }
    }
    
    return [...related];
  }
  
  /**
   * Find all occurrences of terms in a project
   */
  private async findOccurrences(
    project: DetectedProject,
    terms: string[]
  ): Promise<FileOccurrence[]> {
    const occurrences: FileOccurrence[] = [];
    const extensions = this.getExtensionsForLanguage(project.language);
    
    await this.searchDirectory(project.path, terms, extensions, project, occurrences);
    
    return occurrences;
  }
  
  /**
   * Recursively search a directory for terms
   */
  private async searchDirectory(
    dirPath: string,
    terms: string[],
    extensions: string[],
    project: DetectedProject,
    occurrences: FileOccurrence[]
  ): Promise<void> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        
        if (entry.isDirectory() && !this.isIgnoredDirectory(entry.name)) {
          await this.searchDirectory(fullPath, terms, extensions, project, occurrences);
        } else if (entry.isFile() && extensions.some(ext => entry.name.endsWith(ext))) {
          const fileOccurrences = await this.searchFile(fullPath, terms, project);
          occurrences.push(...fileOccurrences);
        }
      }
    } catch (error) {
      // Directory not readable
    }
  }
  
  /**
   * Search a single file for terms
   */
  private async searchFile(
    filePath: string,
    terms: string[],
    project: DetectedProject
  ): Promise<FileOccurrence[]> {
    const occurrences: FileOccurrence[] = [];
    
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const contentLower = content.toLowerCase();
      const lines = content.split('\n');
      
      for (const term of terms) {
        if (contentLower.includes(term)) {
          // Find all lines containing this term
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(term)) {
              // Get context (3 lines before and after)
              const startLine = Math.max(0, i - 3);
              const endLine = Math.min(lines.length - 1, i + 3);
              const context = lines.slice(startLine, endLine + 1).join('\n');
              
              occurrences.push({
                project: project.name,
                projectType: project.type,
                file: filePath,
                relativePath: path.relative(project.path, filePath),
                line: i + 1,
                term,
                lineContent: lines[i],
                context,
                layer: this.inferLayer(filePath, lines[i], project),
              });
            }
          }
        }
      }
    } catch (error) {
      // File not readable
    }
    
    return occurrences;
  }
  
  /**
   * Infer the architectural layer from file path and content
   */
  private inferLayer(filePath: string, lineContent: string, project: DetectedProject): DataLocation['layer'] {
    const pathLower = filePath.toLowerCase();
    const lineLower = lineContent.toLowerCase();
    
    // UI/Frontend indicators
    if (project.type === 'frontend') return 'ui';
    if (pathLower.includes('component') || pathLower.includes('/ui/')) return 'ui';
    if (pathLower.includes('.html') || pathLower.includes('.tsx') || pathLower.includes('.vue')) return 'ui';
    if (lineLower.includes('{{') || lineLower.includes('v-') || lineLower.includes('ng-')) return 'ui';
    
    // API layer indicators
    if (project.type === 'api') return 'api';
    if (pathLower.includes('controller') || pathLower.includes('resource')) return 'api';
    if (pathLower.includes('endpoint') || pathLower.includes('/web/')) return 'api';
    if (lineLower.includes('@get') || lineLower.includes('@post') || lineLower.includes('@path')) return 'api';
    
    // Service layer indicators
    if (pathLower.includes('service') || pathLower.includes('/core/')) return 'service';
    if (pathLower.includes('utils') || pathLower.includes('helper')) return 'service';
    if (lineLower.includes('@service') || lineLower.includes('@injectable')) return 'service';
    
    // Repository layer indicators
    if (pathLower.includes('repository') || pathLower.includes('dao')) return 'repository';
    if (pathLower.includes('mapper')) return 'repository';
    if (lineLower.includes('@repository') || lineLower.includes('panache')) return 'repository';
    
    // Database layer indicators
    if (pathLower.includes('entity') || pathLower.includes('model')) return 'database';
    if (pathLower.includes('migration') || pathLower.includes('schema')) return 'database';
    if (lineLower.includes('@entity') || lineLower.includes('@table')) return 'database';
    
    return 'unknown';
  }
  
  /**
   * Analyze an occurrence to create a DataPoint
   */
  private async analyzeOccurrence(
    occurrence: FileOccurrence,
    relatedTerms: string[]
  ): Promise<DataPoint | null> {
    // Analyze what kind of data point this is
    const isAssignment = /[=:]/.test(occurrence.lineContent) && !occurrence.lineContent.includes('==');
    const isMethodCall = /\.\w+\(/.test(occurrence.lineContent);
    const isDeclaration = /\b(var|let|const|private|public|protected)\b/.test(occurrence.lineContent);
    const isReturn = /\breturn\b/.test(occurrence.lineContent);
    const isConditional = /\b(if|when|switch|case)\b/.test(occurrence.lineContent);
    
    const dataPoint: DataPoint = {
      name: occurrence.term,
      location: {
        project: occurrence.project,
        file: occurrence.relativePath,
        line: occurrence.line,
        layer: occurrence.layer,
      },
      transformations: [],
      sources: [],
      consumers: [],
    };
    
    // Determine if this is a source, transformation, or consumer
    if (isAssignment && !isDeclaration) {
      dataPoint.transformations.push({
        description: 'Assignment/Calculation',
        location: dataPoint.location,
        code: occurrence.lineContent.trim(),
        inputs: this.extractInputs(occurrence.context, relatedTerms),
        output: occurrence.term,
      });
    }
    
    if (isReturn) {
      dataPoint.consumers.push({
        type: occurrence.layer === 'api' ? 'api-response' : 'unknown',
        location: dataPoint.location,
        description: 'Return value',
      });
    }
    
    if (occurrence.layer === 'ui') {
      dataPoint.consumers.push({
        type: 'ui-display',
        location: dataPoint.location,
        description: 'Displayed in UI',
      });
    }
    
    return dataPoint;
  }
  
  /**
   * Extract input variables from code context
   */
  private extractInputs(context: string, relatedTerms: string[]): string[] {
    const inputs: string[] = [];
    
    // Find variable references
    const varPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
    let match;
    while ((match = varPattern.exec(context)) !== null) {
      const term = match[1].toLowerCase();
      if (relatedTerms.includes(term) && !inputs.includes(match[1])) {
        inputs.push(match[1]);
      }
    }
    
    return inputs;
  }
  
  /**
   * Detect flow paths through the system
   */
  private detectFlowPaths(dataPoints: DataPoint[], workspace: Workspace): FlowPath[] {
    const paths: FlowPath[] = [];
    
    // Group by layer
    const byLayer = new Map<string, DataPoint[]>();
    for (const dp of dataPoints) {
      const layer = dp.location.layer;
      if (!byLayer.has(layer)) byLayer.set(layer, []);
      byLayer.get(layer)!.push(dp);
    }
    
    // Typical flow: database -> repository -> service -> api -> ui
    const layerOrder: DataLocation['layer'][] = ['database', 'repository', 'service', 'api', 'ui'];
    const presentLayers = layerOrder.filter(l => byLayer.has(l));
    
    if (presentLayers.length >= 2) {
      const steps: FlowStep[] = [];
      let order = 1;
      
      for (const layer of presentLayers) {
        const points = byLayer.get(layer)!;
        for (const point of points.slice(0, 1)) { // Take first occurrence per layer
          steps.push({
            order: order++,
            project: point.location.project,
            file: point.location.file,
            action: `${layer}: ${point.transformations.length > 0 ? 'transforms' : 'uses'} ${point.name}`,
            code: point.transformations[0]?.code,
          });
        }
      }
      
      paths.push({
        description: `Data flows through ${presentLayers.length} layers`,
        steps,
      });
    }
    
    return paths;
  }
  
  /**
   * Detect duplicate logic across locations
   */
  private detectDuplicateLogic(dataPoints: DataPoint[]): DuplicateLogic[] {
    const duplicates: DuplicateLogic[] = [];
    
    // Group transformations by similarity
    const transformations = dataPoints
      .flatMap(dp => dp.transformations)
      .filter(t => t.code.length > 20);
    
    // Check for similar calculations in different locations
    const seen = new Map<string, DataLocation[]>();
    
    for (const t of transformations) {
      // Normalize the code for comparison
      const normalized = t.code
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/['"]/g, '')
        .trim();
      
      // Look for key patterns (calculations, date manipulation, etc.)
      const patterns = [
        /add.*days/i,
        /add.*weeks/i,
        /calculate/i,
        /\+\s*\d+/,
        /date.*format/i,
      ];
      
      for (const pattern of patterns) {
        if (pattern.test(normalized)) {
          const key = pattern.toString();
          if (!seen.has(key)) seen.set(key, []);
          seen.get(key)!.push(t.location);
        }
      }
    }
    
    // Report duplicates found in multiple locations
    for (const [pattern, locations] of seen) {
      if (locations.length >= 2) {
        // Check if they're in different projects
        const projects = new Set(locations.map(l => l.project));
        if (projects.size >= 2) {
          duplicates.push({
            description: `Similar calculation logic found in ${projects.size} projects`,
            locations,
            similarity: 80,
            risk: 'high',
          });
        }
      }
    }
    
    // ADDITIONAL CHECK: Look for function names that suggest duplicate logic
    // This catches cases like "addWorkingDays" in both frontend and backend
    const functionNamePatterns = [
      /add\w*Days/i,
      /add\w*Weeks/i,
      /calculate\w*Date/i,
      /get\w*Due\w*Date/i,
      /estimate\w*Date/i,
      /working\s*Days/i,
    ];
    
    const functionLocations = new Map<string, DataLocation[]>();
    
    for (const dp of dataPoints) {
      const content = dp.transformations.map(t => t.code).join(' ') + ' ' + dp.name;
      
      for (const pattern of functionNamePatterns) {
        const match = pattern.exec(content);
        if (match) {
          const funcName = match[0].toLowerCase().replace(/\s+/g, '');
          if (!functionLocations.has(funcName)) {
            functionLocations.set(funcName, []);
          }
          functionLocations.get(funcName)!.push(dp.location);
        }
      }
    }
    
    // Report functions that appear in multiple projects
    for (const [funcName, locations] of functionLocations) {
      // Deduplicate by project
      const uniqueByProject = new Map<string, DataLocation>();
      for (const loc of locations) {
        if (!uniqueByProject.has(loc.project)) {
          uniqueByProject.set(loc.project, loc);
        }
      }
      
      if (uniqueByProject.size >= 2) {
        const uniqueLocs = Array.from(uniqueByProject.values());
        const projectList = uniqueLocs.map(l => l.project).join(', ');
        
        // Check if in different layers (frontend vs backend)
        const layers = new Set(uniqueLocs.map(l => l.layer));
        const inDifferentLayers = layers.size >= 2;
        
        duplicates.push({
          description: inDifferentLayers
            ? `⚠️ CRITICAL: "${funcName}" function exists in BOTH frontend AND backend (${projectList}). This may cause calculation inconsistencies!`
            : `Similar function "${funcName}" found in ${uniqueByProject.size} projects (${projectList})`,
          locations: uniqueLocs,
          similarity: inDifferentLayers ? 95 : 75,
          risk: inDifferentLayers ? 'high' : 'medium',
        });
      }
    }
    
    return duplicates;
  }
  
  /**
   * GAP 3: Search for duplicate functions across projects by name
   * Specifically targets common business logic functions like addWorkingDays, calculateDate, etc.
   */
  private async findCrossProjectDuplicateFunctions(workspace: Workspace): Promise<DuplicateLogic[]> {
    const duplicates: DuplicateLogic[] = [];
    
    // Function patterns that indicate business logic we should check for duplicates
    const businessLogicPatterns = [
      /addWorkingDays/i,
      /addDays/i,
      /addWeeks/i,
      /calculateDate/i,
      /computeDate/i,
      /getEstimatedDate/i,
      /getDueDate/i,
      /get\w+DueDate/i,         // Pattern: getFooDueDate, getItemDueDate, etc.
      /formatDate/i,
      /parseDate/i,
      /businessDays/i,
      /workingDays/i,
    ];
    
    // Map of function name -> locations where found
    const functionLocations = new Map<string, Array<{project: string; file: string; line?: number; layer: DataLocation['layer']}>>();
    
    for (const project of workspace.projects) {
      try {
        const files = await this.getSourceFiles(project.path);
        
        for (const file of files) {
          const content = await this.readFileContent(file);
          if (!content) continue;
          
          const lines = content.split('\n');
          
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            for (const pattern of businessLogicPatterns) {
              const match = pattern.exec(line);
              if (match) {
                const funcName = match[0].toLowerCase();
                
                if (!functionLocations.has(funcName)) {
                  functionLocations.set(funcName, []);
                }
                
                // Determine layer
                const layer = this.inferLayer(file, line, project);
                
                // Check if we already have this file for this function
                const existingLocations = functionLocations.get(funcName)!;
                if (!existingLocations.some(l => l.file === file)) {
                  existingLocations.push({
                    project: project.name,
                    file,
                    line: i + 1,
                    layer,
                  });
                }
              }
            }
          }
        }
      } catch (e) {
        // Skip projects with read errors
      }
    }
    
    // Find functions that appear in multiple projects
    for (const [funcName, locations] of functionLocations) {
      // Group by project
      const byProject = new Map<string, typeof locations[0]>();
      for (const loc of locations) {
        if (!byProject.has(loc.project)) {
          byProject.set(loc.project, loc);
        }
      }
      
      if (byProject.size >= 2) {
        const uniqueLocs = Array.from(byProject.values());
        const layers = new Set(uniqueLocs.map(l => l.layer));
        const inDifferentLayers = layers.size >= 2;
        
        duplicates.push({
          description: inDifferentLayers
            ? `🔴 CRITICAL DUPLICATE: Function "${funcName}" found in BOTH frontend AND backend projects! This likely causes inconsistent calculations.`
            : `⚠️ DUPLICATE: Function "${funcName}" found in ${byProject.size} different projects: ${[...byProject.keys()].join(', ')}`,
          locations: uniqueLocs.map(l => ({
            project: l.project,
            file: l.file,
            line: l.line,
            layer: l.layer,
          })),
          similarity: inDifferentLayers ? 95 : 80,
          risk: inDifferentLayers ? 'high' : 'medium',
        });
      }
    }
    
    return duplicates;
  }
  
  /**
   * Get all source files from a project
   */
  private async getSourceFiles(projectPath: string): Promise<string[]> {
    const results: string[] = [];
    
    async function walk(dir: string, depth = 0): Promise<void> {
      if (depth > 6) return;
      
      try {
        const { readdir, stat } = await import('fs/promises');
        const path = await import('path');
        
        const entries = await readdir(dir);
        for (const entry of entries) {
          // Skip common non-source directories
          if (entry.startsWith('.') || 
              entry === 'node_modules' || 
              entry === 'dist' || 
              entry === 'build' ||
              entry === 'target' ||
              entry === '.git') {
            continue;
          }
          
          const fullPath = path.join(dir, entry);
          const stats = await stat(fullPath);
          
          if (stats.isDirectory()) {
            await walk(fullPath, depth + 1);
          } else if (stats.isFile()) {
            const ext = path.extname(entry).toLowerCase();
            // Include both frontend and backend source files
            if (['.ts', '.tsx', '.js', '.jsx', '.vue', '.java', '.kt', '.py', '.go'].includes(ext)) {
              results.push(fullPath);
            }
          }
        }
      } catch (e) {
        // Ignore permission errors
      }
    }
    
    await walk(projectPath);
    return results;
  }
  
  /**
   * Read file content safely
   */
  private async readFileContent(filePath: string): Promise<string | null> {
    try {
      const { readFile } = await import('fs/promises');
      return await readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  }
  
  /**
   * Generate recommendations based on analysis
   */
  private generateRecommendations(
    dataPoints: DataPoint[],
    flowPaths: FlowPath[],
    duplicateLogic: DuplicateLogic[],
    context?: { taskDescription?: string }
  ): string[] {
    const recommendations: string[] = [];
    
    // Check for duplicate logic
    if (duplicateLogic.length > 0) {
      recommendations.push(
        `⚠️ DUPLICATE LOGIC DETECTED: Same calculation appears in ${duplicateLogic.length} different locations. ` +
        `Consider centralizing this logic to avoid inconsistencies.`
      );
    }
    
    // Check for missing layers
    const layers = new Set(dataPoints.map(dp => dp.location.layer));
    if (layers.has('ui') && !layers.has('api')) {
      recommendations.push(
        `⚠️ DATA GAP: Found in UI but not in API layer. ` +
        `Check if the calculation is happening only in frontend (potential bug source).`
      );
    }
    
    // Check for frontend-only calculations
    const frontendCalcs = dataPoints.filter(
      dp => dp.location.layer === 'ui' && dp.transformations.length > 0
    );
    if (frontendCalcs.length > 0) {
      recommendations.push(
        `⚠️ FRONTEND CALCULATION: Business logic in UI layer detected. ` +
        `Consider moving calculations to backend for consistency.`
      );
    }
    
    // Multiple projects involved
    const projects = new Set(dataPoints.map(dp => dp.location.project));
    if (projects.size >= 2) {
      recommendations.push(
        `📦 MULTI-PROJECT: This data appears in ${projects.size} projects (${[...projects].join(', ')}). ` +
        `Ensure all locations are updated consistently.`
      );
    }
    
    // Low coverage
    if (dataPoints.length < 3) {
      recommendations.push(
        `🔍 LOW COVERAGE: Only ${dataPoints.length} occurrences found. ` +
        `Consider searching with alternative terms or checking related concepts.`
      );
    }
    
    return recommendations;
  }
  
  /**
   * Get file extensions for a language
   */
  private getExtensionsForLanguage(language: string): string[] {
    const extensions: Record<string, string[]> = {
      'java': ['.java'],
      'kotlin': ['.kt', '.kts'],
      'typescript': ['.ts', '.tsx'],
      'javascript': ['.js', '.jsx', '.mjs'],
      'python': ['.py'],
      'go': ['.go'],
      'unknown': ['.java', '.kt', '.ts', '.js', '.py', '.go'],
    };
    return extensions[language] || extensions['unknown'];
  }
  
  /**
   * Check if directory should be ignored
   */
  private isIgnoredDirectory(name: string): boolean {
    const ignored = [
      'node_modules', '.git', '.idea', '.vscode',
      'target', 'build', 'dist', 'out',
      '__pycache__', '.pytest_cache', 'venv',
      '.gradle', '.mvn', 'coverage',
    ];
    return ignored.includes(name) || name.startsWith('.');
  }
}

/**
 * Internal type for file occurrences
 */
interface FileOccurrence {
  project: string;
  projectType: DetectedProject['type'];
  file: string;
  relativePath: string;
  line: number;
  term: string;
  lineContent: string;
  context: string;
  layer: DataLocation['layer'];
}

export default new DataFlowTracer();
