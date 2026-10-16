import { NavLink } from 'react-router-dom';

export function NavBar() {
  return (
    <header className="nav">
      <strong>Hospital Management</strong>
      <nav aria-label="Main">
        <NavLink to="/" end>Dashboard</NavLink>
        <NavLink to="/appointments">Appointments</NavLink>
        <NavLink to="/patients">Patients</NavLink>
        <NavLink to="/doctors">Doctors</NavLink>
        <NavLink to="/settings">Departments &amp; specializations</NavLink>
      </nav>
    </header>
  );
}
