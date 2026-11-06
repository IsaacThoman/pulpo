import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fileExtension, type FileNode } from '@pulpo/contracts'
import { FileDown, FileOutput, Info, Loader2, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ui, uit } from '@/i18n/ui'
import { useAuth } from '@/stores/auth'
import { fetchFilePdf } from './api'
import { filesErrorMessage } from './file-display'
import { officeFileActions, type OfficeConversion } from './office-file'

/** The file view's header buttons: Convert to .docx (or .xlsx, .pptx) and Download as PDF. */
export function OfficeFileHeaderActions({ node, conversion, compact }: {
  node: FileNode
  conversion: OfficeConversion
  compact: boolean
}) {
  const enabled = useAuth((state) => state.officeConversionEnabled)
  const { target, pdf } = officeFileActions(node, enabled)
  const converting = conversion.converting.has(node.id)
  const exporting = conversion.exporting.has(node.id)
  const trashed = node.trashedAt !== null
  return (
    <>
      {target && (
        <Button size="sm" disabled={converting || trashed} onClick={() => void conversion.convert(node, target)}>
          {converting ? <Loader2 className="animate-spin" /> : <FileOutput />}
          {converting ? ui("Converting…") : compact ? `.${target}` : uit`Convert to .${target}`}
        </Button>
      )}
      {pdf && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={ui("Download as PDF")} disabled={exporting || trashed} onClick={() => void conversion.downloadPdf(node)}>
              {exporting ? <Loader2 className="animate-spin" /> : <FileDown />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{ui("Download as PDF")}</TooltipContent>
        </Tooltip>
      )}
    </>
  )
}

/** Says that a legacy or OpenDocument file is read only here, and what converting does. */
export function OfficeConversionBanner({ node }: { node: FileNode }) {
  const enabled = useAuth((state) => state.officeConversionEnabled)
  const { target } = officeFileActions(node, enabled)
  if (!target) return null
  return (
    <div role="note" className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2 text-sm text-muted-foreground sm:px-6">
      <Info className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        {uit`.${fileExtension(node.name)} files open read only. Converting makes a .${target} copy beside it; the original stays as it is.`}
      </span>
    </div>
  )
}

/**
 * A read-only preview of an office file the browser cannot show itself: the server renders it
 * as PDF, shown in the browser's PDF viewer. The blob URL only ever carries a PDF type.
 */
export function OfficePdfPreview({ node }: { node: FileNode }) {
  const userId = useAuth((state) => state.user?.id)
  const pdf = useQuery({
    // Outside the ['files', user] tree: Files refreshes invalidate that on every change, and each
    // refetch would render the document again on the server.
    queryKey: ['office-pdf', userId, node.id, node.contentChecksum ?? node.revision],
    // Leaving the view cancels the request, and with it the conversion.
    queryFn: ({ signal }) => fetchFilePdf(node, signal),
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    retry: false,
  })
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!pdf.data) return
    const objectUrl = URL.createObjectURL(pdf.data.slice(0, pdf.data.size, 'application/pdf'))
    setUrl(objectUrl)
    return () => {
      URL.revokeObjectURL(objectUrl)
      setUrl(null)
    }
  }, [pdf.data])

  if (pdf.isError) {
    return (
      <div className="grid h-64 place-items-center p-8 text-center">
        <div className="max-w-sm space-y-3">
          <p className="text-sm text-muted-foreground">{uit`No preview: ${filesErrorMessage(pdf.error, node.name)}`}</p>
          <Button variant="outline" size="sm" onClick={() => void pdf.refetch()}><RotateCw /> {ui("Try again")}</Button>
        </div>
      </div>
    )
  }
  if (!url) {
    return (
      <div className="grid h-64 place-items-center" aria-busy="true">
        <span className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{ui("Preparing preview…")}</span>
      </div>
    )
  }
  return <iframe src={url} title={node.name} className="h-[calc(100dvh-10rem)] w-full rounded-md border bg-background" />
}
