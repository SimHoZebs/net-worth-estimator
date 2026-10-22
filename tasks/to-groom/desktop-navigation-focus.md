# Desktop navigation: release focus after the final control

At desktop width `1440`, navigation is non-modal. Its shared drawer still wraps Tab from `Theme · System` to `Waypoint home`, which prevents normal forward keyboard movement into the page.

Apply the drawer's Tab-wrapping code only when its existing `modal` setting is true. Focus-on-open and page inertness already use that distinction.

- Desktop setting: `frontend/src/workspace/WorkspaceLayout.tsx:26-34`.
- Unconditional wrapping: `frontend/src/components/Drawer.tsx:103-156`.
- Final control and tests: `frontend/src/components/ThemeToggle.tsx:19-23`, `frontend/tests/workspace.spec.ts:355-402`.

Add desktop Tab/Shift+Tab boundary tests. Verify that mobile navigation and modal account drawers still contain focus and return it correctly after close. Browser verification remains required because the audit established the source path, not an observed keyboard reproduction.
