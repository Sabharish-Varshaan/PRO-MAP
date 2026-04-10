import dagre from 'dagre'

const NODE_W = 260
const NODE_H = 140

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

  const safeEdges = Array.isArray(edges)
    ? edges.filter((e) => e && e.source && e.target)
    : []

  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', nodesep: 100, ranksep: 160, marginx: 50, marginy: 50 })

  safeNodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }))
  safeEdges.forEach((e) => g.setEdge(String(e.source), String(e.target)))

  dagre.layout(g)

  const positioned = safeNodes.map((n, index) => {
    const pos = g.node(n.id)
    const fallbackX = index % 2 === 0 ? 0 : 300
    const fallbackY = index * 120

    return {
      ...n,
      type: 'task',
      position: {
        x: pos ? pos.x - NODE_W / 2 : fallbackX,
        y: pos ? pos.y - NODE_H / 2 : fallbackY,
      },
    }
  })

  const minX = Math.min(...positioned.map((n) => n.position?.x || 0))
  const minY = Math.min(...positioned.map((n) => n.position?.y || 0))
  const baseX = Number.isFinite(minX) ? minX : 0
  const baseY = Number.isFinite(minY) ? minY : 0

  return positioned.map((n) => ({
    ...n,
    position: {
      x: (n.position?.x || 0) - baseX + 40,
      y: (n.position?.y || 0) - baseY + 40,
    },
  }))
}