import { Toast } from 'primereact/toast'
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
    error,
    fileName,
    fileUploadRef,
    folderPathInputRef,
    folderPathTestSummary,
    globalFilter,
    handleClearData,
    handleFileSelect,
    handleFolderPathSelect,
    handleOpenFolderPathTest,
    isAuditActive,
    isAuditVisible,
    isPersisted,
    setGlobalFilter,
    toast,
    videoRows,
  } = useVideoAuditController()

  return (
    <main className={`app-shell ${videoRows ? 'has-data' : ''}`}>
      <Toast ref={toast} position="top-center" />

      <UploadPanel
        auditPercent={auditPercent}
        auditProgress={auditProgress}
        error={error}
        fileUploadRef={fileUploadRef}
        folderPathInputRef={folderPathInputRef}
        folderPathTestSummary={folderPathTestSummary}
        isAuditActive={isAuditActive}
        isAuditVisible={isAuditVisible}
        onFileSelect={handleFileSelect}
        onFolderAuditClick={handleOpenFolderPathTest}
        onFolderPathSelect={handleFolderPathSelect}
        videoRows={videoRows}
      />

      {videoRows && (
        <VideoTable
          fileName={fileName}
          fileUploadRef={fileUploadRef}
          globalFilter={globalFilter}
          isAuditActive={isAuditActive}
          isPersisted={isPersisted}
          onClearData={handleClearData}
          onFileSelect={handleFileSelect}
          onFolderAuditClick={handleOpenFolderPathTest}
          onGlobalFilterChange={setGlobalFilter}
          videoRows={videoRows}
        />
      )}
    </main>
  )
}

export default App
