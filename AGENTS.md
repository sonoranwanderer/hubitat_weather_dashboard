# Agent Instructions

Engineering expectations for this repository:

- Favor tight, performant code. Keep implementations direct, avoid unnecessary abstraction, and consider runtime, memory, and I/O costs when choosing an approach.
- Treat quality assurance as part of the implementation, not a follow-up activity. Each change should leave the test harness stronger when a gap is found.
- Use an architecture-led development cycle. Every change, including a simple bug fix, must start from a concise plan that explains the intended design, affected components, and expected impact.
- Regressions are not acceptable. When fixing a quality failure or defect, add a regression test to the appropriate harness as part of the same fix.
- Keep changes scoped and intentional. If a fix exposes broader architectural risk, document the risk in the plan or pull request rather than hiding it in incidental refactoring.

When the user requests a code change in this git repository:

1. Create a new branch before making changes.
2. Create a concise plan before editing. Include the design approach, affected files or components, expected behavior changes, performance considerations, and regression risk.
3. Implement the requested change with tight, performant code.
4. Add or update tests for the change. Any defect, quality failure, or regression fix must include a regression test in the relevant test harness.
5. Run relevant tests or checks.
6. Commit the changes with a clear signed commit message. Do not create unsigned commits.
7. Push the branch.
8. Open a pull request that summarizes the plan, impact, test coverage, and residual risk.
9. Monitor the pull request for code review comments and CI failures.
10. Address all PR code review comments.
11. Resolve every PR review thread whether code changes were made or not.
12. Use follow-up signed commits for comments that require code changes.
13. Re-run relevant checks after fixes.
14. Do not merge the PR unless explicitly asked.
