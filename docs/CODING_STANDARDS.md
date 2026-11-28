Coding Standards
1. Purpose

This document defines the coding standards that must be followed when developing, modifying, reviewing, and maintaining this system.

The objective is to ensure that all code is:

Readable and understandable.
Consistent across the entire project.
Maintainable and reusable.
Testable and reliable.
Secure and efficient.
Easy to extend without introducing unnecessary complexity.

These standards apply to all application code, regardless of programming language or framework.

2. Core Coding Principles

Follow these software engineering principles:

2.1 SOLID

Follow the five SOLID principles:

Single Responsibility Principle: Each class or module should have one primary responsibility.
Open/Closed Principle: Components should support extension without unnecessary modification.
Liskov Substitution Principle: Implementations should honor their parent types and contracts.
Interface Segregation Principle: Prefer small, focused interfaces.
Dependency Inversion Principle: Depend on abstractions instead of concrete implementations.

Refer to SOLID_PRINCIPLES.md for detailed requirements.

2.2 DRY (Don't Repeat Yourself)
Avoid duplicating business logic.
Reuse existing functions, services, and components where appropriate.
Create shared utilities when there is a genuine reuse requirement.
Avoid introducing unnecessary abstractions merely to eliminate small repetitions.
2.3 KISS (Keep It Simple)
Prefer straightforward implementations.
Avoid unnecessary design patterns.
Avoid overly complicated conditional logic.
Write code that other developers can easily understand.
2.4 YAGNI (You Aren't Gonna Need It)
Implement only currently required functionality.
Avoid speculative features.
Do not introduce unnecessary dependencies.
Avoid premature optimization.
2.5 Separation of Concerns

Keep different responsibilities separate.

Where appropriate, separate:

User interface logic.
Business logic.
Data access.
Input validation.
Authentication and authorization.
External service integrations.
3. Naming Conventions

Use meaningful and descriptive names.

General rules:

Variables must describe the data they represent.
Functions must describe the actions they perform.
Classes must describe their responsibilities.
Constants must use the project's established naming convention.
Avoid unclear abbreviations.
Use consistent naming conventions throughout the project.

Follow the naming conventions of the existing programming language and framework.

4. Functions and Methods
Keep functions focused on a single task.
Avoid unnecessarily long functions.
Avoid excessive parameters.
Validate inputs where appropriate.
Return predictable results.
Handle errors explicitly.
Avoid hidden side effects.
Prefer reusable functions when functionality is genuinely shared.
5. Classes and Modules
Keep classes focused on their responsibilities.
Avoid classes that manage unrelated operations.
Use composition where appropriate.
Avoid unnecessary inheritance.
Keep dependencies explicit.
Avoid tightly coupled modules.
6. Error Handling
Handle expected errors explicitly.
Never silently ignore important errors.
Provide meaningful error messages.
Avoid exposing sensitive internal information.
Log errors using the project's established logging mechanism.
Do not use exceptions as a replacement for normal business logic.
7. Code Formatting
Follow the project's established formatter and linter.
Maintain consistent indentation.
Avoid unused variables and imports.
Remove dead code when appropriate.
Keep formatting consistent.
Do not introduce unnecessary formatting changes in unrelated files.
8. Comments and Documentation
Write comments when they explain why something is done.
Avoid comments that merely repeat the code.
Document complex business rules.
Document public APIs and important interfaces.
Update documentation when functionality changes.
9. Dependencies
Reuse existing dependencies when suitable.
Avoid unnecessary packages.
Check compatibility before introducing new dependencies.
Prefer maintained and reputable libraries.
Never introduce a dependency without a clear purpose.
10. Code Modification Rules

When modifying existing code:

Inspect the relevant implementation first.
Understand the existing behavior.
Preserve existing functionality unless a change is required.
Modify only the necessary files.
Avoid unrelated refactoring.
Add or update tests where appropriate.
Verify that the changes do not introduce regressions.
11. AI-Assisted Development Instructions

When using Codex:

Inspect existing code before generating new implementations.
Follow the project's existing conventions.
Apply SOLID, DRY, KISS, and YAGNI where appropriate.
Avoid generating unnecessary files, classes, or abstractions.
Explain significant implementation decisions.
Identify potential technical debt.
Do not assume that more code means better architecture.
12. Final Quality Checklist

Before considering implementation complete, verify:

Code follows established naming conventions.
Responsibilities are properly separated.
No unnecessary code duplication exists.
Error handling is appropriate.
No unnecessary dependencies were introduced.
Existing functionality is preserved.
Relevant tests pass.
Documentation is updated when necessary.
13. Guiding Principle

Write code for the next developer who will maintain it, not only for the developer who initially creates it.

Prioritize clarity, consistency, simplicity, and maintainability.