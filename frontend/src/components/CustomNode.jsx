import { Handle, Position } from 'react-flow-renderer'

export default function CustomNode({ data, selected }) {
  const priority = data?.priority || 'Medium'
  const phase = data?.phase || 'Planning'
  const features = Array.isArray(data?.features) ? data.features.slice(0, 2) : []
  const modules  = Array.isArray(data?.modules)  ? data.modules.slice(0, 2)  : []

  return (
    <div className={`task-node${selected ? ' selected' : ''}`}>
      <div className={`task-node__bar task-node__bar--${priority}`} />

      <Handle type="target" position={Position.Top} className="task-node__handle" />

      <h3 className="task-node__title">{data?.label}</h3>

      <div className="task-node__phase-row">
        <span className="task-node__phase">{phase}</span>
        {data?.parallelizable ? <span className="task-node__phase task-node__phase--parallel">Parallelizable</span> : null}
      </div>

      {(data?.is_critical || data?.is_bottleneck) && (
        <div className="task-node__flags">
          {data?.is_critical && (
            <span className="task-node__flag task-node__flag--critical">Critical</span>
          )}
          {data?.is_bottleneck && (
            <span className="task-node__flag task-node__flag--bottleneck">Bottleneck</span>
          )}
        </div>
      )}

      {data?.description ? (
        <p className="task-node__desc">{data.description}</p>
      ) : null}

      {features.length > 0 && (
        <div className="task-node__meta-block">
          <div className="task-node__meta-label">Features</div>
          <div className="task-node__chips">
            {features.map((f) => <span key={f} className="task-node__chip">{f}</span>)}
          </div>
        </div>
      )}

      {modules.length > 0 && (
        <div className="task-node__meta-block">
          <div className="task-node__meta-label">Modules</div>
          <div className="task-node__chips">
            {modules.map((m) => <span key={m} className="task-node__chip task-node__chip--mod">{m}</span>)}
          </div>
        </div>
      )}

      <div className="task-node__footer">
        {data?.parallel && <span className="task-node__parallel">‖ Parallel</span>}
        <span className={`task-node__priority task-node__priority--${priority}`}>{priority}</span>
      </div>

      <Handle type="source" position={Position.Bottom} className="task-node__handle" />
    </div>
  )
}