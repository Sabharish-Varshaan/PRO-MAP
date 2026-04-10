export default function AppLayout({
  sidebar,
  topbar,
  children,
  rightPanel,
  className = '',
}) {
  return (
    <div className={`app-shell ${className}`.trim()}>
      {sidebar ? <aside className="app-shell-sidebar">{sidebar}</aside> : null}

      <div className="app-shell-main">
        {topbar ? <header className="app-shell-topbar">{topbar}</header> : null}
        <main className="app-shell-content">{children}</main>
      </div>

      {rightPanel ? <aside className="app-shell-right">{rightPanel}</aside> : null}
    </div>
  )
}