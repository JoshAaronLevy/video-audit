import { Button } from 'primereact/button'
import { Dialog } from 'primereact/dialog'
import { Dropdown } from 'primereact/dropdown'
import { Message } from 'primereact/message'
import type { PremierePreset } from '../types/premiere'

type PremiereExportDialogProps = {
  error: string | null
  isSubmitting: boolean
  onHide: () => void
  onPresetChange: (presetId: string | null) => void
  onSubmit: () => void
  presets: PremierePreset[]
  selectedCount: number
  selectedPresetId: string | null
  visible: boolean
}

export function PremiereExportDialog({
  error,
  isSubmitting,
  onHide,
  onPresetChange,
  onSubmit,
  presets,
  selectedCount,
  selectedPresetId,
  visible,
}: PremiereExportDialogProps) {
  const footer = (
    <div className="premiere-export-dialog-actions">
      <Button
        type="button"
        label="Cancel"
        severity="secondary"
        text
        disabled={isSubmitting}
        onClick={onHide}
      />
      <Button
        type="button"
        label="Queue export"
        disabled={!selectedPresetId || isSubmitting}
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
          options={presets}
          optionLabel="label"
          optionValue="id"
          placeholder="Choose export preset"
          className="premiere-export-preset"
          disabled={isSubmitting}
          onChange={(event) => onPresetChange(event.value ?? null)}
        />
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
