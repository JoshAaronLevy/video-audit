import { Toast } from 'primereact/toast'
import { Message } from 'primereact/message'
import { Button } from 'primereact/button'
import 'primereact/resources/themes/lara-light-cyan/theme.css'
import 'primereact/resources/primereact.min.css'
import 'primeflex/primeflex.css'
import { PremiereExportDialog } from './components/PremiereExportDialog'
import { PremiereStatusBanner } from './components/PremiereStatusBanner'
import { UploadPanel } from './components/UploadPanel'
import { VideoTable } from './components/VideoTable'
import { useVideoAuditController } from './hooks/useVideoAuditController'
import './App.css'

function App() {
  const {
    auditPercent,
    auditProgress,
    canExportToPremiere,
    canRefresh,
    checkPremiereStatus,
    error,
    fileName,
    folderPathInputRef,
    folderPathTestSummary,
    globalFilter,
    handleClearData,
    handleClosePremiereExportDialog,
    handleFolderPathSelect,
    handleOpenFolderPathTest,
    handleOpenPremiereExportDialog,
    handleRefreshData,
    handleSubmitPremiereExport,
    isAuditActive,
    isAuditVisible,
    isPremiereExportDialogVisible,
    isPremiereExportSubmitting,
    isPremiereStatusLoading,
    isPersisted,
    isTableLoading,
    premiereExportError,
    premierePresets,
    premiereStatus,
    selectedPremierePresetId,
    selectedVideos,
    setSelectedPremierePresetId,
    setSelectedVideos,
    setGlobalFilter,
    toast,
    videoRows,
  } = useVideoAuditController()
  const hasTableSurface = videoRows !== null || isTableLoading
  const tableError = hasTableSurface ? error : null

  return (
    <main className={`app-shell ${hasTableSurface ? 'has-data' : ''}`}>
      <Toast ref={toast} position="top-center" />

      {premiereStatus?.status !== 'ready' && (
        <PremiereStatusBanner
          isLoading={isPremiereStatusLoading}
          onRetry={checkPremiereStatus}
          status={premiereStatus}
        />
      )}

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
            canExportToPremiere={canExportToPremiere}
            canRefresh={canRefresh}
            fileName={fileName}
            globalFilter={globalFilter}
            isAuditActive={isAuditActive}
            isLoading={isTableLoading}
            isPersisted={isPersisted}
            onClearData={handleClearData}
            onExportToPremiereClick={handleOpenPremiereExportDialog}
            onGlobalFilterChange={setGlobalFilter}
            onRefreshData={handleRefreshData}
            onSelectedVideosChange={setSelectedVideos}
            selectedVideos={selectedVideos}
            videoRows={videoRows ?? []}
          />
        )
      )}

      <PremiereExportDialog
        error={premiereExportError}
        isSubmitting={isPremiereExportSubmitting}
        onHide={handleClosePremiereExportDialog}
        onPresetChange={setSelectedPremierePresetId}
        onSubmit={handleSubmitPremiereExport}
        presets={premierePresets}
        selectedCount={selectedVideos.length}
        selectedPresetId={selectedPremierePresetId}
        visible={isPremiereExportDialogVisible}
      />
    </main>
  )
}

export default App
