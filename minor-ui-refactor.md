# Context & Problem

We are working in the `video-audit` Vite + React app.

The app uses a **PrimeReact DataTable** to display audited video records. The table is functionally working, but the UI needs a minor refactor/polish pass.

There are three related UI issues to address:

1. Long file/path values in the table are wrapping and making rows too tall.
2. Table headers are wrapping instead of allowing horizontal scrolling.
3. The UI feels too large overall, especially table headers, row text, button labels, and action areas.

The table row text has already been manually adjusted from `1rem` to `0.8rem`, and that size feels good. Use that as the visual reference point when scaling down related UI elements.

# Goal

Make a focused UI refinement pass for the video audit table and nearby controls.

The goals are:

1. Use PrimeReact DataTable features and props where appropriate.
2. Prevent table headers from wrapping.
3. Prevent key table cell values, especially file names, from wrapping.
4. Allow horizontal scrolling when the table is wider than the viewport/container.
5. Display a shorter, cleaner filename value in the table.
6. Show the full path/filename on hover using a PrimeReact tooltip/popover pattern.
7. Scale down table/header/button/action text so the UI feels denser and less oversized.
8. Keep the existing functionality intact.

# Files To Inspect

Please inspect the existing implementation before changing code.

Likely relevant files:

```txt
src/components/VideoTable.tsx
src/components/*.tsx
src/hooks/useVideoAuditController.ts
src/helpers/utils.ts
src/types/video.ts
src/App.tsx
src/App.css
src/index.css
src/**/*.css
```

Also inspect the current PrimeReact DataTable usage, including:

```tsx
<DataTable />
<Column />
```

Look for current props such as:

```tsx
scrollable
scrollHeight
responsiveLayout
tableStyle
className
size
```

and use the existing component/style patterns where practical.

# PrimeReact DataTable Requirements

The table is definitely a PrimeReact DataTable.

Prioritize PrimeReact-supported approaches where appropriate, including but not limited to:

* `scrollable`
* horizontal scroll-friendly sizing
* `tableStyle`
* `style`
* `className`
* `body` templates for custom cell rendering
* PrimeReact `Tooltip` if already installed/available through PrimeReact

Do not replace PrimeReact DataTable with another table implementation.

# Part 1: Column and Date Field Changes

1. Adjust the datatable so there's no longer a column for Mbps or Borders.
2. The crop column should just show "Yes" or "No" if a video does need to be cropped.
3. Created Date should no longer be used, and instead use the Modified Date field
4. Change the date format from "March 18, 2026" to "03/18/2026"

# Part 2: Table Wrapping / Horizontal Scrolling

Update the table so:

1. Column headers do not wrap.
2. File name cells do not wrap.
3. Long values truncate with ellipsis where appropriate.
4. The table can scroll horizontally instead of forcing wrapping.
5. Existing sorting/filtering/selection/actions continue working.

Use CSS equivalent to:

```css
white-space: nowrap;
overflow: hidden;
text-overflow: ellipsis;
```

for key single-line table values.

Use horizontal scrolling either through PrimeReact DataTable props or a wrapper/container, whichever is cleaner in this codebase.

If a min width is needed, use a reasonable value that fits the current columns, for example:

```tsx
tableStyle={{ minWidth: '1200px' }}
```

or a CSS class equivalent.

Do not blindly force every cell to nowrap if some cells are intentionally better wrapped, such as warnings/details. Prefer targeted nowrap for:

* headers
* file name
* compact metadata columns
* action/status columns

# Part 3: File Name Display Change

Currently, file names/paths are often too long because directory names are included.

Update the file name display logic in the table:

## Desired display behavior

### Modification of extension

Remove the file extension from the displayed filename in the table. The extension is not critical information for the user in this context, and removing it helps reduce visual clutter and long text.

So instead of:

```txt
Born to Run - Live in Denver.mp4
```

it should display:

```txt
Born to Run - Live in Denver
```

**NOTE:** When removing the extension, remove **only** the final file extension. For example:

- `video.mp4` → `video`
- `video.final.export.mp4` → `video.final.export`

Do not remove dots from the base filename or any other part of the filename or path.

### Modification based on file location

If the video file is in the audited root directory, display only the filename:

```txt
Born to Run - Live in Denver
```

If the video file is inside a subdirectory, display:

```txt
../Born to Run - Live in Denver
```

The `../` prefix is just a visual cue that the file lives under a subdirectory. Do **not** display the full directory path in the table cell.

**IMPORTANT:** For this, you will need to treat/use the directory the user selected for auditing as the "root". Otherwise, every file would be considered nested and get the `../` prefix, which would be incorrect. In other words, do not determine nested/root status from the absolute path alone, because every absolute path contains directories. Prefer a reliable row field like `relativePath` if available. A file should be considered nested only when its relative path has one or more directory segments before the filename.

## Hover behavior

When hovering over the file name cell, show the full path or full relative path in a tooltip/popover.

Example table cell:

```txt
../Born to Run - Live in Denver
```

Hover tooltip:

```txt
Music/Bruce Springsteen/Born to Run - Live in Denver.mp4
```

or, if the row contains only absolute path:

