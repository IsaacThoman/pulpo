/** Reduce input-sized collections without passing one call argument per item. */
export function maxOf(values: Iterable<number>): number {
  let result = -Infinity
  for (const value of values) result = Math.max(result, value)
  return result
}

export function minOf(values: Iterable<number>): number {
  let result = Infinity
  for (const value of values) result = Math.min(result, value)
  return result
}

/** Append in order, including when the source is the destination array itself. */
export function pushAll<T>(target: T[], values: Iterable<T>): void {
  const source = values === target ? target.slice() : values
  for (const value of source) target.push(value)
}

/** Insert a snapshot without spreading input into splice/unshift arguments. */
export function insertAll<T>(target: T[], index: number, values: Iterable<T>): void {
  const source = Array.from(values)
  if (!source.length) return
  const at = Math.max(0, Math.min(target.length, index < 0 ? target.length + index : index))
  for (let i = target.length - 1; i >= at; i--) target[i + source.length] = target[i]!
  for (let i = 0; i < source.length; i++) target[at + i] = source[i]!
}

/** Build the fragment first so moving existing child nodes preserves their order. */
export function replaceChildrenWith(target: Element, children: Iterable<Node>): void {
  const fragment = target.ownerDocument.createDocumentFragment()
  for (const child of Array.from(children)) fragment.appendChild(child)
  target.replaceChildren(fragment)
}
