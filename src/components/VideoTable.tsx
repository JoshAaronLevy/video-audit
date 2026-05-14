import { useMemo, useState } from 'react'
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
import {
  formatDate,
  formatDuration,
  formatNumber,
  getBlackBorderCropStatus,
  getRowDisplayFile,
  getRowDisplayFileName,
  globalFilterFields,
  isCropReviewCandidate,
} from '../helpers/utils'
import type { CropReviewStatus } from '../helpers/utils'

type VideoTableProps = {
  canExportToPremiere: boolean
  canGenerateThumbnails: boolean
  canAutoCropSelected: boolean
  canStartMigration: boolean
  canRefresh: boolean
  fileName: string | null
  globalFilter: string
  isAuditActive: boolean
  isLoading: boolean
  isPersisted: boolean
  isGeneratingThumbnails: boolean
  onClearData: () => void
  onAutoCropSelectedClick: () => void
  onExportToPremiereClick: () => void
  onGenerateThumbnailsClick: (tableRows: VideoRow[]) => void
  onMigrateNewEditsClick: () => void
  onGlobalFilterChange: (value: string) => void
  onRefreshData: () => void
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
  { label: 'Yes', value: 'Yes' },
  { label: 'No', value: 'No' },
  { label: 'Uncertain', value: 'Uncertain' },
  { label: 'Errored', value: 'Errored' },
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
  return (
    <div className="cell-stack">
      <span>{getBlackBorderCropStatus(row.adjustments)}</span>
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
  canAutoCropSelected,
  canExportToPremiere,
  canGenerateThumbnails,
  canStartMigration,
  // canRefresh,
  fileName,
  globalFilter,
  // isAuditActive,
  isLoading,
  isGeneratingThumbnails,
  // isPersisted,
  onClearData,
  onAutoCropSelectedClick,
  onExportToPremiereClick,
  onGenerateThumbnailsClick,
  onMigrateNewEditsClick,
  onGlobalFilterChange,
  // onRefreshData,
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
  const visibleVideoCount = useMemo(
    () => getVisibleVideoCount(videoRows, activeFilters),
    [activeFilters, videoRows],
  )
  const visibleVideoRows = useMemo(
    () => videoRows.filter((row) => matchesVideoFilters(row, activeFilters)),
    [activeFilters, videoRows],
  )
  const directoryFilterOptions = useMemo(
    () => buildDirectoryFilterOptionsForFilters(videoRows, activeFilters),
    [activeFilters, videoRows],
  )
  const countedFileSizeFilterOptions = useMemo(
    () => buildFileSizeFilterOptions(videoRows, activeFilters),
    [activeFilters, videoRows],
  )
  const countedFileTypeFilterOptions = useMemo(
    () => buildFileTypeFilterOptions(videoRows, activeFilters),
    [activeFilters, videoRows],
  )
  const countedDurationFilterOptions = useMemo(
    () => buildDurationFilterOptions(videoRows, activeFilters),
    [activeFilters, videoRows],
  )
  const countedResolutionFilterOptions = useMemo(
    () => buildResolutionFilterOptions(videoRows, activeFilters),
    [activeFilters, videoRows],
  )
  const countedAspectRatioFilterOptions = useMemo(
    () => buildAspectRatioFilterOptions(videoRows, activeFilters),
    [activeFilters, videoRows],
  )
  const countedCropFilterOptions = useMemo(
    () => buildCropFilterOptions(videoRows, activeFilters),
    [activeFilters, videoRows],
  )
  const countedStatusFilterOptions = useMemo(
    () => buildStatusFilterOptions(videoRows, activeFilters),
    [activeFilters, videoRows],
  )
  const selectedVideosSizeMB = useMemo(
    () =>
      selectedVideos.reduce(
        (totalSizeMB, video) => totalSizeMB + (video.sizeMB ?? 0),
        0,
      ),
    [selectedVideos],
  )
  const selectedCropReviewVideos = useMemo(
    () => selectedVideos.filter(isCropReviewCandidate),
    [selectedVideos],
  )
  const selectedVideoCountLabel =
    selectedVideos.length > 0
      ? ` - ${selectedVideos.length.toLocaleString()} Selected (${formatSelectedVideoSize(selectedVideosSizeMB)})`
      : ''
  const exportButtonLabel =
    selectedVideos.length > 0
      ? `Export to Premiere (${selectedVideos.length.toLocaleString()})`
      : 'Export to Premiere'
  const cropOptionsButtonLabel =
    selectedCropReviewVideos.length > 0
      ? `Crop Options (${selectedCropReviewVideos.length.toLocaleString()})`
      : 'Crop Options'
  const thumbnailButtonLabel =
    selectedVideos.length > 0
      ? `Generate Thumbnails (${selectedVideos.length.toLocaleString()})`
      : 'Generate Thumbnails'
  const actionsTemplate = (row: VideoRow) => (
    <Button
      type="button"
      label="View details"
      size="small"
      severity="secondary"
      outlined
      onClick={(event) => {
        event.stopPropagation()
        setDetailVideo(row)
      }}
    />
  )

  const tableHeader = (
    <div className="table-header">
      <div>
        <h2 className="table-title">Videos</h2>
        <p>
          {isLoading
            ? 'Refreshing videos...'
            : `${videoRows.length.toLocaleString()} flagged videos found`}
          {!isLoading && fileName ? ` in ${fileName}` : ''}
          {/* {!isLoading && isPersisted ? ' saved locally' : ''} */}
        </p>
        {!isLoading && (
          <p className="table-visible-count">
            {visibleVideoCount.toLocaleString()} Videos{selectedVideoCountLabel}
          </p>
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
          label={thumbnailButtonLabel}
          severity="secondary"
          outlined
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
          label={exportButtonLabel}
          disabled={!canExportToPremiere}
          onClick={onExportToPremiereClick}
        />
        <Button
          type="button"
          label={cropOptionsButtonLabel}
          severity="secondary"
          disabled={!canAutoCropSelected}
          onClick={onAutoCropSelectedClick}
        />
        <Button
          type="button"
          label="Migrate New Edits"
          severity="secondary"
          outlined
          disabled={!canStartMigration}
          onClick={onMigrateNewEditsClick}
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
          severity="secondary"
          outlined
          disabled={isAuditActive || isLoading || !canRefresh}
          onClick={onRefreshData}
        /> */}
        <Button
          type="button"
          label="Clear cache"
          severity="danger"
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
      <DataTable
        value={isLoading ? loadingRows : videoRows}
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
        tableStyle={{ minWidth: '1320px' }}
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
          style={{ width: '9%' }}
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
        onHide={() => setDetailVideo(null)}
      >
        {detailVideo && renderVideoDetailRows(detailVideo)}
      </Dialog>
    </section>
  )
}
