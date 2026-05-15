import { useEffect, useMemo, useState } from 'react'
import { Button } from 'primereact/button'
import { Column } from 'primereact/column'
import { Dialog } from 'primereact/dialog'
import { Message } from 'primereact/message'
import { ProgressSpinner } from 'primereact/progressspinner'
import { TreeTable } from 'primereact/treetable'
import {
  defaultVideoRootPath,
  fetchDefaultRootStatus,
  fetchFolderTree,
  formatBytes,
  loadFolderTreeCache,
  saveFolderTreeCache,
} from '../helpers/utils'
import type {
  DefaultRootStatusResponse,
  FolderTreeCache,
  FolderTreeNode,
  FolderTreeResponse,
  FolderTreeWarning,
} from '../types/video'

type TreeSelectionKey = {
  checked?: boolean
  partialChecked?: boolean
}

type TreeSelectionKeys = Record<string, TreeSelectionKey>

type SelectedFolderSummary = {
  selectedFolderCount: number
  selectedVideoCount: number
  selectedSizeBytes: number
}

type FolderBrowserDialogProps = {
  isAuditActive: boolean
  onHide: () => void
  onScanSelectedFolders: (
    selectedFolders: string[],
    summary: SelectedFolderSummary,
  ) => Promise<boolean>
  visible: boolean
}

const unavailableMessage =
  'Default video folder was not found. Make sure the SanDisk SSD is connected.'

const isCheckedSelectionKey = (
  value: TreeSelectionKey | boolean | undefined,
): value is TreeSelectionKey => {
  return Boolean(value && typeof value === 'object' && value.checked === true)
}

const pathDepth = (value: string) => value.split('/').filter(Boolean).length

const isSameOrDescendantPath = (parentPath: string, childPath: string) => {
  const normalizedParent = parentPath.replace(/\/+$/, '')
  const normalizedChild = childPath.replace(/\/+$/, '')

  return (
    normalizedParent === normalizedChild ||
    normalizedChild.startsWith(`${normalizedParent}/`)
  )
}

const flattenTree = (nodes: FolderTreeNode[]): FolderTreeNode[] =>
  nodes.flatMap((node) => [node, ...flattenTree(node.children ?? [])])

const buildNodeMap = (nodes: FolderTreeNode[]) =>
  new Map(flattenTree(nodes).map((node) => [node.key, node]))

const getCheckedPaths = (selectionKeys: TreeSelectionKeys) =>
  Object.entries(selectionKeys)
    .filter(([, value]) => isCheckedSelectionKey(value))
    .map(([key]) => key)

const getEffectiveSelectedPaths = (selectionKeys: TreeSelectionKeys) => {
  const checkedPaths = getCheckedPaths(selectionKeys).sort(
    (left, right) => pathDepth(left) - pathDepth(right) || left.localeCompare(right),
  )
  const effectivePaths: string[] = []

  checkedPaths.forEach((selectedPath) => {
    if (
      effectivePaths.some((ancestorPath) =>
        isSameOrDescendantPath(ancestorPath, selectedPath),
      )
    ) {
      return
    }

    effectivePaths.push(selectedPath)
  })

  return effectivePaths
}

const buildAllSelectionKeys = (nodes: FolderTreeNode[]): TreeSelectionKeys =>
  Object.fromEntries(
    flattenTree(nodes).map((node) => [
      node.key,
      {
        checked: true,
        partialChecked: false,
      },
    ]),
  )

const getExpandedRootKeys = (nodes: FolderTreeNode[]) =>
  Object.fromEntries(nodes.map((node) => [node.key, true]))

const getSelectedSummary = (
  effectivePaths: string[],
  nodeMap: Map<string, FolderTreeNode>,
): SelectedFolderSummary =>
  effectivePaths.reduce(
    (summary, folderPath) => {
      const node = nodeMap.get(folderPath)

      if (!node) {
        return summary
      }

      return {
        selectedFolderCount: summary.selectedFolderCount + 1,
        selectedVideoCount: summary.selectedVideoCount + node.data.videoCount,
        selectedSizeBytes:
          summary.selectedSizeBytes + node.data.totalVideoSizeBytes,
      }
    },
    {
      selectedFolderCount: 0,
      selectedVideoCount: 0,
      selectedSizeBytes: 0,
    },
  )

const toTreeResponseFromCache = (
  cache: FolderTreeCache,
  rootStatus: DefaultRootStatusResponse,
): FolderTreeResponse => ({
  root: {
    path: cache.rootPath,
    name: cache.rootPath.split('/').filter(Boolean).at(-1) ?? 'Edited',
    available: true,
    label: rootStatus.label,
  },
  generatedAt: cache.generatedAt,
  supportedVideoExtensions: cache.supportedVideoExtensions,
  summary: cache.summary,
  nodes: cache.nodes,
  warnings: cache.warnings,
})

