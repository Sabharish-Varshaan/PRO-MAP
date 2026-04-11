export function getLayoutedNodes(nodes, edges) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return []
  }

  const safeNodes = nodes
    .filter((n) => n && typeof n === 'object')
    .map((n, index) => ({
      ...n,
      id: String(n.id || `n${index + 1}`),
    }))

  return safeNodes.map((n, index) => ({
    ...n,
    type: 'task',
    position: {
      x: 80,
      y: index * 180,
    },
  }))
}