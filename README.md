# Task Automation Engine

> Automate 100% of your development workflow - from task to commit-ready code in ~20 minutes

Transform your sprint workflow from **3.5 hours of manual work** to **fully automated delivery** with comprehensive testing, code review, and validation.

## 🎯 Vision

```
Task Input (JSON/Jira)
      ↓
PHASE 0: Setup (2 min)
      ↓
PHASE 1: Analysis (3 min) → xray + testlens
      ↓
PHASE 2: Patterns (1 min)
      ↓
PHASE 3: Implementation (5 min) → AI agent codes feature
      ↓
PHASE 4: Testing (4 min) → AI agent writes tests
      ↓
PHASE 5: Code Review (2 min) → Auto security & performance review
      ↓
PHASE 6: Validation (1 min) → Lint + coverage verification
      ↓
PHASE 7: Finalization (1 min) → Reports + branch staged

═══════════════════════════════════════════════════════
TOTAL: ~19 minutes
OUTPUT: Feature branch ready for commit (not just code!)
═══════════════════════════════════════════════════════
```

## ✨ Key Features

### 🏗️ Three Core Pillars

1. **Analysis Layer** (test-lens integration)
   - `xray`: Understand project architecture, stack, dependencies
   - `testlens`: Extract test patterns and coverage baseline
   - Output: Complete project knowledge before coding

2. **Implementation Layer** (jay-crew integration)
   - Generate specialized crew context for your task
   - FeatureImplementer agent writes production code
   - TestImplementer agent creates comprehensive tests
   - DocImplementer auto-generates documentation
   - Output: Production-ready code with 70%+ coverage

3. **Validation Layer** (Internal agents)
   - Build validation (Maven/Gradle/npm)
   - Test execution & coverage verification
   - Automated code review (anti-patterns, security, performance)
   - Auto-fix issues found
   - Lint validation
   - Output: Zero-issue code ready for team PR

## 🚀 Quick Start

### Installation

```bash
git clone https://github.com/jeferson0306/task-automation-engine.git
cd task-automation-engine
npm install
```

### Usage

#### Phase 1-2 Analysis Only

```bash
npm run phase1 -- --project-path /path/to/your/project --task-id PROJ-123 --task-title "Add JWT Auth"
```

#### Full Workflow (All Phases)

```bash
npm run full -- --task-file task.json
```

Or with CLI options:

```bash
npm run full -- \
  --task-id PROJ-123 \
  --task-title "Add JWT Authentication" \
  --task-desc "Implement JWT with refresh tokens" \
  --accept-criteria "Auth endpoint works, Tokens valid 24h, Secure storage" \
  --project-path /path/to/project
```

#### Task File Format

Create `task.json`:

```json
{
  "taskId": "PROJ-123",
  "title": "Add JWT Authentication",
  "description": "Implement JWT with refresh tokens for 24h expiry",
  "acceptanceCriteria": [
    "Auth endpoint returns JWT token",
    "Tokens valid for 24 hours",
    "Credentials stored securely",
    "Refresh token endpoint working",
    "Tests covering all flows"
  ],
  "estimatedPoints": 8,
  "projectPath": "/path/to/project"
}
```

## 📋 Project Structure

```
task-automation-engine/
├── src/
│   ├── core/
│   │   ├── TaskParser.ts        ← Parse task input
│   │   ├── WorkflowOrchestrator.ts ← Coordinate phases
│   │   ├── ReportGenerator.ts   ← Generate phase reports
│   │   └── types.ts             ← TypeScript interfaces
│   │
│   ├── analyzers/
│   │   ├── ArchitectureAnalyzer.ts   ← Detect project stack
│   │   └── TestPatternsAnalyzer.ts   ← Extract test conventions
│   │
│   ├── validators/               [PHASE 2]
│   │   ├── BuildValidator.ts
│   │   ├── TestValidator.ts
│   │   └── ...
│   │
│   ├── reviewers/                [PHASE 2]
│   │   ├── AutoCodeReviewer.ts
│   │   ├── SecurityReviewer.ts
│   │   └── ...
│   │
│   ├── agents/                   [PHASE 2]
│   │   ├── feature-implementer.md
│   │   ├── test-specialist.md
│   │   └── ...
│   │
│   ├── workflows/
│   │   ├── analysis-workflow.ts  ← Phases 0-2 (DONE)
│   │   ├── implementation-workflow.ts [PHASE 2]
│   │   ├── testing-workflow.ts [PHASE 2]
│   │   └── ...
│   │
│   ├── utils/
│   │   ├── logger.ts
│   │   └── file-utils.ts
│   │
│   └── index.ts                 ← CLI entry point
│
├── config/
│   └── company-patterns.json    ← Your company standards
│
└── package.json
```

## 🔄 Integration with Existing Tools

### test-lens Integration
```typescript
// Phases 1-2 use test-lens skills:
await runXray(projectPath);          // xray skill
await runTestlens(projectPath);      // testlens skill
```

