# Audit Progress Time Remaining Plan

## Goal

Show an estimated time remaining next to the elapsed time in the audit progress panel, only for larger scans. The estimate should be useful without adding a fragile or overbuilt timing system.

Recommended display:

```text
Elapsed: 2m 14s | Remaining: about 6m
```

For small scans, do not show the remaining-time text. I recommend using `totalFiles >= 50` as the threshold.

## Current State

The audit progress panel already receives:

- `jobId`
- `status`
- `phase`
- `totalFiles`
- `processedFiles`
- `flaggedCount`
- `errorCount`
- `currentFile`
- a frontend-local elapsed timer

The backend emits progress during:

- `walking`, when the app is discovering videos and may not know the final total yet
- `analyzing`, when `totalFiles` is known and `processedFiles` increments as each video finishes
- `complete`, `error`, and `canceled`

The backend CLI progress bar already shows an ETA through `cli-progress`, but that is only for terminal output. The browser progress API does not currently receive that ETA.

## Recommendation

Use a simple throughput estimate based on completed files over elapsed analyzing time:

```text
secondsPerFile = elapsedAnalyzingSeconds / processedFiles
remainingSeconds = (totalFiles - processedFiles) * secondsPerFile
```

Then smooth the displayed estimate by recalculating only when `processedFiles` changes and only after enough files have completed.

Suggested rules:

- Show nothing if `totalFiles < 50`.
- Show `Remaining: calculating...` while:
  - the scan is still in `walking`, or
  - `processedFiles < 10`, or
  - elapsed analyzing time is under 15 seconds.
- Once eligible, calculate ETA from elapsed time and completed files.
- Update the ETA whenever `processedFiles` changes.
- Let the existing 1-second timer make the displayed remaining time count down between recalculations.
- Clamp remaining time to `0s` when the scan completes.
- Hide remaining time on canceled/error states, or show the last known estimate only if we decide it is useful.

This is intentionally based on real observed scan throughput rather than file size. The audit currently does mixed work per file: metadata reads, ffprobe, and optional black-border analysis. File size alone may not predict this well because codec, duration, file health, and enabled analysis options can matter more than bytes.

## Accuracy Check

To let us evaluate whether this is accurate enough, add a lightweight comparison for the first real estimate.

When the first ETA is calculated, store:

- `estimatedAtElapsedSeconds`
- `estimatedAtProcessedFiles`
- `estimatedRemainingSeconds`
- `estimatedAtTimestampMs`

When the scan completes, calculate:

```text
actualRemainingSeconds = completedAtTimestampMs - estimatedAtTimestampMs
estimateErrorSeconds = actualRemainingSeconds - estimatedRemainingSeconds
estimateErrorPercent = estimateErrorSeconds / actualRemainingSeconds
```

Then show a small completion-only diagnostic in the progress panel, for example:

```text
First estimate: 8m remaining at 10/120 files; actual from then: 9m 12s
```

This can be removed later or hidden behind a debug flag once we trust the method.

## Approach Options

### Option A: Simple Overall Throughput

Use `elapsed / processedFiles` after the first 10 processed files.

Pros:

- Small frontend-only change.
- Uses counters already available to the panel.
- No backend API changes.
- Easy to explain and debug.
- Adapts naturally to the real enabled scan mode.

Cons:

- Early estimates can be wrong if the first files are unusually fast or slow.
- If scan work changes sharply mid-run, the estimate will lag.
- It treats every file as equal, even though some videos take longer than others.

### Option B: Rolling Throughput Window

Track recent progress samples and estimate from the last N completed files, such as the last 10 or 20.

Pros:

- Adapts faster if scan speed changes.
- Less influenced by a strange first batch once the scan is underway.
- Still frontend-only if based on progress events and timestamps.

Cons:

- More moving parts than Option A.
- Can swing around if a few consecutive files are unusually small or large.
- Needs careful handling when progress stalls or files complete in bursts.

### Option C: Blended Overall + Rolling Estimate

Calculate both the overall throughput and a rolling-window throughput, then blend them:

```text
estimatedSecondsPerFile =
  overallSecondsPerFile * 0.7 + rollingSecondsPerFile * 0.3
```

Pros:

- More stable than a pure rolling estimate.
- More adaptive than pure overall throughput.
- Still does not require backend changes.

Cons:

- Harder to reason about.
- The weights are arbitrary unless tuned from real runs.
- Slightly more state to maintain in the component.

### Option D: Backend ETA Using File-Level Timing

Have the backend track each file's start/end time and emit `estimatedRemainingSeconds` in the SSE progress payload.

Pros:

- Centralizes timing near the scan loop.
- Can account for backend phases more cleanly.
- Could later support richer diagnostics by phase or scan mode.

Cons:

- Requires API/type changes.
- More backend/frontend surface area for a display-only feature.
- Still cannot reliably predict per-file scan time without historical data.

### Option E: File-Size Weighted Estimate

Use total bytes and processed bytes to estimate remaining time.

Pros:

- May help if larger files consistently take longer in this environment.
- Could produce better estimates for highly varied file sizes if byte cost dominates.

Cons:

- Requires backend support to expose total bytes and processed bytes.
- File size may be a poor predictor for ffprobe/cropdetect-style work.
- Adds complexity before we have evidence that bytes improve ETA quality.

## Preferred Implementation

I recommend Option A first, with the first-estimate accuracy check.

It is the best tradeoff because it is:

- low-risk
- frontend-only
- easy to verify
- grounded in actual scan speed
- simple to replace later if the comparison shows it is not accurate enough

If the first few real runs show the estimate is too jumpy or too wrong, the next step would be Option C: blend the overall throughput with a rolling estimate from the most recent 10 completed files.

## Implementation Sketch

In `AuditProgressPanel.tsx`:

1. Track when each audit job starts, as it already does for elapsed time.
2. Track when `phase === 'analyzing'` first begins, so walking time does not pollute the per-file scan estimate.
3. Only enable ETA UI when `totalFiles >= 50`.
4. Store the first valid ETA snapshot once `processedFiles >= 10` and analyzing has lasted at least 15 seconds.
5. Recalculate the base ETA whenever `processedFiles` changes.
6. Between progress events, subtract local elapsed seconds from the most recent estimate so it counts down smoothly.
7. On completion, compare the first estimate to actual remaining time and render the diagnostic.

Potential display states:

```text
Elapsed: 0m 42s | Remaining: calculating...
Elapsed: 2m 14s | Remaining: about 6m
Elapsed: 11m 26s | First estimate: 8m remaining at 10/120 files; actual from then: 9m 12s
```

## Open Questions

- Should the completion diagnostic stay visible permanently, or only while we test the feature?
  - Answer: Keep it permanently for now, but make it visually subtle and separate from the main ETA display (right next to it is fine). It can be removed later if we find it is not useful or just adds noise.
- Should ETA include the initial walking/discovery phase, or only the analyzing phase after the final queue size is known?
  - Answer: Only the analyzing phase, since that is when we have a stable `totalFiles` and are doing the work that dominates scan time. The walking phase can be very variable and may not reflect the per-file scan time well. So during that time, we can show "Remaining: calculating..." to set the expectation that we don't have enough data for an estimate yet.
- Should canceled/error states keep the last ETA visible, or hide ETA entirely?
  - Answer: Keep it. It's possible the ETA was the reason for the cancel in the first place, so hiding it would lose that context. We can show the last known estimate as a reference, even if the scan did not complete. It may also help us understand if the ETA was wildly off when we see a cancel.
