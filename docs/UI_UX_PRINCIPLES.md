# UI/UX Principles for Front-End Agents

The interface exists to help the user accomplish something, not to explain itself.

## 1. Prefer recognition over reading

Do not use text when an established visual language communicates the same thing more quickly.

Use familiar icons, shapes, colors, placement, spacing, and interaction patterns before adding explanatory labels.

A user should often be able to recognize an action before consciously reading anything.

Examples include:

- ☰ for navigation or menus
- × for close
- ⋮ / ⋯ for additional actions
- ▶ for play
- Ⅱ for pause
- ■ for stop
- 🔍 for search
- trash can for delete
- arrows for navigation, movement, sending, or progression where convention makes the meaning clear
- sparkle-style iconography for AI-assisted actions when that convention is established for the audience

Do not replace a well-understood visual convention with prose.

## 2. Inherit the user's existing visual language

Interfaces do not begin with a blank vocabulary.

Users arrive with years of learned conventions from operating systems, browsers, mobile apps, SaaS products, games, and other interfaces.

Reuse those conventions whenever possible.

Do not make users learn that something means something new when they already know what its conventional equivalent means.

Familiarity is compression.

## 3. Create visual language for recurring product concepts

Not every concept has an established convention.

When the product introduces something new, give it a consistent visual identity and reuse it until the user can recognize it without reading.

A recurring action, object, state, or category should develop a stable combination of iconography, shape, position, typography, or color.

The goal is for repeated use to move the interaction from:

read → understand → act

toward:

recognize → act

## 4. Design around user intent, not available data

Before deciding what belongs on a page, determine why the user is there.

Ask:

> What is the user trying to know, decide, or do right now?

The answer determines the information hierarchy.

Primary information should directly serve that intent.

Primary actions should be immediately visible and easy to reach.

Supporting information should remain available without competing with the primary task.

Internal information used to calculate, derive, or produce an outcome should not automatically become part of the interface.

The fact that the system knows something does not mean the user needs to see it.

## 5. Let the interface mirror the user's mental model

The interface should be organized around how the user understands the task, not how the application's database, API, component tree, or backend architecture happens to be structured.

Two pieces of information may come from entirely different systems but belong together because the user thinks of them as part of the same question.

Likewise, two fields may belong to the same underlying object while serving completely different user intents and therefore deserve separate presentation.

Implementation relationships do not automatically imply interface relationships.

Group by user meaning, not by implementation.

## 6. Group information by semantic purpose

Information and actions that serve the same question, decision, object, or workflow should be perceptually grouped.

Similarity may come from:

- answering the same question,
- describing the same concept,
- participating in the same decision,
- affecting the same object,
- belonging to the same workflow,
- or being repeatedly used together.

Categorically similar information should usually appear together rather than being interleaved with unrelated information.

Separation should communicate conceptual separation.

Grouping should communicate conceptual relationship.

The user should be able to infer structure from proximity before reading labels.

## 7. Keep dependent information adjacent

If information B is necessary to correctly interpret, qualify, or complete information A, place B with A.

Do not make the user search elsewhere for information required to understand what is already in front of them.

Supplementary information should usually appear immediately beneath, beside, or within the component whose meaning it completes.

For example, a result may need:

- a qualification,
- a confidence level,
- a unit,
- a comparison baseline,
- a warning,
- a relevant constraint,
- or an explanation of why the value matters.

If that information changes how the primary value should be interpreted, it belongs nearby.

An answer should be locally complete whenever practical.

## 8. Treat comparison as its own information structure

Normally, preserve semantic grouping.

However, when the user's intent is comparison, the comparison itself becomes the organizing category.

Place the compared objects near each other.

Align equivalent attributes spatially.

Use shared scales, common axes, consistent units, and parallel layouts where appropriate.

Do not force the user to:

inspect A → remember A → navigate to B → reconstruct the comparison mentally

when the interface can perform that cognitive work directly.

Comparison should minimize memory requirements.

## 9. Minimize cognitive joins

