import { Toast } from 'primereact/toast'
import { Message } from 'primereact/message'
import { Button } from 'primereact/button'
import 'primereact/resources/themes/lara-light-cyan/theme.css'
import 'primereact/resources/primereact.min.css'
import 'primeflex/primeflex.css'
import { AutoCropDialog } from './components/AutoCropDialog'
import { DirectoryInput } from './components/DirectoryInput'
import { MigrationResultDialog } from './components/MigrationResultDialog'
import { MigrationScanDialog } from './components/MigrationScanDialog'
import { PremiereExportDialog } from './components/PremiereExportDialog'
import { PremiereStatusBanner } from './components/PremiereStatusBanner'
import { UploadPanel } from './components/UploadPanel'
import { VideoTable } from './components/VideoTable'
import { useVideoAuditController } from './hooks/useVideoAuditController'
import './App.css'

function App() {
  const {
    auditedRootDirectory,
    autoCropError,
    autoCropPercent,
    autoCropProgress,
    autoCropResult,
    auditPercent,
    auditProgress,
    canAutoCropSelected,
    canExportToPremiere,
    canRefresh,
    canStartMigration,
    checkPremiereStatus,
    error,
    fileName,
    folderPathInputRef,
    folderPathTestSummary,
    globalFilter,
    handleClearData,
    handleCloseMigrationDialog,
    handleCloseMigrationResult,
    handleCloseAutoCropDialog,
    handleClosePremiereExportDialog,
    handleExecuteMigration,
    handleFolderPathSelect,
    handleMigrationNewEditedDirChange,
    handleNewEditedFolderSelect,
    handleOpenAutoCropDialog,
    handleOpenFolderPathTest,
    handleOpenMigrationDialog,
    handleOpenPremiereExportDialog,
    handleRefreshData,
    handleSelectNewEditedFolderClick,
    handleStartMigrationScan,
    handleSubmitAutoCrop,
    handleSubmitPremiereExport,
    includeLowResolutionAnalysis,
    includeBlackBorderAnalysis,
    isAuditActive,
    isAuditVisible,
    isAutoCropDialogVisible,
    isAutoCropSubmitting,
    isMigrationExecuting,
    isMigrationScanDialogVisible,
    isMigrationScanning,
    isPremiereExportDialogVisible,
    isPremiereExportSubmitting,
    isPremiereStatusLoading,
    isPersisted,
    isTableLoading,
    migrationNewEditedDir,
    migrationPercent,
    migrationProgress,
    migrationResult,
    migrationResultError,
    migrationScan,
    migrationScanError,
    newEditedFolderInputRef,
    premiereExportError,
    premierePresets,
    premiereStatus,
    selectedPremierePresetId,
    selectedVideos,
    setIncludeLowResolutionAnalysis,
    setIncludeBlackBorderAnalysis,
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
        includeLowResolutionAnalysis={includeLowResolutionAnalysis}
        includeBlackBorderAnalysis={includeBlackBorderAnalysis}
        isAuditActive={isAuditActive}
        isAuditVisible={isAuditVisible}
        onFolderAuditClick={handleOpenFolderPathTest}
        onFolderPathSelect={handleFolderPathSelect}
        onIncludeLowResolutionAnalysisChange={setIncludeLowResolutionAnalysis}
        onIncludeBlackBorderAnalysisChange={setIncludeBlackBorderAnalysis}
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
            canAutoCropSelected={canAutoCropSelected}
            canExportToPremiere={canExportToPremiere}
            canStartMigration={canStartMigration}
            canRefresh={canRefresh}
            fileName={fileName}
            globalFilter={globalFilter}
            isAuditActive={isAuditActive}
            isLoading={isTableLoading}
            isPersisted={isPersisted}
            onClearData={handleClearData}
            onAutoCropSelectedClick={handleOpenAutoCropDialog}
            onExportToPremiereClick={handleOpenPremiereExportDialog}
            onMigrateNewEditsClick={handleOpenMigrationDialog}
            onGlobalFilterChange={setGlobalFilter}
            onRefreshData={handleRefreshData}
            onSelectedVideosChange={setSelectedVideos}
            selectedVideos={selectedVideos}
            videoRows={videoRows ?? []}
          />
        )
      )}

      <DirectoryInput
        ref={newEditedFolderInputRef}
        type="file"
        multiple
        webkitdirectory=""
        onChange={handleNewEditedFolderSelect}
        style={{ display: 'none' }}
      />

      <AutoCropDialog
        autoCropPercent={autoCropPercent}
        error={autoCropError}
        isSubmitting={isAutoCropSubmitting}
        onHide={handleCloseAutoCropDialog}
        onSubmit={handleSubmitAutoCrop}
        progress={autoCropProgress}
        result={autoCropResult}
        selectedVideos={selectedVideos}
        visible={isAutoCropDialogVisible}
      />

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

      <MigrationScanDialog
        auditedRootDirectory={auditedRootDirectory}
        error={migrationScanError}
        isExecuting={isMigrationExecuting}
        isScanning={isMigrationScanning}
        migrationPercent={migrationPercent}
        newEditedDir={migrationNewEditedDir}
        onExecute={handleExecuteMigration}
        onHide={handleCloseMigrationDialog}
        onNewEditedDirChange={handleMigrationNewEditedDirChange}
        onSelectFolderClick={handleSelectNewEditedFolderClick}
        onStartScan={handleStartMigrationScan}
        progress={migrationProgress}
        resultError={migrationResultError}
        scan={migrationScan}
        visible={isMigrationScanDialogVisible}
      />

      <MigrationResultDialog
        error={migrationResultError}
        onHide={handleCloseMigrationResult}
        result={migrationResult}
        scan={migrationScan}
        visible={Boolean(migrationResult)}
      />
    </main>
  )
}

export default App
