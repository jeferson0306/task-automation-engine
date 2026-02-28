# Agent Guide - Task Automation Engine

Complete guide to all agents in the system.

---

## Overview

The Task Automation Engine uses **4 specialized AI agents** to automate the development workflow:

| Agent | Phase | Role | Expertise |
|-------|-------|------|-----------|
| **FeatureImplementer** | 3 | Senior Engineer | Architecture, design patterns, code generation |
| **TestImplementer** | 4 | QA Engineer | Test design, mocking, coverage strategy |
| **SecurityFixer** | 5 | AppSec Engineer | OWASP, vulnerability remediation |
| **DocGenerator** | 6 | Technical Writer | API docs, guides, architecture docs |

---

## 1. FeatureImplementer Agent

**Phase**: 3 (Implementation)  
**Role**: Senior Backend/Frontend Engineer

### Responsibility
Generates complete, production-ready code that implements features based on requirements, architecture, and patterns.

### Input Context
- Task requirements and acceptance criteria
- Project architecture and patterns (language, framework, build tool)
- Existing code samples (naming conventions, folder structure)
- Test patterns and company coding standards
- Dependencies available in project

### Output
- Complete feature implementation
- Error handling and logging
- Documentation (inline comments for complex logic)
- Code following project patterns exactly

### Example Prompt
```
Implement the following feature:

Task ID: PROJ-001
Title: Add JWT Authentication
Description: Implement JWT-based authentication for REST API
Acceptance Criteria:
- [ ] Users can login with email/password
- [ ] JWT token returned on successful login
- [ ] Token valid for 24 hours
- [ ] Endpoints protected with @Authenticated annotation

Project: Java 11 + Spring Boot 2.7.0 + Maven
Detected Patterns:
- Use Spring Security
- Implement in com.company.auth.service package
- Follow existing AuthService structure
- Use bcrypt for password hashing (already in pom.xml)
```

### Constraints
- Must follow detected project patterns **exactly**
- Cannot introduce new dependencies
- Must implement error handling for all paths
- Generated code must be **immediately compilable**

### Configuration
```json
{
  "outputFormat": "CODE_ONLY",
  "codeLanguage": "auto-detect",
  "includeComments": true,
  "errorHandling": "comprehensive",
  "logging": "info-level"
}
```

---

## 2. TestImplementer Agent

**Phase**: 4 (Testing)  
**Role**: QA Automation Engineer

### Responsibility
Generates comprehensive unit and integration tests with high coverage and clarity.

### Input Context
- Implemented feature code
- Test framework, mocking library, assertion library (detected)
- Coverage baseline (usually 70%)
- Existing test samples and conventions
- Acceptance criteria for the feature

### Output
- Complete test suite (unit + integration)
- Descriptive test names
- 70%+ code coverage
- No flaky or time-dependent tests
- Tests are **maintainable and clear**

### Example Test Structure

**Java (JUnit 5 + Mockito + AssertJ)**:
```java
@DisplayName("Feature: JWT Authentication")
class AuthServiceTest {
  @Mock AuthRepository repository;
  @InjectMocks AuthService service;
  
  @Nested
  @DisplayName("Happy Path")
  class HappyPath {
    @Test
    void should_login_successfully_with_valid_credentials() { }
    
    @Test
    void should_return_valid_jwt_token() { }
  }
  
  @Nested
  @DisplayName("Error Cases")
  class ErrorCases {
    @Test
    void should_throw_unauthorized_when_password_invalid() { }
    
    @Test
    void should_throw_not_found_when_user_not_exists() { }
  }
}
```

**TypeScript (Jest + @testing-library)**:
```typescript
describe('AuthService', () => {
  let service: AuthService;
  let repository: jest.Mocked<AuthRepository>;
  
  beforeEach(() => {
    repository = {
      findByEmail: jest.fn(),
      save: jest.fn(),
    };
    service = new AuthService(repository);
  });
  
  describe('Happy Path', () => {
    it('should login successfully with valid credentials', async () => {});
    it('should return valid JWT token', async () => {});
  });
  
  describe('Error Cases', () => {
    it('should throw UnauthorizedError when password invalid', async () => {});
  });
});
```

