import dagre from 'dagre'

const NODE_WIDTH = 220
const NODE_HEIGHT = 120

export function getLayoutedNodes(nodes, edges) {
  try {
    const graph = new dagre.graphlib.Graph()
    graph.setDefaultEdgeLabel(() => ({}))
    graph.setGraph({
      rankdir: 'TB',
      ranksep: 92,
      nodesep: 64,
      marginx: 32,
      marginy: 32,
    })

    nodes.forEach((node) => {
      graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
    })

    edges.forEach((edge) => {
      graph.setEdge(edge.source, edge.target)
    })

    dagre.layout(graph)

    return nodes.map((node, index) => {
      const position = graph.node(node.id)
      if (!position) {
        return {
          ...node,
          type: node.type || 'default',
          position: {
            x: index * 260,
            y: 0,
          },
        }
      }

      return {
        ...node,
        type: node.type || 'default',
        position: {
          x: position.x - NODE_WIDTH / 2,
          y: position.y - NODE_HEIGHT / 2,
        },
      }
    })
  } catch {
    return nodes.map((node, index) => ({
      ...node,
      type: node.type || 'default',
      position: {
        x: index * 260,
        y: 0,
      },
    }))
  }
}
