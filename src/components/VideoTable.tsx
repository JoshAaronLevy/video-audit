import { useMemo, useState } from 'react'
import { Button } from 'primereact/button'
import { Column } from 'primereact/column'
import { DataTable } from 'primereact/datatable'
import { Dropdown } from 'primereact/dropdown'
import { FilterMatchMode } from 'primereact/api'
import { InputText } from 'primereact/inputtext'
import { MultiSelect } from 'primereact/multiselect'
import { Skeleton } from 'primereact/skeleton'
import type { VideoRow, VideoStatus } from '../types/video'
import {
  formatDate,
  formatDuration,
  formatNumber,
  getRowDisplayFile,
  globalFilterFields,
  isAutoCropCandidate,
} from '../helpers/utils'

type VideoTableProps = {
  canExportToPremiere: boolean
  canAutoCropSelected: boolean
  canStartMigration: boolean
  canRefresh: boolean
  fileName: string | null
  globalFilter: string
  isAuditActive: boolean
  isLoading: boolean
  isPersisted: boolean
  onClearData: () => void
  onAutoCropSelectedClick: () => void
  onExportToPremiereClick: () => void
  onMigrateNewEditsClick: () => void
  onGlobalFilterChange: (value: string) => void
  onRefreshData: () => void
  onSelectedVideosChange: (videos: VideoRow[]) => void
  selectedVideos: VideoRow[]
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

type SelectOption<TValue> = {
  label: string
  value: TValue
}

const rootDirectoryFilterValue = '__root_videos__'

type ActiveVideoFilters = {
  aspectRatio: boolean | null
  directory: DirectoryFilterValue[]
  duration: DurationFilterValue[]
  fileSize: FileSizeFilterValue[]
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
  (excludedDimension === 'duration' ||
    durationFilterFunction(row.durationSeconds, filters.duration)) &&
  (excludedDimension === 'resolution' ||
    filters.resolution === null ||
    row.isLowResolution === filters.resolution) &&
  (excludedDimension === 'aspectRatio' ||
    filters.aspectRatio === null ||
    row.isWrongAspectRatio === filters.aspectRatio) &&
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

const fileTemplate = (row: VideoRow) => {
  const displayFile = getRowDisplayFile(row)

  return (
    <div className="cell-stack file-cell">
      <span>{displayFile}</span>
    </div>
  )
}

const storageTemplate = (row: VideoRow) => (
  <div className="cell-stack">
    <span>{formatRoundedMegabytes(row.sizeMB)}</span>
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
      <span>{isAutoCropCandidate(row) ? 'Yes' : 'No'}</span>
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

export function VideoTable({
  canAutoCropSelected,
  canExportToPremiere,
  canStartMigration,
  // canRefresh,
  fileName,
  globalFilter,
  // isAuditActive,
  isLoading,
  // isPersisted,
  onClearData,
  onAutoCropSelectedClick,
  onExportToPremiereClick,
  onMigrateNewEditsClick,
  onGlobalFilterChange,
  // onRefreshData,
  onSelectedVideosChange,
  selectedVideos,
  videoRows,
}: VideoTableProps) {
  const [directoryFilterValue, setDirectoryFilterValue] = useState<
    DirectoryFilterValue[]
  >([])
  const [fileSizeFilterValue, setFileSizeFilterValue] = useState<
    FileSizeFilterValue[]
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
  const [statusFilterValue, setStatusFilterValue] =
    useState<VideoStatus | null>(null)
  const activeFilters = useMemo<ActiveVideoFilters>(
    () => ({
      aspectRatio: aspectRatioFilterValue,
      directory: directoryFilterValue,
      duration: durationFilterValue,
      fileSize: fileSizeFilterValue,
      global: globalFilter,
      resolution: resolutionFilterValue,
      status: statusFilterValue,
    }),
    [
      aspectRatioFilterValue,
      directoryFilterValue,
      durationFilterValue,
      fileSizeFilterValue,
      globalFilter,
      resolutionFilterValue,
      statusFilterValue,
    ],
  )
  const visibleVideoCount = useMemo(
    () => getVisibleVideoCount(videoRows, activeFilters),
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
  const selectedVideoCountLabel =
    selectedVideos.length > 0
      ? ` - ${selectedVideos.length.toLocaleString()} Selected (${formatSelectedVideoSize(selectedVideosSizeMB)})`
      : ''
  const exportButtonLabel =
    selectedVideos.length > 0
      ? `Export to Premiere (${selectedVideos.length.toLocaleString()})`
      : 'Export to Premiere'
  const selectedAutoCropCount = selectedVideos.filter(isAutoCropCandidate).length
  const autoCropButtonLabel =
    selectedVideos.length > 0
      ? `Auto-Crop Selected (${selectedAutoCropCount.toLocaleString()})`
      : 'Auto-Crop Selected'

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
        <Button
          type="button"
          label={exportButtonLabel}
          disabled={!canExportToPremiere}
          onClick={onExportToPremiereClick}
        />
        <Button
          type="button"
          label={autoCropButtonLabel}
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
    <section className="table-section" aria-label="Loaded videos">
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
        tableStyle={{ minWidth: '1160px' }}
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
          body={isLoading ? skeletonTemplate : fileTemplate}
          style={{ width: '44%' }}
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
      </DataTable>
    </section>
  )
}
