/** A label used mid-sentence: "Background jobs" becomes "background jobs", but "AI features" stays. */
export function inSentence(label: string): string {
  const firstWord = label.split(/\s+/)[0] ?? "";
  if (firstWord.length > 1 && firstWord === firstWord.toUpperCase() && /[A-Z]/.test(firstWord)) return label;
  return label.charAt(0).toLowerCase() + label.slice(1);
}
