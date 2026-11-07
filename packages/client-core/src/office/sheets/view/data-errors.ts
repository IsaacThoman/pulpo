export const DATA_ERRORS = {
  size: 'This range is too large to edit safely. Select a smaller range.',
  partialArray: "You can't change part of an array.",
  arrays: 'Cannot sort a range containing spilled or legacy array formulas.',
  merges: 'To do this, all the merged cells need to be the same size.',
  filter: 'Cannot change this filter safely. Only value-list filters are supported.',
  tables: 'Select cells inside a single table before sorting it.',
  keys: 'Sort keys must be columns inside the sorted range.',
  changed: 'The sheet changed while preparing the sort. Try again.',
  formulas: 'Cannot sort an opaque What-If data table.',
} as const

export class DataOperationError extends Error {
  constructor(readonly reason: keyof typeof DATA_ERRORS) {
    super(DATA_ERRORS[reason])
  }
}
