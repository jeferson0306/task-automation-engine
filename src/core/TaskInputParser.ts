import { logger } from '../utils/logger.js';

/**
 * Parsed task from any input format
 */
export interface ParsedTaskInput {
  // Core identification
  id?: string;
  title: string;
  description: string;
  
  // Classification
  type: TaskType;
  priority: TaskPriority;
  
  // Requirements
  acceptanceCriteria: string[];
  technicalDetails: string[];
  
  // Context
  affectedAreas: string[];      // Services, modules, components mentioned
  relatedEntities: string[];    // Classes, methods, endpoints mentioned
  keywords: string[];           // Key technical terms
  
  // Metadata
  sourceFormat: 'text' | 'json' | 'csv' | 'jira' | 'github' | 'markdown';
  confidence: number;           // How confident we are in the parsing
  rawInput: string;
}

export type TaskType = 
  | 'feature'           // New functionality
  | 'bug_fix'           // Fix existing problem
  | 'improvement'       // Enhance existing feature
  | 'refactor'          // Code restructuring
  | 'test'              // Add/fix tests
  | 'documentation'     // Docs work
  | 'investigation'     // Spike/research
  | 'maintenance'       // Tech debt, cleanup
  | 'unknown';

export type TaskPriority = 'critical' | 'high' | 'medium' | 'low' | 'unknown';

/**
 * Task Input Parser
 * Parses any format of task input into a structured format
 */
export class TaskInputParser {
  
  /**
   * Parse any input into structured task
   */
  parse(input: string): ParsedTaskInput {
    logger.info('Parsing task input...');
    
    const trimmedInput = input.trim();
    
    // Detect format and parse accordingly
    if (this.isJSON(trimmedInput)) {
      return this.parseJSON(trimmedInput);
    }
    
    if (this.isCSVRow(trimmedInput)) {
      return this.parseCSV(trimmedInput);
    }
    
    if (this.isJiraFormat(trimmedInput)) {
      return this.parseJiraFormat(trimmedInput);
    }
    
    if (this.isGitHubFormat(trimmedInput)) {
      return this.parseGitHubFormat(trimmedInput);
    }
    
    // Default: parse as free text
    return this.parseFreeText(trimmedInput);
  }

