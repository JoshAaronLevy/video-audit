// import { Toast } from 'primereact/toast'
import { Message } from 'primereact/message'
import { Button } from 'primereact/button'
import 'primereact/resources/themes/lara-light-cyan/theme.css'
import 'primereact/resources/primereact.min.css'
import 'primeflex/primeflex.css'
import { AutoFixDialog } from './components/AutoFixDialog'
import { DirectoryInput } from './components/DirectoryInput'
import { FolderBrowserDialog } from './components/FolderBrowserDialog'
import { MigrationResultDialog } from './components/MigrationResultDialog'
import { MigrationScanDialog } from './components/MigrationScanDialog'
import { PremiereStatusBanner } from './components/PremiereStatusBanner'
import { ThumbnailGenerationDialog } from './components/ThumbnailGenerationDialog'
import { UploadPanel } from './components/UploadPanel'
import { VideoTable } from './components/VideoTable'
import { useVideoAuditController } from './hooks/useVideoAuditController'
import './App.css'

function App() {
  const {
    auditedRootDirectory,
    autoFixDestinationRoot,
    autoFixError,
    autoFixPercent,
    autoFixProgress,
    autoFixResult,
    auditPercent,
    auditProgress,
    canAutoFixSelected,
    canEditSelectedInPremiere,
    canGenerateThumbnails,
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
    handleCloseAutoFixDialog,
    handleCloseMigrationDialog,
    handleCloseMigrationResult,
    handleCloseFolderBrowserDialog,
    handleCloseGenerateThumbnailsDialog,
    handleCloseThumbnailResult,
    handleExecuteMigration,
    handleFolderPathSelect,
    handleMigrationNewEditedDirChange,
    handleNewEditedFolderSelect,
    handleOpenAutoFixDialog,
    handleOpenFolderPathTest,
    handleOpenMigrationDialog,
    handleOpenGenerateThumbnails,
    handleOpenSelectedFilesAudit,
    handleRefreshData,
    handleRemoveVideosFromTable,
    handleRestoreRemovedVideos,
    handleSelectNewEditedFolderClick,
    handleStartMigrationScan,
    handleStartThumbnailGeneration,
    handleSubmitSelectedPremiereImport,
    handleStartAutoFix,
    handleSelectedFilesSelect,
    handleScanSelectedFolders,
    includeLowResolutionAnalysis,
    includeBlackBorderAnalysis,
    includeSubfolders,
    isAuditActive,
    isAutoFixDialogVisible,
    isAutoFixSubmitting,
    isFolderBrowserDialogVisible,
    isMigrationExecuting,
    isMigrationScanDialogVisible,
    isMigrationScanning,
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
    premiereStatus,
    selectedVideos,
    selectedFilesInputRef,
    setIncludeLowResolutionAnalysis,
    setIncludeBlackBorderAnalysis,
    setIncludeSubfolders,
    setAutoFixDestinationRoot,
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
                severity="info"
                raised
                disabled={isAuditActive || isTableLoading || !canRefresh}
                onClick={handleRefreshData}
              />
              <Button
                type="button"
                label="Clear cache"
                severity="danger"
                raised
                onClick={handleClearData}
              />
            </div>
          </div>
        </section>
      ) : (
        hasTableSurface && (
          <VideoTable
            canAutoFixSelected={canAutoFixSelected}
            canEditSelectedInPremiere={canEditSelectedInPremiere}
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
            onAutoFixSelectedClick={handleOpenAutoFixDialog}
            onEditInPremiereClick={handleSubmitSelectedPremiereImport}
            onGenerateThumbnailsClick={handleOpenGenerateThumbnails}
            onMigrateNewEditsClick={handleOpenMigrationDialog}
            onGlobalFilterChange={setGlobalFilter}
            onRemoveVideosClick={handleRemoveVideosFromTable}
            onRefreshData={handleRefreshData}
            onRestoreRemovedVideosClick={handleRestoreRemovedVideos}
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

      <AutoFixDialog
        autoFixPercent={autoFixPercent}
        destinationRoot={autoFixDestinationRoot}
        error={autoFixError}
        isSubmitting={isAutoFixSubmitting}
        onDestinationRootChange={setAutoFixDestinationRoot}
        onHide={handleCloseAutoFixDialog}
        onSubmit={handleStartAutoFix}
        progress={autoFixProgress}
        result={autoFixResult}
        selectedCount={selectedVideos.length}
        visible={isAutoFixDialogVisible}
      />

      <FolderBrowserDialog
        isAuditActive={isAuditActive}
        onHide={handleCloseFolderBrowserDialog}
        onScanSelectedFolders={handleScanSelectedFolders}
        visible={isFolderBrowserDialogVisible}
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
