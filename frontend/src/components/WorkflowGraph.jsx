import ReactFlow, { Background, Controls } from 'react-flow-renderer'

function WorkflowGraph({ nodes, edges, nodeTypes }) {
  return (
    <section className="card graph-card">
      <div className="graph-card__header">
        <h2>Workflow Graph</h2>
        <p>Drag, zoom, and inspect task dependencies.</p>
      </div>

      <div className="graph-card__canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.18 }}
          minZoom={0.35}
          maxZoom={1.9}
        >
          <Background gap={20} size={1} color="#dbe2ea" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </section>
  )
}

export default WorkflowGraph
