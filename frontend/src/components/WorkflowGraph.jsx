import { useMemo } from 'react'
import ReactFlow, { Background, Controls, MiniMap } from 'react-flow-renderer'
import CustomNode from './CustomNode'

const NODE_TYPES = { task: CustomNode }

const EDGE_STYLE = {
  type: 'smoothstep',
  animated: true,
  style: { stroke: '#2563eb', strokeWidth: 2 },
  markerEnd: { type: 'arrowclosed', color: '#2563eb' },
}

export default function WorkflowGraph({ nodes, edges, onNodeClick }) {
  const safeNodes = useMemo(() => {
    if (!Array.isArray(nodes)) return []

    return nodes
      .filter((n) => n && typeof n === 'object' && n.id)
      .map((n) => ({
        ...n,
        id: String(n.id),
      }))
  }, [nodes])

  const safeEdges = useMemo(() => {
    if (!Array.isArray(edges)) return []

    const nodeIds = new Set(safeNodes.map((n) => n.id))

    return edges
      .filter((e) => e && typeof e === 'object' && e.source && e.target)
      .map((e, i) => {
        const source = String(e.source)
        const target = String(e.target)

        return {
          ...EDGE_STYLE,
          ...e,
          id: String(e.id || `e-${source}-${target}-${i}`),
          source,
          target,
        }
      })
      .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
  }, [edges, safeNodes])

  return (
    <div className="canvas-flow-wrap">
      <ReactFlow
        nodes={safeNodes}
        edges={safeEdges}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.25}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        onNodeClick={onNodeClick}
      >
        <Background gap={24} size={1} color="#d5d3cc" />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={(n) => {
            const p = n.data?.priority
            if (p === 'High') return '#fecaca'
            if (p === 'Low') return '#a7f3d0'
            return '#fde68a'
          }}
          maskColor="rgba(245,244,240,.75)"
          style={{
            borderRadius: 10,
            border: '1px solid #e8e6e0',
          }}
        />
      </ReactFlow>
    </div>
  )
}
