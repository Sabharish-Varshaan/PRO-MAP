import { Handle, Position } from 'react-flow-renderer'

export default function CustomNode({ data, selected }) {
  const priority = data?.priority || 'Medium'
  const features = Array.isArray(data?.features) ? data.features.slice(0, 2) : []
  const modules  = Array.isArray(data?.modules)  ? data.modules.slice(0, 2)  : []

  function handleNodeClick(e) {
    e.stopPropagation()
    if (typeof data?.onClick === 'function') {
      data.onClick(e)
    }
  }

  return (
    <div className={`task-node${selected ? ' selected' : ''}`}
    onClick={handleNodeClick}>
      <div className={`task-node__bar task-node__bar--${priority}`} />

      <Handle type="target" position={Position.Top} className="task-node__handle" />

      <p className="task-node__title">{data?.label}</p>

      {data?.description ? (
        <p className="task-node__desc">{data.description}</p>
      ) : null}

      {features.length > 0 && (
        <div style={{ marginBottom: 4 }}>
          <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-3)', marginBottom: 4 }}>Features</div>
          <div className="task-node__chips">
            {features.map((f) => <span key={f} className="task-node__chip">{f}</span>)}
          </div>
        </div>
      )}

      {modules.length > 0 && (
        <div style={{ marginBottom: 4 }}>
          <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-3)', marginBottom: 4 }}>Modules</div>
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