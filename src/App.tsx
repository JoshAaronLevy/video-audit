// import { Toast } from 'primereact/toast'
import { Message } from 'primereact/message'
import { Button } from 'primereact/button'
import 'primereact/resources/themes/lara-light-cyan/theme.css'
import 'primereact/resources/primereact.min.css'
import 'primeflex/primeflex.css'
import { AutoCropDialog } from './components/AutoCropDialog'
import { DirectoryInput } from './components/DirectoryInput'
import { FolderBrowserDialog } from './components/FolderBrowserDialog'
import { MigrationResultDialog } from './components/MigrationResultDialog'
import { MigrationScanDialog } from './components/MigrationScanDialog'
import { PremiereExportDialog } from './components/PremiereExportDialog'
import { PremiereStatusBanner } from './components/PremiereStatusBanner'
import { ThumbnailGenerationDialog } from './components/ThumbnailGenerationDialog'
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
    canGenerateThumbnails,
    canImportSelectedToPremiere,
    canRefresh,
    canStartMigration,
    checkPremiereStatus,
    error,
    fileName,
    folderPathInputRef,
    folderPathTestSummary,
    globalFilter,
    handleClearData,
    handleCancelAudit,
    handleCloseMigrationDialog,
    handleCloseMigrationResult,
    handleCloseAutoCropDialog,
    handleCloseFolderBrowserDialog,
    handleCloseGenerateThumbnailsDialog,
    handleClosePremiereExportDialog,
    handleCloseThumbnailResult,
    handleExecuteMigration,
    handleFolderPathSelect,
    handleMigrationNewEditedDirChange,
    handleNewEditedFolderSelect,
    handleOpenAutoCropDialog,
    handleOpenFolderPathTest,
    handleOpenMigrationDialog,
    handleOpenPremiereExportDialog,
    handleOpenGenerateThumbnails,
    handleOpenSelectedFilesAudit,
    handleRefreshData,
    handleSelectNewEditedFolderClick,
    handleStartMigrationScan,
    handleSubmitAutoCrop,
    handleStartThumbnailGeneration,
    handleSubmitPremiereImport,
    handleSubmitPremiereExport,
    handleSelectedFilesSelect,
    handleScanSelectedFolders,
    includeLowResolutionAnalysis,
    includeBlackBorderAnalysis,
    includeSubfolders,
    isAuditActive,
    isAutoCropDialogVisible,
    isAutoCropSubmitting,
    isFolderBrowserDialogVisible,
    isPremiereImportSubmitting,
    isMigrationExecuting,
    isMigrationScanDialogVisible,
    isMigrationScanning,
    isPremiereExportDialogVisible,
    isPremiereExportSubmitting,
    isGeneratingThumbnails,
    isThumbnailDialogVisible,
    isPremiereStatusLoading,
    isPersisted,
    isTableLoading,
    isStorageLoading,
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
    selectedAutoCropVideos,
    selectedVideos,
    selectedFilesInputRef,
    setIncludeLowResolutionAnalysis,
    setIncludeBlackBorderAnalysis,
    setIncludeSubfolders,
    setSelectedPremierePresetId,
    setSelectedVideos,
    setGlobalFilter,
    setShowThumbnails,
    setThumbnailScope,
    showThumbnails,
    thumbnailCandidateRows,
    thumbnailError,
    thumbnailPercent,
    thumbnailProgress,
    thumbnailResult,
    thumbnailScope,
    // toast,
    videoRows,
  } = useVideoAuditController()
  const hasTableSurface = videoRows !== null || isTableLoading || isStorageLoading
  const tableError = hasTableSurface ? error : null

  return (
    <main className={`app-shell ${hasTableSurface ? 'has-data' : ''}`}>
      {/* <Toast ref={toast} position="top-center" /> */}

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
        selectedFilesInputRef={selectedFilesInputRef}
        folderPathTestSummary={folderPathTestSummary}
        includeLowResolutionAnalysis={includeLowResolutionAnalysis}
        includeBlackBorderAnalysis={includeBlackBorderAnalysis}
        includeSubfolders={includeSubfolders}
        isAuditActive={isAuditActive}
        onFolderAuditClick={handleOpenFolderPathTest}
        onFilesAuditClick={handleOpenSelectedFilesAudit}
        onCancelAudit={handleCancelAudit}
        onFolderPathSelect={handleFolderPathSelect}
        onSelectedFilesSelect={handleSelectedFilesSelect}
        onIncludeSubfoldersChange={setIncludeSubfolders}
        onIncludeLowResolutionAnalysisChange={setIncludeLowResolutionAnalysis}
        onIncludeBlackBorderAnalysisChange={setIncludeBlackBorderAnalysis}
        videoRows={isStorageLoading ? [] : videoRows}
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
            canGenerateThumbnails={canGenerateThumbnails}
            canStartMigration={canStartMigration}
            canRefresh={canRefresh}
            fileName={fileName}
            globalFilter={globalFilter}
            isAuditActive={isAuditActive}
            isLoading={isTableLoading || isStorageLoading}
            isGeneratingThumbnails={isGeneratingThumbnails}
            isPersisted={isPersisted}
            onClearData={handleClearData}
            onAutoCropSelectedClick={handleOpenAutoCropDialog}
            onExportToPremiereClick={handleOpenPremiereExportDialog}
            onGenerateThumbnailsClick={handleOpenGenerateThumbnails}
            onMigrateNewEditsClick={handleOpenMigrationDialog}
            onGlobalFilterChange={setGlobalFilter}
            onRefreshData={handleRefreshData}
            onSelectedVideosChange={setSelectedVideos}
            onShowThumbnailsChange={setShowThumbnails}
            selectedVideos={selectedVideos}
            showThumbnails={showThumbnails}
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
        isPremiereImportSubmitting={isPremiereImportSubmitting}
        canImportToPremiere={canImportSelectedToPremiere}
        onHide={handleCloseAutoCropDialog}
        onImportToPremiere={handleSubmitPremiereImport}
        onSubmit={handleSubmitAutoCrop}
        progress={autoCropProgress}
        result={autoCropResult}
        selectedVideos={selectedAutoCropVideos}
        visible={isAutoCropDialogVisible}
      />

      <FolderBrowserDialog
        isAuditActive={isAuditActive}
        onHide={handleCloseFolderBrowserDialog}
        onScanSelectedFolders={handleScanSelectedFolders}
        visible={isFolderBrowserDialogVisible}
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

      <ThumbnailGenerationDialog
        allCount={thumbnailCandidateRows.length}
        error={thumbnailError}
        isGenerating={isGeneratingThumbnails}
        onHide={
          thumbnailResult
            ? handleCloseThumbnailResult
            : handleCloseGenerateThumbnailsDialog
        }
        onScopeChange={setThumbnailScope}
        onStart={handleStartThumbnailGeneration}
        progress={thumbnailProgress}
        result={thumbnailResult}
        selectedCount={selectedVideos.length}
        thumbnailPercent={thumbnailPercent}
        thumbnailScope={thumbnailScope}
        visible={isThumbnailDialogVisible}
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
