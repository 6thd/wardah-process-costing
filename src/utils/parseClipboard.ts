export const parseClipboardTable = async (): Promise<string[][]> => {
  const text = await navigator.clipboard.readText()
  return text
    .split(/\r?\n/)
    .map((row) => row.split('\t'))
    .filter((cells) => cells.some((cell) => cell.trim().length > 0))
}
