import dagre from 'dagre'

const NODE_W = 220
const NODE_H = 170

export function getLayoutedNodes(nodes, edges) {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', nodesep: 55, ranksep: 80, marginx: 40, marginy: 40 })

  nodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }))
  edges.forEach((e) => { if (e.source && e.target) g.setEdge(e.source, e.target) })

  dagre.layout(g)

  return nodes.map((n) => {
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
}