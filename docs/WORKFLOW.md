# SurfaceTrace Investigation Workflow

```text
START
  |
  v
Confirm authorized scope
  |
  v
Import captured HAR traffic
  |
  v
Map endpoints and inputs
  |
  v
Select an endpoint in the graph
  |
  v
Choose a grounded hypothesis
  |
  v
Lock an imported baseline observation
  |
  v
Declare exactly one changed input
  |
  v
Select the corresponding imported result observation
  |
  v
Compare deterministically
  |
  v
Append experiment and diff evidence
```

## Enforced Rules

1. Scope first: only authorized captured traffic belongs in SurfaceTrace.
2. Baseline lock: every experiment references a known redacted observation.
3. One variable: the server rejects zero or multiple mutation dimensions.
4. Relationship integrity: endpoint, hypothesis, input, baseline, and result must belong together.
5. Deterministic diff: comparison is code-driven and never an AI judgment.
6. Evidence separation: experiment and diff are distinct hash-linked records.
7. No active execution: v1 compares imported observations and does not send requests.

## Sample Experiment

```text
Endpoint:    GET /api/projects/{id}
Hypothesis:  Does the server enforce ownership and role authorization?
Baseline:    imported observation for /api/projects/100
Changed:     path.id from 100 to 200
Result:      imported observation for /api/projects/200
Diff:        response size -2 bytes
State:       different (not "vulnerable")
Evidence:    observation -> experiment -> diff
```

The tester interprets the difference and decides what evidence or authorized investigation should come next.
