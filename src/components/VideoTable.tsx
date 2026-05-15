import { useMemo, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCircleMinus,
  faEye,
} from '@fortawesome/free-solid-svg-icons'
import { Button } from 'primereact/button'
import { Column } from 'primereact/column'
import { DataTable } from 'primereact/datatable'
import { Dialog } from 'primereact/dialog'
import { Dropdown } from 'primereact/dropdown'
import { FilterMatchMode } from 'primereact/api'
import { InputText } from 'primereact/inputtext'
import { InputSwitch } from 'primereact/inputswitch'
import { MultiSelect } from 'primereact/multiselect'
import { Skeleton } from 'primereact/skeleton'
import { Tooltip } from 'primereact/tooltip'
import { VideoThumbnailPreview } from './VideoThumbnailPreview'
import type { VideoAdjustments, VideoRow, VideoStatus } from '../types/video'
import type {
  VideoPreviewFrame,
  VideoPreviewFrameResult,
} from '../types/video'
import {
  apiBaseUrl,
  formatDate,
  formatDuration,
  formatNumber,
  getBlackBorderCropDisplay,
  getBlackBorderCropStatus,
  getMaxPreviewFrameCount,
  getRowDisplayFile,
  getRowDisplayFileName,
  globalFilterFields,
} from '../helpers/utils'
import type { CropReviewStatus } from '../helpers/utils'

type VideoTableProps = {
  canAutoFixSelected: boolean
  canEditSelectedInPremiere: boolean
  canGenerateThumbnails: boolean
  canStartMigration: boolean
  canRefresh: boolean
  fileName: string | null
  globalFilter: string
  isAuditActive: boolean
  isLoading: boolean
  isPersisted: boolean
  isGeneratingThumbnails: boolean
  onClearData: () => void
  onAutoFixSelectedClick: () => void
  onEditInPremiereClick: () => void
  onGenerateThumbnailsClick: (tableRows: VideoRow[]) => void
  onMigrateNewEditsClick: () => void
  onGlobalFilterChange: (value: string) => void
  onRemoveVideosClick: (videos: VideoRow[]) => void
  onRefreshData: () => void
  onRestoreRemovedVideosClick: () => void
  onSelectedVideosChange: (videos: VideoRow[]) => void
  onShowThumbnailsChange: (showThumbnails: boolean) => void
  selectedVideos: VideoRow[]
  showThumbnails: boolean
  videoRows: VideoRow[]
}

type FilterTemplateOptions<TValue> = {
  value: TValue
  filterApplyCallback: (value?: TValue, index?: number) => void
}

type DurationFilterValue =
  | 'under-5'
  | '5-10'
  | '10-20'
  | '20-30'
  | '30-45'
  | '45-60'
  | 'over-60'

type FileSizeFilterValue =
  | 'very-small'
  | 'small'
  | 'medium'
  | 'large'
  | 'very-large'

type DirectoryFilterValue = string
type CropFilterValue = CropReviewStatus
type FileTypeFilterValue = string
type PreviewFrameFetchMode = 'additional' | 'fresh'

type SelectOption<TValue> = {
  label: string
  value: TValue
}

const rootDirectoryFilterValue = '__root_videos__'

type ActiveVideoFilters = {
  aspectRatio: boolean | null
  crop: CropFilterValue[]
  directory: DirectoryFilterValue[]
  duration: DurationFilterValue[]
  fileSize: FileSizeFilterValue[]
  fileType: FileTypeFilterValue[]
  global: string
  resolution: boolean | null
  status: VideoStatus | null
}

type FilterDimension = keyof ActiveVideoFilters

const loadingRows = Array.from(
  { length: 8 },
  (_, index) => ({ path: `loading-${index}` }) as VideoRow,
)

const resolutionFilterOptions: SelectOption<boolean>[] = [
  { label: 'Low Res', value: true },
  { label: 'High Res', value: false },
]

const aspectRatioFilterOptions: SelectOption<boolean>[] = [
  { label: 'Correct', value: false },
  { label: 'Incorrect', value: true },
]

const durationFilterOptions: SelectOption<DurationFilterValue>[] = [
  { label: 'Under 5 minutes', value: 'under-5' },
  { label: '5-10 minutes', value: '5-10' },
  { label: '10-20 minutes', value: '10-20' },
  { label: '20-30 minutes', value: '20-30' },
  { label: '30-45 minutes', value: '30-45' },
  { label: '45-60 minutes', value: '45-60' },
  { label: 'Over 60 minutes', value: 'over-60' },
]

const fileSizeFilterOptions: SelectOption<FileSizeFilterValue>[] = [
  { label: '0-99 MB', value: 'very-small' },
  { label: '100-249 MB', value: 'small' },
  { label: '250-499 MB', value: 'medium' },
  { label: '500-749 MB', value: 'large' },
  { label: '750+ MB', value: 'very-large' },
]

const statusFilterOptions: SelectOption<VideoStatus>[] = [
  { label: 'Pending', value: 'Pending' },
  { label: 'Queued', value: 'Queued' },
  { label: 'Completed', value: 'Completed' },
  { label: 'Dismissed', value: 'Dismissed' },
]

const cropFilterOptions: SelectOption<CropFilterValue>[] = [
  { label: 'Auto', value: 'Auto' },
  { label: 'Review', value: 'Review' },
  { label: 'No', value: 'No' },
  { label: 'Uncertain', value: 'Uncertain' },
  { label: 'Error', value: 'Error' },
]

const formatRoundedMegabytes = (value: number | null) =>
  value === null ? '' : `${Math.round(value).toLocaleString()}MB`

const formatSelectedVideoSize = (sizeMB: number) => {
  if (sizeMB > 999) {
    return `${formatNumber(sizeMB / 1024, 2)} GB`
  }

  return `${Math.round(sizeMB).toLocaleString()} MB`
}