  /**
   * Check if input is JSON
   */
  private isJSON(input: string): boolean {
    try {
      JSON.parse(input);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if input looks like a CSV row
   */
  private isCSVRow(input: string): boolean {
    // Has multiple semicolons or commas as delimiters with consistent pattern
    const semicolonCount = (input.match(/;/g) || []).length;
    const commaCount = (input.match(/,/g) || []).length;
    return semicolonCount > 5 || (commaCount > 5 && input.includes('"'));
  }

  /**
   * Check if input has Jira-like format
   */
  private isJiraFormat(input: string): boolean {
    // Jira patterns: PROJ-123, h1., h2., *As a*, {code}, !image!
    const jiraPatterns = [
      /[A-Z]{2,10}-\d+/,           // Issue key
      /^h[1-6]\.\s/m,              // Headers
      /\*As\s+(a|an|part)/i,       // User story format
      /\{code\}/,                  // Code blocks
      /!\S+\.(png|jpg|gif)!/,      // Images
    ];
    
    return jiraPatterns.some(p => p.test(input));
  }

  /**
   * Check if input has GitHub-like format
   */
  private isGitHubFormat(input: string): boolean {
    // GitHub patterns: #123, ```code```, - [ ], @mentions
    const githubPatterns = [
      /#\d+/,                      // Issue reference
      /```[\s\S]*```/,             // Code blocks
      /- \[(x| )\]/i,              // Checkboxes
      /@[a-z0-9-]+/i,              // Mentions
    ];
    
    return githubPatterns.filter(p => p.test(input)).length >= 2;
  }

  /**
   * Parse JSON input
   */
  private parseJSON(input: string): ParsedTaskInput {
    const data = JSON.parse(input);
    
    return {
      id: data.id || data.taskId || data.key || data.issue_key,
      title: data.title || data.summary || data.name || 'Untitled Task',
      description: data.description || data.body || data.content || '',
      type: this.detectType(data.type || data.issueType || data.description || ''),
      priority: this.normalizePriority(data.priority),
      acceptanceCriteria: this.extractAcceptanceCriteria(data),
      technicalDetails: this.extractTechnicalDetails(data.description || ''),
      affectedAreas: this.extractAffectedAreas(data.description || ''),
      relatedEntities: this.extractRelatedEntities(data.description || ''),
      keywords: this.extractKeywords(data.description || ''),
      sourceFormat: 'json',
      confidence: 90,
      rawInput: input,
    };
  }

  /**
   * Parse CSV row (Jira export format)
   */
  private parseCSV(input: string): ParsedTaskInput {
    // Split by semicolon (Jira export) or detect delimiter
    const delimiter = input.includes(';') ? ';' : ',';
    const parts = this.parseCSVLine(input, delimiter);
    
    // Common Jira CSV structure:
    // Summary;Issue key;Issue id;Parent id;Issue Type;Status;...;Description;...
    const summary = parts[0] || '';
    const issueKey = parts[1] || '';
    const issueType = parts[4] || '';
    const description = this.findLongestPart(parts); // Description is usually longest
    
    return {
      id: issueKey,
      title: summary,
      description: description,
      type: this.detectType(issueType + ' ' + description),
      priority: this.detectPriorityFromText(parts.join(' ')),
      acceptanceCriteria: this.extractAcceptanceCriteriaFromText(description),
      technicalDetails: this.extractTechnicalDetails(description),
      affectedAreas: this.extractAffectedAreas(description),
      relatedEntities: this.extractRelatedEntities(description),
      keywords: this.extractKeywords(description),
      sourceFormat: 'csv',
      confidence: 75,
      rawInput: input,
    };
  }

  /**
   * Parse Jira-formatted text
   */
  private parseJiraFormat(input: string): ParsedTaskInput {
    // Extract issue key if present
    const keyMatch = input.match(/([A-Z]{2,10}-\d+)/);
    const id = keyMatch ? keyMatch[1] : undefined;
    
    // Extract title (first line or h1)
    const titleMatch = input.match(/^h1\.\s*(.+)$/m) || input.match(/^(.+?)[\n;]/);
    const title = titleMatch ? titleMatch[1].trim() : input.substring(0, 100);
    
    // User story detection
    const userStoryMatch = input.match(/\*?As\s+(a|an|part)[^*]+\*?[,.]?\s*\*?I\s+want[^*]+\*?[,.]?\s*\*?so\s+that[^*]+\*?/is);
    
    return {
      id,
      title: title.replace(/^\*+|\*+$/g, '').trim(),
      description: input,
      type: this.detectType(input),
      priority: this.detectPriorityFromText(input),
      acceptanceCriteria: this.extractAcceptanceCriteriaFromText(input),
      technicalDetails: this.extractTechnicalDetails(input),
      affectedAreas: this.extractAffectedAreas(input),
      relatedEntities: this.extractRelatedEntities(input),
      keywords: this.extractKeywords(input),
      sourceFormat: 'jira',
      confidence: 85,
      rawInput: input,
    };
  }

  /**
   * Parse GitHub-formatted text
   */
  private parseGitHubFormat(input: string): ParsedTaskInput {
    // Extract issue number
    const issueMatch = input.match(/#(\d+)/);
    const id = issueMatch ? `#${issueMatch[1]}` : undefined;
    
    // Title is usually first line
    const lines = input.split('\n');
    const title = lines[0].replace(/^#+\s*/, '').trim();
    
    return {
      id,
      title,
      description: input,
      type: this.detectType(input),
      priority: this.detectPriorityFromText(input),
      acceptanceCriteria: this.extractCheckboxItems(input),
      technicalDetails: this.extractTechnicalDetails(input),
      affectedAreas: this.extractAffectedAreas(input),
      relatedEntities: this.extractRelatedEntities(input),
      keywords: this.extractKeywords(input),
      sourceFormat: 'github',
      confidence: 80,
      rawInput: input,
    };
  }

  /**
   * Parse free text input
   */
  private parseFreeText(input: string): ParsedTaskInput {
    const lines = input.split('\n').filter(l => l.trim());
    const title = lines[0]?.substring(0, 200) || 'Task';
    
    return {
      id: undefined,
      title: title,
      description: input,
      type: this.detectType(input),
      priority: this.detectPriorityFromText(input),
      acceptanceCriteria: this.extractAcceptanceCriteriaFromText(input),
      technicalDetails: this.extractTechnicalDetails(input),
      affectedAreas: this.extractAffectedAreas(input),
      relatedEntities: this.extractRelatedEntities(input),
      keywords: this.extractKeywords(input),
      sourceFormat: 'text',
      confidence: 60,
      rawInput: input,
    };
  }

  /**
   * Detect task type from text
   */
  private detectType(text: string): TaskType {
    const lower = text.toLowerCase();
    
    // Bug/defect indicators
    if (/\b(bug|defect|fix|error|issue|problem|broken|doesn'?t work|not working|incorrect|wrong)\b/.test(lower)) {
      return 'bug_fix';
    }
    
    // Feature indicators
    if (/\b(as a|i want|so that|new feature|implement|create|add new|build)\b/.test(lower)) {
      return 'feature';
    }
    
    // Improvement indicators
    if (/\b(improve|enhance|optimize|better|upgrade|update existing)\b/.test(lower)) {
      return 'improvement';
    }
    
    // Refactor indicators
    if (/\b(refactor|restructure|reorganize|clean\s*up|tech debt|migrate)\b/.test(lower)) {
      return 'refactor';
    }
    
    // Test indicators
    if (/\b(test|coverage|e2e|unit test|integration test|spec)\b/.test(lower)) {
      return 'test';
    }
    
    // Documentation indicators
    if (/\b(document|readme|wiki|guide|tutorial)\b/.test(lower)) {
      return 'documentation';
    }
    
    // Investigation indicators
    if (/\b(spike|investigate|research|poc|prototype|evaluate|explore)\b/.test(lower)) {
      return 'investigation';
    }
    
    // Maintenance indicators
    if (/\b(maintenance|cleanup|remove|delete|deprecate)\b/.test(lower)) {
      return 'maintenance';
    }
    
    return 'unknown';
  }

  /**
   * Normalize priority from various formats
   */
  private normalizePriority(priority: string | undefined): TaskPriority {
    if (!priority) return 'unknown';
    
    const lower = priority.toLowerCase();
    
    if (/critical|blocker|p0|urgent|highest/.test(lower)) return 'critical';
    if (/high|important|p1|major/.test(lower)) return 'high';
    if (/medium|normal|p2|moderate/.test(lower)) return 'medium';
    if (/low|minor|p3|trivial|lowest/.test(lower)) return 'low';
    
    return 'unknown';
  }

  /**
   * Detect priority from text content
   * Uses multiple heuristics to infer priority when not explicitly stated
   */
  private detectPriorityFromText(text: string): TaskPriority {
    const lower = text.toLowerCase();

    // Explicit priority keywords (highest confidence)
    if (/\b(critical|blocker|urgent|asap|immediately|production.?down|p0|severity.?1|sev.?1)\b/.test(lower)) {
      return 'critical';
    }
    if (/\b(high.?priority|important|p1|major.?impact|severity.?2|sev.?2|high)\b/.test(lower)) {
      return 'high';
    }
    if (/\b(medium.?priority|normal|standard|p2|moderate|severity.?3|sev.?3)\b/.test(lower)) {
      return 'medium';
    }
    if (/\b(low.?priority|minor|nice.?to.?have|when.?possible|p3|trivial|cosmetic|severity.?4|sev.?4)\b/.test(lower)) {
      return 'low';
    }

    // Context-based inference (medium confidence)
    // Bug fixes affecting core functionality are typically high priority
    const isBugFix = /\b(bug|fix|defect|error|wrong|incorrect|broken)\b/.test(lower);
    const affectsCore = /\b(calculation|payment|order|auth|login|security|data.?loss|crash)\b/.test(lower);
    const affectsCustomer = /\b(customer|user|client|production|live)\b/.test(lower);
    const isBlocking = /\b(block|prevent|cannot|unable|fail|exception)\b/.test(lower);

    if (isBugFix) {
      if (affectsCore && affectsCustomer) return 'critical';
      if (affectsCore || isBlocking) return 'high';
      return 'medium'; // Bug fixes default to medium, not unknown
    }

    // Feature/improvement inference
    const isFeature = /\b(add|implement|create|new|feature|enhance)\b/.test(lower);
    if (isFeature) {
      if (affectsCustomer || /\b(required|must|need)\b/.test(lower)) return 'high';
      return 'medium';
    }

    // Refactor/maintenance is typically lower priority
    if (/\b(refactor|cleanup|technical.?debt|optimize|improve.?code)\b/.test(lower)) {
      return 'low';
    }

    return 'unknown';
  }

  /**
   * Extract acceptance criteria from structured data
   */
  private extractAcceptanceCriteria(data: any): string[] {
    const criteria: string[] = [];
    
    // Direct field
    if (data.acceptanceCriteria) {
      if (Array.isArray(data.acceptanceCriteria)) {
        criteria.push(...data.acceptanceCriteria);
      } else if (typeof data.acceptanceCriteria === 'string') {
        criteria.push(...data.acceptanceCriteria.split('\n').filter((l: string) => l.trim()));
      }
    }
    
    // Checklist format (Jira)
    if (data.checklistItems) {
      criteria.push(...data.checklistItems.map((item: any) => item.name || item));
    }
    
    return criteria;
  }

  /**
   * Extract acceptance criteria from text
   */
  private extractAcceptanceCriteriaFromText(text: string): string[] {
    const criteria: string[] = [];
    
    // Checkbox format: - [ ] or - [x]
    const checkboxes = text.match(/[-*]\s*\[[ x]\]\s*(.+)/gi);
    if (checkboxes) {
      criteria.push(...checkboxes.map(c => c.replace(/[-*]\s*\[[ x]\]\s*/, '').trim()));
    }
    
    // Numbered list after "Acceptance Criteria" header
    const acSection = text.match(/acceptance\s*criteria[:\s]*([\s\S]*?)(?=\n\n|\n#|$)/i);
    if (acSection) {
      const items = acSection[1].match(/^\s*[-*\d.]+\s*(.+)$/gm);
      if (items) {
        criteria.push(...items.map(i => i.replace(/^\s*[-*\d.]+\s*/, '').trim()));
      }
    }
    
    // "Given/When/Then" format
    const gwtMatches = text.match(/\b(given|when|then)\s+.+/gi);
    if (gwtMatches) {
      criteria.push(...gwtMatches);
    }
    
    return [...new Set(criteria)];
  }

  /**
   * Extract checkbox items (GitHub format)
   */
  private extractCheckboxItems(text: string): string[] {
    const items: string[] = [];
    const matches = text.match(/- \[[ x]\] .+/gi);
    if (matches) {
      items.push(...matches.map(m => m.replace(/- \[[ x]\] /, '').trim()));
    }
    return items;
  }

  /**
   * Extract technical details from description
   */
  private extractTechnicalDetails(text: string): string[] {
    const details: string[] = [];
    
    // Code blocks
    const codeBlocks = text.match(/```[\s\S]*?```|`[^`]+`/g);
    if (codeBlocks) {
      details.push(...codeBlocks.slice(0, 5));
    }
    
    // Technical sections
    const techSections = text.match(/(?:details?|technical|implementation|notes?)[:\s]*([\s\S]*?)(?=\n\n|\n#|$)/gi);
    if (techSections) {
      details.push(...techSections.map(s => s.substring(0, 500)));
    }
    
    // API/endpoint mentions
    const apiMatches = text.match(/\b(GET|POST|PUT|DELETE|PATCH)\s+\/\S+/gi);
    if (apiMatches) {
      details.push(...apiMatches);
    }
    
    return details;
  }

  /**
   * Extract affected areas (services, modules, components)
   */
  private extractAffectedAreas(text: string): string[] {
    const areas: string[] = [];
    
    // Service patterns
    const servicePatterns = [
      /\b(\w+[-_]?service)\b/gi,
      /\b(\w+[-_]?api)\b/gi,
      /\b(\w+[-_]?module)\b/gi,
      /\b(\w+[-_]?component)\b/gi,
      /\b(frontend|backend|database|ui|ux)\b/gi,
    ];
    
    for (const pattern of servicePatterns) {
      const matches = text.match(pattern);
      if (matches) {
        areas.push(...matches.map(m => m.toLowerCase()));
      }
    }
    
    return [...new Set(areas)];
  }

  /**
   * Extract related entities (classes, methods, endpoints)
   */
  private extractRelatedEntities(text: string): string[] {
    const entities: string[] = [];
    
    // CamelCase (class/method names)
    const camelCase = text.match(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g);
    if (camelCase) {
      entities.push(...camelCase);
    }
    
    // Method calls: something.method() or ClassName.method()
    const methodCalls = text.match(/\b\w+\.\w+\(\)/g);
    if (methodCalls) {
      entities.push(...methodCalls);
    }
    
    // Backtick code references
    const codeRefs = text.match(/`([^`]+)`/g);
    if (codeRefs) {
      entities.push(...codeRefs.map(r => r.replace(/`/g, '')));
    }
    
    return [...new Set(entities)].slice(0, 20);
  }

  /**
   * Extract keywords from text
   */
  private extractKeywords(text: string): string[] {
    const keywords: string[] = [];
    const lower = text.toLowerCase();
    
    // Technical keywords
    const techKeywords = [
      'api', 'endpoint', 'database', 'query', 'cache', 'authentication',
      'authorization', 'validation', 'error', 'exception', 'log', 'config',
      'deploy', 'build', 'test', 'migration', 'integration', 'performance',
      'security', 'pagination', 'filter', 'sort', 'search', 'export', 'import',
    ];
    
    for (const keyword of techKeywords) {
      if (lower.includes(keyword)) {
        keywords.push(keyword);
      }
    }
    
    // Domain keywords (from context)
    const domainPatterns = text.match(/\b(order|user|product|payment|notification|report|status|date|time)\b/gi);
    if (domainPatterns) {
      keywords.push(...domainPatterns.map(k => k.toLowerCase()));
    }
    
    return [...new Set(keywords)];
  }

  /**
   * Parse CSV line handling quotes
   */
  private parseCSVLine(line: string, delimiter: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === delimiter && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    result.push(current.trim());
    return result;
  }

  /**
   * Find longest part (usually description in CSV)
   */
  private findLongestPart(parts: string[]): string {
    return parts.reduce((a, b) => a.length > b.length ? a : b, '');
  }
}

export default new TaskInputParser();
