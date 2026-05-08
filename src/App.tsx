import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Button } from 'primereact/button'
import { Message } from 'primereact/message'
import { Toast } from 'primereact/toast'
import 'primereact/resources/themes/lara-light-cyan/theme.css'
import 'primereact/resources/primereact.min.css'
import 'primeflex/primeflex.css'
import './App.css'

function App() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const toast = useRef<Toast>(null)
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)

  const openFilePicker = () => {
    fileInputRef.current?.click()
  }

  const handleFileSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0]
    event.target.value = ''

    if (!selectedFile) {
      return
    }

    try {
      setError(null)
      const fileContents = await selectedFile.text()
      const parsedData: unknown = JSON.parse(fileContents)

      if (!Array.isArray(parsedData)) {
        throw new Error('The selected JSON file must contain an array of videos.')
      }

      setFileName(selectedFile.name)
      toast.current?.show({
        severity: 'success',
        summary: 'JSON loaded',
        detail: `${parsedData.length.toLocaleString()} videos found.`,
        life: 4200,
      })
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to load this JSON file.'

      setFileName(null)
      setError(message)
    }
  }

  return (
    <main className="app-shell">
      <Toast ref={toast} position="top-center" />

      <section className="upload-panel" aria-labelledby="upload-heading">
        <p className="eyebrow">Video Audit</p>
        <h1 id="upload-heading">Load a JSON file to view your video table.</h1>
        <p className="subcopy">
          Start by choosing a JSON file that contains an array of video records.
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="file-input"
          onChange={handleFileSelect}
        />

        <Button
          type="button"
          label="Choose JSON file"
          className="upload-button"
          onClick={openFilePicker}
        />

        {fileName && (
          <p className="file-status" aria-live="polite">
            Loaded {fileName}
          </p>
        )}

        {error && (
          <Message
            severity="error"
            text={error}
            className="error-alert"
            role="alert"
          />
        )}
      </section>
    </main>
  )
}

export default App