### jay-crew Integration
```typescript
// Phase 3-4 use jay-crew:
const crewContext = await generateCrewContext({
  projectPath,
  task,
  projectAnalysis,   // from xray
  testPatterns,      // from testlens
  persona: 'feature-implementer'
});

const implementation = await agent.implement(crewContext);
```

## 📊 Comparison: Before vs After

| Aspect | Before | After |
|--------|--------|-------|
| **Time** | 3.5 hours | ~20 minutes |
| **Effort** | 6-8 manual steps | 1 command |
| **Code Quality** | Variable | Consistent |
| **Test Coverage** | Often <70% | 70%+ guaranteed |
| **Bugs Found** | In team PR review | Before PR |
| **Docs** | Manual/incomplete | Auto-generated |
| **PR Ready** | No | Yes |

## 🏅 Success Criteria

### Phase 1 Complete (Week 1)
```
✓ Task parsing working
✓ Branch creation working
✓ Project analysis working (detect Java, Spring, Gradle, etc)
✓ Test patterns extracted
✓ All phase reports generated
✓ Time: ~6 minutes
```

### Phase 2-4 Complete (Week 2)
```
✓ Feature implemented by agent
✓ Tests created (70%+ coverage)
✓ Build passing
✓ Documentation updated
✓ Time: ~15 minutes
```

### Phase 5-7 Complete (Week 3-4)
```
✓ Code review issues found
✓ Security issues detected & fixed
✓ Lint passing (0 issues)
✓ Coverage threshold met
✓ Branch staged in git
✓ Ready for: git commit
✓ Time: ~19 minutes total
```

## 🛠️ Configuration

### company-patterns.json

```json
{
  "naming": {
    "className": "PascalCase",
    "methodName": "camelCase",
    "constantName": "UPPER_SNAKE_CASE"
  },
  "structure": {
    "services": "src/main/java/{domain}/service",
    "repositories": "src/main/java/{domain}/repository",
    "tests": "src/test/java/{domain}/**Test.java"
  },
  "testing": {
    "minCoveragePercent": 70,
    "testNamingPattern": "*Test.java"
  },
  "languages": ["Java", "TypeScript", "Python"],
  "buildTools": ["Maven", "Gradle", "npm"]
}
```

## 📝 Generated Reports

Each phase generates a markdown report:

- `task-automation-setup-report.md` - Phase 0 setup details
- `task-automation-analysis-report.md` - Phase 1 project analysis
- `task-automation-patterns-report.md` - Phase 2 detected patterns
- `task-automation-implementation-report.md` - Phase 3 code generation
- `task-automation-testing-report.md` - Phase 4 test results
- `task-automation-review-report.md` - Phase 5 code review findings
- `task-automation-validation-report.md` - Phase 6 lint & coverage
- `task-automation-summary.md` - Complete execution summary

## 🚦 Current Status

### ✅ Phase 1: MVP Complete

- [x] TaskParser - Parse task from JSON/CLI/object
- [x] WorkflowOrchestrator - Coordinate phases, create branches
- [x] ArchitectureAnalyzer - Detect language, build tool, framework
- [x] TestPatternsAnalyzer - Extract test patterns
- [x] ReportGenerator - Generate markdown reports
- [x] CLI commands - Run analysis workflow

### ⏳ Phase 2: Implementation (In Progress)

- [ ] FeatureImplementer agent
- [ ] TestImplementer agent
- [ ] DocImplementer
- [ ] Build validator
- [ ] Test validator

### ⏳ Phase 3: Review & Quality

- [ ] AutoCodeReviewer agent
- [ ] SecurityReviewer agent
- [ ] PerformanceReviewer agent
- [ ] Lint validator
- [ ] Coverage validator

### ⏳ Phase 4: Polish & Deployment

- [ ] Configuration management
- [ ] Jira integration (optional)
- [ ] Slack notifications (optional)
- [ ] Dashboard/HTML reports
- [ ] CI/CD integration (GitHub Actions, etc)

## 🤝 Contributing

This is a personal automation tool, but contributions are welcome!

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/improvement`)
3. Commit your changes (`git commit -am 'Add improvement'`)
4. Push to the branch (`git push origin feature/improvement`)
5. Open a Pull Request

## 📚 Documentation

- `AUTOMATION_FRAMEWORK_PLAN.md` - Complete technical specification
- `ARCHITECTURE_DIAGRAMS.md` - Visual workflows and diagrams
- `NEXT_STEPS.md` - Implementation roadmap
- `SUMMARY.md` - High-level overview

## 🔗 Related Projects

- [test-lens](https://github.com/jeferson0306/test-lens) - Test analysis & improvement
- [jay-crew](https://github.com/jeferson0306/jay-crew) - Multi-agent AI crew for project analysis
- [project-xray](https://github.com/jeferson0306/project-xray) - Architectural analysis CLI

## 📄 License

MIT

## 🎯 Next Steps

```bash
# Install dependencies
npm install

# Run Phase 1-2 analysis on any project
npm run phase1 -- --project-path /path/to/project

# Run full automation (when Phase 3-7 ready)
npm run full -- --task-file task.json

# View logs
cat logs/combined.log
```

---

**Built with ❤️ for faster, better development workflows**