const isFileSizeInRange = (
  sizeMB: number | null,
  range: FileSizeFilterValue,
) => {
  if (sizeMB === null) {
    return false
  }

  const roundedSizeMB = Math.round(sizeMB)

  switch (range) {
    case 'very-small':
      return roundedSizeMB < 100
    case 'small':
      return roundedSizeMB >= 100 && roundedSizeMB < 250
    case 'medium':
      return roundedSizeMB >= 250 && roundedSizeMB < 500
    case 'large':
      return roundedSizeMB >= 500 && roundedSizeMB < 750
    case 'very-large':
      return roundedSizeMB >= 750
  }
}

const fileSizeFilterFunction = (
  value: number | null,
  filter: FileSizeFilterValue[] | null,
) => {
  if (!filter || filter.length === 0) {
    return true
  }

  return filter.some((range) => isFileSizeInRange(value, range))
}

const getFileTypeLabel = (row: VideoRow) =>
  row.fileType || row.fileExtension?.replace(/^\./, '').toUpperCase() || ''

const getThumbnailSrc = (url: string) =>
  url.startsWith('/api/') ? `${apiBaseUrl}${url}` : url

const getPreviewFrameKey = (frame: VideoPreviewFrame) =>
  `${frame.batchId}:${frame.index}:${frame.thumbnail.url ?? frame.timestampSeconds}`

const getGeneratedPreviewFrames = (result?: VideoPreviewFrameResult) =>
  (result?.frames ?? []).filter(
    (frame) => frame.thumbnail.generated === true && Boolean(frame.thumbnail.url),
  )

const getRowPreviewFrameResult = (
  row: VideoRow | null,
): VideoPreviewFrameResult | undefined => {
  if (!row?.previewFrames || row.previewFrames.length === 0) {
    return undefined
  }

  return {
    durationSeconds: row.durationSeconds,
    maxPreviewFrameCount:
      row.maxPreviewFrameCount ?? getMaxPreviewFrameCount(row.durationSeconds),
    mode: 'additional',
    batchId: row.previewFrameBatchId ?? 'default',
    summary: {
      requested: row.previewFrames.length,
      existing: row.previewFrames.length,
      generated: 0,
      cached: row.previewFrames.length,
      failed: row.previewFrames.filter(
        (frame) => frame.thumbnail.generated !== true,
      ).length,
      returned: row.previewFrames.length,
    },
    frames: row.previewFrames,
  }
}

const toPreviewFrameRequestVideo = (row: VideoRow) => {
  const modifiedAtMs = row.modifiedAt ? Date.parse(row.modifiedAt) : null

  return {
    id: row.path,
    fileName: row.fileName,
    path: row.path,
    absolutePath: row.path,
    durationSeconds: row.durationSeconds ?? undefined,
    sizeBytes: row.sizeBytes ?? row.fileSystemSizeBytes ?? undefined,
    modifiedAtMs: Number.isFinite(modifiedAtMs) ? modifiedAtMs : undefined,
  }
}

const getTopLevelDirectory = (displayDirectory: string) =>
  displayDirectory.split(/[\\/]+/).filter(Boolean)[0] ?? ''

const buildDirectoryFilterOptions = (
  rows: VideoRow[],
): SelectOption<DirectoryFilterValue>[] => {
  const directoryCounts = new Map<DirectoryFilterValue, number>()
  let rootVideoCount = 0

  rows.forEach((row) => {
    const directory = getTopLevelDirectory(row.displayDirectory)

    if (!directory) {
      rootVideoCount += 1
      return
    }

    directoryCounts.set(directory, (directoryCounts.get(directory) ?? 0) + 1)
  })

  const directoryOptions = Array.from(directoryCounts.entries())
    .sort(
      ([firstDirectory, firstCount], [secondDirectory, secondCount]) =>
        secondCount - firstCount ||
        firstDirectory.localeCompare(secondDirectory),
    )
    .map(([directory, count]) => ({
      label: `${directory} (${count.toLocaleString()})`,
      value: directory,
    }))

  return [
    {
      label: `Root Videos (${rootVideoCount.toLocaleString()})`,
      value: rootDirectoryFilterValue,
    },
    ...directoryOptions,
  ]
}

const matchesGlobalFilter = (row: VideoRow, filter: string) => {
  const normalizedFilter = filter.trim().toLowerCase()

  if (!normalizedFilter) {
    return true
  }

  return globalFilterFields.some((field) =>
    String(row[field]).toLowerCase().includes(normalizedFilter),
  )
}

const isDurationInRange = (
  durationSeconds: number | null,
  range: DurationFilterValue,
) => {
  if (durationSeconds === null) {
    return false
  }

  const durationMinutes = durationSeconds / 60

  switch (range) {
    case 'under-5':
      return durationMinutes < 5
    case '5-10':
      return durationMinutes >= 5 && durationMinutes < 10
    case '10-20':
      return durationMinutes >= 10 && durationMinutes < 20
    case '20-30':
      return durationMinutes >= 20 && durationMinutes < 30
    case '30-45':
      return durationMinutes >= 30 && durationMinutes < 45
    case '45-60':
      return durationMinutes >= 45 && durationMinutes < 60
    case 'over-60':
      return durationMinutes >= 60
  }
}

const durationFilterFunction = (
  value: number | null,
  filter: DurationFilterValue[] | null,
) => {
  if (!filter || filter.length === 0) {
    return true
  }

  return filter.some((range) => isDurationInRange(value, range))
}

const directoryFilterFunction = (
  value: string | null,
  filter: DirectoryFilterValue[] | null,
) => {
  if (!filter || filter.length === 0) {
    return true
  }

  const displayDirectory = value ?? ''

  return filter.some((directory) => {
    if (directory === rootDirectoryFilterValue) {
      return displayDirectory === ''
    }

    return displayDirectory.includes(directory)
  })
}

const fileTypeFilterFunction = (
  value: string | null,
  filter: FileTypeFilterValue[] | null,
) => {
  if (!filter || filter.length === 0) {
    return true
  }

  return filter.includes((value ?? '').toUpperCase())
}

const getCropFilterValue = (
  adjustments: VideoAdjustments | undefined,
): CropFilterValue => getBlackBorderCropStatus(adjustments)

const cropFilterFunction = (
  value: VideoAdjustments | null | undefined,
  filter: CropFilterValue[] | null,
) => {
  if (!filter || filter.length === 0) {
    return true
  }

  return filter.includes(getCropFilterValue(value ?? undefined))
}

