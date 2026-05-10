import { forwardRef } from 'react'
import type { InputHTMLAttributes } from 'react'

type DirectoryInputProps = InputHTMLAttributes<HTMLInputElement> & {
  webkitdirectory?: string
}

export const DirectoryInput = forwardRef<HTMLInputElement, DirectoryInputProps>(
  function DirectoryInput(props, ref) {
    return <input ref={ref} {...props} />
  },
)
