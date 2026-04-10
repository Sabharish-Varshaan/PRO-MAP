function toList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item : String(item || '')))
      .map((item) => item.trim())
      .filter(Boolean)
  }
  if (typeof value === 'string') {
    const single = value.trim()
    return single ? [single] : []
  }
  return []
}

function toRoles(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((role) => {
      if (typeof role === 'string') {
        const name = role.trim()
        return name ? { name, responsibilities: [] } : null
      }

      if (role && typeof role === 'object') {
        const name = String(role.name || role.role || '').trim()
        const responsibilities = toList(role.responsibilities || role.tasks)
        if (!name && responsibilities.length === 0) return null
        return {
          name: name || 'Unnamed role',
          responsibilities,
        }
      }

      return null
    })
    .filter(Boolean)
}

function ListSection({ title, items }) {
  const safeItems = toList(items)

  return (
    <section>
      <h4>{title}</h4>
      {safeItems.length > 0 ? (
        <ul>
          {safeItems.map((item, index) => (
            <li key={`${title}-${index}`}>{item}</li>
          ))}
        </ul>
      ) : (
        <p>No data available.</p>
      )}
    </section>
  )
}

export default function RequirementsPanel({ requirementsData, isLoading = false }) {
  const source = (requirementsData && typeof requirementsData === 'object') ? requirementsData : {}
  const teamRoles = toRoles(source.team?.roles)
  const hasRequirements = Boolean(requirementsData && typeof requirementsData === 'object')

  return (
    <section
      className="requirements-panel"
      style={{
        background: '#ffffff',
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
      }}
    >
      <h3 style={{ marginTop: 0, marginBottom: 12 }}>Requirements Summary</h3>

      {isLoading ? (
        <p style={{ margin: 0, color: '#475569' }}>Loading requirements...</p>
      ) : null}

      {!isLoading && !hasRequirements ? (
        <p style={{ margin: '0 0 12px 0', color: '#64748b' }}>
          Requirements are not available yet. Generate workflow to populate this section.
        </p>
      ) : null}

      <div
        className="requirements-panel-grid"
        style={{
          display: 'grid',
          gap: 16,
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          opacity: isLoading ? 0.65 : 1,
        }}
      >
        <ListSection title="Requirements" items={source.requirements} />
        <ListSection title="User Actions" items={source.user_actions} />
        <ListSection title="System Behavior" items={source.system_behavior} />
        <ListSection title="Data Entities" items={source.data_entities} />
        <ListSection title="Priority Features" items={source.priority_features} />

        <section>
          <h4>Team Roles</h4>
          {teamRoles.length > 0 ? (
            <ul>
              {teamRoles.map((role, index) => (
                <li key={`${role.name}-${index}`}>
                  <strong>{role.name}</strong>
                  {role.responsibilities.length > 0
                    ? `: ${role.responsibilities.join(', ')}`
                    : ''}
                </li>
              ))}
            </ul>
          ) : (
            <p>No data available.</p>
          )}
        </section>
      </div>
    </section>
  )
}