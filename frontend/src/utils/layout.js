import dagre from 'dagre'

const NODE_W = 260
const NODE_H = 140

export function getLayoutedNodes(nodes, edges) {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', nodesep: 100, ranksep: 160, marginx: 50, marginy: 50 })

  nodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }))
  edges.forEach((e) => { if (e.source && e.target) g.setEdge(e.source, e.target) })

  dagre.layout(g)

  const positioned = nodes.map((n) => {
    const pos = g.node(n.id)
    return {
      ...n,
      type: 'task',
      position: {
        x: pos ? pos.x - NODE_W / 2 : (n.position?.x || 0),
        y: pos ? pos.y - NODE_H / 2 : (n.position?.y || 0),
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