const matchesVideoFilters = (
  row: VideoRow,
  filters: ActiveVideoFilters,
  excludedDimension?: FilterDimension,
) =>
  (excludedDimension === 'global' ||
    matchesGlobalFilter(row, filters.global)) &&
  (excludedDimension === 'directory' ||
    directoryFilterFunction(row.displayDirectory, filters.directory)) &&
  (excludedDimension === 'fileSize' ||
    fileSizeFilterFunction(row.sizeMB, filters.fileSize)) &&
  (excludedDimension === 'fileType' ||
    fileTypeFilterFunction(getFileTypeLabel(row), filters.fileType)) &&
  (excludedDimension === 'duration' ||
    durationFilterFunction(row.durationSeconds, filters.duration)) &&
  (excludedDimension === 'resolution' ||
    filters.resolution === null ||
    row.isLowResolution === filters.resolution) &&
  (excludedDimension === 'aspectRatio' ||
    filters.aspectRatio === null ||
    row.isWrongAspectRatio === filters.aspectRatio) &&
  (excludedDimension === 'crop' ||
    cropFilterFunction(row.adjustments, filters.crop)) &&
  (excludedDimension === 'status' ||
    filters.status === null ||
    row.status === filters.status)

const getVisibleVideoCount = (rows: VideoRow[], filters: ActiveVideoFilters) =>
  rows.filter((row) => matchesVideoFilters(row, filters)).length

const withCountLabel = <TValue,>(
  option: SelectOption<TValue>,
  count: number,
): SelectOption<TValue> => ({
  ...option,
  label: `${option.label} (${count.toLocaleString()})`,
})

const buildDirectoryFilterOptionsForFilters = (
  rows: VideoRow[],
  filters: ActiveVideoFilters,
): SelectOption<DirectoryFilterValue>[] =>
  buildDirectoryFilterOptions(
    rows.filter((row) => matchesVideoFilters(row, filters, 'directory')),
  )

const buildFileSizeFilterOptions = (
  rows: VideoRow[],
  filters: ActiveVideoFilters,
) =>
  fileSizeFilterOptions.map((option) =>
    withCountLabel(
      option,
      rows.filter(
        (row) =>
          matchesVideoFilters(row, filters, 'fileSize') &&
          isFileSizeInRange(row.sizeMB, option.value),
      ).length,
    ),
  )

const buildFileTypeFilterOptions = (
  rows: VideoRow[],
  filters: ActiveVideoFilters,
): SelectOption<FileTypeFilterValue>[] => {
  const typeCounts = new Map<FileTypeFilterValue, number>()

  rows
    .filter((row) => matchesVideoFilters(row, filters, 'fileType'))
    .forEach((row) => {
      const fileType = getFileTypeLabel(row)

      if (!fileType) return

      typeCounts.set(fileType, (typeCounts.get(fileType) ?? 0) + 1)
    })

  return Array.from(typeCounts.entries())
    .sort(([firstType], [secondType]) => firstType.localeCompare(secondType))
    .map(([fileType, count]) => ({
      label: `${fileType} (${count.toLocaleString()})`,
      value: fileType,
    }))
}

const buildDurationFilterOptions = (
  rows: VideoRow[],
  filters: ActiveVideoFilters,
) =>
  durationFilterOptions.map((option) =>
    withCountLabel(
      option,
      rows.filter(
        (row) =>
          matchesVideoFilters(row, filters, 'duration') &&
          isDurationInRange(row.durationSeconds, option.value),
      ).length,
    ),
  )

const buildResolutionFilterOptions = (
  rows: VideoRow[],
  filters: ActiveVideoFilters,
) =>
  resolutionFilterOptions.map((option) =>
    withCountLabel(
      option,
      rows.filter(
        (row) =>
          matchesVideoFilters(row, filters, 'resolution') &&
          row.isLowResolution === option.value,
      ).length,
    ),
  )

const buildAspectRatioFilterOptions = (
  rows: VideoRow[],
  filters: ActiveVideoFilters,
) =>
  aspectRatioFilterOptions.map((option) =>
    withCountLabel(
      option,
      rows.filter(
        (row) =>
          matchesVideoFilters(row, filters, 'aspectRatio') &&
          row.isWrongAspectRatio === option.value,
      ).length,
    ),
  )

const buildStatusFilterOptions = (
  rows: VideoRow[],
  filters: ActiveVideoFilters,
) =>
  statusFilterOptions.map((option) =>
    withCountLabel(
      option,
      rows.filter(
        (row) =>
          matchesVideoFilters(row, filters, 'status') &&
          row.status === option.value,
      ).length,
    ),
  )

const buildCropFilterOptions = (rows: VideoRow[], filters: ActiveVideoFilters) =>
  cropFilterOptions.map((option) =>
    withCountLabel(
      option,
      rows.filter(
        (row) =>
          matchesVideoFilters(row, filters, 'crop') &&
          getCropFilterValue(row.adjustments) === option.value,
      ).length,
    ),
  )

const fileSizeFilterTemplate = (
  options: FilterTemplateOptions<FileSizeFilterValue[] | null>,
  fileSizeFilterOptions: SelectOption<FileSizeFilterValue>[],
  onFilterChange: (value: FileSizeFilterValue[]) => void,
) => (
  <MultiSelect
    value={options.value ?? []}
    options={fileSizeFilterOptions}
    onChange={(event) => {
      const nextValue = event.value ?? []
      onFilterChange(nextValue)
      options.filterApplyCallback(nextValue)
    }}
    placeholder="File Size"
    className="table-column-filter"
    display="chip"
    maxSelectedLabels={1}
  />
)

const fileTypeFilterTemplate = (
  options: FilterTemplateOptions<FileTypeFilterValue[] | null>,
  fileTypeFilterOptions: SelectOption<FileTypeFilterValue>[],
  onFilterChange: (value: FileTypeFilterValue[]) => void,
) => (
  <MultiSelect
    value={options.value ?? []}
    options={fileTypeFilterOptions}
    onChange={(event) => {
      const nextValue = event.value ?? []
      onFilterChange(nextValue)
      options.filterApplyCallback(nextValue)
    }}
    placeholder="Type"
    className="table-column-filter"
    display="chip"
    maxSelectedLabels={1}
  />
)