Physical separation creates cognitive work.

Every time the user must:

- look somewhere else,
- scroll elsewhere,
- switch tabs,
- open another page,
- remember one value while searching for another,
- or mentally combine information from unrelated regions,

the interface is asking the user to perform a cognitive join.

Perform those joins in the interface whenever doing so preserves clarity.

Information that must be mentally combined should generally be visually related.

Do not make the user reconstruct relationships the system already knows.

## 10. Show outcomes before machinery

Prefer the result that matters to the user over the intermediate information used to produce it.

If an application calculates a recommendation from twenty variables, the interface does not need to expose twenty variables beside the recommendation unless they help the user evaluate, modify, or understand it.

Implementation detail is not automatically user information.

Expose reasoning, provenance, diagnostics, and intermediate state when they are useful—not merely because they exist.

## 11. Visualize relationships instead of describing them

When information is fundamentally spatial, comparative, temporal, proportional, hierarchical, or relational, prefer a visualization that directly expresses that structure.

Use graphs for trends, maps for geography, timelines for chronology, progress indicators for progression, diagrams for relationships, and appropriate visual encodings for comparisons.

Do not then repeat the visualization as a paragraph simply to explain what is already plainly visible.

Text should add information the visualization cannot efficiently convey: interpretation, qualification, exact values, uncertainty, or unusual context.

## 12. Let structure communicate meaning

Position itself is information.

Users learn that certain regions of an interface have particular purposes.

For example, in many desktop SaaS interfaces:

- a persistent left region contains primary navigation,
- the center contains the active workspace,
- a right region contains contextual or secondary information,
- the top region contains global state or actions,
- overlays contain temporary or focused interactions.

Use established spatial expectations instead of labeling every region.

A good layout reduces the amount of explanation required.

## 13. Spend text where ambiguity exceeds familiarity

Icons are not inherently better than words.

Use an icon alone when its meaning is sufficiently established for the intended audience.

Use text when the concept is unfamiliar, ambiguous, consequential, or difficult to represent visually.

Use icon + text when both recognition and precision are valuable, particularly for navigation and important actions.

Over time, the icon provides recognition while the text teaches its meaning.

Do not remove useful text merely to achieve minimalism.

Remove text when the interface already communicates the same information more efficiently.

## 14. Design for the audience's existing literacy

The amount of explanation an interface needs depends on who uses it.

A general consumer application should assume less domain knowledge.

A developer tool can rely on conventions familiar to developers.

A professional editing application can expose denser controls than a casual mobile application.

Do not simplify an interface beyond the user's competence.

Do not explain things the intended audience already understands.

The correct amount of explicitness is audience-dependent.

## 15. Use visual hierarchy to encode importance

Not everything deserves equal visual weight.

Importance should be visible before the user reads.

Use position, size, whitespace, contrast, typography, grouping, shape, and color so that the interface naturally answers:

What should I notice first?

What can I do here?

What is secondary?

What changed?

What requires attention?

A user scanning the page should understand its hierarchy without reading every label.

## 16. Keep semantic cues consistent

A visual property becomes a language only when its meaning is stable.

If red communicates destructive actions, errors, or danger, do not casually use the same red for ordinary decoration.

If a particular shape identifies generated content, reuse that shape.

If one icon represents editing, do not use another icon for the same action elsewhere without reason.

Consistency turns visual details into learned vocabulary.

Inconsistency forces users back into reading and interpretation.

## 17. Never make color carry meaning alone

Color is an extremely fast communication channel, but it should reinforce meaning rather than be its only carrier.

Pair important states with shape, iconography, position, pattern, or another non-color signal.

An error might be red and carry an error icon.

Success might be green and carry a check.

Warnings might use both a distinct color and warning symbol.

Accessibility should preserve visual communication rather than force every distinction back into prose.

## 18. Optimize repeated use, not just first use

The best interface may not be the interface that explains itself most thoroughly on first contact.

Consider how it behaves after the hundredth interaction.