### Constraints
- Must use **exact** testing framework detected in project
- Must achieve **minimum coverage threshold** (70%)
- Cannot use hardcoded timeouts or random delays
- All external dependencies must be mocked
- Tests must be **deterministic**

### Configuration
```json
{
  "testFramework": "auto-detect",
  "mockingLibrary": "auto-detect",
  "assertionLibrary": "auto-detect",
  "minimumCoverage": 70,
  "testStructure": "nested-describe-blocks",
  "namingConvention": "should_..._when_..."
}
```

---

## 3. SecurityFixer Agent

**Phase**: 5 (Security Review)  
**Role**: Application Security Engineer

### Responsibility
Identifies OWASP vulnerabilities and provides fixes that maintain functionality.

### Vulnerabilities Addressed
- **A01**: Broken Access Control
- **A02**: Cryptographic Failures (weak encryption, hardcoded secrets)
- **A03**: Injection (SQL, command, template)
- **A05**: Broken Authentication
- **A08**: Software/Data Integrity Failures
- And more...

### Output
For each vulnerability:
1. **Severity**: CRITICAL | HIGH | MEDIUM | LOW
2. **Location**: File and line number
3. **OWASP Category**: Reference to OWASP Top 10
4. **Risk**: What can go wrong?
5. **Fix**: Code to remediate
6. **Test**: How to verify fix

### Example Vulnerabilities

**Java**:
```java
// ❌ VULNERABLE: SQL Injection
String query = "SELECT * FROM users WHERE email = '" + email + "'";

// ✅ FIXED: Parameterized query
String query = "SELECT * FROM users WHERE email = ?";
PreparedStatement stmt = connection.prepareStatement(query);
stmt.setString(1, email);
```

**TypeScript**:
```typescript
// ❌ VULNERABLE: Hardcoded credentials
const API_KEY = "sk-1234567890abcdef";

// ✅ FIXED: Environment variable
const API_KEY = process.env.API_KEY;
if (!API_KEY) throw new Error('API_KEY not set');
```

**Python**:
```python
# ❌ VULNERABLE: Unsafe pickle
data = pickle.loads(user_input)

# ✅ FIXED: Use JSON
import json
data = json.loads(user_input)
```

### Constraints
- Must address all **CRITICAL and HIGH** vulnerabilities
- Fixes must **preserve functionality**
- Must follow framework security guidelines
- Cannot weaken existing security controls

---

## 4. DocGenerator Agent

**Phase**: 6 (Documentation)  
**Role**: Technical Writer

### Responsibility
Generates clear, comprehensive documentation for developers.

### Documentation Outputs

1. **README.md**
   - What the feature does
   - Quick start guide
   - Configuration options
   - Links to detailed docs

2. **API_REFERENCE.md**
   - All public functions/endpoints
   - Parameters with types
   - Return values and examples
   - Exceptions that can be thrown

3. **INTEGRATION_GUIDE.md**
   - Step-by-step setup
   - Prerequisites and dependencies
   - Configuration needed
   - Common issues and solutions

4. **TROUBLESHOOTING.md**
   - Common errors and fixes
   - Performance tips
   - FAQ
   - Support contacts

### Example Documentation

```markdown
## AuthService

### Purpose
Handles JWT-based user authentication and token management.

### Usage
\`\`\`java
@Autowired
private AuthService authService;

// Login user
LoginResponse response = authService.login(
  "user@example.com",
  "password123"
);
// Returns: { "token": "eyJhbGc...", "expiresIn": 86400 }
\`\`\`

### Methods

#### login(email: string, password: string) → LoginResponse
Authenticates user with email and password.

**Parameters:**
- `email` (string, required): User email
- `password` (string, required): User password

**Returns:**
```json
{
  "token": "JWT token string",
  "expiresIn": 86400,
  "user": { "id": "...", "email": "..." }
}
```

**Throws:**
- `UnauthorizedError`: Invalid email or password
- `NotFoundException`: User not found

**Example:**
\`\`\`
POST /auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "secret"
}
\`\`\`
```

### Constraints
- Must be **accurate** and match implementation exactly
- Code examples must be **tested and working**
- Must cover all **public APIs**
- Must include troubleshooting section

