# Scaling Review Process

This document records the visual and process contract for comprehensive
dashboard scaling work. It is intended to preserve context between iterations
and prevent UI changes from devolving into isolated CSS patches.

## Governing Principle

Visual form is the source of truth. CSS and JavaScript are implementation
tools, not constraints to preserve.

Define the intended visual composition and scaling behavior first. Then choose
or rewrite the CSS, JavaScript layout logic, DOM structure, grid model, sizing
algorithm, and scaling variables needed to express that composition directly.
Do not preserve existing renderer code merely because it already exists.

If an existing implementation prevents a proper layout or scale result, rewrite
that implementation. Do not patch around a poor layout model when the model
itself is wrong.

## Acceptance Hierarchy

Evaluate changes in this order:

1. Visual composition and readability.
2. Correct scaling across card sizes.
3. No overflow, clipping, or overlap.
4. Stable alignment and stable label/value relationships.
5. Shared renderer parity between Hubitat and standalone.
6. Clean, maintainable CSS and JavaScript implementation.

The renderer implementation should serve these goals in this order.

## Card-Level Acceptance Criteria

Every card must satisfy these rules:

- All card content stays inside card boundaries.
- Internal elements do not overlap.
- Graphics and fonts scale smoothly to the practical limit imposed by the
  card's most constraining dimension, whether vertical or horizontal.
- If vertical space is the limiter, typography and graphics scale until
  vertical fit would become unsafe.
- If horizontal space is the limiter, typography and graphics scale until
  horizontal fit would become unsafe.
- Elements must not remain artificially small on large cards unless another
  element, alignment rule, or fit rule would be broken.
- Label/value pairs scale as a unit and remain visually paired.
- Tables and rows keep labels and values close enough to read as pairs.
- Columns use available space without visually disconnecting related elements.
- Outer gutters are intentional and balanced.
- Inter-column gaps are intentional, bounded, and proportional to the content.
- Graphics scale within intentionally sized visual zones. A graphic should not
  be cramped, isolated in excess empty space, or dominant without purpose.
- Any internal rearrangement must be based on available card geometry, not on
  one specific device model or screenshot size.

## Scaling Model

Scaling should be smooth and card-aware. Avoid device-specific constants unless
there is no more general layout rule that can express the required behavior.

Broad layout modes are acceptable when driven by available geometry:

- desktop or wide landscape
- tablet or medium canvas
- mobile portrait or narrow canvas

These modes should be expressed as viewport, card, aspect-ratio, or available
canvas behavior. They should not target one phone, laptop, browser, or device
pixel ratio.

## Label and Data Stability

Labels and data are a visual pair. They should not drift apart simply because a
card has more horizontal space.

Use bounded readable measures for rows and tables. If a row contains only one
label/value pair, prefer an intrinsic pair with a controlled gap over stretching
the two items across a wide container. If a table contains multiple rows, the
table may use justified label/value alignment, but only within a bounded table
width.

Rotating content, such as air quality devices, must keep labels and values
positionally stable between rotations. Content changes should not cause rows,
columns, or key values to jump.

## Rain Card Contract

The rain card is the current proving ground for this process.

The intended composition is three zones:

- a rain drop visual zone
- a primary reading zone containing Rate and Daily
- a secondary metrics table zone

Rain card acceptance criteria:

- The drop grows until bounded by available height or its visual-zone width,
  whichever constrains first.
- The drop zone is sized to the bounded drop. The drop must not sit isolated in
  a much wider track.
- The space to the left of the drop should visually match the space to the
  right of the metrics table.
- The Rate label and value must read as a close pair.
- The Daily value and unit must scale as one primary reading.
- The metrics table must be narrow enough that each label and value read as a
  pair.
- The metrics table should use available vertical space without top-pinning or
  drifting as card size changes.
- The Rate row should not inherit a generic table rule that stretches its label
  and value apart.
- The card should not require manual screenshot-by-screenshot correction for
  obvious spacing errors.

## Required Workflow For UI Scaling Work

Follow this sequence for each card:

1. Define the card's visual composition in words before editing code.
2. Define measurable acceptance criteria for the card.
3. Identify whether the current CSS/JS model can express the intended form.
4. Rewrite the model when it cannot express the form cleanly.
5. Implement the smallest coherent layout change that satisfies the form.
6. Verify in a browser-like render at representative canvas sizes.
7. Add or update automated checks for the visual contract.
8. Rebuild `dashboard/weather-dashboard.js` from source.
9. Run targeted checks and the full suite when shared renderer behavior changes.
10. Before handoff, report what was visually checked, what was measured, and
    what residual subjective risk remains.

Do not present a UI scaling change as finished if the verification only proves
that CSS text exists or that markup renders. The verification must show that the
intended layout wins the cascade and behaves correctly in representative sizes.

## Automated Verification Expectations

Existing DOM and source-string tests are not enough for visual scaling quality.
Future scaling work should add or strengthen browser/geometry checks that
measure actual rendered rectangles.

Useful checks include:

- card content rectangles stay inside card bounds
- no internal element overlap
- left and right gutters are balanced where symmetry is required
- inter-zone gaps stay below defined maximums
- label/value distances stay within readable thresholds
- graphics occupy an acceptable share of their visual zone
- text remains readable and does not wrap unexpectedly
- CSS cascade order allows card-specific rules to win over generic rules

When a defect is found, the regression check should target the actual failure
mode. For example, if a rule exists but is overridden later in the cascade, the
test must check cascade order or computed layout behavior, not only that the
rule text exists.

## Handoff Checklist

Before asking for human review of a visual scaling change, provide:

- affected card or cards
- intended visual composition
- representative sizes checked
- fixture or live payload used
- specific measurements inspected
- tests run
- rebuilt bundle status
- residual visual risk

The goal is to reduce human review burden, not transfer visual QA to the user.
