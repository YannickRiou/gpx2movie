import { useCallback, useId, useRef, useState } from 'react'
import type { DragEvent, KeyboardEvent, MouseEvent } from 'react'

export interface DropZoneProps {
  /**
   * Called with the selected or dropped files (never empty). Files are NOT filtered by
   * extension here: the importer rejects unsupported formats with an explicit message.
   */
  onFiles(files: File[]): void
  /** While true the zone is dimmed and ignores input. */
  busy?: boolean
}

const ACCEPT = '.gpx,.fit'

/** Drag-and-drop + click/keyboard file picker for GPX and FIT files. */
export function DropZone({ onFiles, busy = false }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [active, setActive] = useState(false)
  const hintId = useId()

  const submit = useCallback(
    (list: FileList | null) => {
      if (!list || list.length === 0) return
      onFiles(Array.from(list))
    },
    [onFiles],
  )

  const openPicker = () => {
    if (!busy) inputRef.current?.click()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openPicker()
    }
  }

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (busy) return
    event.dataTransfer.dropEffect = 'copy'
    if (!active) setActive(true)
  }

  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    // dragleave also fires when moving over a child: only leave when the pointer exits the zone
    const next = event.relatedTarget
    if (next instanceof Node && event.currentTarget.contains(next)) return
    setActive(false)
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setActive(false)
    if (!busy) submit(event.dataTransfer.files)
  }

  const className = ['dropzone', active ? 'dropzone--active' : '', busy ? 'dropzone--busy' : '']
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={className}
      role="button"
      tabIndex={busy ? -1 : 0}
      aria-disabled={busy}
      aria-describedby={hintId}
      onClick={openPicker}
      onKeyDown={onKeyDown}
      onDragEnter={(event) => event.preventDefault()}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <span className="dropzone__title">Glissez un fichier GPX ou FIT</span>
      <span className="dropzone__hint" id={hintId}>
        ou cliquez pour choisir
      </span>
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        multiple
        accept={ACCEPT}
        tabIndex={-1}
        aria-hidden="true"
        // the programmatic click() bubbles to the zone: stop it so openPicker is not re-entered
        onClick={(event: MouseEvent<HTMLInputElement>) => event.stopPropagation()}
        onChange={(event) => {
          submit(event.currentTarget.files)
          // allow re-selecting the same file
          event.currentTarget.value = ''
        }}
      />
    </div>
  )
}
