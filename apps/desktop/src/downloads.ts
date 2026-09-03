type DesktopDownload = Pick<Electron.DownloadItem,
  'cancel' | 'getFilename' | 'setSaveDialogOptions'
>

export function prepareDesktopDownload(item: DesktopDownload, trusted: boolean): void {
  if (!trusted) {
    item.cancel()
    return
  }

  item.setSaveDialogOptions({ defaultPath: item.getFilename() })
}
