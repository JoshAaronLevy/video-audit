import { Button } from 'primereact/button'
import { Dialog } from 'primereact/dialog'
import { Dropdown } from 'primereact/dropdown'
import { Message } from 'primereact/message'
import type { PremierePreset } from '../types/premiere'

type PremiereExportDialogProps = {
  canImportToPremiere: boolean
  error: string | null
  isImportSubmitting: boolean
  isSubmitting: boolean
  onHide: () => void
  onImportToPremiere: () => void
  onPresetChange: (presetId: string | null) => void
  onSubmit: () => void
  presets: PremierePreset[]
  selectedCount: number
  selectedPresetId: string | null
  visible: boolean
}

export function PremiereExportDialog({
  canImportToPremiere,
  error,
  isImportSubmitting,
  isSubmitting,
  onHide,
  onImportToPremiere,
  onPresetChange,
  onSubmit,
  presets,
  selectedCount,
  selectedPresetId,
  visible,
}: PremiereExportDialogProps) {
  const presetOptions = presets.map((preset) => ({
    ...preset,
    disabled: preset.available === false,
    label:
      preset.available === false ? `${preset.label} (preset file missing)` : preset.label,
  }))
  const hasAvailablePresets = presets.some((preset) => preset.available !== false)
  const footer = (
    <div className="premiere-export-dialog-actions">
      <Button
        type="button"
        label="Cancel"
        severity="secondary"
        text
        disabled={isSubmitting || isImportSubmitting}
        onClick={onHide}
      />
      <Button
        type="button"
        label="Edit in Premiere Pro"
        severity="secondary"
        outlined
        disabled={!canImportToPremiere || isSubmitting || isImportSubmitting}
        loading={isImportSubmitting}
        onClick={onImportToPremiere}
      />
      <Button
        type="button"
        label="Queue export"
        disabled={
          !selectedPresetId ||
          !hasAvailablePresets ||
          isSubmitting ||
          isImportSubmitting
        }
        loading={isSubmitting}
        onClick={onSubmit}
      />
    </div>
  )

  return (
    <Dialog
      header="Export to Premiere"
      visible={visible}
      modal
      draggable={false}
      className="premiere-export-dialog"
      footer={footer}
      onHide={onHide}
    >
      <div className="premiere-export-dialog-content">
        <p>
          {selectedCount.toLocaleString()}{' '}
          {selectedCount === 1 ? 'video' : 'videos'} selected
        </p>
        <Dropdown
          value={selectedPresetId}
          options={presetOptions}
          optionLabel="label"
          optionValue="id"
          optionDisabled="disabled"
          placeholder="Choose export preset"
          className="premiere-export-preset"
          disabled={isSubmitting || isImportSubmitting}
          onChange={(event) => onPresetChange(event.value ?? null)}
        />
        <Message
          severity="info"
          text="Edit in Premiere Pro imports the selected files without fixes, sequences, exports, or the Media Encoder queue."
          role="status"
        />
        {!hasAvailablePresets && (
          <Message
            severity="warn"
            text="Add the Adobe .epr preset file to the bridge presets folder before queueing exports."
            className="premiere-export-error"
            role="status"
          />
        )}
        {error && (
          <Message
            severity="error"
            text={error}
            className="premiere-export-error"
            role="alert"
          />
        )}
      </div>
    </Dialog>
  )
}
