"use client"

import { useRef, useState } from "react"
import { Upload } from "lucide-react"
import { Button } from "@/components/ui/button"

export function FileUpload({
  accept,
  onFileSelected,
  className,
  disabled,
  
}: {
  accept?: string
  onFileSelected: (file: File) => void
  className?: string
  disabled?: boolean     
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  function handleFiles(files: FileList | null) {
    const file = files?.[0]
    if (file) onFileSelected(file)
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setIsDragging(true)
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setIsDragging(false)
        handleFiles(e.dataTransfer.files)
      }}
      className={`flex h-10 items-center gap-2 rounded-sm border px-2 text-sm transition-colors ${
        isDragging
          ? "border-primary bg-primary/5"
          : "border-input bg-muted/30"
      } ${className ?? ""}`}
    >
      <Upload className="size-4 shrink-0 text-muted-foreground" />

      <span className="flex-1 truncate text-muted-foreground">
        Seleccione archivo en su equipo.
      </span>

      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 shrink-0 rounded-sm px-3 text-xs"
        onClick={() => inputRef.current?.click()}
      >
        Examinar
      </Button>

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
    </div>
  )
}