import { useEffect, useMemo, useState } from 'react'
import ReactFlow, { Background, Controls, MiniMap } from 'react-flow-renderer'
import CustomNode from './CustomNode'

const EDGE_STYLE = {
  type: 'smoothstep',
  animated: true,
  style: { stroke: '#94a3b8', strokeWidth: 2 },
  markerEnd: { type: 'arrowclosed', color: '#94a3b8' },
}

const nodeTypes = { task: CustomNode }

function buildLinearLayout(nodes) {
  const safeNodes = Array.isArray(nodes) ? nodes : []
  return safeNodes.map((node, index) => ({
    ...node,
    id: String(node.id),
    data: {
      ...(node.data || {}),
      label: node?.data?.label || node?.label || node?.name || String(node.id),
    },
    position: {
      x: index % 2 === 0 ? 80 : 360,
      y: index * 180,
    },
    style: {
      ...(node.style || {}),
      border: node?.data?.is_critical ? '2px solid #ef4444' : '1px solid #e5e7eb',
      backgroundColor: node?.data?.parallel ? '#eff6ff' : '#ffffff',
      borderRadius: 14,
      boxShadow: '0 2px 8px rgba(15,23,42,.06)',
    },
  }))
}

function buildDagLayout(nodes, edges) {
  const safeNodes = Array.isArray(nodes) ? nodes : []
  const safeEdges = Array.isArray(edges) ? edges : []
  const nodeMap = new Map(safeNodes.map((node) => [String(node.id), node]))
  const indegree = new Map(safeNodes.map((node) => [String(node.id), 0]))

  safeEdges.forEach((edge) => {
    const source = String(edge?.source || '')
    const target = String(edge?.target || '')
    if (nodeMap.has(source) && nodeMap.has(target)) {
      indegree.set(target, (indegree.get(target) || 0) + 1)
    }
  })

  const queue = safeNodes.map((node) => String(node.id)).filter((id) => (indegree.get(id) || 0) === 0)
  const levelMap = new Map()
  const visited = new Set()

  while (queue.length > 0) {
    const current = queue.shift()
    if (visited.has(current)) continue
    visited.add(current)
    const currentLevel = levelMap.get(current) || 0

    safeEdges.forEach((edge) => {
      const source = String(edge?.source || '')
      const target = String(edge?.target || '')
      if (source === current && nodeMap.has(target)) {
        const nextLevel = currentLevel + 1
        levelMap.set(target, Math.max(levelMap.get(target) || 0, nextLevel))
        indegree.set(target, Math.max((indegree.get(target) || 1) - 1, 0))
        if ((indegree.get(target) || 0) === 0) {
          queue.push(target)
        }
      }
    })
  }

  if (visited.size !== safeNodes.length) {
    return null
  }

  const levels = new Map()
  safeNodes.forEach((node) => {
    const id = String(node.id)
    const level = levelMap.get(id) || 0
    if (!levels.has(level)) levels.set(level, [])
    levels.get(level).push(node)
  })

  return safeNodes.map((node, index) => {
    const id = String(node.id)
    const level = levelMap.get(id) || 0
    const positionIndex = (levels.get(level) || []).findIndex((item) => String(item.id) === id)
    return {
      ...node,
      id,
      data: {
        ...(node.data || {}),
        label: node?.data?.label || node?.label || node?.name || id,
      },
      position: {
        x: positionIndex % 2 === 0 ? 80 : 360,
        y: level * 180,
      },
      style: {
        ...(node.style || {}),
        border: node?.data?.is_critical ? '2px solid #ef4444' : '1px solid #e5e7eb',
        backgroundColor: node?.data?.parallel ? '#eff6ff' : '#ffffff',
        borderRadius: 14,
        boxShadow: '0 2px 8px rgba(15,23,42,.06)',
      },
    }
  })
}