const directoryFilterTemplate = (
  options: FilterTemplateOptions<DirectoryFilterValue[] | null>,
  directoryFilterOptions: SelectOption<DirectoryFilterValue>[],
  onFilterChange: (value: DirectoryFilterValue[]) => void,
) => (
  <MultiSelect
    value={options.value ?? []}
    options={directoryFilterOptions}
    onChange={(event) => {
      const nextValue = event.value ?? []
      onFilterChange(nextValue)
      options.filterApplyCallback(nextValue)
    }}
    placeholder="Directory"
    className="table-column-filter"
    display="chip"
    maxSelectedLabels={1}
  />
)

const durationFilterTemplate = (
  options: FilterTemplateOptions<DurationFilterValue[] | null>,
  durationFilterOptions: SelectOption<DurationFilterValue>[],
  onFilterChange: (value: DurationFilterValue[]) => void,
) => (
  <MultiSelect
    value={options.value ?? []}
    options={durationFilterOptions}
    onChange={(event) => {
      const nextValue = event.value ?? []
      onFilterChange(nextValue)
      options.filterApplyCallback(nextValue)
    }}
    placeholder="Duration"
    className="table-column-filter"
    display="chip"
    maxSelectedLabels={1}
  />
)

const resolutionFilterTemplate = (
  options: FilterTemplateOptions<boolean | null>,
  resolutionFilterOptions: SelectOption<boolean>[],
  onFilterChange: (value: boolean | null) => void,
) => (
  <Dropdown
    value={options.value}
    options={resolutionFilterOptions}
    onChange={(event) => {
      const nextValue = event.value ?? null
      onFilterChange(nextValue)
      options.filterApplyCallback(nextValue)
    }}
    placeholder="Resolution"
    className="table-column-filter"
    showClear
  />
)

const aspectRatioFilterTemplate = (
  options: FilterTemplateOptions<boolean | null>,
  aspectRatioFilterOptions: SelectOption<boolean>[],
  onFilterChange: (value: boolean | null) => void,
) => (
  <Dropdown
    value={options.value}
    options={aspectRatioFilterOptions}
    onChange={(event) => {
      const nextValue = event.value ?? null
      onFilterChange(nextValue)
      options.filterApplyCallback(nextValue)
    }}
    placeholder="Aspect"
    className="table-column-filter"
    showClear
  />
)

const statusFilterTemplate = (
  options: FilterTemplateOptions<VideoStatus | null>,
  statusFilterOptions: SelectOption<VideoStatus>[],
  onFilterChange: (value: VideoStatus | null) => void,
) => (
  <Dropdown
    value={options.value}
    options={statusFilterOptions}
    onChange={(event) => {
      const nextValue = event.value ?? null
      onFilterChange(nextValue)
      options.filterApplyCallback(nextValue)
    }}
    placeholder="Status"
    className="table-column-filter"
    showClear
  />
)

const cropFilterTemplate = (
  options: FilterTemplateOptions<CropFilterValue[] | null>,
  cropFilterOptions: SelectOption<CropFilterValue>[],
  onFilterChange: (value: CropFilterValue[]) => void,
) => (
  <MultiSelect
    value={options.value ?? []}
    options={cropFilterOptions}
    onChange={(event) => {
      const nextValue = event.value ?? []
      onFilterChange(nextValue)
      options.filterApplyCallback(nextValue)
    }}
    placeholder="Crop"
    className="table-column-filter"
    display="chip"
    maxSelectedLabels={1}
  />
)

const fileTemplate = (row: VideoRow, showThumbnails: boolean) => {
  const displayFileName = getRowDisplayFileName(row)
  const tooltipValue = getRowDisplayFile(row)

  return (
    <div className="video-title-cell file-cell">
      {showThumbnails && <VideoThumbnailPreview row={row} />}
      <div className="cell-stack video-title-text">
        <span className="file-cell-tooltip" data-pr-tooltip={tooltipValue}>
          {displayFileName}
        </span>
      </div>
    </div>
  )
}

const storageTemplate = (row: VideoRow) => (
  <div className="cell-stack">
    <span>{formatRoundedMegabytes(row.sizeMB)}</span>
  </div>
)

const fileTypeTemplate = (row: VideoRow) => (
  <div className="cell-stack">
    <span>{getFileTypeLabel(row)}</span>
  </div>
)

const durationTemplate = (row: VideoRow) => (
  <div className="cell-stack">
    <span>{formatDuration(row.durationSeconds)}</span>
  </div>
)

const resolutionTemplate = (row: VideoRow) => (
  <div className="cell-stack">
    <span>
      {[row.width, row.height].filter((value) => value !== null).join('x')}
    </span>
  </div>
)

const aspectRatioTemplate = (row: VideoRow) => (
  <div className="cell-stack">
    <span>{row.displayAspectRatio}</span>
  </div>
)

const cropTemplate = (row: VideoRow) => {
  const crop = getBlackBorderCropDisplay(row)

  return (
    <div
      className="cell-stack crop-cell"
      data-pr-tooltip={crop.detail}
      data-pr-position="top"
    >
      <span>{crop.value}</span>
    </div>
  )
}

const modifiedDateTemplate = (row: VideoRow) => (
  <div className="cell-stack">
    <span>{formatDate(row.modifiedAt)}</span>
  </div>
)

const statusTemplate = (row: VideoRow) => (
  <div className="cell-stack">
    <span>{row.status}</span>
  </div>
)

const skeletonTemplate = () => (
  <Skeleton height="1.35rem" className="table-skeleton" />
)

const isObjectValue = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const renderPrimitiveValue = (value: unknown) => {
  if (value === undefined) {
    return 'undefined'
  }

  if (typeof value === 'string') {
    return value
  }

  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value)
  }

  return String(value)
}

