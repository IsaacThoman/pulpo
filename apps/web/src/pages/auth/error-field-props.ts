/** Props that mark a field invalid and point it at the form error, when there is one. */
export function errorFieldProps(errorId: string, invalid: boolean, described = invalid) {
  return {
    'aria-invalid': invalid || undefined,
    'aria-describedby': described ? errorId : undefined,
  }
}
