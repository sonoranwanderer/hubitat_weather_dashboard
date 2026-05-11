# Agent Instructions

Engineering expectations for this repository:

- Favor tight, performant code. Keep implementations direct, avoid unnecessary abstraction, and consider runtime, memory, and I/O costs when choosing an approach.
- Treat quality assurance as part of the implementation, not a follow-up activity. Each change should leave the test harness stronger when a gap is found.
- Choose tests deliberately. Prefer the smallest relevant harness that proves the changed behavior, then run broader checks when the change touches shared code, cross-module behavior, rendering, build output, or release-sensitive paths.
- Use an architecture-led development cycle. Every change, including a simple bug fix, must start from a concise plan that explains the intended design, affected components, and expected impact.
- Regressions are not acceptable. When fixing a quality failure or defect, add a regression test to the appropriate harness as part of the same fix.
- Keep changes scoped and intentional. If a fix exposes broader architectural risk, document the risk in the plan or pull request rather than hiding it in incidental refactoring.

When the user requests a code change in this git repository:

1. Create a new branch before making changes.
2. Create a concise plan before editing. Include the design approach, affected files or components, expected behavior changes, performance considerations, regression risk, and residual risk.
3. Implement the requested change with tight, performant code.
4. Add or update tests for the change. Any defect, quality failure, or regression fix must include a regression test in the relevant test harness.
5. Run relevant tests or checks. Prefer targeted tests that cover the changed behavior, and run the full suite before pushing when behavior changes, shared code changes, or regression risk is meaningful. For documentation-only changes, run formatting or repository checks when available; full runtime tests are optional unless the change affects workflow instructions.
6. Commit the changes with a clear commit message.
7. Ensure all commits are signed. Do not create unsigned commits.
8. Push the branch.
9. Open a pull request that summarizes the plan, impact, test coverage, and residual risk.
10. Monitor the pull request for code review comments and CI failures.
11. Address all PR code review comments.
12. Resolve every PR review thread whether code changes were made or not.
13. Use follow-up signed commits for comments that require code changes.
14. Re-run relevant checks after fixes.
15. Do not merge the PR unless explicitly asked.