Frequent actions should become recognizable by position, icon, shape, shortcut, and muscle memory.

Avoid repeatedly making experienced users read instructions they already understand.

An interface should become faster as the user becomes familiar with it.

## 19. Reveal complexity when it becomes relevant

Do not display every possible control, explanation, metric, and state simultaneously.

Present what is necessary for the current task and make deeper information available contextually.

Secondary controls can live in menus, expandable regions, inspectors, drawers, detail views, tooltips, or progressive workflows.

Complexity is often necessary.

Simultaneous complexity usually is not.

## 20. Every element must earn its attention

Every visible element consumes some portion of the user's attention.

Text, borders, cards, icons, buttons, labels, colors, animations, dividers, metadata, and empty decoration all compete for perception.

An element should exist because it helps the user:

recognize, understand, decide, navigate, or act.

If removing it leaves those abilities unchanged, it probably does not need to be there.

## 21. Allow hint text only for non-obvious behavior and consequential qualifications

Most hint text should not exist.

Field hints, method notes, section notes, empty-state descriptions, and provenance explanations ("from the server", "canonical", "display copy", "stays in this browser") restate what labels, badges, buttons, and layout already communicate, or describe implementation machinery the user never asked about.

They charge attention on every viewing while teaching only on the first.

Persistent hint text is allowed only in two cases:

1. Non-obvious input behavior the user cannot infer from the control itself,
   and then prefer structure first: an explicit choice (a "No end date"
   checkbox) beats a sentence about leaving a field empty, and a validation
   warning at apply time (debt sign, blocked by `validatePlan` with the same
   message) beats a persistent reminder.
   A hint that duplicates a validation message is always removed.

2. Consequential outcome qualifications that change how a primary value must be read.
   Unpaid amounts are not borrowed, cash above protected balances is not safe to spend, and a first threshold crossing is a milestone rather than sustained coverage qualify.
   Methodology summaries, comparison caveats beyond the like-for-like badge, and validation-scope notes do not: they belong in on-demand evidence, if anywhere.

Blocked-action guidance, pre-commit review notes, and error text are not hints.
They already appear only in the state they describe: the draft-must-save warning shows
only when a draft blocks import, and evidence qualifications show only when viewing that outcome.
If guidance can move closer to the moment it matters, move it there rather than
repeating it persistently.

Never announce a state the structure already shows.
A disabled control, a lock icon, and a status readout together say "read-only";
a sentence saying it again is not information.
Text may only add the recourse the structure does not offer: where to go instead,
what to do instead. "Edit it at the source and import a refreshed plan" stays;
"This record is owned by a read-only source" goes.

Everything else goes:

- no implementation provenance in persistent UI (error and loading states name the failed action only),
- no tutorial paragraphs for staged workflows the buttons already stage (edit → compare → save),
- no empty-state descriptions where the title plus the action button already guides,
- no duplicated warnings in both the editor and the evidence view; keep the single on-demand instance closest to the decision,
- no adjacent duplicates: one fact lives in one place; a count, a status, or an action shown nearby is not shown again.
- no domain jargon as labels: name things the way the user would (confirmed
  vs estimated balances, starting balances, as-of dates), not the way the
  model stores them.

Error messages, read-only locks, destructive-action confirmations, and empty states with no guiding action are not hints; they are state and remain.

## Core Principle

Communicate with the lowest-cost representation that preserves the meaning the user needs.

Prefer:

- recognition over reading,
- structure over explanation,
- visualization over narration,
- outcomes over machinery,
- user meaning over implementation structure,
- proximity over cognitive reconstruction,
- conventions over invention,
- hierarchy over uniformity,
- and progressive disclosure over simultaneous complexity.

Text remains essential where precision, ambiguity, accessibility, or unfamiliar concepts require it.

The objective is not minimal text.

The objective is minimal interpretation effort.

The interface should perform as much organization, comparison, association, and contextualization as it reasonably can so that the user does not have to reconstruct those relationships mentally.
