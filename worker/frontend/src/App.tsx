import { useState } from "react";
import { AppProvider, useApp } from "./store";
import { Layout } from "./components/Layout";
import { Login } from "./components/Login";
import { Builder } from "./features/Builder";
import { Activities } from "./features/Activities";
import { Classrooms } from "./features/Classrooms";
import { Student } from "./features/Student";
import { normaliseActivity } from "./utils";

function AppInner() {
  const {teacher,setActivity,setVideo}=useApp();
  const [page,setPage]=useState<"builder"|"activities"|"classrooms"|"student">("builder");

  if(!teacher && page!=="student") return <Layout onActivities={()=>{}} onClassrooms={()=>{}} onNew={()=>setPage("builder")}><Login/></Layout>;

  function newActivity(){setActivity({name:"Untitled Activity",videoUrl:"",videoMode:null,sentences:[],tags:[],originalTranscript:null});setVideo(null);setPage("builder");}
  async function openActivity(id:string){try{const raw=await (await import("./api")).api.loadActivity(teacher!.id,id);setActivity(normaliseActivity(raw) as any);setVideo(raw.videoUrl?{source:(raw.videoMode||"url") as any,directUrl:raw.videoUrl,playbackUrl:raw.videoUrl,youtubeVideoId:raw.youtubeVideoId||undefined}:null);setPage("builder");}catch(e){alert(e instanceof Error?e.message:"Could not open activity");}}

  return <Layout onActivities={()=>setPage("activities")} onClassrooms={()=>setPage("classrooms")} onNew={newActivity}>
    {page==="builder"&&<Builder/>}
    {page==="activities"&&<Activities onOpen={openActivity} onNew={newActivity}/>}
    {page==="classrooms"&&<Classrooms/>}
    {page==="student"&&<Student/>}
  </Layout>
}

export default function App(){
  const params = new URLSearchParams(location.search);
  const student = params.get("student")==="1" || !!params.get("id");
  const lessonId = params.get("id") || undefined;
  return <AppProvider>{student?<Layout onActivities={()=>{}} onClassrooms={()=>{}} onNew={()=>{}}><Student lessonId={lessonId}/></Layout>:<AppInner/>}</AppProvider>;
}
