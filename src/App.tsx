import { Toast } from 'primereact/toast'
import { Message } from 'primereact/message'
import { Button } from 'primereact/button'
import 'primereact/resources/themes/lara-light-cyan/theme.css'
import 'primereact/resources/primereact.min.css'
import 'primeflex/primeflex.css'
import { UploadPanel } from './components/UploadPanel'
import { VideoTable } from './components/VideoTable'
import { useVideoAuditController } from './hooks/useVideoAuditController'
import './App.css'

function App() {
  const {
    auditPercent,
    auditProgress,
    canRefresh,
    error,
    fileName,
    folderPathInputRef,
    folderPathTestSummary,
    globalFilter,
    handleClearData,
    handleFolderPathSelect,
    handleOpenFolderPathTest,
    handleRefreshData,
    isAuditActive,
    isAuditVisible,
    isPersisted,
    isTableLoading,
    setGlobalFilter,
    toast,
    videoRows,
  } = useVideoAuditController()
  const hasTableSurface = videoRows !== null || isTableLoading
  const tableError = hasTableSurface ? error : null

  return (
    <main className={`app-shell ${hasTableSurface ? 'has-data' : ''}`}>
      <Toast ref={toast} position="top-center" />

      <UploadPanel
        auditPercent={auditPercent}
        auditProgress={auditProgress}
        error={hasTableSurface ? null : error}
        folderPathInputRef={folderPathInputRef}
        folderPathTestSummary={folderPathTestSummary}
        isAuditActive={isAuditActive}
        isAuditVisible={isAuditVisible}
        onFolderAuditClick={handleOpenFolderPathTest}
        onFolderPathSelect={handleFolderPathSelect}
        videoRows={videoRows}
      />

      {tableError ? (
        <section className="table-section" aria-label="Audit error">
          <div className="table-error-panel">
            <Message
              severity="error"
              text={tableError}
              className="table-error"
              role="alert"
            />
            <div className="table-actions">
              <Button
                type="button"
                label="Refresh"
                severity="secondary"
                outlined
                disabled={isAuditActive || isTableLoading || !canRefresh}
                onClick={handleRefreshData}
              />
              <Button
                type="button"
                label="Clear cache"
                severity="secondary"
                text
                onClick={handleClearData}
              />
            </div>
          </div>
        </section>
      ) : (
        hasTableSurface && (
          <VideoTable
            canRefresh={canRefresh}
            fileName={fileName}
            globalFilter={globalFilter}
            isAuditActive={isAuditActive}
            isLoading={isTableLoading}
            isPersisted={isPersisted}
            onClearData={handleClearData}
            onGlobalFilterChange={setGlobalFilter}
            onRefreshData={handleRefreshData}
            videoRows={videoRows ?? []}
          />
        )
      )}
    </main>
  )
}

export default App