```txt
/Volumes/SanDisk SSD/Videos/Edited/Music/Bruce Springsteen/Born to Run - Live in Denver.mp4
```

Use whichever full path value is already reliably available on the row object.

Prefer a PrimeReact `Tooltip` implementation if appropriate.

If PrimeReact `Tooltip` is used, make sure tooltips are not duplicated excessively in a way that causes performance problems for many table rows. A single global tooltip using `data-pr-tooltip` / target class is preferred if that fits PrimeReact’s API.

## Helper function

Add or update a small helper function if needed, for example:

```ts
function getDisplayFileName(row: VideoRow): string {
  // Root file:
  //   relativePath = "Born to Run - Live in Denver.mp4"
  //   display = "Born to Run - Live in Denver"
  //
  // Nested file:
  //   relativePath = "Music/Bruce Springsteen/Born to Run - Live in Denver.mp4"
  //   display = "../Born to Run - Live in Denver"
}
```

Use existing row fields where possible, such as:

* `fileName`
* `relativePath`
* `path`
* `directory`
* whatever the existing model actually provides

Do not change backend data shape for this task.

# Part 4: UI Density / Scaling Down

The UI currently feels too large.

The table row font size has already been manually changed from `1rem` to `0.8rem`, and `0.8rem` feels good. Use that as the visual reference for this pass.

Please inspect the current CSS structure and determine the cleanest way to scale the UI down.

There are two possible approaches:

## Option A — Local component-level scaling

If the oversized feel is isolated to the video table and its nearby controls, keep the change local.

For example:

```css
.video-table {
  font-size: 0.8rem;
}

.video-table .p-datatable-thead > tr > th {
  font-size: 0.8rem;
}

.video-table-actions .p-button {
  font-size: 0.8rem;
}
```

## Option B — Global font-size anchor (Preferable if it fits the existing codebase, or if adding a new global anchor isn't going to involve a large refactor)

If the app has a global root font-size or design-token-like anchor that controls these rem values, consider whether it is cleaner to adjust that global value instead.

If changing a global anchor, reset the table row font-size back to the appropriate relative value so we do not double-scale the UI.

Do **not** blindly change global font sizing if it causes unrelated layout regressions.

## What to scale down

Scale down, consistently and tastefully:

* table row text
* table header text
* DataTable filter text if present
* table action button labels
* nearby toolbar/action area text
* badges/tags only if they look oversized relative to the row text

Do not make the UI tiny or cramped. The current `0.8rem` row text should be the visual anchor.

### Button Label Scaling

Button labels currently feel too large.

Update button styles in the table/action areas so labels visually align with the denser table.

If using PrimeReact buttons, prefer styling through class names and CSS rather than changing every button individually.

For example:

```css
.video-table-actions .p-button {
  font-size: 0.8rem;
  padding-block: 0.35rem;
  padding-inline: 0.65rem;
}
```

Use judgment based on existing styles.

Do not shrink primary app-level buttons outside this table/audit workflow unless they clearly share the same problem.

# Accessibility / Usability

Preserve usability:

* Ellipsized file names should expose the full path on hover.
* If using tooltips, they should be readable and not clipped by the table container.
* Do not remove accessible labels.
* Do not hide important information permanently.
* Preserve keyboard/mouse behavior for row selection and action buttons.

# Constraints

* Do NOT write tests.
* Do NOT change backend code.
* Do NOT modify the Premiere UXP plugin.
* Do NOT replace PrimeReact DataTable.
* Do NOT remove existing sorting/filtering/selection behavior.
* Do NOT remove existing Export to Premiere / Auto-Crop / Migration actions.
* Do NOT do a large design overhaul.
* Keep the change focused and incremental.
* Avoid over-engineering.
* Prefer clear class names and small helper functions over clever abstractions.

# Suggested Implementation Steps

1. Inspect `VideoTable.tsx` and related CSS.
2. Identify the current file name/path fields available on each row.
3. Add a helper to compute the short display filename:
   * root file → `file`
   * nested file → `../file`
4. Update the filename column body template to:
   * render the shortened value
   * apply nowrap/ellipsis styling
   * include tooltip data with the full path
5. Add or update PrimeReact Tooltip usage.
6. Enable/adjust DataTable horizontal scrolling using PrimeReact props and/or wrapper CSS.
7. Add nowrap styling for DataTable headers.
8. Scale down table headers, table cells, filter inputs, and action buttons using the existing `0.8rem` row font size as the reference.
9. Check whether the current `0.8rem` table row change should stay local or be replaced by a cleaner shared/global font-size anchor.
10. Verify the UI still works with sorting, filtering, row selection, and action buttons.

# Expected Result

After this change:

1. File name cells show concise values:
   * `file` for root files
   * `../file` for nested files
2. Hovering the filename shows the full path/relative path.
3. File names stay on one line with ellipsis.
4. Table headers stay on one line.
5. Table columns modified based on requests (removing requested columns)
6. Display value for date fields changed.
7. The table scrolls horizontally instead of wrapping awkwardly.
8. Table text, headers, filters, and button labels feel scaled down consistently around the existing `0.8rem` row text.
9. Existing table behavior remains intact.