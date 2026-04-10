import { useEffect, useMemo, useState } from 'react'
import ReactFlow, { Background, Controls, MiniMap } from 'react-flow-renderer'
import CustomNode from './CustomNode'

const EDGE_STYLE = {
  type: 'smoothstep',
  animated: true,
  style: { stroke: '#94a3b8', strokeWidth: 2 },
  markerEnd: { type: 'arrowclosed', color: '#94a3b8' },
}

export default function WorkflowGraph({ nodes, edges, insights, onNodeClick, isLoading = false }) {
  const [flowInstance, setFlowInstance] = useState(null)
  const nodeTypes = useMemo(() => ({ task: CustomNode }), [])
  const criticalNodeSet = useMemo(() => new Set(insights?.critical_path || []), [insights])

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
        const isCriticalEdge = criticalNodeSet.has(source) && criticalNodeSet.has(target)

        return {
          ...EDGE_STYLE,
          ...e,
          id: String(e.id || `e-${source}-${target}-${i}`),
          source,
          target,
          style: isCriticalEdge
            ? { stroke: '#ef4444', strokeWidth: 3 }
            : (e.style || EDGE_STYLE.style),
          markerEnd: isCriticalEdge
            ? { type: 'arrowclosed', color: '#ef4444' }
            : (e.markerEnd || EDGE_STYLE.markerEnd),
        }
      })
      .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
  }, [edges, safeNodes, criticalNodeSet])

  useEffect(() => {
    if (!flowInstance || safeNodes.length === 0) return
    const timer = setTimeout(() => {
      flowInstance.fitView({ padding: 0.2, duration: 350, includeHiddenNodes: true })
      requestAnimationFrame(() => {
        flowInstance.fitView({ padding: 0.2, duration: 200, includeHiddenNodes: true })
      })
    }, 150)
    return () => clearTimeout(timer)
  }, [flowInstance, safeNodes, safeEdges])

  return (
    <div className="canvas-flow-wrap">
      {isLoading ? (
        <div className="expl-banner" style={{ marginBottom: 12 }}>
          <p className="expl-label">Workflow Graph</p>
          <p className="expl-text">Loading graph...</p>
        </div>
      ) : null}

      {!isLoading && safeNodes.length === 0 ? (
        <div className="expl-banner" style={{ marginBottom: 12 }}>
          <p className="expl-label">Workflow Graph</p>
          <p className="expl-text">No graph data available yet.</p>
        </div>
      ) : null}

      <ReactFlow
        nodes={safeNodes}
        edges={safeEdges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        style={{ height: '100%', width: '100%' }}
        defaultZoom={1}
        minZoom={0.5}
        maxZoom={2}
        panOnScroll
        panOnDrag
        panOnScrollSpeed={0.8}
        zoomOnScroll={false}
        zoomOnPinch
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
        onInit={setFlowInstance}
        onNodeClick={(event, node) => {
          if (typeof onNodeClick === 'function') {
            onNodeClick(event, node)
          }
        }}
      >
        <Background gap={24} size={1} color="#d5d3cc" />
        <Controls />
        <MiniMap
          nodeColor={(n) => {
            const p = n.data?.priority
            if (p === 'High') return '#f59e0b'
            if (p === 'Low') return '#64748b'
            return '#3b82f6'
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
