function Header() {
  return (
    <header className="top-nav">
      <div className="top-nav__brand">
        <div className="top-nav__logo">P</div>
        <div>
          <p className="top-nav__title">PROMAP</p>
          <p className="top-nav__subtitle">Workflow Generator</p>
        </div>
      </div>
      <span className="top-nav__badge">AI Workflow Engine</span>
    </header>
  )
}

export default Header