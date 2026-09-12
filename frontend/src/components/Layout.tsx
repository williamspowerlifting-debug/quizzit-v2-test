import React from "react";
import { useApp } from "../store";
import { api } from "../api";

export function Layout({
  children,
  onActivities,
  onClassrooms,
  onNew,
}: {
  children: React.ReactNode;
  onActivities: () => void;
  onClassrooms: () => void;
  onNew: () => void;
}) {
  const { teacher, setTeacher } = useApp();
  async function logout() {
    await api.logout().catch(() => {});
    setTeacher(null);
  }
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand" onClick={onNew} role="button">
          <span className="brand-mark">Q</span>
          <span>Quizzit</span>
        </div>
        <nav>
          {teacher && <button onClick={onActivities}>My Activities</button>}
          {teacher && <button onClick={onClassrooms}>Classrooms</button>}
          {teacher && <button className="primary" onClick={onNew}>Create Activity</button>}
        </nav>
        <div className="account">
          {teacher ? (
            <>
              {teacher.picture && <img src={teacher.picture} alt="" />}
              <span>{teacher.name || teacher.email}</span>
              <button onClick={logout}>Sign out</button>
            </>
          ) : null}
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