---

## Agent Orchestration

### How Agents Are Invoked

```
Phase 3: Implementation
└─ FeatureImplementer Agent
   └─ Output: Feature code
   └─ Validated: BuildValidator

Phase 4: Testing
└─ TestImplementer Agent
   └─ Output: Test code
   └─ Validated: TestValidator + CodeCoverageValidator

Phase 5: Security Review
└─ SecurityFixer Agent
   └─ Output: Security fixes + remediation
   └─ Validated: SecurityReviewer

Phase 6: Documentation
└─ DocGenerator Agent
   └─ Output: API docs + guides
   └─ Validated: Manual review
```

### AgentOrchestrator

The `AgentOrchestrator` manages:
- **Agent Registry**: All available agents
- **Request Preparation**: Formats prompt with context
- **Invocation**: Calls AI model with prepared prompt
- **Response Handling**: Parses and validates output
- **Error Management**: Handles failures gracefully

### AI Integration Points

Ready to integrate with:
- **Claude API** (@anthropic-ai/sdk)
- **LangChain** (chainlit integration)
- **OpenAI API**
- **Custom HTTP service**
- **GitHub Copilot Skills**

```typescript
// Example: Direct Claude API integration
const client = new Anthropic();
const response = await client.messages.create({
  model: 'claude-opus-4.6',
  max_tokens: 4096,
  system: agent.systemPrompt,
  messages: [{ role: 'user', content: preparedPrompt }],
});
```

---

## Configuration

### Agent Settings (company-patterns.json)

```json
{
  "agents": {
    "feature-implementer": {
      "enabled": true,
      "model": "claude-opus-4.6",
      "maxTokens": 4096,
      "temperature": 0.3,
      "retries": 2
    },
    "test-implementer": {
      "enabled": true,
      "model": "claude-opus-4.6",
      "maxTokens": 8192,
      "minimumCoverage": 70
    },
    "security-fixer": {
      "enabled": true,
      "model": "claude-opus-4.6",
      "addressCritical": true,
      "addressHigh": true
    },
    "doc-generator": {
      "enabled": true,
      "model": "claude-opus-4.6",
      "language": "en",
      "style": "technical"
    }
  }
}
```

---

## Best Practices

### For Using Agents

1. **Provide Complete Context**
   - Include architecture details
   - Show existing code patterns
   - Clarify acceptance criteria

2. **Validate Output**
   - Compile/run generated code
   - Review tests for coverage
   - Check security fixes for functionality
   - Verify docs for accuracy

3. **Iterate if Needed**
   - If output is incorrect, refine prompt
   - Provide corrected examples
   - Escalate to human review

4. **Track Token Usage**
   - Monitor costs per agent
   - Optimize prompts for brevity
   - Cache common patterns

### For Implementing Agents

1. **System Prompt Design**
   - Clear role definition
   - Specific constraints
   - Output format specification
   - Validation checklist

2. **Context Preparation**
   - Relevant project details
   - Code samples (3-5 files max)
   - Established patterns
   - Any company-specific rules

3. **Response Parsing**
   - Validate output structure
   - Extract code/documentation
   - Check for errors/warnings
   - Save artifacts with metadata

---

## Next Steps

1. **Choose AI Provider**
   - Decision: Claude, OpenAI, LangChain, etc.

2. **Implement AgentOrchestrator.invoke()**
   - Replace `simulateAICall()` with real API call
   - Handle rate limiting and retries
   - Parse structured responses

3. **Test on Real Projects**
   - Run Phase 3-4 workflows
   - Validate generated code/tests
   - Gather feedback

4. **Iterate and Improve**
   - Refine system prompts based on output
   - Add language-specific patterns
   - Optimize context preparation

---

## Additional Resources

- **Agent Definitions**: `src/agents/AgentDefinitions.ts`
- **Orchestrator**: `src/agents/AgentOrchestrator.ts`
- **Implementation Workflow**: `src/workflows/implementation-workflow.ts`
- **Testing Workflow**: `src/workflows/testing-workflow.ts`
- **Technical Spec**: `docs/TECHNICAL_SPECIFICATION.md`

---

**Generated by Task Automation Engine**
