export const parseClipboardTable = async (): Promise<string[][]> => {
  const text = await navigator.clipboard.readText()
  return text
    .split(/\r?\n/)
    .map((row) => row.split('\t'))
    .filter((cells) => cells.length > 0 && cells.some((cell) => cell.trim().length > 0))
}
