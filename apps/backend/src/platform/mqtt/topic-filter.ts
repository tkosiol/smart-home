/** Whether an MQTT topic matches a subscription filter (`+` is one level, `#` the rest). */
export function matchesFilter(filter: string, topic: string): boolean {
  const filterLevels = filter.split('/');
  const topicLevels = topic.split('/');
  for (const [index, level] of filterLevels.entries()) {
    if (level === '#') return index === filterLevels.length - 1;
    const actual = topicLevels[index];
    if (actual === undefined) return false;
    if (level !== '+' && level !== actual) return false;
  }
  return filterLevels.length === topicLevels.length;
}
