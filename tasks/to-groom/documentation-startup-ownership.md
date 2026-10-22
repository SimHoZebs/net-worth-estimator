# Startup documentation: give the command recipe one owner

README, agent instructions, and the frontend guide repeat the same API/frontend startup commands. The audit found exact overlaps of 19, 8, and 4 lines. Command or port changes therefore need synchronized edits.

Make README own the executable recipe. Agent instructions retain the stopped-backup safety rule and a direct link. The frontend guide owns frontend-specific Node/proxy details instead of another startup copy.

- Main overlap: `README.md:45-63`, `AGENTS.md:4-22`.
- Additional overlaps: `README.md:50-57,60-63`, `frontend/RUNNING.md:10-17,21-24`.

Compare commands, paths, and ports after consolidation. Preserve linked headings and the instruction to restore a backup only while its database is stopped. Use the applicable instruction-maintenance workflow for any actual `AGENTS.md` edit.
