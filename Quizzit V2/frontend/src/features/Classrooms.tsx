import { useEffect, useState } from "react";
import { api } from "../api";
import { useApp } from "../store";
import type { Classroom, Student } from "../types";

export function Classrooms() {
  const {teacher}=useApp();
  const [rooms,setRooms]=useState<Classroom[]>([]);
  const [selected,setSelected]=useState<Classroom|null>(null);
  const [students,setStudents]=useState<Student[]>([]);
  const [name,setName]=useState("");
  const [student,setStudent]=useState("");
  const [bulk,setBulk]=useState("");
  const [activities,setActivities]=useState<any[]>([]);
  const [activityId,setActivityId]=useState("");

  async function load(){if(!teacher)return; setRooms((await api.listClassrooms(teacher.id)).classrooms||[]);}
  useEffect(()=>{load()},[teacher?.id]);
  async function open(c:Classroom){setSelected(c); const info=await api.classroomByCode(c.code);setStudents(info.students||[]);}
  async function create(){if(!name.trim())return;await api.createClassroom(name.trim());setName("");load();}
  async function add(){if(!selected||!student.trim())return;await api.addStudent(selected.id,student.trim());setStudent("");open(selected);}
  async function addBulk(){if(!selected)return;const names=bulk.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);if(names.length){await api.addStudentsBulk(selected.id,names);setBulk("");open(selected);}}
  async function loadActivities(){if(!teacher)return;setActivities((await api.listActivities(teacher.id)).exercises||[]);}
  useEffect(()=>{loadActivities()},[teacher?.id]);

  if(selected) return <section className="card"><button onClick={()=>setSelected(null)}>← Classrooms</button><h1>{selected.name}</h1><p className="code">Join code: <strong>{selected.code}</strong></p><div className="classroom-grid"><div><h2>Students</h2>{students.map(s=><div className="student-row" key={s.id}>{s.name}</div>)}<input placeholder="Student name" value={student} onChange={e=>setStudent(e.target.value)}/><button onClick={add}>Add student</button><textarea placeholder="Or paste one student per line" value={bulk} onChange={e=>setBulk(e.target.value)}/><button onClick={addBulk}>Add students</button></div><div><h2>Assign activity</h2><select value={activityId} onChange={e=>setActivityId(e.target.value)}><option value="">Choose activity…</option>{activities.map(a=><option key={a.exerciseId} value={a.exerciseId}>{a.name}</option>)}</select><button disabled={!activityId} onClick={async()=>{await api.assignActivity(selected.id,activityId);alert("Assigned");}}>Assign</button><p className="muted">Students use the class code to sign in.</p></div></div></section>;

  return <section className="card"><div className="section-head"><div><h1>Classrooms</h1><p className="muted">Create classes and assign activities.</p></div></div><div className="inline-form"><input placeholder="New classroom name" value={name} onChange={e=>setName(e.target.value)}/><button className="primary" onClick={create}>Create classroom</button></div>{rooms.map(c=><article className="activity-item" key={c.id}><div><h3>{c.name}</h3><p>Code: <strong>{c.code}</strong></p></div><button onClick={()=>open(c)}>Open</button></article>)}</section>
}