const formatTimestamp = (value: string) => {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

const warningText = (warning: FolderTreeWarning) => {
  if (typeof warning === 'string') {
    return warning
  }

  return warning.message || warning.path || warning.type || 'Folder tree warning.'
}

export function FolderBrowserDialog({
  isAuditActive,
  onHide,
  onScanSelectedFolders,
  visible,
}: FolderBrowserDialogProps) {
  const [rootStatus, setRootStatus] =
    useState<DefaultRootStatusResponse | null>(null)
  const [tree, setTree] = useState<FolderTreeResponse | null>(null)
  const [selectionKeys, setSelectionKeys] = useState<TreeSelectionKeys>({})
  const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({})
  const [isCheckingRoot, setIsCheckingRoot] = useState(false)
  const [isLoadingCache, setIsLoadingCache] = useState(false)
  const [isFetchingTree, setIsFetchingTree] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cacheWarning, setCacheWarning] = useState<string | null>(null)
  const [cacheStatus, setCacheStatus] = useState<string | null>(null)

  const nodeMap = useMemo(() => buildNodeMap(tree?.nodes ?? []), [tree])
  const effectiveSelectedPaths = useMemo(
    () => getEffectiveSelectedPaths(selectionKeys),
    [selectionKeys],
  )
  const selectedSummary = useMemo(
    () => getSelectedSummary(effectiveSelectedPaths, nodeMap),
    [effectiveSelectedPaths, nodeMap],
  )
  const rootPath = rootStatus?.defaultRoot || defaultVideoRootPath
  const rootLabel = rootStatus?.label || 'SanDisk Edited Videos'
  const isRootUnavailable = rootStatus?.available === false
  const isBusy = isCheckingRoot || isLoadingCache || isFetchingTree
  const hasTree = Boolean(tree?.nodes.length)
  const handleHide = () => {
    if (!isSubmitting) {
      onHide()
    }
  }

  const applyTree = (nextTree: FolderTreeResponse, fromCache: boolean) => {
    setTree(nextTree)
    setExpandedKeys(getExpandedRootKeys(nextTree.nodes))
    setCacheStatus(
      fromCache
        ? 'Cached folder tree loaded. Refresh if files changed.'
        : 'Folder tree refreshed.',
    )
  }

  const refreshTree = async (nextRootPath = rootPath) => {
    setIsFetchingTree(true)
    setError(null)
    setCacheWarning(null)

    try {
      const freshTree = await fetchFolderTree(nextRootPath)

      applyTree(freshTree, false)
      setSelectionKeys({})

      try {
        await saveFolderTreeCache(freshTree)
      } catch {
        setCacheWarning(
          'Folder tree loaded, but could not be saved to local cache.',
        )
      }
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to load folder tree.',
      )
    } finally {
      setIsFetchingTree(false)
    }
  }

  useEffect(() => {
    if (!visible) {
      return
    }

    let isMounted = true

    const loadTree = async () => {
      setIsCheckingRoot(true)
      setIsLoadingCache(false)
      setError(null)
      setCacheWarning(null)

      try {
        const status = await fetchDefaultRootStatus()

        if (!isMounted) {
          return
        }

        setRootStatus(status)

        if (!status.available) {
          setTree(null)
          setSelectionKeys({})
          setCacheStatus(null)
          setError(status.message || unavailableMessage)
          return
        }

        const nextRootPath = status.defaultRoot || defaultVideoRootPath

        setIsLoadingCache(true)

        try {
          const cachedTree = await loadFolderTreeCache(nextRootPath)

          if (!isMounted) {
            return
          }

          if (cachedTree) {
            applyTree(toTreeResponseFromCache(cachedTree, status), true)
            return
          }
        } catch {
          if (isMounted) {
            setCacheWarning('Could not read the cached folder tree.')
          }
        } finally {
          if (isMounted) {
            setIsLoadingCache(false)
          }
        }

        if (isMounted) {
          await refreshTree(nextRootPath)
        }
      } catch (caughtError) {
        if (!isMounted) {
          return
        }

        setError(
          caughtError instanceof Error
            ? caughtError.message
            : 'Unable to check default video folder.',
        )
      } finally {
        if (isMounted) {
          setIsCheckingRoot(false)
          setIsLoadingCache(false)
        }
      }
    }

    void loadTree()

    return () => {
      isMounted = false
    }
    // Intentionally run when the dialog opens; manual refresh handles freshness.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  const handleScanSelected = async () => {
    if (effectiveSelectedPaths.length === 0) {
      setError('Select at least one folder to scan.')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const started = await onScanSelectedFolders(
        effectiveSelectedPaths,
        selectedSummary,
      )

      if (started) {
        onHide()
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const footer = (
    <div className="folder-browser-actions">
      <Button
        type="button"
        label="Cancel"
        severity="warning"
        raised
        disabled={isSubmitting}
        onClick={onHide}
      />
      <Button
        type="button"
        label="Scan Selected"
        severity="success"
        raised
        disabled={
          isAuditActive ||
          isBusy ||
          isSubmitting ||
          effectiveSelectedPaths.length === 0
        }
        loading={isSubmitting}
        onClick={handleScanSelected}
      />
    </div>
  )

  return (
    <Dialog
      header="Select Folder(s) to Scan"
      visible={visible}
      modal
      draggable={false}
      className="folder-browser-dialog"
      footer={footer}
      onHide={handleHide}
    >
      <div className="folder-browser-content">
        <p>Choose one or more folders to scan from your edited video library.</p>

        <div className="folder-browser-root">
          <span>Default root:</span>
          <strong>{rootLabel}</strong>
          <code>{rootPath}</code>
        </div>

        <div className="folder-browser-summary" aria-live="polite">
          <div>
            <span>Selected folders</span>
            <strong>{selectedSummary.selectedFolderCount.toLocaleString()}</strong>
          </div>
          <div>
            <span>Selected videos</span>
            <strong>{selectedSummary.selectedVideoCount.toLocaleString()}</strong>
          </div>
          <div>
            <span>Selected size</span>
            <strong>{formatBytes(selectedSummary.selectedSizeBytes)}</strong>
          </div>
        </div>

        {tree && (
          <div className="folder-browser-tree-meta">
            <span>
              Tree generated: {formatTimestamp(tree.generatedAt)}
            </span>
            <span>
              {tree.summary.videoCount.toLocaleString()} supported videos across{' '}
              {tree.summary.folderCount.toLocaleString()} folders
            </span>
          </div>
        )}

        {cacheStatus && <Message severity="info" text={cacheStatus} />}
        {cacheWarning && <Message severity="warn" text={cacheWarning} />}
        {error && (
          <Message
            severity={isRootUnavailable ? 'warn' : 'error'}
            text={error}
            role="alert"
          />
        )}

        <div className="folder-browser-toolbar">
          <Button
            type="button"
            label="Refresh Tree"
            severity="info"
            raised
            disabled={isCheckingRoot || isFetchingTree || isRootUnavailable}
            loading={isFetchingTree}
            onClick={() => void refreshTree(rootPath)}
          />
          <Button
            type="button"
            label="Select All"
            severity="success"
            raised
            disabled={!hasTree || isBusy}
            onClick={() => setSelectionKeys(buildAllSelectionKeys(tree?.nodes ?? []))}
          />
          <Button
            type="button"
            label="Clear Selection"
            severity="warning"
            raised
            disabled={Object.keys(selectionKeys).length === 0 || isBusy}
            onClick={() => setSelectionKeys({})}
          />
        </div>

        {isBusy && !hasTree ? (
          <div className="folder-browser-loading" role="status">
            <ProgressSpinner
              strokeWidth="4"
              style={{ width: '32px', height: '32px' }}
            />
            <span>
              {isCheckingRoot
                ? 'Checking default root...'
                : isLoadingCache
                  ? 'Loading cached folder tree...'
                  : 'Fetching folder tree...'}
            </span>
          </div>
        ) : (
          <TreeTable
            value={tree?.nodes ?? []}
            selectionMode="checkbox"
            selectionKeys={selectionKeys}
            expandedKeys={expandedKeys}
            onSelectionChange={(event) =>
              setSelectionKeys((event.value ?? {}) as TreeSelectionKeys)
            }
            onToggle={(event) =>
              setExpandedKeys((event.value ?? {}) as Record<string, boolean>)
            }
            className="folder-tree-table"
            tableStyle={{ minWidth: '720px' }}
            emptyMessage={
              isRootUnavailable
                ? unavailableMessage
                : 'No supported video folders found.'
            }
            scrollable
            scrollHeight="440px"
          >
            <Column
              field="name"
              header="Name"
              expander
              sortable
              body={(node: FolderTreeNode) => (
                <span className="folder-tree-name">{node.data.name}</span>
              )}
            />
            <Column
              field="videoCount"
              header="Videos"
              sortable
              body={(node: FolderTreeNode) =>
                node.data.videoCount.toLocaleString()
              }
              style={{ width: '120px' }}
            />
            <Column
              field="totalVideoSizeBytes"
              header="Size"
              sortable
              body={(node: FolderTreeNode) =>
                formatBytes(node.data.totalVideoSizeBytes)
              }
              style={{ width: '140px' }}
            />
          </TreeTable>
        )}

        {tree && tree.summary.videoCount === 0 && !isBusy && (
          <Message
            severity="warn"
            text="No supported video files were found under the default root."
          />
        )}

        {tree && tree.warnings.length > 0 && (
          <div className="folder-browser-warnings">
            <strong>Warnings</strong>
            <ul>
              {tree.warnings.slice(0, 4).map((warning, index) => (
                <li key={`${warningText(warning)}-${index}`}>
                  {warningText(warning)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Dialog>
  )
}
