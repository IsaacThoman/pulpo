/** Only the latest, uninterrupted drawer animation may commit navigation. */
export function createDrawerTransition() {
  let revision = 0
  return {
    cancel() { revision += 1 },
    begin(commit: () => void) {
      const owner = ++revision
      return (finished: boolean) => {
        if (owner !== revision) return
        revision += 1
        if (finished) commit()
      }
    },
  }
}