export default function WorkflowGraph({ nodes, edges, insights, onNodeClick, isLoading = false, mode = 'linear' }) {
  console.log('Rendering Graph')
  const [flowInstance, setFlowInstance] = useState(null)
  const criticalNodeSet = useMemo(() => new Set(insights?.critical_path || []), [insights])
  const safeNodesInput = Array.isArray(nodes) ? nodes : []
  const safeEdgesInput = Array.isArray(edges) ? edges : []

  console.log('GRAPH RECEIVED:', safeNodesInput, safeEdgesInput)

  const linearEdges = useMemo(() => {
    const safeNodes = Array.isArray(nodes) ? nodes.filter((node) => node && node.id) : []
    return safeNodes.slice(0, -1).map((node, index) => ({
      ...EDGE_STYLE,
      id: `linear-${String(node.id)}-${String(safeNodes[index + 1].id)}`,
      source: String(node.id),
      target: String(safeNodes[index + 1].id),
    }))
  }, [nodes])

  const linearNodes = useMemo(() => buildLinearLayout(nodes), [nodes])

  const dagNodes = useMemo(() => buildDagLayout(nodes, edges), [nodes, edges])

  const dagEdges = useMemo(() => {
    if (!Array.isArray(edges)) return []

    const nodeIds = new Set(dagNodes.map((n) => n.id))
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
          style: isCriticalEdge ? { stroke: '#ef4444', strokeWidth: 3 } : (e.style || EDGE_STYLE.style),
          markerEnd: isCriticalEdge ? { type: 'arrowclosed', color: '#ef4444' } : (e.markerEnd || EDGE_STYLE.markerEnd),
        }
      })
      .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
  }, [edges, dagNodes, criticalNodeSet])

  const layoutedNodes = mode === 'dag' && dagNodes ? dagNodes : linearNodes
  const fallbackToLinear = mode === 'dag' && !dagNodes

  const safeEdges = useMemo(() => {
    if (mode === 'dag' && dagNodes) return dagEdges
    return linearEdges
  }, [mode, dagNodes, dagEdges, linearEdges])

  useEffect(() => {
    console.log('STEP DATA:', {
      step: 'workflow-graph-input',
      data: { nodes, edges, insights },
      hasNodes: layoutedNodes.length > 0,
      hasEdges: safeEdges.length > 0,
      safeNodes: layoutedNodes,
      safeEdges,
      mode,
      fallbackToLinear,
    })
  }, [nodes, edges, insights, layoutedNodes, safeEdges, mode, fallbackToLinear])

  useEffect(() => {
    if (!flowInstance || layoutedNodes.length === 0) return
    const timer = setTimeout(() => {
      flowInstance.fitView({ padding: 0.2, duration: 350, includeHiddenNodes: true })
      requestAnimationFrame(() => {
        flowInstance.fitView({ padding: 0.2, duration: 200, includeHiddenNodes: true })
      })
    }, 150)
    return () => clearTimeout(timer)
  }, [flowInstance, layoutedNodes, safeEdges])

  useEffect(() => {
    if (mode !== 'dag' || dagNodes) return
    console.warn('[WorkflowGraph] DAG layout failed, falling back to linear mode.')
  }, [mode, dagNodes])

  if (!layoutedNodes.length) {
    return null
  }

  return (
    <div
      className="canvas-flow-wrap"
      style={{ position: 'relative', inset: 'auto', width: '100%', height: '100%', minHeight: 520 }}
    >
      {isLoading ? (
        <div className="expl-banner" style={{ marginBottom: 12 }}>
          <p className="expl-label">Workflow Graph</p>
          <p className="expl-text">Loading graph...</p>
        </div>
      ) : null}

      {!isLoading && layoutedNodes.length === 0 ? (
        <div className="expl-banner" style={{ marginBottom: 12 }}>
          <p className="expl-label">Workflow Graph</p>
          <p className="expl-text">No graph data available yet.</p>
        </div>
      ) : null}

      <ReactFlow
        nodes={layoutedNodes}
        edges={safeEdges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        style={{ height: '100%', width: '100%' }}
        defaultZoom={0.92}
        minZoom={0.65}
        maxZoom={1.35}
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
