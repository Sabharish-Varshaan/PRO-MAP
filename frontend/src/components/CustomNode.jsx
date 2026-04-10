import { Handle, Position } from 'react-flow-renderer'

function CustomNode({ data }) {
  const features = Array.isArray(data?.features) ? data.features.slice(0, 2) : []
  const modules = Array.isArray(data?.modules) ? data.modules.slice(0, 2) : []

  return (
    <div className="task-node">
      <Handle type="target" position={Position.Top} className="task-node__handle" />

      <p className="task-node__title">{data?.label}</p>
      <p className="task-node__description">{data?.description}</p>

      {features.length > 0 ? (
        <div className="task-node__meta">
          <span className="task-node__meta-label">Features</span>
          <div className="task-node__chips">
            {features.map((feature) => (
              <span key={feature} className="task-node__chip">
                {feature}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {modules.length > 0 ? (
        <div className="task-node__meta">
          <span className="task-node__meta-label">Modules</span>
          <div className="task-node__chips">
            {modules.map((module) => (
              <span key={module} className="task-node__chip task-node__chip--alt">
                {module}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {data?.parallel ? <span className="task-node__badge">Parallel</span> : null}

      <Handle type="source" position={Position.Bottom} className="task-node__handle" />
    </div>
  )
}

export default CustomNode
