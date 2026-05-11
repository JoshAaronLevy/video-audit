export type PremiereStatusCode =
  | 'ready'
  | 'premiere_not_running'
  | 'bridge_disconnected'
  | 'error'

export type PremierePreset = {
  id: string
  label: string
  resolution: string
}

export type PremiereStatusResponse = {
  status: PremiereStatusCode
  message: string
  premiere?: {
    running: boolean | null
    reason?: string
    message?: string
  }
  bridge?: {
    connected: boolean
    status?: string | null
    reason?: string
    updatedAt?: string | null
    activeProjectName?: string | null
    activeProjectPath?: string | null
    outputDirectory?: string | null
  }
  bridgeDir?: string
  outputDirectory?: string
  presets?: PremierePreset[]
}

export type PremiereExportVideo = {
  id: string
  fileName: string
  absolutePath: string
  directory: string
  durationSeconds: number | null
  width: number | null
  height: number | null
  displayAspectRatio: string
  frameRate: number | null
}

export type PremiereExportRequestPayload = {
  presetId: string
  videos: PremiereExportVideo[]
}

export type PremiereExportRequestResponse = {
  status: string
  requestId?: string
  message?: string
  premiereStatus?: PremiereStatusResponse
}