const renderVideoDetailRows = (value: unknown, path = 'video') => {
  if (!isObjectValue(value)) {
    return <>{renderPrimitiveValue(value)}</>
  }

  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value)

  if (entries.length === 0) {
    return <>{Array.isArray(value) ? '[]' : '{}'}</>
  }

  return (
    <table className="video-details-table">
      <tbody>
        {entries.map(([key, nestedValue]) => {
          const rowKey = `${path}.${key}`

          return (
            <tr key={rowKey}>
              <td>{key}</td>
              <td>
                {isObjectValue(nestedValue)
                  ? renderVideoDetailRows(nestedValue, rowKey)
                  : renderPrimitiveValue(nestedValue)}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export function VideoTable({
  canAutoFixSelected,
  canEditSelectedInPremiere,
  canGenerateThumbnails,
  canStartMigration,
  // canRefresh,
  // fileName,
  globalFilter,
  // isAuditActive,
  isLoading,
  isGeneratingThumbnails,
  // isPersisted,
  onClearData,
  onAutoFixSelectedClick,
  onEditInPremiereClick,
  onGenerateThumbnailsClick,
  onMigrateNewEditsClick,
  onGlobalFilterChange,
  onRemoveVideosClick,
  // onRefreshData,
  onRestoreRemovedVideosClick,
  onSelectedVideosChange,
  onShowThumbnailsChange,
  selectedVideos,
  showThumbnails,
  videoRows,
}: VideoTableProps) {
  const [directoryFilterValue, setDirectoryFilterValue] = useState<
    DirectoryFilterValue[]
  >([])
  const [fileSizeFilterValue, setFileSizeFilterValue] = useState<
    FileSizeFilterValue[]
  >([])
  const [fileTypeFilterValue, setFileTypeFilterValue] = useState<
    FileTypeFilterValue[]
  >([])
  const [durationFilterValue, setDurationFilterValue] = useState<
    DurationFilterValue[]
  >([])
  const [resolutionFilterValue, setResolutionFilterValue] = useState<
    boolean | null
  >(null)
  const [aspectRatioFilterValue, setAspectRatioFilterValue] = useState<
    boolean | null
  >(null)
  const [cropFilterValue, setCropFilterValue] = useState<CropFilterValue[]>([])
  const [statusFilterValue, setStatusFilterValue] =
    useState<VideoStatus | null>(null)
  const [detailVideo, setDetailVideo] = useState<VideoRow | null>(null)
  const [previewFramesByVideoPath, setPreviewFramesByVideoPath] = useState<
    Record<string, VideoPreviewFrameResult>
  >({})
  const [selectedPreviewFrameKey, setSelectedPreviewFrameKey] = useState<
    string | null
  >(null)
  const [previewFetchMode, setPreviewFetchMode] =
    useState<PreviewFrameFetchMode | null>(null)
  const [previewFrameError, setPreviewFrameError] = useState<string | null>(
    null,
  )
  const [previewFrameMessage, setPreviewFrameMessage] = useState<string | null>(
    null,
  )
  const activeFilters = useMemo<ActiveVideoFilters>(
    () => ({
      aspectRatio: aspectRatioFilterValue,
      crop: cropFilterValue,
      directory: directoryFilterValue,
      duration: durationFilterValue,
      fileSize: fileSizeFilterValue,
      fileType: fileTypeFilterValue,
      global: globalFilter,
      resolution: resolutionFilterValue,
      status: statusFilterValue,
    }),
    [
      aspectRatioFilterValue,
      cropFilterValue,
      directoryFilterValue,
      durationFilterValue,
      fileSizeFilterValue,
      fileTypeFilterValue,
      globalFilter,
      resolutionFilterValue,
      statusFilterValue,
    ],
  )
  const tableVideoRows = useMemo(
    () => videoRows.filter((row) => row.visible !== false),
    [videoRows],
  )
  const removedVideoCount = videoRows.length - tableVideoRows.length
  const visibleVideoCount = useMemo(
    () => getVisibleVideoCount(tableVideoRows, activeFilters),
    [activeFilters, tableVideoRows],
  )
  const visibleVideoRows = useMemo(
    () => tableVideoRows.filter((row) => matchesVideoFilters(row, activeFilters)),
    [activeFilters, tableVideoRows],
  )
  const directoryFilterOptions = useMemo(
    () => buildDirectoryFilterOptionsForFilters(tableVideoRows, activeFilters),
    [activeFilters, tableVideoRows],
  )
  const countedFileSizeFilterOptions = useMemo(
    () => buildFileSizeFilterOptions(tableVideoRows, activeFilters),
    [activeFilters, tableVideoRows],
  )
  const countedFileTypeFilterOptions = useMemo(
    () => buildFileTypeFilterOptions(tableVideoRows, activeFilters),
    [activeFilters, tableVideoRows],
  )
  const countedDurationFilterOptions = useMemo(
    () => buildDurationFilterOptions(tableVideoRows, activeFilters),
    [activeFilters, tableVideoRows],
  )
  const countedResolutionFilterOptions = useMemo(
    () => buildResolutionFilterOptions(tableVideoRows, activeFilters),
    [activeFilters, tableVideoRows],
  )
  const countedAspectRatioFilterOptions = useMemo(
    () => buildAspectRatioFilterOptions(tableVideoRows, activeFilters),
    [activeFilters, tableVideoRows],
  )
  const countedCropFilterOptions = useMemo(
    () => buildCropFilterOptions(tableVideoRows, activeFilters),
    [activeFilters, tableVideoRows],
  )
  const countedStatusFilterOptions = useMemo(
    () => buildStatusFilterOptions(tableVideoRows, activeFilters),
    [activeFilters, tableVideoRows],
  )
  const selectedVideosSizeMB = useMemo(
    () =>
      selectedVideos.reduce(
        (totalSizeMB, video) => totalSizeMB + (video.sizeMB ?? 0),
        0,
      ),
    [selectedVideos],
  )
  const selectedVideoCountLabel =
    selectedVideos.length > 0
      ? ` - ${selectedVideos.length.toLocaleString()} Selected (${formatSelectedVideoSize(selectedVideosSizeMB)})`
      : ''
  const editButtonLabel =
    selectedVideos.length > 0
      ? `Edit in Premiere (${selectedVideos.length.toLocaleString()})`
      : 'Edit in Premiere'
  const autoFixButtonLabel =
    selectedVideos.length > 0
      ? `Auto-Fix (${selectedVideos.length.toLocaleString()})`
      : 'Auto-Fix'
  const thumbnailButtonLabel =
    selectedVideos.length > 0
      ? `Generate Thumbnails (${selectedVideos.length.toLocaleString()})`
      : 'Generate Thumbnails'
  const currentPreviewFrameResult = detailVideo
    ? (previewFramesByVideoPath[detailVideo.path] ??
      getRowPreviewFrameResult(detailVideo))
    : undefined
  const currentPreviewFrames = getGeneratedPreviewFrames(
    currentPreviewFrameResult,
  )
  const selectedPreviewFrame =
    currentPreviewFrames.find(
      (frame) => getPreviewFrameKey(frame) === selectedPreviewFrameKey,
    ) ??
    currentPreviewFrames[0] ??
    null
  const tableThumbnailUrl =
    detailVideo?.thumbnail?.generated === true ? detailVideo.thumbnail.url : null
  const mainPreviewUrl =
    selectedPreviewFrame?.thumbnail.url ?? tableThumbnailUrl ?? null
  const mainPreviewSrc = mainPreviewUrl ? getThumbnailSrc(mainPreviewUrl) : ''
  const mainPreviewLabel = selectedPreviewFrame
    ? `${detailVideo?.fileName ?? 'Video'} at ${selectedPreviewFrame.timestampLabel}`
    : detailVideo
      ? `Thumbnail preview for ${detailVideo.fileName}`
      : 'Video preview'
  const maxPreviewFrameCount =
    currentPreviewFrameResult?.maxPreviewFrameCount ??
    getMaxPreviewFrameCount(detailVideo?.durationSeconds)
  const remainingPreviewFrameCount = Math.max(
    maxPreviewFrameCount - currentPreviewFrames.length,
    0,
  )
  const isFetchingPreviewFrames = previewFetchMode !== null
  const additionalThumbnailButtonLabel =
    remainingPreviewFrameCount > 0
      ? `Fetch ${remainingPreviewFrameCount.toLocaleString()} Additional Thumbnails`
      : 'Fetch Additional Thumbnails'
  const failedPreviewFrameCount =
    currentPreviewFrameResult?.summary.failed ??
    (currentPreviewFrameResult?.frames ?? []).filter(
      (frame) => frame.thumbnail.generated !== true,
    ).length
  const handleOpenDetails = (row: VideoRow) => {
    const savedPreviewFrames = getGeneratedPreviewFrames(
      previewFramesByVideoPath[row.path],
    )

    setDetailVideo(row)
    setSelectedPreviewFrameKey(
      savedPreviewFrames[0] ? getPreviewFrameKey(savedPreviewFrames[0]) : null,
    )
    setPreviewFrameError(null)
    setPreviewFrameMessage(null)
  }
  const handleCloseDetails = () => {
    setDetailVideo(null)
    setSelectedPreviewFrameKey(null)
    setPreviewFrameError(null)
    setPreviewFrameMessage(null)
  }
  const handleFetchPreviewFrames = async (mode: PreviewFrameFetchMode) => {
    if (!detailVideo) {
      return
    }

    if (!detailVideo.path) {
      setPreviewFrameError('This video does not have a valid local path.')
      return
    }

    setPreviewFetchMode(mode)
    setPreviewFrameError(null)
    setPreviewFrameMessage(null)

    try {
      const response = await fetch(
        `${apiBaseUrl}/api/thumbnails/preview-frames`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            video: toPreviewFrameRequestVideo(detailVideo),
            mode,
          }),
        },
      )
      const payload = (await response.json()) as
        | VideoPreviewFrameResult
        | { message?: string }

      if (!response.ok) {
        throw new Error(
          'message' in payload && payload.message
            ? payload.message
            : 'Unable to fetch preview frames.',
        )
      }

      if (!('frames' in payload) || !Array.isArray(payload.frames)) {
        throw new Error('The preview frame response was incomplete.')
      }

      const nextResult = payload as VideoPreviewFrameResult
      const nextFrames = getGeneratedPreviewFrames(nextResult)

      setPreviewFramesByVideoPath((currentResults) => ({
        ...currentResults,
        [detailVideo.path]: nextResult,
      }))

      setSelectedPreviewFrameKey((currentKey) => {
        if (mode === 'additional' && currentKey) {
          const stillAvailable = nextFrames.some(
            (frame) => getPreviewFrameKey(frame) === currentKey,
          )

          if (stillAvailable) {
            return currentKey
          }
        }

        return nextFrames[0] ? getPreviewFrameKey(nextFrames[0]) : null
      })

      if (nextFrames.length === 0) {
        setPreviewFrameError('No preview frames were returned for this video.')
      } else if (nextResult.summary.failed > 0) {
        setPreviewFrameMessage(
          `${nextFrames.length.toLocaleString()} preview frames ready; ${nextResult.summary.failed.toLocaleString()} failed.`,
        )
      } else {
        setPreviewFrameMessage(
          mode === 'fresh'
            ? 'New preview frames ready.'
            : 'Preview frames ready.',
        )
      }
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to fetch preview frames.'

      setPreviewFrameError(message)
    } finally {
      setPreviewFetchMode(null)
    }
  }
  const actionsTemplate = (row: VideoRow) => (
    <div className="row-actions">
      <Button
        type="button"
        aria-label="View details"
        size="small"
        severity="info"
        raised
        className="row-action-button"
        onClick={(event) => {
          event.stopPropagation()
          handleOpenDetails(row)
        }}
      >
        <FontAwesomeIcon icon={faEye} />
      </Button>
      <Button
        type="button"
        aria-label="Remove from table"
        size="small"
        severity="danger"
        raised
        className="row-action-button"
        onClick={(event) => {
          event.stopPropagation()
          onRemoveVideosClick([row])
        }}
      >
        <FontAwesomeIcon icon={faCircleMinus} />
      </Button>
    </div>
  )

  const tableHeader = (
    <div className="table-header">
      <div>
        {!isLoading && (
          <>
            <h2 className="table-title">Videos</h2>
            <p className="table-visible-count">
              {visibleVideoCount.toLocaleString()} Videos{selectedVideoCountLabel}
            </p>
          </>
        )}
      </div>
      <div className="table-actions">
        <label className="thumbnail-toggle">
          <InputSwitch
            checked={showThumbnails}
            onChange={(event) => onShowThumbnailsChange(Boolean(event.value))}
            disabled={isLoading}
            aria-label="Show thumbnails"
          />
          <span>Show thumbnails</span>
        </label>
        <Button
          type="button"
          label={editButtonLabel}
          severity="help"
          raised
          disabled={!canEditSelectedInPremiere}
          title="Import selected videos into the open Premiere project for manual editing."
          onClick={onEditInPremiereClick}
        />
        <Button
          type="button"
          label={autoFixButtonLabel}
          severity="warning"
          raised
          disabled={!canAutoFixSelected}
          title="Normalize selected videos with FFmpeg."
          onClick={onAutoFixSelectedClick}
        />
        <Button
          type="button"
          label={thumbnailButtonLabel}
          severity="info"
          raised
          disabled={
            !canGenerateThumbnails ||
            isGeneratingThumbnails ||
            visibleVideoRows.length === 0
          }
          loading={isGeneratingThumbnails}
          onClick={() => onGenerateThumbnailsClick(visibleVideoRows)}
        />
        <Button
          type="button"
          label="Migrate New Edits"
          severity="success"
          raised
          disabled={!canStartMigration}
          onClick={onMigrateNewEditsClick}
        />
        <Button
          type="button"
          label="Remove Selected Videos"
          severity="danger"
          raised
          disabled={isLoading || selectedVideos.length === 0}
          onClick={() => onRemoveVideosClick(selectedVideos)}
        />
        <Button
          type="button"
          label="Restore Removed Videos"
          severity="info"
          raised
          disabled={isLoading || removedVideoCount === 0}
          onClick={onRestoreRemovedVideosClick}
        />
        <InputText
          value={globalFilter}
          onChange={(event) => onGlobalFilterChange(event.target.value)}
          placeholder="Search videos"
          aria-label="Search videos"
          disabled={isLoading}
        />
        {/* <Button
          type="button"
          label="Refresh"
          severity="info"
          raised
          disabled={isAuditActive || isLoading || !canRefresh}
          onClick={onRefreshData}
        /> */}
        <Button
          type="button"
          label="Clear cache"
          severity="danger"
          raised
          onClick={onClearData}
        />
      </div>
    </div>
  )

  return (
    <section
      className={`table-section ${showThumbnails ? '' : 'thumbnails-hidden'}`}
      aria-label="Loaded videos"
    >
      <Tooltip target=".file-cell-tooltip" position="top" showDelay={2000} />
      <Tooltip target=".crop-cell" position="top" showDelay={1000} />
      <DataTable
        value={isLoading ? loadingRows : tableVideoRows}
        header={tableHeader}
        dataKey="path"
        className="video-table"
        selectionMode="multiple"
        selection={selectedVideos}
        onSelectionChange={(event) => {
          const nextSelectedVideos = event.value as VideoRow[]
          console.log('[VideoTable] Selected videos:', nextSelectedVideos)
          onSelectedVideosChange(nextSelectedVideos)
        }}
        metaKeySelection={false}
        paginator={!isLoading}
        rows={50}
        rowsPerPageOptions={[25, 50, 100, 250, 500, 1000]}
        sortMode="multiple"
        removableSort
        filterDisplay="row"
        globalFilter={globalFilter}
        globalFilterFields={globalFilterFields}
        stripedRows
        size="small"
        scrollable
        tableStyle={{ minWidth: '1420px' }}
        emptyMessage={isLoading ? '' : 'No videos found.'}
      >
        <Column
          selectionMode="multiple"
          headerStyle={{ width: '3rem' }}
          style={{ width: '3rem' }}
        />
        <Column
          field="displayFile"
          filterField="displayDirectory"
          header="File Name"
          sortable={!isLoading}
          filter={!isLoading}
          filterMatchMode={FilterMatchMode.CUSTOM}
          filterFunction={directoryFilterFunction}
          filterElement={(options) =>
            directoryFilterTemplate(
              options as FilterTemplateOptions<
                DirectoryFilterValue[] | null
              >,
              directoryFilterOptions,
              setDirectoryFilterValue,
            )
          }
          showFilterMenu={false}
          body={
            isLoading
              ? skeletonTemplate
              : (row: VideoRow) => fileTemplate(row, showThumbnails)
          }
          style={{ width: '38%' }}
        />
        <Column
          field="fileType"
          header="Type"
          sortable={!isLoading}
          filter={!isLoading}
          filterMatchMode={FilterMatchMode.CUSTOM}
          filterFunction={fileTypeFilterFunction}
          filterElement={(options) =>
            fileTypeFilterTemplate(
              options as FilterTemplateOptions<FileTypeFilterValue[] | null>,
              countedFileTypeFilterOptions,
              setFileTypeFilterValue,
            )
          }
          showFilterMenu={false}
          body={isLoading ? skeletonTemplate : fileTypeTemplate}
          style={{ width: '7%' }}
        />
        <Column
          field="sizeMB"
          header="File Size"
          sortable={!isLoading}
          filter={!isLoading}
          filterMatchMode={FilterMatchMode.CUSTOM}
          filterFunction={fileSizeFilterFunction}
          filterElement={(options) =>
            fileSizeFilterTemplate(
              options as FilterTemplateOptions<FileSizeFilterValue[] | null>,
              countedFileSizeFilterOptions,
              setFileSizeFilterValue,
            )
          }
          showFilterMenu={false}
          dataType="numeric"
          body={isLoading ? skeletonTemplate : storageTemplate}
          style={{ width: '10%' }}
        />
        <Column
          field="durationSeconds"
          header="Duration"
          sortable={!isLoading}
          filter={!isLoading}
          filterMatchMode={FilterMatchMode.CUSTOM}
          filterFunction={durationFilterFunction}
          filterElement={(options) =>
            durationFilterTemplate(
              options as FilterTemplateOptions<DurationFilterValue[] | null>,
              countedDurationFilterOptions,
              setDurationFilterValue,
            )
          }
          showFilterMenu={false}
          dataType="numeric"
          body={isLoading ? skeletonTemplate : durationTemplate}
          style={{ width: '10%' }}
        />
        <Column
          field="modifiedAt"
          header="Modified"
          sortable={!isLoading}
          body={isLoading ? skeletonTemplate : modifiedDateTemplate}
          style={{ width: '12%' }}
        />
        <Column
          field="width"
          filterField="isLowResolution"
          header="Resolution"
          sortable={!isLoading}
          filter={!isLoading}
          filterMatchMode={FilterMatchMode.EQUALS}
          filterElement={(options) =>
            resolutionFilterTemplate(
              options as FilterTemplateOptions<boolean | null>,
              countedResolutionFilterOptions,
              setResolutionFilterValue,
            )
          }
          showFilterMenu={false}
          body={isLoading ? skeletonTemplate : resolutionTemplate}
          style={{ width: '11%' }}
        />
        <Column
          field="displayAspectRatio"
          filterField="isWrongAspectRatio"
          header="Aspect Ratio"
          sortable={!isLoading}
          filter={!isLoading}
          filterMatchMode={FilterMatchMode.EQUALS}
          filterElement={(options) =>
            aspectRatioFilterTemplate(
              options as FilterTemplateOptions<boolean | null>,
              countedAspectRatioFilterOptions,
              setAspectRatioFilterValue,
            )
          }
          showFilterMenu={false}
          body={isLoading ? skeletonTemplate : aspectRatioTemplate}
          style={{ width: '11%' }}
        />
        <Column
          field="adjustments"
          header="Crop"
          filter={!isLoading}
          filterMatchMode={FilterMatchMode.CUSTOM}
          filterFunction={cropFilterFunction}
          filterElement={(options) =>
            cropFilterTemplate(
              options as FilterTemplateOptions<CropFilterValue[] | null>,
              countedCropFilterOptions,
              setCropFilterValue,
            )
          }
          showFilterMenu={false}
          body={isLoading ? skeletonTemplate : cropTemplate}
          style={{ width: '14%' }}
        />
        <Column
          field="status"
          header="Status"
          sortable={!isLoading}
          filter={!isLoading}
          filterMatchMode={FilterMatchMode.EQUALS}
          filterElement={(options) =>
            statusFilterTemplate(
              options as FilterTemplateOptions<VideoStatus | null>,
              countedStatusFilterOptions,
              setStatusFilterValue,
            )
          }
          showFilterMenu={false}
          body={isLoading ? skeletonTemplate : statusTemplate}
          style={{ width: '10%' }}
        />
        <Column
          header="Actions"
          body={isLoading ? skeletonTemplate : actionsTemplate}
          style={{ width: '12%' }}
        />
      </DataTable>
      <Dialog
        visible={Boolean(detailVideo)}
        modal
        dismissableMask
        draggable={false}
        resizable={false}
        showHeader={false}
        className="video-details-dialog"
        contentClassName="video-details-dialog-content"
        onHide={handleCloseDetails}
      >
        {detailVideo && (
          <>
            <div className="video-details-preview">
              <div className="video-details-preview-main">
                {mainPreviewSrc ? (
                  <img
                    src={mainPreviewSrc}
                    alt={mainPreviewLabel}
                    className="video-details-preview-image"
                  />
                ) : (
                  <div className="video-details-preview-placeholder">
                    No thumbnail available
                  </div>
                )}
              </div>

              {currentPreviewFrames.length > 0 && (
                <div
                  className="video-details-preview-strip"
                  aria-label="Preview frame thumbnails"
                >
                  {currentPreviewFrames.map((frame) => {
                    const frameKey = getPreviewFrameKey(frame)
                    const isSelected =
                      selectedPreviewFrame?.thumbnail.url ===
                        frame.thumbnail.url &&
                      selectedPreviewFrame?.batchId === frame.batchId
                    const frameUrl = frame.thumbnail.url

                    if (!frameUrl) {
                      return null
                    }

                    return (
                      <button
                        key={frameKey}
                        type="button"
                        className={`video-details-preview-thumb ${isSelected ? 'is-selected' : ''}`}
                        onClick={() => setSelectedPreviewFrameKey(frameKey)}
                        aria-label={`Show frame at ${frame.timestampLabel}`}
                      >
                        <img
                          src={getThumbnailSrc(frameUrl)}
                          alt={`Preview frame at ${frame.timestampLabel}`}
                        />
                        <span>{frame.timestampLabel}</span>
                      </button>
                    )
                  })}
                </div>
              )}

              <div className="video-details-preview-actions">
                {remainingPreviewFrameCount > 0 && (
                  <Button
                    type="button"
                    label={additionalThumbnailButtonLabel}
                    severity="info"
                    raised
                    disabled={isFetchingPreviewFrames}
                    loading={previewFetchMode === 'additional'}
                    onClick={() => void handleFetchPreviewFrames('additional')}
                  />
                )}
                <Button
                  type="button"
                  label="Fetch New Thumbnails"
                  severity="success"
                  raised
                  disabled={isFetchingPreviewFrames}
                  loading={previewFetchMode === 'fresh'}
                  onClick={() => void handleFetchPreviewFrames('fresh')}
                />
              </div>

              {isFetchingPreviewFrames && (
                <p className="video-details-preview-status">
                  Fetching preview frames...
                </p>
              )}
              {previewFrameMessage && (
                <p className="video-details-preview-message">
                  {previewFrameMessage}
                </p>
              )}
              {(previewFrameError || failedPreviewFrameCount > 0) && (
                <p className="video-details-preview-warning">
                  {previewFrameError ??
                    `${failedPreviewFrameCount.toLocaleString()} preview frames failed.`}
                </p>
              )}
            </div>

            {renderVideoDetailRows(detailVideo)}
          </>
        )}
      </Dialog>
    </section>
  )
}
