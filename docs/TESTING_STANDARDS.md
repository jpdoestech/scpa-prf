Testing Standards
1. Purpose

This document defines the testing standards for developing, validating, and maintaining the system.

The objective is to ensure that the system is:

Functionally correct.
Reliable.
Stable.
Secure.
Maintainable.
Resistant to regressions.

Testing must be considered throughout the development lifecycle.

2. Testing Principles
2.1 Test Early
Identify testing requirements during feature development.
Validate business rules before integrating modules.
Avoid postponing all testing until the end.
2.2 Test Important Behavior
Prioritize business-critical functionality.
Test expected and unexpected scenarios.
Verify boundary conditions.
Test invalid inputs.
Test error-handling behavior.
2.3 Keep Tests Maintainable
Write readable tests.
Use meaningful test names.
Avoid unnecessary test duplication.
Keep tests independent where practical.
Avoid tests that depend on execution order.
3. Types of Testing
3.1 Unit Testing

Purpose: Test individual functions, methods, classes, or components.

Requirements:

Test business logic independently.
Cover normal scenarios.
Cover edge cases.
Test invalid inputs.
Mock external dependencies when appropriate.
Keep tests fast and isolated.
3.2 Integration Testing

Purpose: Verify that multiple components work together correctly.

Test interactions involving:

Database operations.
API endpoints.
Service integrations.
Authentication mechanisms.
Module communication.
External dependencies.

Verify that data flows correctly between integrated components.

3.3 End-to-End Testing

Purpose: Verify complete system workflows from the user's perspective.

Examples:

User registration.
User login.
Creating records.
Updating records.
Deleting records.
Processing transactions.
Generating reports.

Test important workflows through the application's actual interfaces.

3.4 Regression Testing

Purpose: Ensure that new changes do not break existing functionality.

Requirements:

Run relevant existing tests after modifications.
Add regression tests for discovered bugs.
Test affected workflows.
Preserve previously working behavior.
3.5 Security Testing

Purpose: Identify security weaknesses.

Where appropriate, test:

Authentication.
Authorization.
Input validation.
Access restrictions.
Session handling.
Sensitive data exposure.
Common application vulnerabilities.
3.6 Performance Testing

Purpose: Evaluate system behavior under expected workloads.

Where appropriate, evaluate:

Response times.
Database query performance.
Resource consumption.
Concurrent requests.
Large data operations.
4. Test Organization
Follow the existing project testing structure.
Keep tests organized by module or feature.
Separate unit, integration, and end-to-end tests where appropriate.
Use descriptive filenames.
Keep test configuration separate from production configuration.
Never run destructive tests against production data.
5. Test Data Management
Use controlled test data.
Avoid depending on real user information.
Isolate test environments.
Reset test data when required.
Avoid modifying production records.
Use fixtures or factories when appropriate.
Keep test credentials separate from production credentials.
6. Test Coverage
Prioritize critical business logic.
Test important application workflows.
Cover error-handling paths.
Cover authorization rules.
Cover important data validation rules.

Do not pursue coverage percentages at the expense of meaningful tests.

A test that executes code without verifying expected behavior provides limited value.

7. Continuous Integration

Where supported by the project:

Run automated tests during code integration.
Run linters and formatters.
Validate builds.
Detect failing tests early.
Prevent known failing checks from being treated as successful.
Keep CI configuration consistent with local development.
8. Bug Fixing and Regression Prevention

When fixing bugs:

Reproduce the issue.
Identify the root cause.
Create a test that demonstrates the failure when practical.
Implement the correction.
Run the relevant test.
Run affected regression tests.
Document important behavior changes.
9. Test Quality Standards

Tests should be:

Deterministic.
Independent.
Readable.
Repeatable.
Focused.
Maintainable.

Avoid:

Tests that rely on arbitrary delays.
Excessive mocking of internal implementation details.
Tests that depend on execution order.
Assertions that do not verify meaningful outcomes.
Tests that require production credentials or production data.
10. AI-Assisted Development Instructions

When using Codex:

Inspect existing test frameworks and conventions.
Identify relevant tests before modifying functionality.
Create or update tests for new and modified behavior.
Test expected and unexpected scenarios.
Run the appropriate test commands.
Investigate failures instead of ignoring them.
Never claim that tests passed unless they were actually executed successfully.
Report tests that could not be executed and explain why.
Avoid changing tests merely to make an incorrect implementation appear successful.
Do not remove existing tests without a valid reason.
11. Testing Completion Checklist
Relevant unit tests are implemented.
Important integration points are tested.
Critical workflows are tested.
Input validation is tested.
Error-handling scenarios are tested.
Authorization rules are tested.
Regression tests are considered.
Tests run successfully.
Failed or skipped tests are reported accurately.
Test data does not affect production.
12. Guiding Principle

A feature is not complete simply because its code has been written.

It must also be validated to ensure that it behaves correctly, handles failures appropriately, and does not break existing functionality.

13. Mobile Keyboard Regression Checks

Follow docs/UI_UX_STANDARDS.md for mobile forms. iPhone XS with Chrome is a standing regression target following the Description-field keyboard obstruction reported on 2026-11-19.
For changed forms/dialogs, verify keyboard opening and dismissal, focus changes between the first/last inputs and multiline textareas, orientation changes, and Save/Close reachability. Typed text and the caret must remain visible above the keyboard and sticky actions.
Automated tests should simulate VisualViewport resize and scroll independently of the layout viewport, retain entered values, and verify listener cleanup. Test the fallback when VisualViewport is unavailable.
Report simulated keyboard geometry separately from a real keyboard on a physical phone. Do not claim physical-device success from a desktop viewport check; identify any pending device retest.
